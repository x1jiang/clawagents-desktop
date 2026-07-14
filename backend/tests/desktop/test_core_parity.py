from __future__ import annotations

import json
import hashlib
from pathlib import Path

from scripts.check_core_parity import check_parity


def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _manifest(
    path: Path,
    *,
    desktop: Path,
    upstream: Path,
    shared: list[str],
    forks: dict[str, str] | None = None,
) -> Path:
    forks = forks or {}
    upstream_hashes = {
        rel: _hash(upstream / rel)
        for rel in [*shared, *forks]
        if (upstream / rel).is_file()
    }
    path.write_text(json.dumps({
        "shared_files": shared,
        "intentional_forks": forks,
        "shared_hashes": {rel: _hash(desktop / rel) for rel in shared},
        "intentional_fork_hashes": {rel: _hash(desktop / rel) for rel in forks},
        "upstream_hashes": upstream_hashes,
    }))
    return path


def test_identical_shared_file_passes(tmp_path: Path) -> None:
    desktop, upstream = tmp_path / "desktop", tmp_path / "upstream"
    desktop.mkdir()
    upstream.mkdir()
    (desktop / "same.py").write_text("same")
    (upstream / "same.py").write_text("same")
    manifest = _manifest(tmp_path / "manifest.json", desktop=desktop, upstream=upstream, shared=["same.py"])
    result = check_parity(desktop, upstream, manifest)
    assert result.ok
    assert result.unexpected == ()


def test_unexpected_drift_fails_with_filename(tmp_path: Path) -> None:
    desktop, upstream = tmp_path / "desktop", tmp_path / "upstream"
    desktop.mkdir()
    upstream.mkdir()
    (desktop / "drift.py").write_text("desktop")
    (upstream / "drift.py").write_text("upstream")
    manifest = _manifest(tmp_path / "manifest.json", desktop=upstream, upstream=upstream, shared=["drift.py"])
    result = check_parity(desktop, upstream, manifest)
    assert not result.ok
    assert result.unexpected == ("drift.py",)


def test_absent_upstream_uses_pinned_hashes(tmp_path: Path) -> None:
    desktop = tmp_path / "desktop"
    upstream_snapshot = tmp_path / "snapshot"
    desktop.mkdir()
    upstream_snapshot.mkdir()
    (desktop / "same.py").write_text("same")
    (upstream_snapshot / "same.py").write_text("same")
    manifest = _manifest(
        tmp_path / "manifest.json",
        desktop=desktop,
        upstream=upstream_snapshot,
        shared=["same.py"],
    )
    result = check_parity(desktop, tmp_path / "missing", manifest)
    assert result.ok and not result.skipped


def test_new_upstream_file_fails_inventory_check(tmp_path: Path) -> None:
    desktop, upstream = tmp_path / "desktop", tmp_path / "upstream"
    desktop.mkdir()
    upstream.mkdir()
    (desktop / "same.py").write_text("same")
    (upstream / "same.py").write_text("same")
    manifest = _manifest(
        tmp_path / "manifest.json",
        desktop=desktop,
        upstream=upstream,
        shared=["same.py"],
    )
    (upstream / "new_security_boundary.py").write_text("new")
    result = check_parity(desktop, upstream, manifest)
    assert not result.ok
    assert result.unexpected == ("untracked-upstream:new_security_boundary.py",)


def test_intentional_fork_is_reported_but_accepted(tmp_path: Path) -> None:
    desktop, upstream = tmp_path / "desktop", tmp_path / "upstream"
    desktop.mkdir()
    upstream.mkdir()
    (desktop / "fork.py").write_text("desktop")
    (upstream / "fork.py").write_text("upstream")
    manifest = _manifest(
        tmp_path / "manifest.json",
        desktop=desktop,
        upstream=upstream,
        shared=[],
        forks={"fork.py": "desktop gateway"},
    )
    result = check_parity(desktop, upstream, manifest)
    assert result.ok
    assert result.intentional == ("fork.py",)

    (desktop / "fork.py").write_text("unreviewed new drift")
    changed = check_parity(desktop, upstream, manifest)
    assert not changed.ok
    assert changed.unexpected == ("intentional-fork-changed:fork.py",)
