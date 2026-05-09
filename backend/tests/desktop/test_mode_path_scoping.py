"""evaluate_tool_permission gains a project_root arg for desktop's Auto mode."""

from __future__ import annotations

from clawagents.permissions.mode import (
    PermissionMode,
    evaluate_tool_permission,
)


def test_accept_edits_without_project_root_still_allows() -> None:
    """Existing CLI/SDK callers that don't pass project_root see no change."""
    decision = evaluate_tool_permission(
        "write_file",
        mode=PermissionMode.ACCEPT_EDITS,
        file_path="/anywhere/foo.txt",
    )
    assert decision.allowed is True


def test_accept_edits_inside_project_root_allows() -> None:
    decision = evaluate_tool_permission(
        "write_file",
        mode=PermissionMode.ACCEPT_EDITS,
        file_path="/Users/me/proj/src/x.py",
        project_root="/Users/me/proj",
    )
    assert decision.allowed is True


def test_accept_edits_outside_project_root_requires_confirmation() -> None:
    decision = evaluate_tool_permission(
        "write_file",
        mode=PermissionMode.ACCEPT_EDITS,
        file_path="/Users/me/Desktop/escape.txt",
        project_root="/Users/me/proj",
    )
    assert decision.allowed is False
    assert decision.requires_confirmation is True


def test_accept_edits_no_file_path_with_root_allows() -> None:
    """Tools that don't operate on a path (e.g. shell with no file) still
    auto-allow under ACCEPT_EDITS — path scoping only kicks in for path tools."""
    decision = evaluate_tool_permission(
        "execute",
        mode=PermissionMode.ACCEPT_EDITS,
        command="ls",
        project_root="/Users/me/proj",
    )
    assert decision.allowed is True


def test_accept_edits_shell_with_outside_file_requires_confirmation() -> None:
    """Shell tools with an explicit file_path argument also obey project_root scoping.
    Regression guard for the path-scoping branch firing on write-class tools generally,
    not just file-write tools."""
    decision = evaluate_tool_permission(
        "execute",
        mode=PermissionMode.ACCEPT_EDITS,
        file_path="/Users/me/Desktop/escape.sh",
        command="bash /Users/me/Desktop/escape.sh",
        project_root="/Users/me/proj",
    )
    assert decision.allowed is False
    assert decision.requires_confirmation is True
