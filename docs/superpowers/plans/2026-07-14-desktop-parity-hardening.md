# ClawAgents Desktop Parity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring ClawAgents Desktop to the clawagents 6.12.13 security/reliability baseline while preserving Desktop-specific gateway and packaging behavior.

**Architecture:** Selectively synchronize the shared upstream core, then place Desktop-specific policy in small storage and UI helpers: project-keyed runtime trust, chat-owned attachment state, a cached skill-catalog snapshot, and a diagnostic parity manifest. Every behavior change starts with a regression test that is observed failing before production code changes.

**Tech Stack:** Python 3.11, FastAPI/Pydantic, pytest, React 18/TypeScript, Vitest, Tauri 2/Rust, shell-based hermetic verification.

---

## File map

- `backend/src/clawagents/{agent.py,run_context.py,tools/registry.py,tools/skills.py,tools/subagent.py}` — upstream 6.12.13 skill paging and capability enforcement.
- `backend/src/clawagents/skills/workshop/{scanner.py,service.py,store.py}` and `backend/src/clawagents/tools/skill_workshop.py` — validate before writing and rescan before applying.
- `backend/src/clawagents/desktop_stores/runtime_trust.py` — project-keyed runtime approval persistence and exact-URL binding.
- `backend/src/clawagents/desktop_stores/settings_store.py` and gateway APIs — separate ordinary preferences from effective per-project trust.
- `backend/src/clawagents/desktop_stores/skills_catalog.py` and `gateway/skills_api.py` — immutable cached scan snapshots with quarantine status.
- `backend/src/clawagents/gateway/attachments_api.py` — canonical MIME selection from bytes.
- `ui/src/lib/chat_attachments.ts` — pure ownership/reducer helpers for attachment state.
- `ui/src/components/ChatSurface.tsx` — abort/reset uploads on chat changes and filter sends by owner.
- `ui/src/components/SettingsModal.tsx` and `ui/src/lib/gateway.ts` — choose and transmit project trust scope.
- `backend/scripts/check_core_parity.py` and its test — explicit shared-file drift reporting.

### Task 1: Lock and synchronize the 6.12.13 core behavior

**Files:**
- Modify: `backend/tests/test_security_regressions.py`
- Modify: `backend/tests/test_skill_activation.py`
- Modify: `backend/tests/test_skill_loading_mechanism.py`
- Create: `backend/tests/test_skill_retrieval_quality.py`
- Modify: `backend/tests/test_subagent_depth.py`
- Modify: the shared core files listed in the file map
- Modify: `backend/src/clawagents/__init__.py`
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Add the upstream regression tests before production changes**

Apply the exact test hunks from `clawagents_py` commit `62da2b8` for paging, retrieval recall, composed `allowed-tools`, subagent propagation, workshop traversal, and apply-time tampering. Preserve Desktop-only tests in each destination file.

- [ ] **Step 2: Verify RED**

Run:

```bash
cd backend
CLAW_TEST_WORKERS=1 scripts/run_tests.sh \
  tests/test_skill_loading_mechanism.py \
  tests/test_skill_retrieval_quality.py \
  tests/test_security_regressions.py \
  tests/test_subagent_depth.py -q
```

Expected: failures showing missing `offset`/`expected_hash` paging, absent registry enforcement, and workshop traversal/tamper acceptance.

- [ ] **Step 3: Apply the upstream production hunks selectively**

Use the exact `62da2b8` versions as the source of truth for these shared files:

```text
agent.py
run_context.py
skills/workshop/scanner.py
skills/workshop/service.py
skills/workshop/store.py
tools/registry.py
tools/skill_workshop.py
tools/skills.py
tools/subagent.py
```

Apply changes with `apply_patch`, retaining Desktop-only imports and gateway setup. Set both backend version declarations to `6.12.13`.

- [ ] **Step 4: Verify GREEN**

Repeat the focused command from Step 2. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

Commit the focused core sync with Lore trailers, citing upstream `62da2b8` and the exact focused test result.

### Task 2: Add project-scoped runtime trust

**Files:**
- Create: `backend/src/clawagents/desktop_stores/runtime_trust.py`
- Create: `backend/tests/desktop/test_runtime_trust.py`
- Modify: `backend/src/clawagents/desktop_stores/app_paths.py`
- Modify: `backend/src/clawagents/desktop_stores/settings_store.py`
- Modify: `backend/src/clawagents/gateway/settings_api.py`
- Modify: `backend/src/clawagents/gateway/agent_power_api.py`
- Modify: `backend/src/clawagents/gateway/chats_api.py`
- Modify: `ui/src/lib/gateway.ts`
- Modify: `ui/src/components/SettingsModal.tsx`

