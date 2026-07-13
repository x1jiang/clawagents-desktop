"""File-backed AppSettings.

Atomic writes via atomic_write_text. Corrupt JSON returns defaults.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from clawagents.desktop_stores.app_paths import settings_file
from clawagents.utils.atomic_write import atomic_write_text


@dataclass
class AppSettings:
    default_model: str = ""
    default_mode: str = "auto"  # ExecMode wire value
    theme: str = "system"       # "light" | "dark" | "system"
    workspace_system_prompt: str = ""  # Prepended to every chat's first turn
    # Preferred provider for default-model routing / Settings UI focus.
    # "auto" | "openai" | "anthropic" | "gemini" | "bedrock" | "ollama"
    provider: str = "auto"
    # OpenAI-compatible base URL (Azure, Ollama, BAG/LiteLLM). Empty = native.
    base_url: str = ""
    trust_custom_base_url: bool = False
    # Native Amazon Bedrock (IAM). Used when provider=bedrock and base_url empty.
    aws_region: str = ""
    aws_profile: str = ""
    # Agent-power toggles (VS Code parity). Defaults match VS Code: off / safe.
    mcp_enabled: bool = False
    mcp_trust_workspace: bool = False
    context_mode: bool = True
    browser_tools: bool = False
    trajectory: bool = False
    learn: bool = False
    action_mode: str = "tools"  # "tools" | "code"
    agent_mode: str = ""        # persona from .clawagents/modes.json
    allow_full_access: bool = False


class SettingsStore:
    def __init__(self) -> None:
        self.path = settings_file()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> AppSettings:
        if not self.path.exists():
            return AppSettings()
        try:
            data = json.loads(self.path.read_text() or "{}")
        except json.JSONDecodeError:
            return AppSettings()
        return AppSettings(**{k: v for k, v in data.items() if k in AppSettings.__dataclass_fields__})

    def save(self, settings: AppSettings) -> None:
        atomic_write_text(self.path, json.dumps(asdict(settings), indent=2))
