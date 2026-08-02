"""Atomic file writes using temp-then-rename pattern."""
import os
import tempfile
from pathlib import Path


def atomic_write_text(path: "Path | str", content: str, encoding: str = "utf-8") -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(content)
        os.replace(tmp, str(path))
    except BaseException:
        # BaseException, not Exception: a KeyboardInterrupt mid-write must not
        # strand the temp file next to the real one. Spelled out rather than a
        # bare ``except:`` so the breadth is a stated decision — the exception
        # is always re-raised, so nothing is swallowed.
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def atomic_write_bytes(path: "Path | str", data: bytes) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, str(path))
    except BaseException:
        # BaseException, not Exception: a KeyboardInterrupt mid-write must not
        # strand the temp file next to the real one. Spelled out rather than a
        # bare ``except:`` so the breadth is a stated decision — the exception
        # is always re-raised, so nothing is swallowed.
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
