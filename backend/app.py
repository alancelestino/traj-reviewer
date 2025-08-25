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
    trajectory = data.get('trajectory', [])

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    # Sanitize trajectory to only include necessary fields and adjust step numbers
    sanitized_trajectory = []
    for step in trajectory:
        if step.get('isStepZero'):
            step_zero_text = ""
            step_zero_content = step.get("content")
            if isinstance(step_zero_content, list) and len(step_zero_content) > 0:
                first_item = step_zero_content[0]
                if isinstance(first_item, dict):
                    step_zero_text = first_item.get("text", "")
            
            sanitized_trajectory.append({
                "step": 0,
                "content": step_zero_text
            })
        else:
            sanitized_trajectory.append({
                "step": step.get("originalIndex"),
                "thought": step.get("thought"),
                "action": step.get("action"),
                "observation": step.get("observation")
            })

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
            # temperature=0.0
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
        # Normalize pattern so that actual newline characters in the incoming JSON
        # match the literal "\\n" sequences present in the JSON file string values.
        normalized_pattern = search_term.replace('\r\n', r'\\r\\n').replace('\n', r'\\n').replace('\r', r'\\r')
        logging.info(f"Normalized regex pattern: {repr(normalized_pattern)}")

        # Compile regex with DOTALL so "." matches across encoded segments if needed
        pattern = re.compile(normalized_pattern, re.DOTALL)

        # Count regex matches before replacement
        occurrences_before = len(pattern.findall(content))
        logging.info(f"Regex matches before: {occurrences_before}")
        
        if occurrences_before == 0:
            return jsonify({"error": "Search term pattern did not match the content"}), 400

        # Perform a global regex replacement using a function to preserve literal backslashes
        def _repl(_match):
            return replace_term
        modified_content, replacements = pattern.subn(_repl, content)

        logging.info(f"Replacements applied: {replacements}")

        if replacements == 0 or modified_content == content:
            logging.warning("Replace operation returned identical content - no changes made")
            return jsonify({"error": "Replace operation did not modify the content. This might indicate an issue with the search pattern or content format."}), 400

        # Validate JSON before returning to avoid frontend parse errors
        try:
            json.loads(modified_content)
        except Exception as je:
            logging.error(f"Modified content is not valid JSON: {je}")
            return jsonify({"error": f"Modified content is not valid JSON: {je}"}), 400

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
    original_index = data.get('original_index')  # 1-based index in trajectory
    old_thought = data.get('old_thought', '')
    new_thought = data.get('new_thought', '')

    if content is None or original_index is None or new_thought is None:
        return jsonify({"error": "Missing required fields: content, original_index, new_thought"}), 400

    try:
        doc = json.loads(content)
    except Exception as e:
        return jsonify({"error": f"Input content is not valid JSON: {e}"}), 400

    try:
        traj = doc.get('trajectory')
        if not isinstance(traj, list):
            return jsonify({"error": "No trajectory array found in JSON"}), 400

        idx0 = int(original_index) - 1
        if idx0 < 0 or idx0 >= len(traj):
            return jsonify({"error": f"original_index {original_index} is out of range"}), 400

        step = traj[idx0]
        if not isinstance(step, dict):
            return jsonify({"error": f"Step at index {original_index} is not an object"}), 400

        current_thought = step.get('thought', '')
        # Optional validation: if old_thought provided, ensure it matches
        if old_thought and current_thought != old_thought:
            # Try to normalize Windows newlines to Unix for comparison
            if current_thought.replace('\r\n', '\n') != old_thought.replace('\r\n', '\n'):
                return jsonify({"error": "Current thought does not match the provided old_thought. Edit may be outdated."}), 409

        # Update the edited step's thought
        step['thought'] = new_thought

        # Also update the edited step's response if present/desired
        try:
            step['response'] = new_thought
        except Exception:
            # Be defensive: if step is not a dict or assignment fails, ignore
            pass

        # Compute derived message index using zero-based i (idx0)
        # Required index: 2*i + 2 where i is zero-based step index
        derived_message_index = 2 * idx0 + 2

        # For all subsequent steps j > i, update query[2*i+2].thought/content if present
        try:
            for subsequent_index in range(idx0 + 1, len(traj)):
                subsequent_step = traj[subsequent_index]
                if not isinstance(subsequent_step, dict):
                    continue
                query_array = subsequent_step.get('query')
                if isinstance(query_array, list) and 0 <= derived_message_index < len(query_array):
                    target_entry = query_array[derived_message_index]
                    if isinstance(target_entry, dict):
                        # Update both fields when available
                        target_entry['thought'] = new_thought
                        target_entry['content'] = new_thought
        except Exception as _:
            # Be resilient to schema variations
            pass

        # Also update the global history[2*i+2].thought/content if present
        try:
            history_array = doc.get('history')
            if isinstance(history_array, list) and 0 <= derived_message_index < len(history_array):
                history_entry = history_array[derived_message_index]
                if isinstance(history_entry, dict):
                    history_entry['thought'] = new_thought
                    history_entry['content'] = new_thought
        except Exception as _:
            pass

        modified_content = json.dumps(doc, indent=2)
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
    original_index = data.get('original_index')  # 1-based index in trajectory

    if content is None or original_index is None:
        return jsonify({"error": "Missing required fields: content, original_index"}), 400

    try:
        doc = json.loads(content)
    except Exception as e:
        return jsonify({"error": f"Input content is not valid JSON: {e}"}), 400

    try:
        traj = doc.get('trajectory')
        if not isinstance(traj, list):
            return jsonify({"error": "No trajectory array found in JSON"}), 400

        idx0 = int(original_index) - 1
        if idx0 < 0 or idx0 >= len(traj):
            return jsonify({"error": f"original_index {original_index} is out of range"}), 400

        # Remove the trajectory step i
        traj.pop(idx0)

        # Compute derived message indices based on zero-based i: 2*i+2 and 2*i+3
        base_msg_idx = 2 * idx0 + 2
        next_msg_idx = base_msg_idx + 1

        # For all subsequent steps j > i (after pop, these are indices >= idx0),
        # remove query[2*i+2] and query[2*i+3] if present. Remove higher index first.
        for subsequent_index in range(idx0, len(traj)):
            step_j = traj[subsequent_index]
            if not isinstance(step_j, dict):
                continue
            query_array = step_j.get('query')
            if isinstance(query_array, list):
                # Remove index next_msg_idx first, then base_msg_idx, guarding bounds each time
                if 0 <= next_msg_idx < len(query_array):
                    query_array.pop(next_msg_idx)
                if 0 <= base_msg_idx < len(query_array):
                    query_array.pop(base_msg_idx)

        # Remove from global history: indices 2*i+2 and 2*i+3 (remove higher first)
        history_array = doc.get('history')
        if isinstance(history_array, list):
            if 0 <= next_msg_idx < len(history_array):
                history_array.pop(next_msg_idx)
            if 0 <= base_msg_idx < len(history_array):
                history_array.pop(base_msg_idx)

        # Decrease info.model_stats.api_calls by 1 if present
        info_obj = doc.get('info')
        if isinstance(info_obj, dict):
            model_stats = info_obj.get('model_stats')
            if isinstance(model_stats, dict):
                api_calls = model_stats.get('api_calls')
                if isinstance(api_calls, int):
                    model_stats['api_calls'] = max(0, api_calls - 1)

        modified_content = json.dumps(doc, indent=2)
        return jsonify({"modified_content": modified_content})
    except Exception as e:
        logging.error(f"Error in remove_step: {e}")
        return jsonify({"error": str(e)}), 500

def create_app():
    return app

if __name__ == '__main__':
    app.run(debug=True, port=5001)
