"""SessionWriter must support a chat_meta event for desktop chat metadata."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from clawagents.session.persistence import SessionReader, SessionWriter


def test_write_chat_meta_appends_event(project_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(project_root)
    w = SessionWriter(session_id="chat-x")
    w.write_chat_meta(title="My chat", model="claude-opus-4.7", mode="auto")

    line = (project_root / ".clawagents" / "sessions" / "chat-x.jsonl").read_text().strip()
    payload = json.loads(line)
    assert payload["type"] == "chat_meta"
    assert payload["title"] == "My chat"
    assert payload["model"] == "claude-opus-4.7"
    assert payload["mode"] == "auto"
    assert "ts" in payload


def test_chat_meta_is_skipped_by_message_reconstruction(project_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(project_root)
    w = SessionWriter(session_id="chat-y")
    w.write_chat_meta(title="t", model="m", mode="ask")
    w.write_system_prompt("be helpful")
    w.write_assistant_message("hi")

    reader = SessionReader(project_root / ".clawagents" / "sessions" / "chat-y.jsonl")
    msgs = reader.reconstruct_messages()
    assert [m.role for m in msgs] == ["system", "assistant"]
