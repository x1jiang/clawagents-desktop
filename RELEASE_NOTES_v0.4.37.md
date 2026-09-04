# ClawAgents Desktop v0.4.37

## Summary

- **Skill Impact Ledger (`skill-impact.md`):** Governed Skill Workshop actions (`apply`, `reject`, `quarantine`, `rollback`) are recorded in an append-only audit trail with unified diffs, timestamps, and reason tracking.
- **Audit & Reason Persistence:** Reject and quarantine actions capture human and agent rationale, persisted to `.clawagents/skill-workshop/skill-impact.md` and surfaced in the proposal history.
- **Skill Workshop UI Enhancements:** Added an inline reason input for reject/quarantine actions, status badges with logged reasons in history, and an embedded Skill Impact Ledger preview with one-click navigation to open the markdown file in the editor.
- **Test Isolation & Stability:** Eliminated module-level feature flag binding pollution across pytest test runs, ensuring full test suite hermeticity.

## Install

Download the `ClawAgents Desktop_0.4.37_aarch64.dmg` asset below, open it, and drag ClawAgents Desktop to Applications.
