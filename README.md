# ClawAgents Desktop

macOS desktop app for ClawAgents: project-scoped chats, file tree, remote SSH projects, and a local Python gateway.

## Install (macOS Apple Silicon)

1. Download the latest **`.dmg`** from [Releases](https://github.com/x1jiang/clawagents-desktop/releases).
2. Open the DMG and drag **ClawAgents Desktop** into **Applications**.
3. Open the app. Developer ID–signed builds are trusted by macOS once notarized; until notarization is configured, first launch may still need right-click → **Open**.
4. Add API keys in **Settings** (stored in macOS Keychain — not in the app bundle).

> The release DMG includes the embedded Python gateway. Thin Tauri-only builds without `Resources/backend` will not run.

## Code signing & notarization (maintainers)

Release builds need a **Developer ID Application** certificate (not *Apple Development*) for Team `SK58FV375Z`, then Apple notarization.

```bash
# One-time: create Developer ID Application in Xcode
#   Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application
# Or generate a CSR and upload at developer.apple.com:
./scripts/create_developer_id_csr.sh

# One-time: store notary credentials (app-specific password from appleid.apple.com)
xcrun notarytool store-credentials clawagents-notary \
  --apple-id "YOUR_APPLE_ID" \
  --team-id SK58FV375Z \
  --password "app-specific-password"

# Production build: embeds Python → signs → notarizes DMG
./build.sh

# Sign only (skip Apple notarization wait):
SKIP_NOTARIZE=1 ./build.sh
```

## Features (0.3.0)

- **VS Code parity:** library **6.12.12**, Wire API / Effort / TLS verify, personal skill homes
- **Native attachments:** images + PDF/DOCX via `invoke(images=/files=)` (not just OCR text)
- **Keychain-safe keys:** sidecar skips dotenv override so Settings keys win
- **Reliable Stop:** Cancel clears the send queue; SSE keep-alive + 60s idle watchdog
- **Provider catalog:** live `/v1/models` probe for custom base URLs; Bedrock not unlocked by OpenAI key alone
- Local projects and **SSH remote** projects (`~/.ssh/config`, including `ProxyJump`)
- Chat UI with Export (Markdown) and Fork
- File tree + **right-side file editor** (edit + autosave)
- Providers: OpenAI / Anthropic / Gemini / **AWS Bedrock** (native IAM or gateway) / Ollama
- Settings UI: sectioned Providers · Defaults · Agent · Data cards
- **Developer ID signed** release builds (`./build.sh` signs after embedding Python)

## Develop

```bash
./start.sh          # dev UI + gateway
./build.sh          # production .app + embed Python + DMG
```

Requirements: Node 20+, Rust (Tauri), Python 3.11+ with `backend/.venv`.

Copy `backend/.env.example` → `.env` for local gateway env (never commit `.env`).

## Security

- Do **not** commit `.env`, Keychain dumps, or release staging folders.
- API keys belong in Settings / Keychain only.
