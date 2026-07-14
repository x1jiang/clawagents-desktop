#!/usr/bin/env python3
"""Focused hash parity check for the vendored ClawAgents core."""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ParityResult:
    unexpected: tuple[str, ...] = ()
    intentional: tuple[str, ...] = ()
    skipped: bool = False
    reason: str = ""

    @property
    def ok(self) -> bool:
        return self.skipped or not self.unexpected


def _digest(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def check_parity(desktop: Path, upstream: Path, manifest: Path) -> ParityResult:
    try:
        config = json.loads(manifest.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return ParityResult(unexpected=(f"manifest: {exc}",))
    shared = config.get("shared_files")
    forks = config.get("intentional_forks")
    shared_hashes = config.get("shared_hashes")
    fork_hashes = config.get("intentional_fork_hashes")
    upstream_hashes = config.get("upstream_hashes")
    if not all(isinstance(value, expected) for value, expected in (
        (shared, list), (forks, dict), (shared_hashes, dict),
        (fork_hashes, dict), (upstream_hashes, dict),
    )):
        return ParityResult(unexpected=("manifest: missing explicit parity hash maps",))

    unexpected: list[str] = []
    intentional: list[str] = []
    upstream_available = upstream.is_dir()
    manifest_paths = set(shared) | set(forks)
    if upstream_available:
        upstream_paths = {
            str(path.relative_to(upstream)) for path in upstream.rglob("*.py")
        }
        unexpected.extend(
            f"untracked-upstream:{rel}" for rel in sorted(upstream_paths - manifest_paths)
        )
        unexpected.extend(
            f"stale-manifest:{rel}" for rel in sorted(manifest_paths - upstream_paths)
        )
    for rel in shared:
        if not isinstance(rel, str) or _digest(desktop / rel) != shared_hashes.get(rel):
            unexpected.append(str(rel))
        if upstream_available and _digest(upstream / rel) != upstream_hashes.get(rel):
            unexpected.append(f"upstream:{rel}")
    for rel in forks:
        if _digest(desktop / rel) != fork_hashes.get(rel):
            unexpected.append(f"intentional-fork-changed:{rel}")
        elif _digest(desktop / rel) != upstream_hashes.get(rel):
            intentional.append(rel)
        if upstream_available and _digest(upstream / rel) != upstream_hashes.get(rel):
            unexpected.append(f"upstream:{rel}")
    reason = "live upstream verified" if upstream_available else "pinned 6.12.13 hashes verified"
    return ParityResult(
        unexpected=tuple(unexpected),
        intentional=tuple(intentional),
        reason=reason,
    )


def _default_upstream() -> Path:
    desktop_repo = Path(__file__).resolve().parents[2]
    return desktop_repo.parent / "clawagents_py" / "src" / "clawagents"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", type=Path, help="clawagents_py repository or src/clawagents path")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[1]
    desktop = backend / "src" / "clawagents"
    upstream = args.upstream or _default_upstream()
    if (upstream / "src" / "clawagents").is_dir():
        upstream = upstream / "src" / "clawagents"
    result = check_parity(desktop, upstream, args.manifest or backend / "core-parity.json")
    if result.skipped:
        print(f"SKIP: {result.reason}")
        return 0
    for rel in result.intentional[:50]:
        print(f"intentional fork: {rel}")
    for rel in result.unexpected[:50]:
        print(f"unexpected drift: {rel}")
    if len(result.unexpected) > 50:
        print(f"unexpected drift: ... and {len(result.unexpected) - 50} more")
    print(
        f"core parity: {'ok' if result.ok else 'failed'}; "
        f"intentional={len(result.intentional)} unexpected={len(result.unexpected)}"
    )
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
