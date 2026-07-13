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

from clawagents.desktop_stores.settings_store import SettingsStore
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


@router.get("/settings/app")
def get_app_settings() -> dict:
    """Return non-secret app settings (everything that lives in settings.json).

    API keys live in macOS Keychain and are handled separately.
    """
    s = SettingsStore().load()
    return {
        "default_model": s.default_model,
        "default_mode": s.default_mode,
        "theme": s.theme,
        "workspace_system_prompt": s.workspace_system_prompt,
        "mcp_enabled": s.mcp_enabled,
        "mcp_trust_workspace": s.mcp_trust_workspace,
        "context_mode": s.context_mode,
        "browser_tools": s.browser_tools,
        "trajectory": s.trajectory,
        "learn": s.learn,
        "action_mode": s.action_mode,
        "agent_mode": s.agent_mode,
        "allow_full_access": s.allow_full_access,
    }


class AppSettingsPatchBody(BaseModel):
    default_model: str | None = None
    default_mode: str | None = None
    theme: str | None = None
    workspace_system_prompt: str | None = None
    mcp_enabled: bool | None = None
    mcp_trust_workspace: bool | None = None
    context_mode: bool | None = None
    browser_tools: bool | None = None
    trajectory: bool | None = None
    learn: bool | None = None
    action_mode: str | None = None
    agent_mode: str | None = None
    allow_full_access: bool | None = None


@router.patch("/settings/app")
def patch_app_settings(body: AppSettingsPatchBody) -> dict:
    sent = body.model_fields_set
    store = SettingsStore()
    settings = store.load()
    if "default_model" in sent and body.default_model is not None:
        settings.default_model = body.default_model
    if "default_mode" in sent and body.default_mode is not None:
        settings.default_mode = body.default_mode
    if "theme" in sent and body.theme is not None:
        settings.theme = body.theme
    if "workspace_system_prompt" in sent:
        settings.workspace_system_prompt = body.workspace_system_prompt or ""
    if "mcp_enabled" in sent and body.mcp_enabled is not None:
        settings.mcp_enabled = bool(body.mcp_enabled)
    if "mcp_trust_workspace" in sent and body.mcp_trust_workspace is not None:
        settings.mcp_trust_workspace = bool(body.mcp_trust_workspace)
    if "context_mode" in sent and body.context_mode is not None:
        settings.context_mode = bool(body.context_mode)
    if "browser_tools" in sent and body.browser_tools is not None:
        settings.browser_tools = bool(body.browser_tools)
    if "trajectory" in sent and body.trajectory is not None:
        settings.trajectory = bool(body.trajectory)
    if "learn" in sent and body.learn is not None:
        settings.learn = bool(body.learn)
    if "action_mode" in sent and body.action_mode is not None:
        settings.action_mode = body.action_mode if body.action_mode in ("tools", "code") else "tools"
    if "agent_mode" in sent and body.agent_mode is not None:
        settings.agent_mode = body.agent_mode
    if "allow_full_access" in sent and body.allow_full_access is not None:
        settings.allow_full_access = bool(body.allow_full_access)
    store.save(settings)
    return get_app_settings()


class VerifyKeyBody(BaseModel):
    provider: Provider
    api_key: str


# Each provider has a cheap models-list endpoint that authenticates the key
# without actually generating any tokens. Using GET /v1/models keeps the cost
# (and latency) low — usually a few hundred ms.
_VERIFY_ENDPOINTS: dict[str, dict] = {
    "openai": {
        "url": "https://api.openai.com/v1/models",
        "auth_header": lambda key: {"Authorization": f"Bearer {key}"},
    },
    "anthropic": {
        "url": "https://api.anthropic.com/v1/models",
        "auth_header": lambda key: {"x-api-key": key, "anthropic-version": "2023-06-01"},
    },
    "gemini": {
        # Gemini uses a query parameter, not a header.
        "url": "https://generativelanguage.googleapis.com/v1beta/models",
        "auth_header": lambda key: {},
        "query": lambda key: {"key": key},
    },
}


@router.post("/settings/verify-key")
async def verify_api_key(body: VerifyKeyBody) -> dict:
    """Hit the provider's models-list endpoint to confirm a key actually works.

    Returns ``{ok: bool, status: int, message: str, model_count: int | null}``.
    Used by the Settings UI's "Test" button so users don't discover an
    invalid key for the first time mid-chat. Doesn't store the key anywhere.
    """
    import httpx

    if not body.api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is empty")
    spec = _VERIFY_ENDPOINTS.get(body.provider)
    if spec is None:
        raise HTTPException(status_code=400, detail=f"unknown provider {body.provider}")

    headers = spec["auth_header"](body.api_key)
    params = spec.get("query", lambda _: {})(body.api_key)

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            r = await http.get(spec["url"], headers=headers, params=params)
    except httpx.RequestError as exc:
        return {"ok": False, "status": 0, "message": f"network error: {exc}", "model_count": None}

    if r.status_code == 200:
        try:
            data = r.json()
        except ValueError:
            data = {}
        # OpenAI/Anthropic return {data: [...]}; Gemini returns {models: [...]}
        count = len(data.get("data") or data.get("models") or [])
        return {"ok": True, "status": 200, "message": "OK", "model_count": count}

    # 401 / 403 / 429 — surface a short message for the UI to display.
    snippet = r.text[:200] if r.text else ""
    if r.status_code in (401, 403):
        return {"ok": False, "status": r.status_code, "message": f"Auth failed: {snippet}", "model_count": None}
    return {"ok": False, "status": r.status_code, "message": snippet or f"HTTP {r.status_code}", "model_count": None}
