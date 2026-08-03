"""Desktop chats keep the longest session logs anywhere in the ecosystem —
one JSONL accumulates every turn of a conversation — so the fork's append
must stay O(1) in the log's size (ported from upstream 6.20.54).

The gateway-side user_message / final-assistant writes are covered by
tests/desktop/test_chat_cross_turn_memory.py; these pin the file mechanics.
"""

from __future__ import annotations

from pathlib import Path

from clawagents.session.persistence import SessionReader, SessionWriter


def test_append_does_not_rewrite_the_whole_log(tmp_path: Path) -> None:
    writer = SessionWriter(session_id="grow", session_dir=tmp_path)
    writer.append("user_message", {"content": "first"})
    first_bytes = writer.path.read_bytes()

    for i in range(50):
        writer.append("tool_result", {"tool_call_id": f"c{i}", "output": "x" * 500})

    assert writer.path.read_bytes().startswith(first_bytes), (
        "earlier events were rewritten; append should only add to the end"
    )
    assert list(tmp_path.glob("*.tmp")) == [], "append left temp files behind"
    assert len(SessionReader(writer.path).events) == 51


def test_reader_tolerates_a_torn_final_line(tmp_path: Path) -> None:
    """With a real append, a SIGKILL mid-write can tear the last line.

    One lost event beats what raising did: making the entire chat fail to
    load in the UI.
    """
    writer = SessionWriter(session_id="torn", session_dir=tmp_path)
    writer.write_user_message("keep me")
    writer.write_assistant_message("keep me too")
    with open(writer.path, "a", encoding="utf-8") as handle:
        handle.write('{"type": "tool_result", "output": "cut off mid-')

    messages = SessionReader(writer.path).reconstruct_messages()
    assert [m.role for m in messages] == ["user", "assistant"]


def test_append_recreates_a_deleted_session_dir(tmp_path: Path) -> None:
    import shutil

    session_dir = tmp_path / "sessions"
    writer = SessionWriter(session_id="gone", session_dir=session_dir)
    writer.write_user_message("before")
    shutil.rmtree(session_dir)

    writer.write_assistant_message("after")
    assert writer.path.exists()
