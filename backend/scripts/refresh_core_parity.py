#!/usr/bin/env python3
"""Regenerate ``core-parity.json`` from the working tree.

``check_core_parity.py`` answers "did anything drift since it was last
reviewed?". This answers "I have reviewed the current state — record it."
Keeping them separate is the point: the check must never be able to silence
itself, so refreshing is always a deliberate, separate act.

The split between shared and forked is derived, not declared: a file whose
bytes match upstream is shared, anything else is a fork. Reasons for forks are
carried over from the existing manifest, and a fork with no recorded reason is
refused — an undocumented fork is how a "temporary" local patch becomes
permanent and invisible.

    python scripts/refresh_core_parity.py --check    # dry run, exit 1 on change
    python scripts/refresh_core_parity.py            # write the manifest
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def _digest(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _default_upstream(backend: Path) -> Path:
    return backend.parent.parent / "clawagents_py" / "src" / "clawagents"


def build_manifest(desktop: Path, upstream: Path, previous: dict) -> tuple[dict, list[str]]:
    """Return the refreshed manifest and any files lacking a fork reason."""
    reasons: dict[str, str] = dict(previous.get("intentional_forks") or {})

    upstream_rel = sorted(
        str(p.relative_to(upstream))
        for p in upstream.rglob("*.py")
        if "__pycache__" not in p.parts
    )

    shared: list[str] = []
    forks: dict[str, str] = {}
    undocumented: list[str] = []

    for rel in upstream_rel:
        up_hash = _digest(upstream / rel)
        dt_hash = _digest(desktop / rel)
        if dt_hash is not None and dt_hash == up_hash:
            shared.append(rel)
            continue
        # Missing locally counts as a fork too: it is a deliberate omission or
        # a botched sync, and either way it deserves a written reason.
        reason = reasons.get(rel)
        if not reason:
            undocumented.append(rel)
            continue
        forks[rel] = reason

    manifest = {
        "intentional_fork_hashes": {
            rel: _digest(desktop / rel) for rel in sorted(forks)
        },
        "intentional_forks": {rel: forks[rel] for rel in sorted(forks)},
        "shared_files": shared,
        "shared_hashes": {rel: _digest(desktop / rel) for rel in shared},
        "upstream_hashes": {
            rel: _digest(upstream / rel) for rel in [*shared, *sorted(forks)]
        },
    }
    return manifest, undocumented


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument(
        "--check",
        action="store_true",
        help="report whether the manifest is current without writing it",
    )
    args = parser.parse_args()

    backend = Path(__file__).resolve().parents[1]
    desktop = backend / "src" / "clawagents"
    upstream = args.upstream or _default_upstream(backend)
    if (upstream / "src" / "clawagents").is_dir():
        upstream = upstream / "src" / "clawagents"
    if not upstream.is_dir():
        print(f"upstream not found: {upstream}")
        return 2

    manifest_path = args.manifest or backend / "core-parity.json"
    try:
        previous = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError):
        previous = {}

    manifest, undocumented = build_manifest(desktop, upstream, previous)

    if undocumented:
        print("refusing to refresh: these differ from upstream with no recorded reason.")
        print('Add each to "intentional_forks" in the manifest with a one-line reason,')
        print("or re-sync the file from upstream so it is shared again:")
        for rel in undocumented:
            print(f"  {rel}")
        return 1

    payload = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    if args.check:
        current = manifest_path.read_text() if manifest_path.exists() else ""
        if current == payload:
            print(f"core-parity.json is current ({len(manifest['shared_files'])} shared, "
                  f"{len(manifest['intentional_forks'])} forked)")
            return 0
        print("core-parity.json is stale — run scripts/refresh_core_parity.py")
        return 1

    manifest_path.write_text(payload)
    print(
        f"wrote {manifest_path.name}: {len(manifest['shared_files'])} shared, "
        f"{len(manifest['intentional_forks'])} intentional forks"
    )
    for rel in manifest["intentional_forks"]:
        print(f"  fork: {rel} — {manifest['intentional_forks'][rel]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
