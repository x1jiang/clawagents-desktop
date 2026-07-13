"""Selecting a model on a chat must round-trip through `chat_meta`.

Regression coverage for the user-visible symptom: "I picked gpt-5.4-mini
in the dropdown but the chat keeps acting dumb." The picker hits PATCH
/chats/{id} which appends a `chat_meta` event with the new model;
subsequent GETs and the `run_chat_turn` path read it back via
`_read_chat_meta`. This test pins all three points of that pipeline.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CLAWAGENTS_DESKTOP_APP_SUPPORT", str(tmp_path / "appsupport"))
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    from clawagents.gateway.server import create_app
    app, _llm, _model = create_app()
    return TestClient(app)


def _make_project(client: TestClient, tmp_path: Path) -> str:
    root = tmp_path / "proj"
    root.mkdir()
    return client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]


def test_create_with_model_round_trips(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    cid = client.post(
        f"/projects/{pid}/chats",
        json={"title": "x", "model": "gpt-5.4-mini"},
    ).json()["chat_id"]
    got = client.get(f"/chats/{cid}").json()
    assert got["model"] == "gpt-5.4-mini"


def test_patch_overwrites_model_on_existing_chat(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    cid = client.post(
        f"/projects/{pid}/chats",
        json={"title": "x", "model": "gpt-5.4"},
    ).json()["chat_id"]
    # Switch via PATCH like the picker does.
    r = client.patch(f"/chats/{cid}", json={"model": "claude-opus-4-7"})
    assert r.status_code == 200, r.text
    assert r.json()["model"] == "claude-opus-4-7"
    # And a fresh GET sees the same value (replay from JSONL).
    assert client.get(f"/chats/{cid}").json()["model"] == "claude-opus-4-7"


def test_patch_model_only_does_not_clobber_other_fields(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    cid = client.post(
        f"/projects/{pid}/chats",
        json={"title": "Original", "model": "gpt-5.4", "mode": "read_only"},
    ).json()["chat_id"]
    client.patch(f"/chats/{cid}", json={"model": "gpt-5.4-mini"})
    after = client.get(f"/chats/{cid}").json()
    assert after["model"] == "gpt-5.4-mini"
    assert after["title"] == "Original"
    assert after["mode"] == "read_only"


def test_projectless_chat_keeps_default_mode_read_only(client: TestClient) -> None:
    # POST /chats creates a projectless chat. Default mode is `read_only`
    # for projectless chats (so the agent doesn't write outside the scratch).
    cid = client.post("/chats", json={"title": "x"}).json()["chat_id"]
    meta = client.get(f"/chats/{cid}").json()
    assert meta["mode"] == "read_only"
