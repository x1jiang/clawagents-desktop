"""Static catalog of providers + models with env-key availability check."""

from __future__ import annotations

import os
from typing import Any

# Conservative defaults. Users can override via the provider's own model
# routing — this catalog drives the desktop's model picker UI only.
_CATALOG: list[dict[str, Any]] = [
    {
        "id": "anthropic",
        "name": "Anthropic",
        "env_key": "ANTHROPIC_API_KEY",
        "models": [
            {"id": "claude-opus-4-7", "label": "Claude Opus 4.7"},
            {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6"},
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
            {"id": "gpt-5.4", "label": "GPT-5.4"},
            {"id": "gpt-5.4-mini", "label": "GPT-5.4 mini"},
            {"id": "gpt-5.4-nano", "label": "GPT-5.4 nano"},
        ],
    },
    {
        "id": "gemini",
        "name": "Google Gemini",
        "env_key": "GEMINI_API_KEY",
        "models": [
            {"id": "gemini-3.5-flash", "label": "Gemini 3.5 Flash"},
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
            {"id": "amazon.nova-pro-v1:0", "label": "Amazon Nova Pro"},
            {"id": "amazon.nova-lite-v1:0", "label": "Amazon Nova Lite"},
            {"id": "amazon.nova-micro-v1:0", "label": "Amazon Nova Micro"},
            {"id": "meta.llama3-3-70b-instruct-v1:0", "label": "Llama 3.3 70B"},
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


def build_provider_catalog() -> list[dict[str, Any]]:
    """Return providers with `available` flags computed from env keys."""
    out: list[dict[str, Any]] = []
    for p in _CATALOG:
        env_key = p.get("env_key")
        if env_key is None:
            available = True
        elif env_key == "BEDROCK_API_KEY":
            available = bool(
                os.environ.get("BEDROCK_API_KEY")
                or os.environ.get("OPENAI_API_KEY")
                or _has_aws_credentials()
            )
        else:
            available = bool(os.environ.get(str(env_key)))
            if env_key == "GEMINI_API_KEY" and not available:
                available = bool(os.environ.get("GOOGLE_API_KEY"))
        out.append({
            "id": p["id"],
            "name": p["name"],
            "available": available,
            "base_url": p.get("base_url"),
            "models": [
                {**m, "available": available}
                for m in p["models"]
            ],
        })
    return out
