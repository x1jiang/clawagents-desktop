"""GET /skills/discovered returns skills present under any of the
auto-discovered skill directories for a given project."""

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


def _seed_docx_skill(root: Path) -> None:
    """Put a minimal docx skill under <root>/.agents/skills/docx/."""
    docx_dir = root / ".agents" / "skills" / "docx"
    docx_dir.mkdir(parents=True)
    (docx_dir / "SKILL.md").write_text(
        "---\nname: docx\ndescription: Read and write Word documents.\n---\nbody\n"
    )


def test_discovered_skills_for_project(client: TestClient, tmp_path: Path) -> None:
    project_root = tmp_path / "myproj"
    project_root.mkdir()
    _seed_docx_skill(project_root)

    # Register the project so the endpoint can resolve project_id → root.
    pid = client.post("/projects", json={"name": "p", "root_path": str(project_root)}).json()["id"]

    r = client.get(f"/skills/discovered?project_id={pid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["root"] == str(project_root)
    names = [s["name"] for s in body["skills"]]
    assert "docx" in names
    docx = next(s for s in body["skills"] if s["name"] == "docx")
    assert "Word documents" in docx["description"]
    assert docx["source_dir"] == ".agents/skills"


def test_discovered_skills_unknown_project_id(client: TestClient) -> None:
    r = client.get("/skills/discovered?project_id=does-not-exist")
    assert r.status_code == 404


def test_discovered_skills_no_skills_dir(client: TestClient, tmp_path: Path) -> None:
    project_root = tmp_path / "bare"
    project_root.mkdir()
    pid = client.post("/projects", json={"name": "bare", "root_path": str(project_root)}).json()["id"]

    r = client.get(f"/skills/discovered?project_id={pid}")
    assert r.status_code == 200
    assert r.json()["skills"] == []


def test_discovered_skills_under_cursor_skills(client: TestClient, tmp_path: Path) -> None:
    project_root = tmp_path / "cursorproj"
    project_root.mkdir()
    cursor_dir = project_root / ".cursor" / "skills" / "pdf"
    cursor_dir.mkdir(parents=True)
    (cursor_dir / "SKILL.md").write_text(
        "---\nname: pdf\ndescription: Read PDF files.\n---\n"
    )
    pid = client.post("/projects", json={"name": "c", "root_path": str(project_root)}).json()["id"]

    r = client.get(f"/skills/discovered?project_id={pid}")
    assert r.status_code == 200
    names = [s["name"] for s in r.json()["skills"]]
    assert names == ["pdf"]
