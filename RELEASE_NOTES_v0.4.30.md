v0.4.30 — split-loop migration, chat memory fix, and a green suite

The vendored engine moves to upstream's split agent loop, a long-standing chat
memory bug is fixed, and the backend suite goes from 13 pre-existing failures to
zero — passing in both forward and reverse collection order.

### Chat memory (user-visible bug fix)

- A turn that ended in a plain answer never persisted an `assistant_message`.
  Only the tool-calling path wrote one, so the agent's reply was streamed to the
  UI and then lost: the next turn had no memory of what it had said, and a
  reloaded transcript showed user messages only. The gateway now records the
  final answer, guarded so a reply the engine already stored is not duplicated.
- The current prompt was written to the chat log *before* the turn ran and then
  replayed as history, so the model received it twice and read it as the user
  repeating themselves. History is now snapshotted before the append.

### Engine: split agent loop

- `graph/agent_loop.py` goes from 5,596 lines to 742, replacing a pre-refactor
  monolith with upstream's split architecture. Roughly 16 modules that were
  present but unreachable — `turn_driver`, `tool_turn`, `round_dispatcher`,
  `run_bootstrapper` and friends — are now on the call path, so upstream fixes
  reach the desktop app instead of silently no-op'ing.
- The three desktop-only run options (`session_id`, `session_dir`,
  `permission_callback`) ride on `RunContext` rather than `AgentRunConfig`, which
  keeps `run_config.py` byte-identical to upstream and merging cleanly.
- Engine synced to 6.20.53. Arriving with it: `task_wait`, a 1-hour tool timeout
  for tools that wait on a person (plan approval and `ask_user` previously died
  at 120s while the user was still reading), `clear_pending_skill`, a sync
  WebSocket `on_event` with a bounded queue, and background-job labels.

### Skills

- Skill auto-discovery lost `.cursor/skills`, `.agents/skills` and
  `.agent/skills` in an earlier upstream sync; restored, plus `.claude/skills`
  and `.clawagents/skills` — the latter is where `marketplace install` writes, so
  an installed skill was never discovered.
- The library fallback and the desktop catalog are now pinned to the same list
  by a test, since which one runs depends on whether catalog resolution returned
  anything.

### Cost estimates

- Costs were computed from a stale table: `gpt-5.6-luna` was priced at the
  pre-2026-07-30 rate, five times the real one, and Opus 4.x at 15/75 rather
  than 5/25. Ported the maintained four-rate tables from the VS Code extension,
  including the Bedrock/Mantle table, cache-write pricing, and the long-context
  multipliers (GPT-5.6 above 272K, Grok at or above 200K).
- The UI had been collecting `cache_creation_tokens` all along and discarding it
  before the estimate. It now reaches both the usage badge and the stats page.

### New

- **Pinned context** — short always-on instructions per project, stored as
  `.clawagents/pinned-context.md`, editable in the project view and injected with
  the rules block on every model call.
- **Goal mode** — the long-horizon completion toggle the VS Code extension has
  had; off by default, since it costs tokens.

### Test suite and tooling

- 1,464 backend tests pass, 0 failures, in forward and reverse order. Two
  order-dependent bugs fixed: a test replaced `features.is_enabled` wholesale,
  which permanently disabled `hunk_review` for any module first imported during
  that window; and the settings-API tests leaked `XAI_API_KEY` into the session
  because the endpoint writes `os.environ` directly.
- Stale copies of four upstream test files re-synced, adding 25 tests that had
  never run here.
- New `backend/scripts/refresh_core_parity.py` derives the shared-vs-forked split
  from actual bytes and refuses to record a fork with no written reason. Drift is
  down from 19 files to 10 documented forks.
- Rust: clippy clean, `cargo test` green.
