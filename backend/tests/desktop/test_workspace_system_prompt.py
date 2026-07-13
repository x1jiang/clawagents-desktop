"""Workspace-level system prompt: settings round-trip + injection."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import clawagents.gateway.chats_api as chats_api
from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router
from clawagents.gateway.settings_api import router as settings_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    app.include_router(settings_router)
    return TestClient(app)


def test_get_settings_defaults(client: TestClient) -> None:
    r = client.get("/settings/app")
    assert r.status_code == 200
    body = r.json()
    assert body["workspace_system_prompt"] == ""


def test_patch_persists_workspace_prompt(client: TestClient) -> None:
    r = client.patch("/settings/app", json={"workspace_system_prompt": "Always cite sources."})
    assert r.status_code == 200
    assert r.json()["workspace_system_prompt"] == "Always cite sources."
    # GET reflects the new value.
    assert client.get("/settings/app").json()["workspace_system_prompt"] == "Always cite sources."


def test_patch_clear_workspace_prompt(client: TestClient) -> None:
    client.patch("/settings/app", json={"workspace_system_prompt": "before"})
    client.patch("/settings/app", json={"workspace_system_prompt": ""})
    assert client.get("/settings/app").json()["workspace_system_prompt"] == ""


def test_patch_unrelated_field_keeps_workspace_prompt(client: TestClient) -> None:
    client.patch("/settings/app", json={"workspace_system_prompt": "keep me"})
    client.patch("/settings/app", json={"theme": "dark"})
    assert client.get("/settings/app").json()["workspace_system_prompt"] == "keep me"


class _CaptureAgent:
    def __init__(self) -> None:
        self.received_task: str | None = None

    async def invoke(self, task: str, **kwargs):
        self.received_task = task
        from clawagents.run_result import RunResult
        return RunResult(status="ok", result="done", iterations=1)


@pytest.mark.asyncio
async def test_workspace_prompt_injected_on_first_turn(
    client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "p"
    root.mkdir()
    proj = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()
    cid = client.post(f"/projects/{proj['id']}/chats", json={"title": "t"}).json()["chat_id"]
    client.patch("/settings/app", json={"workspace_system_prompt": "Use British English."})

    agent = _CaptureAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id=cid,
            content="Hi.",
            project_root=str(root),
            mode="auto",
            model="gpt-4o-mini",
            on_event=lambda *_: None,
        )

    assert agent.received_task is not None
    assert "<workspace_system_prompt>" in agent.received_task
    assert "Use British English." in agent.received_task
    assert agent.received_task.endswith("Hi.")


@pytest.mark.asyncio
async def test_workspace_prompt_layered_before_project_prompt(
    client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "p"
    root.mkdir()
    proj = client.post("/projects", json={
        "name": "p", "root_path": str(root), "system_prompt": "Use Python",
    }).json()
    cid = client.post(f"/projects/{proj['id']}/chats", json={"title": "t"}).json()["chat_id"]
    client.patch("/settings/app", json={"workspace_system_prompt": "Be terse."})

    agent = _CaptureAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id=cid, content="hi", project_root=str(root),
            mode="auto", model="gpt-4o-mini", on_event=lambda *_: None,
        )

    task = agent.received_task or ""
    assert "<workspace_system_prompt>" in task
    assert "<project_system_prompt>" in task
    assert task.index("<workspace_system_prompt>") < task.index("<project_system_prompt>")
