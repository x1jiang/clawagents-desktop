"""REST router for desktop provider catalog."""

from __future__ import annotations

from fastapi import APIRouter

from clawagents.desktop_stores.provider_catalog import build_provider_catalog
from clawagents.desktop_stores.settings_store import SettingsStore
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["providers"], dependencies=[require_auth()])


@router.get("/providers")
def list_providers() -> list[dict]:
    return build_provider_catalog(SettingsStore().load())
