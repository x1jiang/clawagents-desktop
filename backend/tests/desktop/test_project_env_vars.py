"""Project env_vars: storage + injection into the agent's process env."""

from __future__ import annotations

import os
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


def test_create_with_env_vars(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    p = client.post("/projects", json={
        "name": "p", "root_path": str(root),
        "env_vars": {"DATABASE_URL": "postgres://localhost/x"},
    }).json()
    assert p["env_vars"] == {"DATABASE_URL": "postgres://localhost/x"}


def test_patch_updates_env_vars(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    p = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()
    client.patch(f"/projects/{p['id']}", json={"env_vars": {"FOO": "bar"}})
    refreshed = next(x for x in client.get("/projects").json() if x["id"] == p["id"])
    assert refreshed["env_vars"] == {"FOO": "bar"}


def test_patch_unrelated_keeps_env_vars(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    p = client.post("/projects", json={
        "name": "p", "root_path": str(root), "env_vars": {"K": "v"},
    }).json()
    client.patch(f"/projects/{p['id']}", json={"name": "renamed"})
    refreshed = next(x for x in client.get("/projects").json() if x["id"] == p["id"])
    assert refreshed["env_vars"] == {"K": "v"}


class _EnvProbeAgent:
    def __init__(self) -> None:
        self.saw_env: dict[str, str] = {}

    async def invoke(self, task: str, **kwargs):
        # Capture the value of one of the project env vars exactly when the
        # agent is invoked. The temp-env context manager wraps invoke().
        self.saw_env["PROJECT_VAR"] = os.environ.get("PROJECT_VAR", "<UNSET>")
        from clawagents.run_result import RunResult
        return RunResult(status="ok", result="done", iterations=1)


@pytest.mark.asyncio
async def test_env_vars_apply_during_invoke(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("PROJECT_VAR", raising=False)
    root = tmp_path / "p"
    root.mkdir()
    proj = client.post("/projects", json={
        "name": "p", "root_path": str(root),
        "env_vars": {"PROJECT_VAR": "from-project"},
    }).json()
    cid = client.post(f"/projects/{proj['id']}/chats", json={"title": "t"}).json()["chat_id"]

    agent = _EnvProbeAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id=cid,
            content="hi",
            project_root=str(root),
            mode="auto",
            model="gpt-4o-mini",
            on_event=lambda *_: None,
        )

    assert agent.saw_env["PROJECT_VAR"] == "from-project"
    # After the turn, the env should be restored to the pre-call state.
    assert os.environ.get("PROJECT_VAR") is None


@pytest.mark.asyncio
async def test_env_vars_restore_prior_value(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PROJECT_VAR", "ambient")
    root = tmp_path / "p"
    root.mkdir()
    proj = client.post("/projects", json={
        "name": "p", "root_path": str(root),
        "env_vars": {"PROJECT_VAR": "from-project"},
    }).json()
    cid = client.post(f"/projects/{proj['id']}/chats", json={"title": "t"}).json()["chat_id"]

    agent = _EnvProbeAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id=cid, content="hi", project_root=str(root),
            mode="auto", model="gpt-4o-mini", on_event=lambda *_: None,
        )

    assert agent.saw_env["PROJECT_VAR"] == "from-project"
    # Pre-existing ambient value comes back untouched.
    assert os.environ.get("PROJECT_VAR") == "ambient"