- [ ] **Step 1: Write failing storage and API tests**

Tests must demonstrate:

```python
def test_trust_isolated_by_canonical_project(runtime_trust_store, tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir(); second.mkdir()
    runtime_trust_store.update(first, {"mcp_trust_workspace": True})
    assert runtime_trust_store.load(first).mcp_trust_workspace is True
    assert runtime_trust_store.load(second).mcp_trust_workspace is False

def test_gateway_trust_is_bound_to_exact_url(runtime_trust_store, project):
    runtime_trust_store.update(project, {
        "base_url": "https://first.example/v1",
        "trust_custom_base_url": True,
    })
    assert runtime_trust_store.is_url_trusted(project, "https://first.example/v1")
    assert not runtime_trust_store.is_url_trusted(project, "https://second.example/v1")

def test_legacy_global_grants_are_not_effective(app_support_dir, tmp_path):
    import json
    from clawagents.desktop_stores.settings_store import effective_settings

    (app_support_dir / "settings.json").write_text(json.dumps({
        "trust_custom_base_url": True,
        "mcp_trust_workspace": True,
        "allow_full_access": True,
    }))
    project = tmp_path / "project"
    project.mkdir()
    settings = effective_settings(project)
    assert settings.trust_custom_base_url is False
    assert settings.mcp_trust_workspace is False
    assert settings.allow_full_access is False
```

Replace the final test body with concrete JSON setup and API assertions when writing the test; do not add a production migration hook first.

- [ ] **Step 2: Verify RED**

Run `cd backend && CLAW_TEST_WORKERS=1 scripts/run_tests.sh tests/desktop/test_runtime_trust.py -q`.
Expected: import/API failures because the runtime-trust store and project-scoped parameters do not exist.

- [ ] **Step 3: Implement the minimal trust store**

Use a dataclass with safe defaults and an atomic JSON map keyed by SHA-256 of the canonical root. Normalize URLs with `strip().rstrip("/")`. Corrupt or non-dict JSON returns no grants. `update()` accepts only the four runtime fields, binds approval to the supplied effective URL, and never copies legacy settings booleans.

Expose `runtime_trust_file()` from `app_paths.py`. Add `settings_store.effective_settings(project_root)` to merge ordinary preferences with `RuntimeTrustStore.load(project_root)`. Remove runtime fields from `SettingsStore.save()` output while tolerating them on read for migration cleanup.

- [ ] **Step 4: Wire effective project context**

Add `project_id`/`projectless` scope to settings GET/PATCH. Resolve project IDs through `ProjectStore`; fail closed on missing scope when a patch attempts to enable a grant. Make chat agent creation and `/mcp` load the trust record for the chat/project workspace rather than global settings.

In Settings, add a security-scope selector backed by the existing projects store, load effective settings for that scope, and include the scope in trust patches. Ordinary provider/theme preferences remain global.

- [ ] **Step 5: Verify GREEN**

Run the focused runtime-trust tests plus `backend/tests/desktop/test_agent_power_parity.py`. Expected: pass.

- [ ] **Step 6: Commit**

Commit project-scoped trust separately with migration and compatibility trailers.

### Task 3: Make skill previews cached and quarantine-aware

**Files:**
- Modify: `backend/src/clawagents/desktop_stores/skills_catalog.py`
- Modify: `backend/src/clawagents/gateway/skills_api.py`
- Create: `backend/tests/desktop/test_skills_catalog_cache.py`
- Modify: `backend/tests/desktop/test_skill_autodiscovery.py`
- Modify: `ui/src/lib/gateway.ts`

- [ ] **Step 1: Write failing catalog tests**

Cover unchanged snapshot reuse, content rewrite invalidation even when mtime is restored, removed-file invalidation, quarantined-skill reporting, and deep-copy isolation between callers. Use temporary skill roots and real `SKILL.md` files.

- [ ] **Step 2: Verify RED**

Run `cd backend && CLAW_TEST_WORKERS=1 scripts/run_tests.sh tests/desktop/test_skills_catalog_cache.py tests/desktop/test_skill_autodiscovery.py -q`.
Expected: missing cache helpers and missing quarantine metadata.

- [ ] **Step 3: Implement the snapshot**

Port the digest/fingerprint/cache structure from `clawagents_vscode/python/skills_catalog.py`, adapting workspace globals into function parameters. Use `SkillStore` to obtain runnable, ineligible, and quarantined results so the preview matches agent startup. Return deep copies under a re-entrant lock.

