# ClawAgents Desktop

macOS desktop app for ClawAgents: project-scoped chats, file tree, remote SSH projects, and a local Python gateway.

## Install (macOS Apple Silicon)

1. Download the latest **`.dmg`** from [Releases](https://github.com/x1jiang/clawagents-desktop/releases).
2. Open the DMG and drag **ClawAgents Desktop** into **Applications**.
3. First launch: if macOS blocks it, right-click → **Open**, or allow it under **System Settings → Privacy & Security**.
4. Add API keys in **Settings** (stored in macOS Keychain — not in the app bundle).

> The release DMG includes the embedded Python gateway. Thin Tauri-only builds without `Resources/backend` will not run.

## Features (0.2.2)

- Local projects and **SSH remote** projects (`~/.ssh/config`, including `ProxyJump`)
- Chat UI with Export (Markdown) and Fork
- File tree + **right-side file editor** (edit + autosave)
- Provider keys via Keychain (OpenAI / Anthropic / Gemini)

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
