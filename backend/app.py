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

    if not all([content, search_term, replace_term]):
        return jsonify({"error": "Missing required fields"}), 400

    try:
        # Perform a global, case-sensitive replacement
        modified_content = re.sub(search_term, replace_term, content)
        return jsonify({"modified_content": modified_content})
    except Exception as e:
        logging.error(f"An error occurred during replacement: {e}")
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

if __name__ == '__main__':
    app.run(debug=True, port=5001)
