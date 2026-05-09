"""PermissionGrantStore: file-backed grants keyed by project."""

from __future__ import annotations

from pathlib import Path

from clawagents.desktop_stores.permission_grant_store import (
    PermissionGrant,
    PermissionGrantStore,
)


def test_list_empty(app_support_dir: Path) -> None:
    assert PermissionGrantStore().list() == []


def test_add_grant_persists(app_support_dir: Path) -> None:
    store = PermissionGrantStore()
    g = store.add(project_id="proj-1", path_pattern="/tmp/foo/*", scope="write")
    assert g.project_id == "proj-1"
    assert (app_support_dir / "permissions.json").exists()
    assert PermissionGrantStore().list() == [g]


def test_query_match_by_project_and_path(app_support_dir: Path) -> None:
    store = PermissionGrantStore()
    store.add(project_id="proj-1", path_pattern="/tmp/foo/*", scope="write")
    store.add(project_id="proj-2", path_pattern="/tmp/bar/*", scope="read")

    assert store.match("proj-1", "/tmp/foo/baz.txt", scope="write") is True
    assert store.match("proj-1", "/tmp/elsewhere", scope="write") is False
    assert store.match("proj-2", "/tmp/foo/baz.txt", scope="write") is False


def test_remove_by_project(app_support_dir: Path) -> None:
    store = PermissionGrantStore()
    store.add(project_id="proj-1", path_pattern="/a/*", scope="write")
    store.add(project_id="proj-2", path_pattern="/b/*", scope="write")

    store.remove_for_project("proj-1")
    listed = PermissionGrantStore().list()
    assert {g.project_id for g in listed} == {"proj-2"}
