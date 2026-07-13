"""The chat's permission mode (`read_only`, `full_access`, `auto`, `ask`)
must steer `_permission_cb` BEFORE it reaches the user-prompt flow.

Before this change, the chat-level mode field was decorative — the desktop
UI stored it but the gateway always fell through to the permission prompt.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from clawagents.gateway.chats_api import _decide_by_mode


class TestDecideByMode:
    def test_read_only_denies_writes(self, tmp_path: Path) -> None:
        assert _decide_by_mode("read_only", str(tmp_path / "out.txt"), str(tmp_path)) == "deny"

    def test_read_only_denies_even_without_path(self, tmp_path: Path) -> None:
        assert _decide_by_mode("read_only", None, str(tmp_path)) == "deny"

    def test_full_access_allows_everything(self, tmp_path: Path) -> None:
        assert _decide_by_mode("full_access", "/etc/passwd", str(tmp_path)) == "allow_once"

    def test_full_access_allows_without_path(self, tmp_path: Path) -> None:
        assert _decide_by_mode("full_access", None, str(tmp_path)) == "allow_once"

    def test_auto_allows_writes_inside_project_root(self, tmp_path: Path) -> None:
        inside = tmp_path / "src" / "x.py"
        inside.parent.mkdir(parents=True)
        inside.write_text("")
        assert _decide_by_mode("auto", str(inside), str(tmp_path)) == "allow_once"

    def test_auto_falls_through_for_writes_outside_project_root(self, tmp_path: Path) -> None:
        # /etc/passwd is plainly outside any tmp_path.
        assert _decide_by_mode("auto", "/etc/passwd", str(tmp_path)) is None

    def test_auto_without_file_path_falls_through(self, tmp_path: Path) -> None:
        # No path means we can't tell — punt to the user.
        assert _decide_by_mode("auto", None, str(tmp_path)) is None

    def test_auto_root_itself_is_allowed(self, tmp_path: Path) -> None:
        # Writing the project root itself is also "inside".
        assert _decide_by_mode("auto", str(tmp_path), str(tmp_path)) == "allow_once"

    def test_ask_mode_falls_through(self, tmp_path: Path) -> None:
        assert _decide_by_mode("ask", str(tmp_path / "x.txt"), str(tmp_path)) is None

    def test_unknown_mode_falls_through(self, tmp_path: Path) -> None:
        assert _decide_by_mode("does_not_exist", str(tmp_path / "x.txt"), str(tmp_path)) is None


class TestAutoModeSymlinks:
    """Symlinks shouldn't be a route for `auto` mode to leak writes outside
    the project root. Resolving both sides handles this safely."""

    def test_auto_rejects_symlink_escaping_root(self, tmp_path: Path) -> None:
        outside = tmp_path / "outside"
        outside.mkdir()
        project = tmp_path / "project"
        project.mkdir()
        # Place a symlink inside project pointing OUT.
        escape = project / "escape"
        escape.symlink_to(outside)
        # A write under <project>/escape/foo.txt actually lands in <outside>/foo.txt.
        target = escape / "foo.txt"
        # Resolved target is outside the project root → auto should not auto-allow.
        assert _decide_by_mode("auto", str(target), str(project)) is None
