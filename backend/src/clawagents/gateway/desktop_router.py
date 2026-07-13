"""Shared auth + error helpers for desktop API routers."""

from __future__ import annotations

import os
from typing import Any, Callable

from fastapi import Depends, Header, HTTPException, Query


def _check(authorization: str | None, query_token: str | None = None) -> None:
    expected = os.environ.get("GATEWAY_API_KEY", "")
    if not expected:
        return
    # Accept the token from a query parameter as a fallback for browser
    # contexts that can't add request headers — primarily `<img src>` URLs
    # for previewing project files. The gateway is bound to 127.0.0.1 so
    # the token-in-URL surface is limited to the local user.
    if query_token and query_token == expected:
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


def require_auth_with_query_token() -> Callable[..., Any]:
    """Like ``require_auth`` but also honours ``?token=<gateway-key>``.

    Use sparingly — only on endpoints that need to be reachable from
    headerless browser contexts (e.g. `<img src>` for local file preview).
    """

    def _dep(
        authorization: str | None = Header(default=None),
        token: str | None = Query(default=None),
    ) -> None:
        _check(authorization, token)

    return Depends(_dep)
