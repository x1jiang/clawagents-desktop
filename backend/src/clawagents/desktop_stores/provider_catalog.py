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
            {"id": "gpt-4o", "label": "GPT-4o"},
            {"id": "gpt-4o-mini", "label": "GPT-4o mini"},
            {"id": "o1", "label": "o1"},
        ],
    },
    {
        "id": "gemini",
        "name": "Google Gemini",
        "env_key": "GEMINI_API_KEY",
        "models": [
            {"id": "gemini-2.0-flash", "label": "Gemini 2.0 Flash"},
            {"id": "gemini-1.5-pro", "label": "Gemini 1.5 Pro"},
        ],
    },
    {
        "id": "ollama",
        "name": "Ollama (local)",
        "env_key": None,  # always available if the local server is running
        "models": [
            {"id": "ollama/llama3.2", "label": "llama3.2 (local)"},
            {"id": "ollama/qwen2.5-coder", "label": "qwen2.5-coder (local)"},
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
