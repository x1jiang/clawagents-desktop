"""Memory browser + enriched skills gateway smoke tests."""

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


def test_memory_overview_lists_artifacts(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "proj"
    claw = root / ".clawagents"
    claw.mkdir(parents=True)
    (claw / "MEMORY.md").write_text("# Memory\n- learned X\n", encoding="utf-8")
    (claw / "facts.jsonl").write_text(
        '{"id":"f1","text":"API uses bearer tokens","live":true,"created_at":1.0,"source":"test","supersedes":null}\n',
        encoding="utf-8",
    )
    (claw / "memory-bank").mkdir()
    (claw / "memory-bank" / "decisions.md").write_text("# Decisions\n", encoding="utf-8")

    pid = client.post("/projects", json={"name": "m", "root_path": str(root)}).json()["id"]
    r = client.get(f"/memory/overview?project_id={pid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    paths = {a["path"] for a in body["artifacts"]}
    assert ".clawagents/MEMORY.md" in paths
    assert ".clawagents/memory-bank/decisions.md" in paths
    assert body["counts"]["artifacts"] >= 2


def test_memory_file_reads_clawagents_only(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "proj2"
    claw = root / ".clawagents"
    claw.mkdir(parents=True)
    (claw / "core-memory.md").write_text("## User\nPrefers concise diffs.\n", encoding="utf-8")
    (root / "secret.txt").write_text("nope", encoding="utf-8")
    pid = client.post("/projects", json={"name": "m2", "root_path": str(root)}).json()["id"]

    ok = client.get(
        "/memory/file",
        params={"project_id": pid, "path": ".clawagents/core-memory.md"},
    )
    assert ok.status_code == 200
    assert "concise diffs" in ok.json()["content"]
    assert "abs_path" not in ok.json()

    denied = client.get(
        "/memory/file",
        params={"project_id": pid, "path": "secret.txt"},
    )
    assert denied.status_code == 400

    escape = client.get(
        "/memory/file",
        params={"project_id": pid, "path": ".clawagents/../../secret.txt"},
    )
    assert escape.status_code == 400

    bare = client.get("/memory/overview")
    assert bare.status_code == 400

    rogue = client.get(
        "/memory/overview",
        params={"root_path": str(tmp_path / "not-a-registered-project")},
    )
    assert rogue.status_code == 400


def test_skills_preview_includes_folders(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "skillsproj"
    skill = root / ".agents" / "skills" / "demo"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: demo\ndescription: Demo skill.\n---\nbody\n",
        encoding="utf-8",
    )
    pid = client.post("/projects", json={"name": "s", "root_path": str(root)}).json()["id"]
    r = client.get(f"/skills?project_id={pid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert any(s["name"] == "demo" for s in body["skills"])
    assert any(f["origin"] == "auto" for f in body["folders"])
    assert "excluded" in body
    assert "warnings" in body


def test_workshop_list_empty(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    pid = client.post("/projects", json={"name": "w", "root_path": str(root)}).json()["id"]
    r = client.get(f"/skills/workshop?project_id={pid}")
    assert r.status_code == 200
    assert r.json()["proposals"] == []


def test_workshop_rejects_path_escape_proposal_id(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "ws2"
    root.mkdir()
    pid = client.post("/projects", json={"name": "w2", "root_path": str(root)}).json()["id"]
    bad = client.get(f"/skills/workshop/..evil?project_id={pid}")
    assert bad.status_code == 400
