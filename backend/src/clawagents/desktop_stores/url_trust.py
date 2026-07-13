"""URL trust helpers for provider base_url endpoints."""

from __future__ import annotations

from urllib.parse import urlparse


def is_trusted_base_url(raw: str | None) -> bool:
    """True for empty / loopback / unix-socket-style base URLs."""
    text = (raw or "").strip()
    if not text:
        return True
    try:
        with_scheme = text if "://" in text else f"http://{text}"
        u = urlparse(with_scheme)
        host = (u.hostname or "").lower()
        return host in {
            "localhost",
            "127.0.0.1",
            "::1",
            "[::1]",
            "0.0.0.0",
        }
    except Exception:  # noqa: BLE001
        return False
