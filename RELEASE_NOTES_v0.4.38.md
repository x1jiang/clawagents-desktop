# ClawAgents Desktop v0.4.38 Release Notes

## Upstream Core Parity & Reliability Hardening

- **Upstream Sync Parity:** Synchronized core Python engine to v6.20.69 with 253 shared files and 10 audited intentional forks (`core-parity.json` verified 0 unexpected drift).
- **Quota Error Crash Fix:** Fixed `classify_error()` returning a bare Enum on credit/quota exhaustion; now returns a full `ErrorDescriptor` with actionable recovery hints.
- **MCP Event-Loop Deadlock Prevention:** Ported `release_transports()` to cleanly close stdio reader tasks on temporary event loops during tool discovery.
- **Bedrock Mantle Pre-flight Validation:** Added `MantleCredentialsError` and gateway bearer key validation in provider layer.
- **Model Profile Alignment:** Aligned default OpenAI provider profile to `gpt-5.6-terra`.
- **Browser Accessibility Tools:** Integrated and verified Playwright accessibility tree tools (`@e1`/`@e2` element interaction).
- **Hermetic Test Suites:** All 1,500 backend tests and 148 UI tests verified passing with 0 failures.

### Verified Installation & Artifacts

- **DMG:** `ClawAgents Desktop_0.4.38_aarch64.dmg`
- **Architecture:** Apple Silicon (arm64)
- **Codesigning:** Developer ID Application (`SK58FV375Z`)
- **Notarization:** Apple Notary Service accepted & stapled
