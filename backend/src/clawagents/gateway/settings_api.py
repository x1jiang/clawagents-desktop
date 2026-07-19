"""Runtime settings endpoints — live API key updates + app settings.

The desktop's Settings UI persists API keys to macOS Keychain. At sidecar
launch the Tauri Rust shell merges them into the subprocess env. Between
launches, this endpoint lets the UI push a fresh key into the running
gateway's `os.environ` so subsequent chat turns pick it up without a
restart.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from clawagents.desktop_stores.provider_catalog import _has_aws_credentials
from clawagents.desktop_stores.app_paths import projectless_scratch_dir
from clawagents.desktop_stores.project_store import ProjectNotFoundError, ProjectStore
from clawagents.desktop_stores.runtime_trust import RuntimeTrustStore
from clawagents.desktop_stores.settings_store import (
    SettingsStore,
    effective_settings,
    settings_store_lock,
)
from clawagents.desktop_stores.url_trust import is_trusted_base_url
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["settings"], dependencies=[require_auth()])

Provider = Literal["openai", "anthropic", "gemini", "bedrock"]

_PROVIDER_TO_ENV: dict[str, str] = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "bedrock": "BEDROCK_API_KEY",
}


class ApiKeyBody(BaseModel):
    provider: Provider
    api_key: str  # empty string clears


@router.post("/settings/api-keys")
def set_api_key(body: ApiKeyBody) -> dict:
    env_name = _PROVIDER_TO_ENV.get(body.provider)
    if env_name is None:
        raise HTTPException(status_code=400, detail=f"unknown provider {body.provider}")
    if body.api_key:
        os.environ[env_name] = body.api_key
    else:
        os.environ.pop(env_name, None)
    return {"ok": True, "env": env_name, "set": bool(body.api_key)}


def _settings_payload(s) -> dict:
    return {
        "default_model": s.default_model,
        "default_mode": s.default_mode,
        "theme": s.theme,
        "workspace_system_prompt": s.workspace_system_prompt,
        "provider": s.provider,
        "base_url": s.base_url,
        "trust_custom_base_url": s.trust_custom_base_url,
        "aws_region": s.aws_region,
        "aws_profile": s.aws_profile,
        "mcp_enabled": s.mcp_enabled,
        "mcp_trust_workspace": s.mcp_trust_workspace,
        "context_mode": s.context_mode,
        "browser_tools": s.browser_tools,
        "trajectory": s.trajectory,
        "learn": s.learn,
        "action_mode": s.action_mode,
        "agent_mode": s.agent_mode,
        "allow_full_access": s.allow_full_access,
        "allow_external_skill_dirs": s.allow_external_skill_dirs,
        "reasoning_effort": s.reasoning_effort,
        "wire_api": s.wire_api,
        "ssl_verify": s.ssl_verify,
        "skill_dirs": list(s.skill_dirs or []),
        "skill_auto_discover": s.skill_auto_discover,
        "skill_ignore_dirs": list(s.skill_ignore_dirs or []),
        "skill_exclude": list(s.skill_exclude or []),
        "skill_user_homes": s.skill_user_homes,
        "ensure_companions": s.ensure_companions,
        "has_aws_credentials": _has_aws_credentials(),
    }


def _scope_root(project_id: str | None, projectless: bool) -> str | None:
    if project_id and projectless:
        raise HTTPException(status_code=400, detail="choose project_id or projectless, not both")
    if project_id:
        try:
            project = ProjectStore().get(project_id)
        except ProjectNotFoundError:
            raise HTTPException(status_code=404, detail=f"project {project_id} not found")
        if project.kind == "ssh":
            raise HTTPException(
                status_code=400,
                detail="SSH runtime trust must be configured through the connected remote gateway",
            )
        try:
            return str(Path(project.root_path).expanduser().resolve(strict=True))
        except OSError:
            raise HTTPException(status_code=400, detail="project root is unavailable")
    if projectless:
        root = projectless_scratch_dir()
        root.mkdir(parents=True, exist_ok=True)
        return str(root)
    return None


@router.get("/settings/app")
def get_app_settings(project_id: str | None = None, projectless: bool = False) -> dict:
    """Return non-secret app settings (everything that lives in settings.json)."""
    root = _scope_root(project_id, projectless)
    settings = effective_settings(root) if root else SettingsStore().load()
    if root is None:
        # Legacy application-wide approvals are never effective.
        settings.trust_custom_base_url = False
        settings.mcp_trust_workspace = False
        settings.allow_full_access = False
        settings.allow_external_skill_dirs = False
    return _settings_payload(settings)


class AppSettingsPatchBody(BaseModel):
    default_model: str | None = None
    default_mode: str | None = None
    theme: str | None = None
    workspace_system_prompt: str | None = None
    provider: str | None = None
    base_url: str | None = None
    trust_custom_base_url: bool | None = None
    aws_region: str | None = None
    aws_profile: str | None = None
    mcp_enabled: bool | None = None
    mcp_trust_workspace: bool | None = None
    context_mode: bool | None = None
    browser_tools: bool | None = None
    trajectory: bool | None = None
    learn: bool | None = None
    action_mode: str | None = None
    agent_mode: str | None = None
    allow_full_access: bool | None = None
    allow_external_skill_dirs: bool | None = None
    reasoning_effort: str | None = None
    wire_api: str | None = None
    ssl_verify: bool | None = None
    skill_dirs: list[str] | None = None
    skill_auto_discover: bool | None = None
    skill_ignore_dirs: list[str] | None = None
    skill_exclude: list[str] | None = None
    skill_user_homes: bool | None = None
    ensure_companions: bool | None = None


@router.patch("/settings/app")
def patch_app_settings(
    body: AppSettingsPatchBody,
    project_id: str | None = None,
    projectless: bool = False,
) -> dict:
    sent = body.model_fields_set
    root = _scope_root(project_id, projectless)
    runtime_fields = {
        "trust_custom_base_url",
        "mcp_trust_workspace",
        "allow_full_access",
        "allow_external_skill_dirs",
    }
    requested_runtime = sent & runtime_fields
    if requested_runtime and root is None:
        if any(bool(getattr(body, field)) for field in requested_runtime):
            raise HTTPException(
                status_code=400,
                detail="runtime trust requires project_id or projectless scope",
            )
        requested_runtime = set()
    # Guard the whole load -> mutate -> save sequence: two concurrent
    # PATCH requests must not both load() the same snapshot and have
    # whichever save()s last silently discard the other's changes.
    with settings_store_lock:
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
        if "provider" in sent and body.provider is not None:
            allowed = {"auto", "openai", "anthropic", "gemini", "bedrock", "ollama"}
            settings.provider = body.provider if body.provider in allowed else "auto"
        if "base_url" in sent and body.base_url is not None:
            base = body.base_url.strip()
            trust_store = RuntimeTrustStore()
            approved_now = bool(root) and bool(body.trust_custom_base_url)
            already_approved = bool(root) and trust_store.is_url_trusted(root, base)
            if base and not is_trusted_base_url(base) and not (approved_now or already_approved):
                raise HTTPException(
                    status_code=400,
                    detail="Untrusted base_url — set trust_custom_base_url=true to confirm",
                )
            settings.base_url = base
        if "aws_region" in sent and body.aws_region is not None:
            settings.aws_region = body.aws_region.strip()
        if "aws_profile" in sent and body.aws_profile is not None:
            settings.aws_profile = body.aws_profile.strip()
        if "mcp_enabled" in sent and body.mcp_enabled is not None:
            settings.mcp_enabled = bool(body.mcp_enabled)
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
        if "reasoning_effort" in sent and body.reasoning_effort is not None:
            effort = body.reasoning_effort.strip().lower()
            allowed_effort = {"", "none", "low", "medium", "high", "xhigh", "max"}
            settings.reasoning_effort = effort if effort in allowed_effort else "medium"
        if "wire_api" in sent and body.wire_api is not None:
            wire = body.wire_api.strip().lower()
            allowed_wire = {"auto", "responses", "chat_completions"}
            settings.wire_api = wire if wire in allowed_wire else "auto"
        if "ssl_verify" in sent and body.ssl_verify is not None:
            settings.ssl_verify = bool(body.ssl_verify)
        if "skill_dirs" in sent and body.skill_dirs is not None:
            settings.skill_dirs = [str(x).strip() for x in body.skill_dirs if str(x).strip()]
        if "skill_auto_discover" in sent and body.skill_auto_discover is not None:
            settings.skill_auto_discover = bool(body.skill_auto_discover)
        if "skill_ignore_dirs" in sent and body.skill_ignore_dirs is not None:
            settings.skill_ignore_dirs = [str(x).strip() for x in body.skill_ignore_dirs if str(x).strip()]
        if "skill_exclude" in sent and body.skill_exclude is not None:
            settings.skill_exclude = [str(x).strip() for x in body.skill_exclude if str(x).strip()]
        if "skill_user_homes" in sent and body.skill_user_homes is not None:
            settings.skill_user_homes = bool(body.skill_user_homes)
        if "ensure_companions" in sent and body.ensure_companions is not None:
            settings.ensure_companions = bool(body.ensure_companions)
        if root and requested_runtime:
            changes = {field: getattr(body, field) for field in requested_runtime}
            if "trust_custom_base_url" in requested_runtime:
                changes["base_url"] = body.base_url if "base_url" in sent else settings.base_url
            RuntimeTrustStore().update(root, changes)
        store.save(settings)
        # Push AWS region/profile into process env for native Bedrock turns.
        if settings.aws_region:
            os.environ["AWS_REGION"] = settings.aws_region
            os.environ.setdefault("AWS_DEFAULT_REGION", settings.aws_region)
        if settings.aws_profile:
            os.environ["AWS_PROFILE"] = settings.aws_profile
        return get_app_settings(project_id=project_id, projectless=projectless)


class VerifyKeyBody(BaseModel):
    provider: Provider
    api_key: str = ""


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

    if body.provider == "bedrock":
        if _has_aws_credentials():
            return {
                "ok": True,
                "status": 200,
                "message": "Native AWS credentials detected — leave Base URL empty for IAM Bedrock",
                "model_count": None,
            }
        key = body.api_key.strip() or os.environ.get("BEDROCK_API_KEY", "")
        if key:
            return {
                "ok": True,
                "status": 200,
                "message": "Gateway key present — set Base URL for BAG/LiteLLM",
                "model_count": None,
            }
        return {
            "ok": False,
            "status": 0,
            "message": "No AWS credentials (~/.aws or AWS_*) and no gateway key",
            "model_count": None,
        }

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
