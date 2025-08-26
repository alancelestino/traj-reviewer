from flask import Flask, jsonify, request
from flask_cors import CORS
import openai
from dotenv import load_dotenv
import os
import json
import logging
import re

load_dotenv()
logging.basicConfig(level=logging.INFO)

app = Flask(__name__)
CORS(app)

client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = """
# 🔎 Identity,  Goals, and Setting

You are part of an LLM-based system designed to **audit, fix, and improve SWE-bench agentic trajectories with a human-in-the-loop**.
In these trajectories, an agent attempts to resolve a GitHub issue by interacting with the repository inside a containerized environment.

---

# 🧭 Instructions

You will be provided with a **list of agentic steps**.
- **Step 0** contains the initial system prompt from the agent's history, if available.
- **Subsequent steps (1, 2, 3...)** are from the agent's trajectory.

Each trajectory step is a dictionary with the format:
```json
[{{"step": <int>, "thought": <str>, "action": <str>, "observation": <str>}}]
```

Note that the thought comes after the action and the observation is the result of the action.

The human may interact with you in two ways:

1. **General Questions**
   The human may ask general questions about the trajectory. Respond clearly and accurately.

2. **Filtering Requests**
   The human may ask you to filter for certain types of steps (e.g., all steps involving file reads, test invocations, etc.).
   In these cases, call the appropriate filter function.

Use your best judgement to decide between answering general questions and filtering requests.
For example, if the human asks "what are the steps that..." this is a filtering request.
If the human says "help me understand the issue", this is a general question.

---

# 📂 Trajectory
{trajectory}
"""

tools = [
    {
        "type": "function",
        "function": {
            "name": "apply_semantic_filter",
            "description": "Filters the trajectory based on a semantic query and returns the filtered steps along with reasoning.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filtered_steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "originalIndex": {"type": "integer"},
                                "reasoning": {"type": "string"}
                            },
                            "required": ["originalIndex", "reasoning"]
                        }
                    }
                },
                "required": ["filtered_steps"]
            }
        }
    }
]

