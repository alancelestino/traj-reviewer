import json
import os
import sys

import pytest

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from app import create_app  # noqa: E402


@pytest.fixture()
def client():
    app = create_app()
    app.config.update({
        "TESTING": True,
    })
    with app.test_client() as client:
        yield client


def build_mock_trajectory(num_steps=3):
    # Build base system and user messages reused in history and step 0
    system_msg = {
        "role": "system",
        "content": "System prompt",
        "agent": "main",
        "message_type": "system_prompt",
    }
    user_msg = {
        "role": "user",
        "content": "Initial user instruction",
        "agent": "main",
        "message_type": "observation",
    }

    trajectory = []
    history = [system_msg.copy(), user_msg.copy()]

    # step 1 has only 2 query messages (system, user)
    for i in range(num_steps):
        step_query = [system_msg.copy(), user_msg.copy()]
        # Accumulate prior steps' assistant+tool messages so that
        # indices 2*i+2 and 2*i+3 correspond to step i in downstream steps
        for p in range(1, i + 1):
            prior_thought = f"thought_{p}"
            prior_action = f"action_{p}"
            assistant_msg = {
                "role": "assistant",
                "content": prior_thought,
                "thought": prior_thought,
                "action": prior_action,
                "agent": "main",
                "tool_calls": [
                    {
                        "index": 0,
                        "name": None,
                        "function": {
                            "arguments": json.dumps({"command": "view"}),
                            "name": prior_action,
                        },
                        "id": prior_action,
                        "type": "function",
                    }
                ],
                "message_type": "action",
                "thinking_blocks": [],
            }
            tool_msg = {
                "role": "tool",
                "content": f"OBSERVATION for {prior_action}",
                "agent": "main",
                "message_type": "observation",
                "tool_call_ids": [prior_action],
            }
            step_query.extend([assistant_msg, tool_msg])

        thought = f"thought_{i+1}"
        action = f"action_{i+1}"
        observation = f"observation_{i+1}"
        response = thought  # same as thought

        trajectory.append({
            "action": action,
            "observation": observation,
            "response": response,
            "thought": response,
            "execution_time": 0.1,
            "state": {"working_dir": "/repo", "diff": ""},
            "query": step_query,
            "extra_info": {},
        })

        # History mirrors the flattened query for all steps
        if i == 0:
            # step 1 adds assistant+tool at positions 2 and 3
            history.extend([
                {
                    "role": "assistant",
                    "content": thought,
                    "thought": thought,
                    "action": action,
                    "agent": "main",
                    "message_type": "action",
                },
                {
                    "role": "tool",
                    "content": f"OBSERVATION for {action}",
                    "agent": "main",
                    "message_type": "observation",
                },
            ])
        else:
            # subsequent steps append two more entries
            history.extend([
                {
                    "role": "assistant",
                    "content": thought,
                    "thought": thought,
                    "action": action,
                    "agent": "main",
                    "message_type": "action",
                },
                {
                    "role": "tool",
                    "content": f"OBSERVATION for {action}",
                    "agent": "main",
                    "message_type": "observation",
                },
            ])

    doc = {
        "trajectory": trajectory,
        "history": history,
        "info": {
            "swe_agent_hash": "x",
            "swe_agent_version": "1.1.0",
            "swe_rex_version": "1.3.0",
            "swe_rex_hash": "unavailable",
            "submission": "",
            "exit_status": "submitted",
            "exited_files30": "",
            "exited_files50": "",
            "exited_files70": "",
            "model_stats": {
                "instance_cost": 0.0,
                "tokens_sent": 0,
                "tokens_received": 0,
                "api_calls": num_steps,
            },
        },
        "replay_config": json.dumps({"env": "local"}),
        "environment": "image:latest",
    }
    return doc


def test_replace_thought_history_only(client):
    doc = build_mock_trajectory(num_steps=3)
    content = json.dumps(doc)

    # Replace thought at step j=2 (assistant at history[4])
    assistant_idx = 2 * 2
    payload = {
        "content": content,
        "original_index": 2,
        "old_thought": doc["history"][assistant_idx]["thought"],
        "new_thought": "NEW_THOUGHT",
    }
    resp = client.post('/replace_thought', json=payload)
    assert resp.status_code == 200, resp.get_json()
    updated = json.loads(resp.get_json()["modified_content"])

    assert set(updated.keys()) == {"history"}
    hist = updated["history"]
    assert hist[assistant_idx]["thought"] == "NEW_THOUGHT"
    assert hist[assistant_idx]["content"] == "NEW_THOUGHT"


def test_remove_step_history_pair(client):
    doc = build_mock_trajectory(num_steps=4)
    content = json.dumps(doc)

    # Remove step j=2 => remove history[4] and history[5]
    payload = {
        "content": content,
        "original_index": 2,
    }
    resp = client.post('/remove_step', json=payload)
    assert resp.status_code == 200, resp.get_json()
    updated = json.loads(resp.get_json()["modified_content"])

    assert set(updated.keys()) == {"history"}
    old_hist = doc["history"]
    new_hist = updated["history"]
    assert len(new_hist) == len(old_hist) - 2

    removed_assistant = old_hist[4]
    removed_tool = old_hist[5]
    serialized = json.dumps(new_hist)
    # Ensure removed messages' unique contents are gone
    if isinstance(removed_assistant, dict):
        assert removed_assistant.get("content", "") not in serialized
    if isinstance(removed_tool, dict):
        assert removed_tool.get("content", "") not in serialized


