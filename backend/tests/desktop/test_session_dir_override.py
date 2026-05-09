"""SessionWriter must accept an explicit session_dir for projectless chats."""

from __future__ import annotations

from pathlib import Path

import pytest

from clawagents.session.persistence import SessionWriter


def test_session_dir_override_writes_to_custom_path(tmp_path: Path) -> None:
    target_dir = tmp_path / "custom_sessions"
    w = SessionWriter(session_id="chat-z", session_dir=target_dir)
    w.write_assistant_message("hi")

    written = target_dir / "chat-z.jsonl"
    assert written.exists()
    assert "hi" in written.read_text()


def test_session_dir_default_unchanged(project_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Without session_dir, falls back to cwd-based path (existing behavior)."""
    monkeypatch.chdir(project_root)
    w = SessionWriter(session_id="chat-default")
    w.write_assistant_message("hi")

    expected = project_root / ".clawagents" / "sessions" / "chat-default.jsonl"
    assert expected.exists()
