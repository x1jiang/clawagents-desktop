"""Shared auth + error helpers for desktop API routers."""

from __future__ import annotations

import os
from typing import Any, Callable

from fastapi import Depends, Header, HTTPException


def _check(authorization: str | None) -> None:
    expected = os.environ.get("GATEWAY_API_KEY", "")
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")
    if authorization[7:] != expected:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_auth() -> Callable[..., Any]:
    """Use as a FastAPI dependency: ``_: None = require_auth()``."""

    def _dep(authorization: str | None = Header(default=None)) -> None:
        _check(authorization)

    return Depends(_dep)