- [ ] **Step 4: Verify GREEN and commit**

Repeat the focused tests, then commit the isolated catalog improvement.

### Task 4: Keep attachments owned by their chat

**Files:**
- Create: `ui/src/lib/chat_attachments.ts`
- Create: `ui/src/lib/chat_attachments.test.ts`
- Modify: `ui/src/components/ChatSurface.tsx`
- Modify: `backend/tests/desktop/test_attachments_api.py`
- Modify: `backend/src/clawagents/gateway/attachments_api.py`

- [ ] **Step 1: Write failing UI ownership tests**

Define `OwnedComposerAttachment` with `ownerChatId`. Test pure helpers that:

```typescript
expect(attachmentsForChat(items, "chat-b")).toEqual([]);
expect(abortAndDropOtherChats(items, "chat-b").remaining).toEqual([]);
expect(abortCalled).toBe(true);
```

Also test that a late completion for chat A is ignored when active chat is B.

- [ ] **Step 2: Verify UI RED**

Run `cd ui && npm test -- src/lib/chat_attachments.test.ts`.
Expected: module/helper-not-found failure.

- [ ] **Step 3: Implement helpers and integrate ChatSurface**

Tag new items with the current `chatId`; abort/drop old owners in the existing chat-change effect; guard progress/completion updates with both `localId` and `ownerChatId`; derive ready attachments only from the active owner.

- [ ] **Step 4: Add failing MIME regression test**

Upload JPEG magic bytes with a same-family but incorrect declared `image/png`, and assert the returned/stored MIME is `image/jpeg`.

- [ ] **Step 5: Verify MIME RED, implement, and verify GREEN**

Change `_validate_type()` to return the sniffed canonical MIME for recognized image/PDF/container types, retaining warnings for conflicting declarations. Run the focused backend attachment test and the UI helper test; expected: pass.

- [ ] **Step 6: Commit**

Commit attachment ownership and canonical MIME behavior with the focused results.

### Task 5: Add a focused shared-core parity guard

**Files:**
- Create: `backend/scripts/check_core_parity.py`
- Create: `backend/tests/desktop/test_core_parity.py`
- Create: `backend/core-parity.json`

- [ ] **Step 1: Write failing parity tests**

Test a temporary Desktop/upstream pair for: identical files pass; unexpected drift fails with the relative filename; absent upstream skips cleanly; and entries listed under `intentional_forks` are reported but accepted.

- [ ] **Step 2: Verify RED**

Run `cd backend && CLAW_TEST_WORKERS=1 scripts/run_tests.sh tests/desktop/test_core_parity.py -q`.
Expected: script/module missing.

- [ ] **Step 3: Implement the checker and manifest**

The JSON manifest contains explicit `shared_files` and `intentional_forks` with reasons. The checker hashes only those files, prints a bounded filename-level report, and returns exit 1 only for unexpected drift. Repository discovery uses an optional CLI path first, then the known sibling checkout; absence returns a pytest skip-compatible result.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test and the checker against `../../clawagents_py` from `backend`; expected: tests pass and only declared forks remain.

### Task 6: Version, full verification, and release-quality review

**Files:**
- Modify: `ui/package.json`
- Modify: `ui/package-lock.json`
- Modify: `ui/src-tauri/Cargo.toml`
- Modify: `ui/src-tauri/Cargo.lock`
- Modify: `ui/src-tauri/tauri.conf.json`
- Modify: `README.md`

- [ ] **Step 1: Set release versions**

Set native Desktop surfaces to `0.3.1` and embedded Python surfaces to `6.12.13`. Update the README compatibility statement without changing dependency ranges.

- [ ] **Step 2: Run backend verification**

```bash
cd backend
scripts/run_tests.sh
.venv/bin/python -m ruff check src tests
.venv/bin/python -m mypy src/clawagents
```

Expected: all tests, Ruff, and mypy pass.

- [ ] **Step 3: Run UI and Rust verification**

```bash
cd ui
npm test
npm run build
cd src-tauri
cargo check
```

Expected: all commands exit 0 without new warnings attributable to the change.

- [ ] **Step 4: Run final repository checks**

```bash
git diff --check
git status --short
```

Review every changed file, confirm no temporary artifacts, and run the original workshop traversal and URL-trust probes expecting both to fail closed.

- [ ] **Step 5: Request code review and address findings**

Use the repository's code-review workflow over the complete branch diff. For each validated finding, add a failing regression test before the fix and rerun the relevant focused suite.

- [ ] **Step 6: Commit release metadata and verification record**

Use Lore trailers with exact test counts and explicitly name any unrun packaging/notarization checks.
