# ClawAgents Desktop v0.4.40 Release Notes

## Vendored core resynced to clawagents_py 6.20.72

The bundled `clawagents` package was two upstream releases behind (6.20.69). This release brings every shared file back to byte parity and ports the upstream delta onto the ten intentional desktop forks.

- **Correct context windows.** Opus 4.6/4.7/4.8, Opus 5, Sonnet 4.6, Sonnet 5 and Fable 5/5.1 now budget at 1M; Sonnet 4.5, Haiku 4.5 and Opus 4.5 at 200K. Gemini Pro corrected from 2M to 1M. Previously Opus 4.6+ compacted ~5× too early and Sonnet 4.5 was over-budgeted with no 1M beta header.
- **New model profiles.** `gemini-3.8-flash`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-fable-5`, `claude-haiku-4-5`, and Bedrock Mantle ids (`deepseek.v3.2`, `kimi-k2.5`, `glm-5`, `gpt-oss-*`). `normalize_model_id` strips geo + vendor prefixes and the Bedrock `:0` revision so `us.anthropic.claude-…` resolves instead of falling to the default.
- **Configurable base prompt (6.20.70).** `clawagents.prompts.base` is now vendored; `base_prompt=` / `CLAW_BASE_PROMPT[_FILE]` / `.clawagents/base-prompt.md` overrides and `.clawagents/pinned-context.md` tail block are available to the gateway.
- **asyncio hygiene.** `get_event_loop()` → `get_running_loop()` in channels/tool observation; `inspect.iscoroutinefunction` in the LLM provider (Python 3.14-clean).
- **`clawagents.list_profiles`** is no longer shadowed by the sandbox profile lister (exported as `list_sandbox_profiles`).
- **Lint cleanup.** ~260 unused imports and dead locals removed upstream; no behaviour change.
- **Dependency floor.** `anthropic>=0.95.0` so Bedrock Mantle authenticates with the `Authorization` header instead of the legacy path. Vendored `pyproject.toml` version is 6.20.72.

## Parity

- `core-parity.json` refreshed — 254 shared, 10 intentional forks, unexpected=0.
- Fork delta ported via `git diff v6.20.69..HEAD` on `agent.py`, `graph/agent_loop.py`, `graph/run_bootstrapper.py` (the other seven forks had no upstream change).

Backend suite: 1500 passed, 2 skipped.
