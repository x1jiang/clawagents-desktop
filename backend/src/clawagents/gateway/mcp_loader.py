"""MCP server loading from ~/.clawagents/mcp.json + optional project mcp.json.

Adapted from clawagents_vscode/python/mcp_loader.py for project-scoped workspaces.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

CONTEXT_MODE_BINARY = "context-mode"

CONTEXT_MODE_WRITE_TOOLS = frozenset({
    "ctx_execute",
    "ctx_execute_file",
    "ctx_batch_execute",
    "ctx_purge",
    "ctx_upgrade",
})

CONTEXT_MODE_ROUTING_INSTRUCTION = (
    "Context Mode tools are available for token-efficient work. For bulk "
    "analysis (many files, logs, large outputs) prefer ctx_execute or "
    "ctx_batch_execute and print only the summary you need, instead of "
    "reading raw content into context. Prefer ctx_search over re-reading "
    "content you already indexed."
)

_ALLOWED_MCP_COMMANDS = frozenset({
    "npx", "npm", "pnpm", "yarn", "bun", "deno", "uvx", "uv",
    "node", "python", "python3", "pipx", "docker", CONTEXT_MODE_BINARY,
})


def context_mode_available() -> bool:
    return shutil.which(CONTEXT_MODE_BINARY) is not None


def create_context_mode_server(workspace: Path) -> Any | None:
    if not context_mode_available():
        return None
    try:
        from clawagents import MCPServerStdio
    except ImportError:
        return None
    storage = workspace / ".clawagents" / "context-mode"
    try:
        storage.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return MCPServerStdio(
        {
            "command": CONTEXT_MODE_BINARY,
            "args": [],
            "env": {"CONTEXT_MODE_DIR": str(storage)},
        },
        name="context-mode",
        client_session_timeout_seconds=120.0,
    )


def _mcp_paths(workspace: Path, *, trust_workspace: bool) -> list[tuple[Path, str]]:
    out: list[tuple[Path, str]] = [
        (Path.home() / ".clawagents" / "mcp.json", "user"),
    ]
    if trust_workspace:
        out.insert(0, (workspace / ".clawagents" / "mcp.json", "workspace"))
    return out


def _command_allowed(command: str) -> bool:
    text = (command or "").strip()
    if not text:
        return False
    name = PurePosixPath(text.replace("\\", "/")).name
    return name in _ALLOWED_MCP_COMMANDS


def _url_allowed(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:  # noqa: BLE001
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    return host in ("localhost", "127.0.0.1", "::1")


def _sanitize_mcp_env(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    blocked = ("KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "AUTH")
    for k, v in raw.items():
        if not isinstance(k, str) or not isinstance(v, (str, int, float, bool)):
            continue
        upper = k.upper()
        if any(b in upper for b in blocked):
            continue
        if upper.startswith("PYTHON") or upper in ("LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
            continue
        out[k] = str(v)
    return out


def load_mcp_servers(workspace: Path, *, trust_workspace: bool = False) -> list[Any]:
    try:
        from clawagents import MCPServerStdio, MCPServerSse, MCPServerStreamableHttp
    except ImportError:
        return []

    config: dict[str, Any] = {}
    for path, _origin in _mcp_paths(workspace, trust_workspace=trust_workspace):
        if not path.is_file():
            continue
        try:
            resolved = path.resolve()
            if trust_workspace and path == workspace / ".clawagents" / "mcp.json":
                try:
                    resolved.relative_to(workspace.resolve())
                except ValueError:
                    continue
            raw = json.loads(resolved.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(raw, dict):
            servers = raw.get("mcpServers") or raw.get("servers") or raw
            if isinstance(servers, dict):
                config.update(servers)

    out: list[Any] = []
    for name, spec in config.items():
        if not isinstance(spec, dict) or spec.get("disabled"):
            continue
        try:
            timeout = float(spec.get("timeout", 60.0))
        except (TypeError, ValueError):
            timeout = 60.0
        timeout = min(max(timeout, 5.0), 600.0)
        try:
            if "command" in spec:
                command = str(spec["command"])
                if not _command_allowed(command):
                    continue
                params: dict[str, Any] = {
                    "command": command,
                    "args": [str(a) for a in list(spec.get("args") or [])],
                }
                env = _sanitize_mcp_env(spec.get("env"))
                if env:
                    params["env"] = env
                out.append(
                    MCPServerStdio(params, name=name, client_session_timeout_seconds=timeout)
                )
            elif spec.get("url"):
                url = str(spec["url"])
                if not _url_allowed(url):
                    continue
                transport = str(spec.get("transport") or "sse").lower()
                if transport == "sse":
                    out.append(
                        MCPServerSse(
                            {"url": url},
                            name=name,
                            client_session_timeout_seconds=timeout,
                        )
                    )
                else:
                    out.append(
                        MCPServerStreamableHttp(
                            {"url": url},
                            name=name,
                            client_session_timeout_seconds=timeout,
                        )
                    )
        except Exception:  # noqa: BLE001
            continue
    return out


def list_mcp_config(workspace: Path, *, trust_workspace: bool = False) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = [
        {
            "name": "context-mode",
            "disabled": not context_mode_available(),
            "command": CONTEXT_MODE_BINARY,
            "url": None,
            "source": "builtin (settings: context_mode)"
            + ("" if context_mode_available() else " — binary not found"),
        }
    ]
    for path, origin in _mcp_paths(workspace, trust_workspace=True):
        if not path.is_file():
            continue
        if origin == "workspace" and not trust_workspace:
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            servers = raw.get("mcpServers") or raw.get("servers") or raw
            if not isinstance(servers, dict):
                continue
            for name, spec in servers.items():
                if not isinstance(spec, dict):
                    continue
                items.append(
                    {
                        "name": name,
                        "disabled": True,
                        "command": spec.get("command"),
                        "url": spec.get("url"),
                        "source": f"{path} (workspace — enable 'Trust workspace MCP' to load)",
                    }
                )
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        servers = raw.get("mcpServers") or raw.get("servers") or raw
        if not isinstance(servers, dict):
            continue
        for name, spec in servers.items():
            if not isinstance(spec, dict):
                continue
            items.append(
                {
                    "name": name,
                    "disabled": bool(spec.get("disabled")),
                    "command": spec.get("command"),
                    "url": spec.get("url"),
                    "source": str(path),
                }
            )
    return items
