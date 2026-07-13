"""Pin the directories `_auto_discover_skills` searches.

The default list used to be just ``skills/.skills/skill/.skill/Skills``,
which silently ignored projects that put skills under ``.cursor/skills``,
``.agents/skills``, or ``.agent/skills`` (the layouts used by Cursor,
Claude Code, and other agent shells). When the desktop chat ran in such
a project the agent reinvented document-parsing logic instead of using
the bundled DOCX/PDF skills.
"""

from __future__ import annotations

from pathlib import Path

import pytest


def test_auto_discover_finds_dot_agents_skills(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".agents" / "skills" / "docx").mkdir(parents=True)
    (tmp_path / ".agents" / "skills" / "docx" / "SKILL.md").write_text("---\nname: docx\ndescription: docs\n---\n")

    from clawagents.agent import _auto_discover_skills

    found = _auto_discover_skills()
    assert any(str(p).endswith(".agents/skills") for p in found), (
        f".agents/skills not discovered; got {found}"
    )


def test_auto_discover_finds_dot_cursor_skills(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".cursor" / "skills").mkdir(parents=True)
    from clawagents.agent import _auto_discover_skills
    found = _auto_discover_skills()
    assert any(str(p).endswith(".cursor/skills") for p in found), (
        f".cursor/skills not discovered; got {found}"
    )


def test_auto_discover_keeps_legacy_skills_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Backwards compatibility: a plain `skills/` directory must still work."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / "skills").mkdir()
    from clawagents.agent import _auto_discover_skills
    found = _auto_discover_skills()
    assert any(p.endswith("skills") and not p.endswith(".agents/skills") for p in found), (
        f"legacy skills/ not discovered; got {found}"
    )


def test_auto_discover_returns_empty_when_no_skill_dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    from clawagents.agent import _auto_discover_skills
    assert _auto_discover_skills() == []


def test_auto_discover_returns_multiple_when_present(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "skills").mkdir()
    (tmp_path / ".cursor" / "skills").mkdir(parents=True)
    (tmp_path / ".agents" / "skills").mkdir(parents=True)
    from clawagents.agent import _auto_discover_skills
    found = _auto_discover_skills()
    # On case-insensitive FS (macOS default) `skills` and `Skills` collide,
    # so we just assert the three *distinct* locations are present.
    assert any(p.endswith("/skills") and not p.endswith(("/.cursor/skills", "/.agents/skills")) for p in found)
    assert any(p.endswith("/.cursor/skills") for p in found)
    assert any(p.endswith("/.agents/skills") for p in found)
