"""Runtime settings endpoints — currently just live API key updates.

The desktop's Settings UI persists API keys to macOS Keychain. At sidecar
launch the Tauri Rust shell merges them into the subprocess env. Between
launches, this endpoint lets the UI push a fresh key into the running
gateway's `os.environ` so subsequent chat turns pick it up without a
restart. New `create_claw_agent` calls (per turn) re-read env via
`EngineConfig`/pydantic-settings, so the new key takes effect on the next
turn.

Restricted to the three known provider env vars (no arbitrary env writes)
so the endpoint can't be abused to set, say, `PATH`.
"""

from __future__ import annotations

import os
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["settings"], dependencies=[require_auth()])

Provider = Literal["openai", "anthropic", "gemini"]

_PROVIDER_TO_ENV: dict[str, str] = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
}


class ApiKeyBody(BaseModel):
    provider: Provider
    api_key: str  # empty string clears


@router.post("/settings/api-keys")
def set_api_key(body: ApiKeyBody) -> dict:
    env_name = _PROVIDER_TO_ENV.get(body.provider)
    if env_name is None:
        # Pydantic Literal already guards this; defensive belt-and-suspenders.
        raise HTTPException(status_code=400, detail=f"unknown provider {body.provider}")
    if body.api_key:
        os.environ[env_name] = body.api_key
    else:
        os.environ.pop(env_name, None)
    return {"ok": True, "env": env_name, "set": bool(body.api_key)}
