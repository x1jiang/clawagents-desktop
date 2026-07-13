import ast
from pathlib import Path

import pytest

from clawagents.utils import atomic_write as atomic_write_module
from clawagents.utils.atomic_write import atomic_write_bytes, atomic_write_text


def test_atomic_write_text_replaces_destination(tmp_path: Path) -> None:
    target = tmp_path / "sample.txt"
    target.write_text("old", encoding="utf-8")

    atomic_write_text(target, "new")

    assert target.read_text(encoding="utf-8") == "new"
    assert list(tmp_path.glob("*.tmp")) == []


def test_atomic_write_bytes_replaces_destination(tmp_path: Path) -> None:
    target = tmp_path / "sample.bin"
    target.write_bytes(b"old")

    atomic_write_bytes(target, b"new")

    assert target.read_bytes() == b"new"
    assert list(tmp_path.glob("*.tmp")) == []


def test_atomic_write_preserves_destination_and_cleans_temp_on_replace_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    target = tmp_path / "sample.txt"
    target.write_text("old", encoding="utf-8")

    def fail_replace(_src: str, _dst: str) -> None:
        raise OSError("replace failed")

    monkeypatch.setattr(atomic_write_module.os, "replace", fail_replace)

    with pytest.raises(OSError, match="replace failed"):
        atomic_write_text(target, "new")

    assert target.read_text(encoding="utf-8") == "old"
    assert list(tmp_path.glob("*.tmp")) == []


def test_atomic_write_uses_explicit_exception_cleanup() -> None:
    source = Path(atomic_write_module.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)

    bare_handlers = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ExceptHandler) and node.type is None
    ]
    assert bare_handlers == []
