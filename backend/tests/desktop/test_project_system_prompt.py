"""Per-project system_prompt: storage + injection into first user turn."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import clawagents.gateway.chats_api as chats_api
from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    return TestClient(app)


def test_create_with_system_prompt(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    p = client.post("/projects", json={
        "name": "p", "root_path": str(root),
        "system_prompt": "You are a Rust expert.",
    }).json()
    assert p["system_prompt"] == "You are a Rust expert."


def test_patch_updates_system_prompt(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    p = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()
    client.patch(f"/projects/{p['id']}", json={"system_prompt": "Speak in haiku."})
    refreshed = next(x for x in client.get("/projects").json() if x["id"] == p["id"])
    assert refreshed["system_prompt"] == "Speak in haiku."


def test_patch_can_clear_system_prompt(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    p = client.post("/projects", json={
        "name": "p", "root_path": str(root), "system_prompt": "to be cleared",
    }).json()
    client.patch(f"/projects/{p['id']}", json={"system_prompt": None})
    refreshed = next(x for x in client.get("/projects").json() if x["id"] == p["id"])
    assert refreshed["system_prompt"] in (None, "")


def test_patch_without_system_prompt_leaves_it_intact(client: TestClient, tmp_path: Path) -> None:
    """PATCH that omits system_prompt should not clear the existing value."""
    root = tmp_path / "p"
    root.mkdir()
    p = client.post("/projects", json={
        "name": "p", "root_path": str(root), "system_prompt": "keep me",
    }).json()
    client.patch(f"/projects/{p['id']}", json={"name": "renamed"})
    refreshed = next(x for x in client.get("/projects").json() if x["id"] == p["id"])
    assert refreshed["name"] == "renamed"
    assert refreshed["system_prompt"] == "keep me"


class _CaptureAgent:
    def __init__(self) -> None:
        self.received_task: str | None = None

    async def invoke(self, task: str, **kwargs):
        self.received_task = task
        from clawagents.run_result import RunResult
        return RunResult(status="ok", result="done", iterations=1)


@pytest.mark.asyncio
async def test_system_prompt_injected_on_first_turn(
    client: TestClient, app_support_dir: Path, tmp_path: Path
) -> None:
    root = tmp_path / "p"
    root.mkdir()
    proj = client.post("/projects", json={
        "name": "p", "root_path": str(root),
        "system_prompt": "Always use TypeScript.",
    }).json()
    cid = client.post(f"/projects/{proj['id']}/chats", json={"title": "t", "model": "gpt-4o-mini"}).json()["chat_id"]

    agent = _CaptureAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id=cid,
            content="Hello.",
            project_root=str(root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda *_: None,
        )

    assert agent.received_task is not None
    # Project system prompt should appear via <project_system_prompt> wrapping.
    assert "<project_system_prompt>" in agent.received_task
    assert "Always use TypeScript." in agent.received_task
    assert agent.received_task.endswith("Hello.")
    # Project must exist for the test side-effect to actually fire; sanity check.
    assert proj["system_prompt"] == "Always use TypeScript."


@pytest.mark.asyncio
async def test_no_system_prompt_means_no_wrapper(
    client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "p"
    root.mkdir()
    proj = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()
    cid = client.post(f"/projects/{proj['id']}/chats", json={"title": "t"}).json()["chat_id"]

    agent = _CaptureAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id=cid,
            content="Hi.",
            project_root=str(root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda *_: None,
        )
    assert "<project_system_prompt>" not in (agent.received_task or "")
