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


def test_auto_discover_finds_marketplace_install_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`marketplace install` writes to .clawagents/skills; it must be found.

    Installing a skill that is then never discovered looks to the user like the
    install silently failed.
    """
    monkeypatch.chdir(tmp_path)
    from clawagents.marketplace import skills_install_dir

    target = skills_install_dir(tmp_path)
    (target / "demo").mkdir(parents=True)
    (target / "demo" / "SKILL.md").write_text("---\nname: demo\ndescription: d\n---\n")

    from clawagents.agent import _auto_discover_skills

    found = _auto_discover_skills()
    assert any(str(p).endswith(".clawagents/skills") for p in found), (
        f"marketplace install dir not discovered; got {found}"
    )


def test_auto_discover_finds_dot_claude_skills(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".claude" / "skills").mkdir(parents=True)
    from clawagents.agent import _auto_discover_skills

    found = _auto_discover_skills()
    assert any(str(p).endswith(".claude/skills") for p in found), (
        f".claude/skills not discovered; got {found}"
    )


def test_library_fallback_and_desktop_catalog_agree() -> None:
    """The two auto-discovery lists must not drift apart.

    `chats_api` only passes explicit skill dirs when the catalog resolves some;
    when it resolves none (or raises) `create_claw_agent` falls back to
    `_DEFAULT_SKILL_DIRS`. If one list gains a layout the other lacks, skills
    appear or vanish depending on which path ran, which is near-impossible to
    diagnose from the UI.
    """
    from clawagents.agent import _DEFAULT_SKILL_DIRS
    from clawagents.desktop_stores.skills_catalog import _AUTO_NAMES

    assert set(_DEFAULT_SKILL_DIRS) == set(_AUTO_NAMES), (
        "skill auto-discovery lists drifted: "
        f"only in agent={sorted(set(_DEFAULT_SKILL_DIRS) - set(_AUTO_NAMES))}, "
        f"only in catalog={sorted(set(_AUTO_NAMES) - set(_DEFAULT_SKILL_DIRS))}"
    )
