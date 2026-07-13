"""Static catalog of providers + models with env-key availability check."""

from __future__ import annotations

import os
from typing import Any

# Conservative defaults. Users can override via the provider's own model
# routing — this catalog drives the desktop's model picker UI only.
# Trimmed to the current top of each provider's lineup as of July 2026.
# Model IDs verified against the provider documentation; if a workflow needs
# something older or more obscure, pass it via /model — the underlying LLM
# provider accepts whatever the user supplies.
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
            # GPT-5.6 family (Sol / Terra / Luna)
            {"id": "gpt-5.6-sol", "label": "GPT-5.6 Sol"},
            {"id": "gpt-5.6-terra", "label": "GPT-5.6 Terra"},
            {"id": "gpt-5.6-luna", "label": "GPT-5.6 Luna"},
            {"id": "gpt-5.6", "label": "GPT-5.6 (alias → Sol)"},
            # GPT-5.5
            {"id": "gpt-5.5", "label": "GPT-5.5"},
            # GPT-5.4
            {"id": "gpt-5.4", "label": "GPT-5.4"},
            {"id": "gpt-5.4-mini", "label": "GPT-5.4 mini"},
            {"id": "gpt-5.4-nano", "label": "GPT-5.4 nano"},
        ],
    },
    {
        "id": "gemini",
        "name": "Google Gemini",
        "env_key": "GEMINI_API_KEY",
        # Chat-oriented generateContent models from the Gemini API docs.
        "models": [
            {"id": "gemini-3.5-flash", "label": "Gemini 3.5 Flash"},
            {"id": "gemini-3.1-pro-preview", "label": "Gemini 3.1 Pro (preview)"},
            {"id": "gemini-3.1-flash-lite", "label": "Gemini 3.1 Flash-Lite"},
            {"id": "gemini-3-flash-preview", "label": "Gemini 3 Flash (preview)"},
            {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro"},
            {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash"},
        ],
    },
]


def build_provider_catalog() -> list[dict[str, Any]]:
    """Return providers with `available` flags computed from env keys."""
    out: list[dict[str, Any]] = []
    for p in _CATALOG:
        env_key = p["env_key"]
        available = True if env_key is None else bool(os.environ.get(env_key))
        out.append({
            "id": p["id"],
            "name": p["name"],
            "available": available,
            "models": [
                {**m, "available": available}
                for m in p["models"]
            ],
        })
    return out
