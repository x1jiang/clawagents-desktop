# ClawAgents Desktop v0.4.39 Release Notes

## MCP discovery deadlock — actually wired

0.4.38 copied `MCPServerManager.release_transports()` from clawagents_py but `create_claw_agent()` still only called `manager.start()`. MCP stdio readers stayed pinned to the throwaway discovery loop, so agent construction could hang with no output.

- **Call site:** `create_claw_agent()` now runs `_discover_and_release()` (`start` then `release_transports`) on both the no-loop and already-running-loop paths, matching clawagents_py 6.20.69.
- **Version fallback:** vendored `__init__.py` reports 6.20.69 when dist-info is missing.
- **Tests:** `tests/test_mcp_transport_release.py` (tools stay registered; discovery loop shuts down).
- **Parity:** `core-parity.json` refreshed — 253 shared, 10 intentional forks, unexpected=0.

Backend suite: 1500 passed, 2 skipped.
