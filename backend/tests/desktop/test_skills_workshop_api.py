"""Tests for /skills/workshop REST endpoints including skill impact ledger."""

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


def test_workshop_api_lists_impact_and_persists_reject_reason(
    client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "proj"
    root.mkdir(parents=True)
    skills = root / "skills"
    skills.mkdir()

    from clawagents.skills.workshop.service import SkillWorkshopService

    svc = SkillWorkshopService(root, skills)
    proposal = svc.create(
        name="test-skill",
        description="A test skill",
        body="# Test Skill\nInstructions.\n",
    )

    pid = client.post("/projects", json={"name": "test-proj", "root_path": str(root)}).json()["id"]

    # 1. GET /skills/workshop should list proposal and have impact fields
    res = client.get(f"/skills/workshop?project_id={pid}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert len(body["proposals"]) == 1
    assert "skill_impact_path" in body
    assert body["skill_impact_relative_path"] == ".clawagents/skill-workshop/skill-impact.md"

    # 2. Reject proposal with reason
    reason_text = "Rejected due to overlap with existing tool."
    reject_res = client.post(
        f"/skills/workshop/{proposal['id']}/reject",
        json={"project_id": pid, "reason": reason_text},
    )
    assert reject_res.status_code == 200, reject_res.text
    assert reject_res.json()["ok"] is True

    # 3. Inspect proposal to ensure reason is returned
    inspect_res = client.get(f"/skills/workshop/{proposal['id']}?project_id={pid}")
    assert inspect_res.status_code == 200
    inspect_body = inspect_res.json()
    assert inspect_body["status"] == "rejected"
    assert inspect_body["reason"] == reason_text

    # 4. GET /skills/workshop/impact should contain the entry
    impact_res = client.get(f"/skills/workshop/impact?project_id={pid}")
    assert impact_res.status_code == 200, impact_res.text
    impact_body = impact_res.json()
    assert impact_body["ok"] is True
    assert reason_text in impact_body["content"]
    assert "test-skill" in impact_body["content"]
