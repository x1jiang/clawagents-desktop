"""Agent-power parity: settings, event translation, MCP allowlist, checkpoints."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.desktop_stores.settings_store import AppSettings, SettingsStore
from clawagents.desktop_stores.project_store import ProjectStore
from clawagents.gateway.chats_api import _translate_event
from clawagents.gateway.mcp_loader import _command_allowed, _url_allowed, list_mcp_config
from clawagents.gateway.settings_api import router as settings_router
from clawagents.gateway.agent_power_api import router as agent_power_router
from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router


def test_translate_forwards_power_events() -> None:
    for kind in ("checkpoint", "compact_progress", "file_changed", "ask_user_required", "warn"):
        out = _translate_event(kind, {"x": 1})
        assert out is not None
        assert out[0] == kind


def test_settings_store_round_trip_agent_power(app_support_dir: Path) -> None:
    store = SettingsStore()
    s = AppSettings(
        mcp_enabled=True,
        mcp_trust_workspace=True,
        context_mode=False,
        browser_tools=True,
        trajectory=True,
        learn=True,
        action_mode="code",
        agent_mode="architect",
        allow_full_access=True,
    )
    store.save(s)
    loaded = store.load()
    assert loaded.mcp_enabled is True
    assert loaded.action_mode == "code"
    # Runtime authority is intentionally omitted from global settings.
    assert loaded.allow_full_access is False
    assert loaded.context_mode is False


def test_settings_api_patch_agent_power(
    app_support_dir: Path,
    project_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(settings_router)
    client = TestClient(app)
    project = ProjectStore().create(name="test", root_path=str(project_root))
    r = client.patch(
        f"/settings/app?project_id={project.id}",
        json={
            "mcp_enabled": True,
            "browser_tools": True,
            "action_mode": "code",
            "allow_full_access": True,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["mcp_enabled"] is True
    assert body["browser_tools"] is True
    assert body["action_mode"] == "code"
    assert body["allow_full_access"] is True


def test_mcp_allowlist() -> None:
    assert _command_allowed("npx")
    assert _command_allowed("/usr/bin/npx")
    assert not _command_allowed("curl")
    assert _url_allowed("http://127.0.0.1:8080/sse")
    assert not _url_allowed("https://evil.example/sse")


def test_list_mcp_includes_context_mode(tmp_path: Path) -> None:
    items = list_mcp_config(tmp_path, trust_workspace=False)
    assert any(i["name"] == "context-mode" for i in items)


def test_checkpoints_endpoint_empty(
    app_support_dir: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    app.include_router(agent_power_router)
    client = TestClient(app)
    root = tmp_path / "proj"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]
    r = client.get(f"/chats/{cid}/checkpoints")
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    # Fresh workspaces may include a library "checkpoint:init" row.
    assert all(isinstance(row, dict) for row in rows)


def test_snapshots_restore_confined(
    app_support_dir: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    app.include_router(agent_power_router)
    client = TestClient(app)
    root = tmp_path / "proj"
    root.mkdir()
    snap = root / ".clawagents" / "snapshots" / "snap1"
    snap.mkdir(parents=True)
    (snap / "a.txt").write_text("before")
    (root / "a.txt").write_text("after")
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]
    r = client.post(
        f"/chats/{cid}/snapshots/restore",
        json={"snapshot_id": "snap1", "rel": "a.txt"},
    )
    assert r.status_code == 200
    assert (root / "a.txt").read_text() == "before"
    # Path traversal rejected
    bad = client.post(
        f"/chats/{cid}/snapshots/restore",
        json={"snapshot_id": "../x", "rel": "a.txt"},
    )
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_auto_approve_short_circuits_edit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """When auto_approve.edit is on, permission_callback should not emit prompts."""
    from unittest.mock import patch
    import clawagents.gateway.chats_api as chats_api

    prompted: list[dict] = []

    class _FakeAgent:
        async def invoke(self, task, *, permission_callback=None, on_event=None, **kwargs):
            if permission_callback:
                decision = await permission_callback({
                    "tool": "write_file",
                    "file_path": str(tmp_path / "x.py"),
                    "reason": "write",
                })
                assert decision == "allow_once"
            from clawagents.run_result import RunResult
            return RunResult(status="ok", result="done", iterations=1)

    # Force ask mode so mode short-circuit wouldn't auto-allow without auto_approve.
    monkeypatch.setattr(
        "clawagents.desktop_stores.settings_store.SettingsStore.load",
        lambda self: __import__(
            "clawagents.desktop_stores.settings_store", fromlist=["AppSettings"]
        ).AppSettings(allow_full_access=False),
    )

    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: _FakeAgent()):
        events: list[tuple[str, dict]] = []

        def on_event(kind: str, data: dict) -> None:
            events.append((kind, data))
            if kind == "permission_required":
                prompted.append(data)

        await chats_api.run_chat_turn(
            chat_id="chat-aa",
            content="write",
            project_root=str(tmp_path),
            mode="ask",
            model="m",
            on_event=on_event,
            auto_approve={"edit": True, "execute": False, "web": False, "browser": False},
        )
    assert not any(k == "permission_required" for k, _ in events)
