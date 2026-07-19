"""File-backed AppSettings.

Atomic writes via atomic_write_text. Corrupt JSON returns defaults.
"""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from clawagents.desktop_stores.app_paths import settings_file
from clawagents.utils.atomic_write import atomic_write_text

# Guards read-modify-write sequences (load() -> mutate -> save()) against
# concurrent FastAPI requests. `def` routes run on the threadpool, so two
# overlapping PATCH /settings calls can otherwise both load() the same base
# snapshot, mutate independently, and save() -- whichever finishes last wins
# and silently discards the other's changes. Mirrors
# desktop_stores.runtime_trust.RuntimeTrustStore's existing lock pattern.
settings_store_lock = threading.RLock()


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
    allow_external_skill_dirs: bool = False
    # OpenAI reasoning effort (none|low|medium|high|xhigh). Empty = provider default.
    reasoning_effort: str = "medium"
    # OpenAI transport: auto | responses | chat_completions.
    wire_api: str = "auto"
    # TLS verify for custom base_url (False for private-CA / corporate proxies).
    ssl_verify: bool = True
    # Skill roots (absolute paths). Personal homes loaded when skill_user_homes.
    skill_dirs: list | None = None
    skill_auto_discover: bool = True
    skill_ignore_dirs: list | None = None
    skill_exclude: list | None = None
    skill_user_homes: bool = True
    # Auto-install/upgrade context-mode + rtk companions (VS Code parity).
    ensure_companions: bool = True

    def __post_init__(self) -> None:
        if self.skill_dirs is None:
            self.skill_dirs = []
        if self.skill_ignore_dirs is None:
            self.skill_ignore_dirs = []
        if self.skill_exclude is None:
            self.skill_exclude = []


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
        fields = AppSettings.__dataclass_fields__
        kwargs = {k: v for k, v in data.items() if k in fields}
        for list_key in ("skill_dirs", "skill_ignore_dirs", "skill_exclude"):
            if list_key not in kwargs or kwargs[list_key] is None:
                kwargs[list_key] = []
        return AppSettings(**kwargs)

    def save(self, settings: AppSettings) -> None:
        payload = asdict(settings)
        # Runtime authority is project-scoped.  Legacy values are tolerated on
        # read but are intentionally dropped on the next ordinary settings save.
        for key in (
            "trust_custom_base_url",
            "mcp_trust_workspace",
            "allow_full_access",
            "allow_external_skill_dirs",
        ):
            payload.pop(key, None)
        atomic_write_text(self.path, json.dumps(payload, indent=2))


def effective_settings(project_root: str | Path) -> AppSettings:
    """Merge global preferences with the selected workspace's approvals."""
    from clawagents.desktop_stores.runtime_trust import RuntimeTrustStore

    settings = replace(SettingsStore().load())
    trust = RuntimeTrustStore().load(project_root)
    settings.trust_custom_base_url = (
        bool(trust.trusted_base_url)
        and trust.trusted_base_url == settings.base_url.strip().rstrip("/")
    )
    settings.mcp_trust_workspace = trust.mcp_trust_workspace
    settings.allow_full_access = trust.allow_full_access
    settings.allow_external_skill_dirs = trust.allow_external_skill_dirs
    if not trust.allow_external_skill_dirs:
        settings.skill_dirs = []
    return settings
