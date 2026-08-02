"""Pinned context: the editing surface for `.clawagents/pinned-context.md`.

The engine already treats that file as a rules source and leads the injected
rules block with it. These tests cover the gateway routes the desktop UI uses
to read and edit it, and the two behaviours that are easy to get wrong:
clearing must remove the file, and the response must echo what was *stored*
rather than what was sent.
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


@pytest.fixture
def project(client: TestClient, tmp_path: Path) -> tuple[str, Path]:
    root = tmp_path / "proj"
    root.mkdir(parents=True)
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    return pid, root


def test_unset_pinned_context_reads_empty(client: TestClient, project) -> None:
    pid, _root = project
    r = client.get(f"/memory/pinned-context?project_id={pid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["text"] == ""
    assert body["path"].endswith(".clawagents/pinned-context.md")


def test_write_then_read_round_trips(client: TestClient, project) -> None:
    pid, root = project
    r = client.put(
        "/memory/pinned-context",
        json={"project_id": pid, "text": "Use .venv312 for every python call."},
    )
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "Use .venv312 for every python call."

    again = client.get(f"/memory/pinned-context?project_id={pid}").json()
    assert again["text"] == "Use .venv312 for every python call."
    # The generated heading is ours, not the user's: it must not leak back into
    # the editor, or a save round-trip would nest a second copy of it.
    assert "Pinned context (always applies)" not in again["text"]
    assert (root / ".clawagents" / "pinned-context.md").exists()


def test_pinned_context_reaches_the_agent_rules_block(client: TestClient, project) -> None:
    """The whole point: what is pinned must actually be injected."""
    pid, root = project
    client.put(
        "/memory/pinned-context",
        json={"project_id": pid, "text": "Never touch the staging database."},
    )
    from clawagents.memory.rules import load_rules_text

    rules = load_rules_text(str(root))
    assert "Never touch the staging database." in rules


def test_clearing_removes_the_file(client: TestClient, project) -> None:
    pid, root = project
    path = root / ".clawagents" / "pinned-context.md"
    client.put("/memory/pinned-context", json={"project_id": pid, "text": "temporary"})
    assert path.exists()

    r = client.put("/memory/pinned-context", json={"project_id": pid, "text": "   "})
    assert r.status_code == 200, r.text
    assert r.json()["text"] == ""
    assert not path.exists(), "cleared context should leave no file behind"


def test_oversized_text_is_truncated_and_flagged(client: TestClient, project) -> None:
    pid, _root = project
    r = client.put(
        "/memory/pinned-context",
        json={"project_id": pid, "text": "x" * 9_000},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Injected on every LLM round, so it is bounded rather than unbounded --
    # and the caller is told, so the editor cannot show unsaved text as saved.
    assert body["chars"] <= body["max_chars"] == 4_000
    assert body["truncated"] is True
    assert len(client.get(f"/memory/pinned-context?project_id={pid}").json()["text"]) == 4_000


def test_unknown_project_is_rejected(client: TestClient) -> None:
    assert client.get("/memory/pinned-context?project_id=nope").status_code == 404
    assert client.put(
        "/memory/pinned-context", json={"project_id": "nope", "text": "hi"}
    ).status_code == 404


def test_arbitrary_root_path_is_rejected(client: TestClient, tmp_path: Path) -> None:
    """root_path must name a registered project, not any directory on disk."""
    outsider = tmp_path / "not-a-project"
    outsider.mkdir()
    r = client.put(
        "/memory/pinned-context",
        json={"root_path": str(outsider), "text": "pwn"},
    )
    assert r.status_code == 400
    assert not (outsider / ".clawagents" / "pinned-context.md").exists()
