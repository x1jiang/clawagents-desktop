"""GET /stats/usage aggregates token totals across all chat JSONLs."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router
from clawagents.gateway.stats_api import router as stats_router
from clawagents.session.persistence import SessionWriter


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    app.include_router(stats_router)
    return TestClient(app)


def test_empty_stats(client: TestClient) -> None:
    r = client.get("/stats/usage")
    assert r.status_code == 200
    data = r.json()
    assert data["overall"] == {}
    assert data["projectless"] == {}
    assert data["projects"] == []


def test_aggregates_per_project_and_overall(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]
    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    w.append("usage", {
        "input_tokens": 100, "output_tokens": 50, "total_tokens": 150,
        "cached_input_tokens": 20, "cache_creation_tokens": 0,
        "model": "gpt-4o-mini",
    })
    w.append("usage", {
        "input_tokens": 200, "output_tokens": 80, "total_tokens": 280,
        "cached_input_tokens": 50, "cache_creation_tokens": 5,
        "model": "gpt-4o-mini",
    })

    stats = client.get("/stats/usage").json()
    project = next(p for p in stats["projects"] if p["project_id"] == pid)
    assert project["by_model"]["gpt-4o-mini"]["input_tokens"] == 300
    assert project["by_model"]["gpt-4o-mini"]["output_tokens"] == 130
    assert project["by_model"]["gpt-4o-mini"]["total_tokens"] == 430
    assert stats["overall"]["gpt-4o-mini"]["total_tokens"] == 430


def test_includes_projectless(client: TestClient) -> None:
    cid = client.post("/chats", json={"title": "p"}).json()["chat_id"]
    # Find the projectless dir and append a usage event.
    from clawagents.desktop_stores.app_paths import projectless_chats_dir
    pl_dir = projectless_chats_dir()
    SessionWriter(session_id=cid, session_dir=pl_dir).append("usage", {
        "input_tokens": 10, "output_tokens": 5, "total_tokens": 15,
        "cached_input_tokens": 0, "cache_creation_tokens": 0,
        "model": "gemini-2.5-flash",
    })
    stats = client.get("/stats/usage").json()
    assert stats["projectless"]["gemini-2.5-flash"]["total_tokens"] == 15
    assert stats["overall"]["gemini-2.5-flash"]["total_tokens"] == 15


def test_turn_count(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]
    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    w.append("usage", {
        "input_tokens": 10, "output_tokens": 5, "total_tokens": 15,
        "cached_input_tokens": 0, "cache_creation_tokens": 0,
        "model": "gpt-4o-mini",
    })
    w.write_turn_completed(iteration=1, tool_calls=0, status="ok")
    w.write_turn_completed(iteration=2, tool_calls=0, status="ok")

    stats = client.get("/stats/usage").json()
    by_model = next(p for p in stats["projects"] if p["project_id"] == pid)["by_model"]
    assert by_model["gpt-4o-mini"]["turns"] == 2
