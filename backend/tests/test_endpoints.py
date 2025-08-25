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


def test_replace_thought_cascades(client):
    doc = build_mock_trajectory(num_steps=3)
    content = json.dumps(doc)

    # Replace thought at step i=2 (original_index=2)
    payload = {
        "content": content,
        "original_index": 2,
        "old_thought": doc["trajectory"][1]["thought"],
        "new_thought": "NEW_THOUGHT",
    }
    resp = client.post('/replace_thought', json=payload)
    assert resp.status_code == 200, resp.get_json()
    updated = json.loads(resp.get_json()["modified_content"])

    # Step i updated
    assert updated["trajectory"][1]["thought"] == "NEW_THOUGHT"
    assert updated["trajectory"][1]["response"] == "NEW_THOUGHT"

    # For all j>i, query[2*i+2] updated. i=1 (zero-based), idx = 2*1+2 = 4
    idx0 = 1
    msg_idx = 2 * idx0 + 2
    for j in range(2, len(updated["trajectory"])):
        q = updated["trajectory"][j].get("query", [])
        if len(q) > msg_idx and isinstance(q[msg_idx], dict):
            assert q[msg_idx].get("thought") == "NEW_THOUGHT"
            assert q[msg_idx].get("content") == "NEW_THOUGHT"

    # history[2*i+2] updated
    history = updated.get("history", [])
    if len(history) > msg_idx and isinstance(history[msg_idx], dict):
        assert history[msg_idx].get("thought") == "NEW_THOUGHT"
        assert history[msg_idx].get("content") == "NEW_THOUGHT"


def test_remove_step_cascades(client):
    doc = build_mock_trajectory(num_steps=4)
    content = json.dumps(doc)

    # Remove step i=2 (original_index=2)
    payload = {
        "content": content,
        "original_index": 2,
    }
    resp = client.post('/remove_step', json=payload)
    assert resp.status_code == 200, resp.get_json()
    updated = json.loads(resp.get_json()["modified_content"])

    # trajectory[i] removed
    assert len(updated["trajectory"]) == len(doc["trajectory"]) - 1

    # For all j > i (after removal j starts at idx0), ensure messages for removed step are gone
    removed_step_thought = "thought_2"
    removed_step_action = "action_2"
    removed_tool_obs = f"OBSERVATION for {removed_step_action}"

    for j in range(1, len(updated["trajectory"])):
        q = updated["trajectory"][j].get("query", [])
        for msg in q:
            if isinstance(msg, dict):
                assert msg.get("thought") != removed_step_thought
                assert msg.get("content") != removed_step_thought
                assert msg.get("content") != removed_tool_obs

    # history entries for removed step are gone
    hist = updated.get("history", [])
    for msg in hist:
        if isinstance(msg, dict):
            assert msg.get("thought") != removed_step_thought
            assert msg.get("content") not in {removed_step_thought, removed_tool_obs}

    # api_calls decreased by 1
    orig_calls = doc["info"]["model_stats"]["api_calls"]
    new_calls = updated["info"]["model_stats"]["api_calls"]
    assert new_calls == max(0, orig_calls - 1)


