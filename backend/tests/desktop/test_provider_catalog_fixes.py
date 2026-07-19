"""Regressions for four provider_catalog.py bugs found by a parity audit
against clawagents_py/clawagents_vscode's current provider-selection fixes:

1. Ollama daemon probe ran unconditionally (blocking urlopen) on every
   catalog build with no cheap/no-network path.
2. No Mantle (OneHUB gateway) model catalog or routing at all, even though
   gateway.chats_api already routes a trusted Bedrock base_url through the
   OpenAI-compatible client — the catalog showed native IAM ids that 400/404
   against a Mantle endpoint.
3. Hardcoded stale Anthropic model ids (claude-opus-4-7, claude-sonnet-4-6)
   that match no real direct-API model name in either sibling repo.
4. Bedrock IAM and gateway readiness were one shared `available` boolean, so
   a user with only a gateway key (no AWS creds, no base_url configured)
   saw native IAM ids marked available -- picking one hands boto3's
   credential chain nothing to authenticate with.
"""

from __future__ import annotations

import time

import pytest

from clawagents.desktop_stores.provider_catalog import (
    _is_mantle_base_url,
    build_provider_catalog,
)
from clawagents.desktop_stores.settings_store import AppSettings


def _clear_bedrock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in (
        "BEDROCK_API_KEY",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_PROFILE",
        "AWS_DEFAULT_PROFILE",
        "AWS_REGION",
        "AWS_DEFAULT_REGION",
    ):
        monkeypatch.delenv(k, raising=False)


# ── Finding 1: Ollama probe must not block by default ──────────────────────


def test_ollama_not_probed_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*args, **kwargs):
        raise AssertionError("network probe must not run when probe_ollama=False")

    monkeypatch.setattr("urllib.request.urlopen", _boom)

    start = time.monotonic()
    catalog = build_provider_catalog(AppSettings(), probe_ollama=False)
    assert time.monotonic() - start < 0.1

    ollama = next(p for p in catalog if p["id"] == "ollama")
    assert ollama["available"] is False  # unknown, not falsely claimed reachable


def test_ollama_probed_only_when_explicitly_requested(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    class _FakeResp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"{}"

    def _fake_urlopen(req, timeout=None):
        url = req if isinstance(req, str) else req.full_url
        calls.append(url)
        return _FakeResp()

    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)
    build_provider_catalog(AppSettings(), probe_ollama=True)
    assert calls, "probe_ollama=True must actually hit the daemon"


# ── Finding 2: Mantle catalog + routing ─────────────────────────────────────


def test_is_mantle_base_url_detects_gateway_host() -> None:
    assert _is_mantle_base_url("https://bedrock-mantle.us-east-1.api.aws/v1") is True
    assert _is_mantle_base_url("https://bedrock-mantle.api.aws/v1") is True
    assert _is_mantle_base_url("https://api.openai.com/v1") is False
    assert _is_mantle_base_url("not a url") is False


def test_mantle_settings_show_mantle_catalog_not_native_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_bedrock_env(monkeypatch)
    monkeypatch.setenv("BEDROCK_API_KEY", "bag-token")

    settings = AppSettings(
        provider="bedrock",
        base_url="https://bedrock-mantle.us-east-1.api.aws/v1",
        trust_custom_base_url=True,
    )
    catalog = build_provider_catalog(settings)
    bedrock = next(p for p in catalog if p["id"] == "bedrock")

    ids = {m["id"] for m in bedrock["models"]}
    assert "anthropic.claude-sonnet-5" in ids  # Mantle-shaped id present
    assert not any(mid.startswith("us.anthropic") for mid in ids), (
        "native IAM inference-profile ids must not appear in Mantle mode"
    )
    assert bedrock["available"] is True


def test_non_bedrock_provider_with_mantle_like_base_url_stays_native(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A stale Mantle base_url left over after switching providers away
    from bedrock must not affect the Bedrock row (mirrors
    chats_api._resolve_model_kwargs, which only takes the Mantle path when
    provider=='bedrock')."""
    _clear_bedrock_env(monkeypatch)
    monkeypatch.setenv("BEDROCK_API_KEY", "bag-token")
    settings = AppSettings(
        provider="openai",
        base_url="https://bedrock-mantle.us-east-1.api.aws/v1",
        trust_custom_base_url=True,
    )
    catalog = build_provider_catalog(settings)
    bedrock = next(p for p in catalog if p["id"] == "bedrock")
    ids = {m["id"] for m in bedrock["models"]}
    assert any(mid.startswith("us.anthropic") for mid in ids), "must stay on native catalog"


# ── Finding 3: stale model catalog entries ──────────────────────────────────


def test_anthropic_catalog_has_no_stale_ids() -> None:
    catalog = build_provider_catalog(AppSettings())
    anthropic = next(p for p in catalog if p["id"] == "anthropic")
    ids = {m["id"] for m in anthropic["models"]}
    assert "claude-opus-4-7" not in ids
    assert "claude-sonnet-4-6" not in ids
    assert "claude-sonnet-4-5" in ids
    assert "claude-opus-4-6" in ids


# ── Finding 4: split IAM vs gateway availability ────────────────────────────


def test_gateway_key_alone_does_not_mark_native_iam_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bare BEDROCK_API_KEY with no AWS credentials and no base_url must
    NOT mark the (native-IAM-routed) Bedrock row available -- the real
    request path (chats_api._resolve_model_kwargs) takes the native IAM
    branch here and boto3 would get nothing to authenticate with."""
    _clear_bedrock_env(monkeypatch)
    monkeypatch.setenv("BEDROCK_API_KEY", "bag-token")

    settings = AppSettings(provider="bedrock")  # no base_url
    catalog = build_provider_catalog(settings)
    bedrock = next(p for p in catalog if p["id"] == "bedrock")

    assert bedrock["available"] is False
    ids = {m["id"] for m in bedrock["models"]}
    assert any(mid.startswith("us.anthropic") for mid in ids)  # native ids shown


def test_aws_credentials_alone_mark_native_iam_available(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_bedrock_env(monkeypatch)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIATEST")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")

    settings = AppSettings(provider="bedrock")
    catalog = build_provider_catalog(settings)
    bedrock = next(p for p in catalog if p["id"] == "bedrock")
    assert bedrock["available"] is True
