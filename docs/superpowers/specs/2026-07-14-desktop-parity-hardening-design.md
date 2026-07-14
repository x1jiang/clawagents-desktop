# ClawAgents Desktop Parity Hardening Design

## Goal

Bring ClawAgents Desktop up to the security and reliability baseline established by `clawagents_py` 6.12.13 and `clawagents_vscode` 1.0.32 without replacing Desktop's native gateway, packaging, or project model.

## Scope

The change covers five related areas:

1. Synchronize the shared Python core changes introduced in 6.12.13.
2. Replace application-wide runtime approvals with project-scoped trust.
3. Keep composer attachments owned by the chat that staged them.
4. Make skill previews cached, content-invalidating, and quarantine-aware.
5. Add an automated check that exposes future drift in shared core files.

The work will not replace the vendored backend with a PyPI dependency, rebase the entire Desktop backend, or copy VS Code's remote-extension attachment transport. Those approaches either conflict with Desktop packaging and gateway extensions or solve a host boundary Desktop does not have.

## Architecture

### Shared core synchronization

Desktop will selectively synchronize the 6.12.13 changes in the shared core files changed by the upstream release: agent setup, run context, skill loading and paging, tool registry enforcement, subagent propagation, and skill-workshop validation. Desktop-only gateway and storage code remains local.

The resulting behavior must match 6.12.13:

- `use_skill` returns contiguous, content-hash-bound pages.
- No data-plane tool may execute while a skill page sequence is incomplete.
- A skill's `allowed-tools` declaration is a hard boundary.
- Multiple declared boundaries compose by intersection and cannot widen authority.
- Skill-workshop support paths are validated before any proposal file is written.
- Proposal content and support files are rescanned immediately before application.

Desktop's embedded backend and UI-visible version will advance to 6.12.13 while the native application version advances independently.

### Project-scoped runtime trust

Persistent non-sensitive preferences remain in the existing application settings file. Security-sensitive approvals move into a dedicated runtime-trust store under Application Support, keyed by a stable project identity derived from the canonical project root. Projectless chats use a separate explicit identity.

Each trust record contains:

- the exact normalized custom gateway URL that was approved;
- whether workspace MCP configuration is trusted;
- whether full-access mode is allowed;
- whether registered external skill directories are allowed.

The settings API will merge ordinary preferences with the active project's trust record when returning effective settings. A trust patch must include project context. Changing a custom URL invalidates the prior URL grant unless the new exact URL is approved in the same authenticated request.

Legacy global `trust_custom_base_url`, `mcp_trust_workspace`, and `allow_full_access` values will not be migrated as grants. They will be ignored and removed on the next settings write, so an old broad approval cannot silently authorize a new project. Existing non-security preferences remain intact.

Project creation, deletion, and path changes must not allow one project to inherit another project's approvals. Canonical roots are used for lookup; a changed root starts with no trust.

### Chat-owned attachments

Every pending composer attachment is tagged with the `chatId` that initiated its upload. When `chatId` changes, Desktop aborts uploads owned by the prior chat and clears their composer state. Upload progress and completion handlers may update state only while their owner still matches the active chat.

Send derives attachment IDs only from ready items owned by the active chat. The backend continues enforcing chat-local manifests as a second boundary.

MIME validation will continue using magic bytes, but the canonical detected MIME type will be sent to providers instead of trusting a same-family client declaration. Filenames and declared MIME values remain metadata only.

### Skill catalog snapshots

The Desktop skill catalog will use the same conceptual snapshot strategy as VS Code:

- resolve the effective skill roots for the selected project;
- fingerprint candidate skill files using path, metadata, and a cached digest;
- reuse an immutable deep-copied scan result when the fingerprint is unchanged;
- invalidate when roots or file content change;
- parse through the runtime skill loader so eligibility and quarantine behavior match actual agent startup.

The discovery response will preserve existing fields and add status information for ineligible or quarantined skills. The UI can display why a skill is unavailable rather than presenting it as runnable. Cache access must be thread-safe because FastAPI may serve concurrent refreshes.

### Parity guard

A repository script and test will compare the explicit set of shared core files against the sibling `clawagents_py` checkout when it is available. Intentional Desktop forks are listed with reasons rather than silently ignored. The check fails on unexpected drift but skips cleanly in packaged/source-distribution environments where the sibling repository is absent.

This guard is diagnostic; it does not copy files automatically.

## Data and API compatibility

- Existing settings clients may continue reading and writing non-sensitive fields without project context.
- Attempts to enable a runtime grant without project context fail closed with a clear validation error.
- Existing settings responses retain current field names, but runtime fields reflect the selected project's effective trust.
- Skill discovery retains its existing `skills` array and adds optional quarantine/ineligibility metadata.
- Existing chat and attachment records require no migration.

## Error handling

- Corrupt trust-store JSON returns no grants and is not treated as approval.
- Invalid, missing, or non-canonical project roots fail closed.
- A mismatched custom URL returns the existing untrusted-URL error.
- Skill fingerprint or parsing failures are reported per skill without invalidating healthy catalog entries.
- Aborted uploads remain local UI cancellations and do not create ready attachments in another chat.
- Parity-check failures identify the exact unexpected files rather than emitting a broad directory diff.

## Testing strategy

Work proceeds test-first.

Backend regression tests will cover:

- workshop traversal rejection before any out-of-root write;
- apply-time rescan after proposal/support-file tampering;
- incomplete skill-page execution refusal;
- intersecting `allowed-tools` enforcement;
- project isolation for MCP/full-access/external-skill grants;
- exact-URL gateway trust and legacy-grant reset;
- skill snapshot reuse, invalidation, and quarantine reporting;
- canonical MIME selection from magic bytes;
- expected and unexpected parity drift.

UI tests will cover:

- switching chats aborts and removes prior-chat uploads;
- late upload completion cannot repopulate the new chat;
- Send includes only active-chat attachment IDs.

After focused red-green cycles, verification will run Desktop's hermetic backend suite, UI tests, type-check/build, Rust checks required by the repository, lint/static checks, and `git diff --check`.

## Success criteria

- Desktop reports and behaves as core 6.12.13.
- The known workshop traversal probe cannot create a file outside its support root.
- Runtime grants never transfer between projects or custom gateway URLs.
- Attachment UI state cannot transfer between chats.
- Skill previews agree with runtime quarantine decisions and avoid reparsing unchanged catalogs.
- Future unexpected shared-core drift causes a focused test failure.