@app.route('/')
def index():
    return "Trajectory Viewer Backend"

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    messages = data.get('messages', [])
    history = data.get('history')

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    # Build sanitized steps from history-only representation
    sanitized_trajectory = []
    try:
        if isinstance(history, list) and len(history) > 1:
            # Step 0 from history[1] (do not include history[0] in display)
            step_zero_text = ""
            step_zero_content = history[1].get("content") if isinstance(history[1], dict) else None
            if isinstance(step_zero_content, list) and len(step_zero_content) > 0:
                first_item = step_zero_content[0]
                if isinstance(first_item, dict):
                    step_zero_text = first_item.get("text", "")
            elif isinstance(step_zero_content, str):
                step_zero_text = step_zero_content

            sanitized_trajectory.append({
                "step": 0,
                "content": step_zero_text
            })

            # Subsequent steps are pairs: assistant at even i and tool at i+1
            # history[2] & history[3] => step 1, history[4] & history[5] => step 2, ...
            # Start at i=2 and advance by 2
            i = 2
            step_number = 1
            while i + 1 < len(history):
                assistant = history[i] if isinstance(history[i], dict) else {}
                tool_msg = history[i + 1] if isinstance(history[i + 1], dict) else {}

                thought = assistant.get('thought', '')
                action = assistant.get('action', '')
                observation_full = tool_msg.get('content', '')
                observation = observation_full
                try:
                    # Extract after the delimiter if present
                    if isinstance(observation_full, str) and 'OBSERVATION:\n' in observation_full:
                        observation = observation_full.split('OBSERVATION:\n', 1)[1]
                except Exception:
                    pass

                sanitized_trajectory.append({
                    "step": step_number,
                    "thought": thought,
                    "action": action,
                    "observation": observation,
                })

                i += 2
                step_number += 1
    except Exception as e:
        logging.error(f"Failed to build sanitized trajectory from history: {e}")
        return jsonify({"error": "Invalid history format"}), 400

    # Format the trajectory for the prompt
    formatted_trajectory = json.dumps(sanitized_trajectory, indent=2)
    prompt_with_trajectory = SYSTEM_PROMPT.format(trajectory=formatted_trajectory)

    # Prepend the system prompt to the messages
    full_messages = [{"role": "system", "content": prompt_with_trajectory}] + messages

    try:
        response = client.chat.completions.create(
            model="gpt-5",
            messages=full_messages,
            tools=tools,
            tool_choice="auto",
        )
        return jsonify(response.choices[0].message.to_dict())
    except Exception as e:
        logging.error(f"An error occurred while communicating with OpenAI: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/replace', methods=['POST'])
def replace():
    data = request.json
    content = data.get('content')
    search_term = data.get('search_term')
    replace_term = data.get('replace_term')

    logging.info(f"Replace request - search_term length: {len(search_term) if search_term else 0}, replace_term length: {len(replace_term) if replace_term else 0}")
    logging.info(f"Search term (raw): {repr(search_term)}")
    logging.info(f"Replace term (raw): {repr(replace_term)}")
    logging.info(f"Content length: {len(content) if content else 0}")

    if not all([content, search_term, replace_term]):
        return jsonify({"error": "Missing required fields"}), 400

    try:
        # Parse JSON and perform replacements only within the history object
        doc = json.loads(content)
        history = doc.get('history')
        if not isinstance(history, list):
            return jsonify({"error": "No history array found in JSON"}), 400

        # Interpret common escaped newline sequences in the pattern to match actual text
        # so users can search for "\\n" and match real newlines.
        normalized_pattern = (
            search_term
            .replace('\\r\\n', '\r\n')
            .replace('\\n', '\n')
            .replace('\\r', '\r')
        )
        logging.info(f"Normalized regex pattern -> actual text: {repr(normalized_pattern)}")

        pattern = re.compile(normalized_pattern, re.DOTALL)

        replacements = 0

        def replace_in_value(value):
            nonlocal replacements
            if isinstance(value, str):
                new_value, count = pattern.subn(replace_term, value)
                replacements += count
                return new_value
            if isinstance(value, list):
                return [replace_in_value(v) for v in value]
            if isinstance(value, dict):
                return {k: replace_in_value(v) for k, v in value.items()}
            return value

        new_history = replace_in_value(history)

        if replacements == 0:
            return jsonify({"error": "Search term pattern did not match any history fields"}), 400

        modified_content = json.dumps({"history": new_history}, indent=2)
        return jsonify({"modified_content": modified_content})
    except re.error as rex:
        logging.error(f"Regex error during replacement: {rex}")
        return jsonify({"error": f"Invalid regex: {str(rex)}"}), 400
    except Exception as e:
        logging.error(f"An error occurred during replacement: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/replace_thought', methods=['POST'])
def replace_thought():
    data = request.json
    content = data.get('content')
    original_index = data.get('original_index')  # 1-based step index (step j)
    old_thought = data.get('old_thought', '')
    new_thought = data.get('new_thought', '')

    if content is None or original_index is None or new_thought is None:
        return jsonify({"error": "Missing required fields: content, original_index, new_thought"}), 400

    try:
        doc = json.loads(content)
    except Exception as e:
        return jsonify({"error": f"Input content is not valid JSON: {e}"}), 400

    try:
        history = doc.get('history')
        if not isinstance(history, list):
            return jsonify({"error": "No history array found in JSON"}), 400

        step_j = int(original_index)
        if step_j <= 0:
            return jsonify({"error": "original_index must refer to a step >= 1 (step 0 is user instructions)"}), 400

        assistant_idx = 2 * step_j
        tool_idx = assistant_idx + 1
        if assistant_idx < 0 or tool_idx >= len(history):
            return jsonify({"error": f"original_index {original_index} is out of range for history pairs"}), 400

        assistant_msg = history[assistant_idx]
        if not isinstance(assistant_msg, dict):
            return jsonify({"error": f"history[{assistant_idx}] is not an object"}), 400

        current_thought = assistant_msg.get('thought', '')
        if old_thought and current_thought.replace('\r\n', '\n') != str(old_thought).replace('\r\n', '\n'):
            return jsonify({"error": "Current thought does not match the provided old_thought. Edit may be outdated."}), 409

        # Update assistant message's thought and content
        assistant_msg['thought'] = new_thought
        assistant_msg['content'] = new_thought

        modified_content = json.dumps({"history": history}, indent=2)
        return jsonify({"modified_content": modified_content})
    except Exception as e:
        logging.error(f"Error in replace_thought: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/save', methods=['POST'])
def save():
    data = request.json
    content = data.get('content')
    filename = data.get('filename')

    logging.info(f"Save request - filename: {filename}, content length: {len(content) if content else 0}")

    if not all([content, filename]):
        return jsonify({"error": "Missing required fields"}), 400

    try:
        # Ensure the data directory exists
        if not os.path.exists('data'):
            os.makedirs('data')
        
        # Prevent directory traversal
        if ".." in filename or "/" in filename:
            return jsonify({"error": "Invalid filename"}), 400

        filepath = os.path.join('data', filename)
        with open(filepath, 'w') as f:
            f.write(content)
        
        logging.info(f"File saved successfully to {filepath}")
        return jsonify({"message": f"File saved successfully to {filepath}"})
    except Exception as e:
        logging.error(f"An error occurred during save: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/generate_thought', methods=['POST'])
def generate_thought():
    data = request.json
    current_step = data.get('current_step')
    previous_steps = data.get('previous_steps', [])
    tool_call = data.get('tool_call', '')

    if not current_step:
        return jsonify({"error": "Current step is required"}), 400

    # Create the prompt for thought generation
    prompt = f"""You are the assistant and you are just about calling this tool:

{tool_call}

Given the previous conversation, justify why you are calling this tool. Use first person tone in a similar style as the other assistant messages.

Previous steps context:
"""

    # Add previous steps context
    for i, step in enumerate(previous_steps):
        if step.get('isStepZero'):
            step_text = ""
            step_content = step.get("content")
            if isinstance(step_content, list) and len(step_content) > 0:
                first_item = step_content[0]
                if isinstance(first_item, dict):
                    step_text = first_item.get("text", "")
            prompt += f"\nStep 0: {step_text}\n"
        else:
            thought = step.get('thought', '')
            action = step.get('action', '')
            observation = step.get('observation', '')
            prompt += f"\nStep {step.get('originalIndex', i)}:\nThought: {thought}\nAction: {action}\nObservation: {observation}\n"

    try:
        response = client.chat.completions.create(
            model="gpt-5",
            messages=[
                {"role": "system", "content": "You are an AI assistant helping to generate thoughts for trajectory steps. Generate concise, first-person thoughts that explain the reasoning behind tool calls."},
                {"role": "user", "content": prompt}
            ],
            temperature=1.0
        )
        
        generated_thought = response.choices[0].message.content
        return jsonify({"generated_thought": generated_thought})
    except Exception as e:
        logging.error(f"An error occurred while generating thought: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/remove_step', methods=['POST'])
def remove_step():
    data = request.json
    content = data.get('content')
    original_index = data.get('original_index')  # 1-based step index (step j)

    if content is None or original_index is None:
        return jsonify({"error": "Missing required fields: content, original_index"}), 400

    try:
        doc = json.loads(content)
    except Exception as e:
        return jsonify({"error": f"Input content is not valid JSON: {e}"}), 400

    try:
        history = doc.get('history')
        if not isinstance(history, list):
            return jsonify({"error": "No history array found in JSON"}), 400

        step_j = int(original_index)
        if step_j <= 0:
            return jsonify({"error": "original_index must refer to a step >= 1 (cannot remove step 0)"}), 400

        assistant_idx = 2 * step_j
        tool_idx = assistant_idx + 1
        if assistant_idx < 0 or tool_idx >= len(history):
            return jsonify({"error": f"original_index {original_index} is out of range for history pairs"}), 400

        # Remove tool first, then assistant to keep indices valid
        history.pop(tool_idx)
        history.pop(assistant_idx)

        modified_content = json.dumps({"history": history}, indent=2)
        return jsonify({"modified_content": modified_content})
    except Exception as e:
        logging.error(f"Error in remove_step: {e}")
        return jsonify({"error": str(e)}), 500

def create_app():
    return app

if __name__ == '__main__':
    app.run(debug=True, port=5001)
