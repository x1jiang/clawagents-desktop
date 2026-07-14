"""REST router for desktop provider catalog."""

from __future__ import annotations

from fastapi import APIRouter

from clawagents.desktop_stores.provider_catalog import build_provider_catalog
from clawagents.desktop_stores.settings_store import SettingsStore, effective_settings
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["providers"], dependencies=[require_auth()])


@router.get("/providers")
def list_providers(project_id: str | None = None, projectless: bool = False) -> list[dict]:
    from clawagents.gateway.settings_api import _scope_root

    root = _scope_root(project_id, projectless)
    settings = effective_settings(root) if root else SettingsStore().load()
    if root is None:
        settings.trust_custom_base_url = False
    return build_provider_catalog(settings)
