"""Static catalog of providers + models with env-key availability check."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlparse

# Conservative defaults. Users can override via the provider's own model
# routing — this catalog drives the desktop's model picker UI only.
_CATALOG: list[dict[str, Any]] = [
    {
        "id": "anthropic",
        "name": "Anthropic",
        "env_key": "ANTHROPIC_API_KEY",
        "models": [
            {"id": "claude-sonnet-4-5", "label": "Claude Sonnet 4.5"},
            {"id": "claude-opus-4-6", "label": "Claude Opus 4.6"},
            {"id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5"},
        ],
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "env_key": "OPENAI_API_KEY",
        "models": [
            {"id": "gpt-5.6-sol", "label": "GPT-5.6 Sol"},
            {"id": "gpt-5.6-terra", "label": "GPT-5.6 Terra"},
            {"id": "gpt-5.6-luna", "label": "GPT-5.6 Luna"},
            {"id": "gpt-5.6", "label": "GPT-5.6 (alias → Sol)"},
            {"id": "gpt-5.5", "label": "GPT-5.5"},
            {"id": "gpt-5.5-pro", "label": "GPT-5.5 Pro"},
            {"id": "gpt-5.4", "label": "GPT-5.4"},
            {"id": "gpt-5.4-mini", "label": "GPT-5.4 mini"},
            {"id": "gpt-5.4-nano", "label": "GPT-5.4 nano"},
            {"id": "gpt-5.4-pro", "label": "GPT-5.4 Pro"},
            {"id": "gpt-4o", "label": "GPT-4o"},
        ],
    },
    {
        "id": "gemini",
        "name": "Google Gemini",
        "env_key": "GEMINI_API_KEY",
        "models": [
            {"id": "gemini-3.6-flash", "label": "Gemini 3.6 Flash"},
            {"id": "gemini-3.5-flash", "label": "Gemini 3.5 Flash"},
            {"id": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite"},
            {"id": "gemini-3.1-pro-preview", "label": "Gemini 3.1 Pro (preview)"},
            {"id": "gemini-3.1-flash-lite", "label": "Gemini 3.1 Flash-Lite"},
            {"id": "gemini-3-flash-preview", "label": "Gemini 3 Flash (preview)"},
            {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro"},
            {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash"},
        ],
    },
    {
        "id": "bedrock",
        "name": "AWS Bedrock",
        # Native IAM uses the AWS credential chain (no gateway key). When
        # Settings has a trusted Bedrock-gateway/Mantle base_url configured,
        # this row switches to the Mantle catalog + BEDROCK_API_KEY instead
        # (see build_provider_catalog) — matching exactly what
        # gateway.chats_api._resolve_model_kwargs sends for a real turn, so
        # the catalog can't advertise a mode the request path won't take.
        "env_key": "BEDROCK_API_KEY",
        "base_url": "",
        "models": [
            {
                "id": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
                "label": "Claude Sonnet 4.5 (US)",
            },
            {
                "id": "us.anthropic.claude-opus-4-6-20251101-v1:0",
                "label": "Claude Opus 4.6 (US)",
            },
            {
                "id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
                "label": "Claude Haiku 4.5 (US)",
            },
            {
                "id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
                "label": "Claude 3.5 Sonnet v2",
            },
            {"id": "amazon.nova-pro-v1:0", "label": "Amazon Nova Pro"},
            {"id": "amazon.nova-lite-v1:0", "label": "Amazon Nova Lite"},
            {"id": "amazon.nova-micro-v1:0", "label": "Amazon Nova Micro"},
            {"id": "amazon.nova-premier-v1:0", "label": "Amazon Nova Premier"},
            {"id": "meta.llama3-3-70b-instruct-v1:0", "label": "Llama 3.3 70B"},
            {"id": "meta.llama3-1-70b-instruct-v1:0", "label": "Llama 3.1 70B"},
            {"id": "meta.llama3-1-8b-instruct-v1:0", "label": "Llama 3.1 8B"},
            {"id": "mistral.mistral-large-2407-v1:0", "label": "Mistral Large"},
            {"id": "openai.gpt-oss-120b-1:0", "label": "GPT-OSS 120B"},
            {"id": "openai.gpt-oss-20b-1:0", "label": "GPT-OSS 20B"},
        ],
    },
    {
        "id": "ollama",
        "name": "Ollama (local)",
        "env_key": None,
        "base_url": "http://localhost:11434/v1",
        "models": [
            {"id": "llama3.1", "label": "Llama 3.1"},
        ],
    },
]

# Curated AWS Bedrock Mantle (OneHUB gateway) models. Shown instead of the
# native IAM list when Settings has a trusted Bedrock base_url pointed at a
# Mantle host — these bare, gateway-prefixed ids (not the native
# ``us.anthropic....:0`` inference-profile shape) are what
# gateway.chats_api._resolve_model_kwargs actually sends in that mode.
_MANTLE_MODELS: list[dict[str, str]] = [
    # Chat-completions path (…/v1/chat/completions)
    {"id": "openai.gpt-oss-20b", "label": "GPT-OSS 20B (Mantle · chat)"},
    {"id": "openai.gpt-oss-120b", "label": "GPT-OSS 120B (Mantle · chat)"},
    {"id": "deepseek.v3.2", "label": "DeepSeek V3.2 (Mantle · chat)"},
    # Anthropic Messages path (…/anthropic/v1/messages)
    {"id": "anthropic.claude-haiku-4-5", "label": "Claude Haiku 4.5 (Mantle · messages)"},
    {"id": "anthropic.claude-sonnet-5", "label": "Claude Sonnet 5 (Mantle · messages)"},
    {"id": "anthropic.claude-opus-4-8", "label": "Claude Opus 4.8 (Mantle · messages)"},
    {"id": "anthropic.claude-opus-4-7", "label": "Claude Opus 4.7 (Mantle · messages)"},
    # OpenAI Responses path (…/openai/v1/responses)
    {"id": "openai.gpt-5.6-sol", "label": "GPT-5.6 Sol (Mantle · responses)"},
    {"id": "openai.gpt-5.6-luna", "label": "GPT-5.6 Luna (Mantle · responses)"},
    {"id": "openai.gpt-5.6-terra", "label": "GPT-5.6 Terra (Mantle · responses)"},
    {"id": "openai.gpt-5.5", "label": "GPT-5.5 (Mantle · responses)"},
    {"id": "openai.gpt-5.4", "label": "GPT-5.4 (Mantle · responses)"},
]


def _is_mantle_base_url(base_url: str) -> bool:
    try:
        host = (urlparse(base_url).hostname or "").lower()
    except Exception:  # noqa: BLE001
        return False
    if host == "bedrock-mantle.api.aws":
        return True
    parts = host.split(".")
    return (
        len(parts) >= 4
        and parts[0] == "bedrock-mantle"
        and parts[-2] == "api"
        and parts[-1] == "aws"
    )


def _has_aws_credentials() -> bool:
    if os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SECRET_ACCESS_KEY"):
        return True
    if os.environ.get("AWS_PROFILE") or os.environ.get("AWS_DEFAULT_PROFILE"):
        return True
    if os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"):
        return True
    home = os.path.expanduser("~")
    for rel in (".aws/credentials", ".aws/config"):
        if os.path.isfile(os.path.join(home, rel)):
            return True
    return False


def _ollama_alive() -> bool:
    try:
        import urllib.request

        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=0.6) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except Exception:  # noqa: BLE001
        return False


def _probe_compatible_models(base_url: str, api_key: str) -> list[dict[str, str]]:
    """GET {base}/models and return [{id, label}] when the gateway answers."""
    import json
    import urllib.error
    import urllib.request
    from urllib.parse import urljoin

    root = base_url.rstrip("/") + "/"
    url = urljoin(root, "models")
    req = urllib.request.Request(url, method="GET")
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    try:
        with urllib.request.urlopen(req, timeout=2.5) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace") or "{}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return []
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or "").strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        out.append({"id": mid, "label": mid})
        if len(out) >= 80:
            break
    return out


def build_provider_catalog(
    settings: Any | None = None, *, probe_ollama: bool = False
) -> list[dict[str, Any]]:
    """Return providers with `available` flags computed from env keys.

    ``probe_ollama`` gates the blocking local-daemon check: routine catalog
    refreshes (mount, every settings save) pass ``False`` so a user who has
    never touched Ollama never pays a loopback-connect timeout; callers pass
    ``True`` only when the user explicitly opens/selects the Ollama row.
    """
    out: list[dict[str, Any]] = []
    base_url = ""
    trust = False
    provider_setting = "auto"
    if settings is not None:
        base_url = str(getattr(settings, "base_url", "") or "").strip()
        trust = bool(getattr(settings, "trust_custom_base_url", False))
        provider_setting = str(getattr(settings, "provider", "") or "auto").strip().lower()

    # Mirrors gateway.chats_api._resolve_model_kwargs: a Bedrock base_url is
    # only actually used when provider=="bedrock" AND it's trusted (matches
    # url_trust.is_trusted_base_url or the explicit trust_custom_base_url
    # opt-in). Anything else stays on the native IAM path regardless of what
    # base_url happens to be saved in Settings.
    use_mantle = bool(
        provider_setting == "bedrock" and base_url and (trust or _is_mantle_base_url(base_url))
    )

    for p in _CATALOG:
        env_key = p.get("env_key")
        models = list(p.get("models") or [])
        pid = p["id"]

        if pid == "bedrock" and use_mantle:
            # Gateway/Mantle mode: availability + catalog both key off the
            # gateway token, not AWS credentials — matches
            # chats_api._bedrock_api_key(), which never falls back to AWS.
            available = bool(os.environ.get("BEDROCK_API_KEY"))
            models = list(_MANTLE_MODELS)
            if available:
                probed = _probe_compatible_models(
                    base_url, os.environ.get("BEDROCK_API_KEY") or ""
                )
                if probed:
                    seen = {m["id"] for m in models}
                    models = models + [m for m in probed if m["id"] not in seen]
        elif env_key is None:
            available = _ollama_alive() if probe_ollama else False
            if available:
                probed = _probe_compatible_models(
                    str(p.get("base_url") or "http://localhost:11434/v1"),
                    "ollama",
                )
                if probed:
                    models = probed
        elif env_key == "BEDROCK_API_KEY":
            # Native IAM: only real AWS credentials count. A bare
            # BEDROCK_API_KEY with no AWS creds and no trusted gateway
            # base_url must NOT show this row as available — the native IAM
            # path chats_api._resolve_model_kwargs takes here would hand
            # boto3's credential chain nothing to authenticate with.
            available = _has_aws_credentials()
        else:
            available = bool(os.environ.get(str(env_key)))
            if env_key == "GEMINI_API_KEY" and not available:
                available = bool(os.environ.get("GOOGLE_API_KEY"))

        if (
            pid == "openai"
            and base_url
            and not use_mantle
            and (trust or base_url.startswith(("http://localhost", "http://127.0.0.1")))
        ):
            key = (os.environ.get("OPENAI_API_KEY") or "").strip() or "openai"
            probed = _probe_compatible_models(base_url, key)
            if probed:
                models = probed
                available = True

        out.append({
            "id": pid,
            "name": p["name"],
            "available": available,
            "base_url": (base_url if pid == "bedrock" and use_mantle else p.get("base_url")),
            "models": [
                {**m, "available": available}
                for m in models
            ],
        })
    return out
