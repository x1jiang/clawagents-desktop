#!/usr/bin/env bash
# Launch the ClawAgents Desktop app in dev mode.
#
# What this does:
#   1. Verifies the Python venv exists (creates + installs if not).
#   2. Verifies the UI node_modules exist (installs if not).
#   3. Runs `npm run tauri dev`, which:
#        - opens the Tauri desktop window,
#        - spawns the FastAPI gateway as a Python sidecar on a random
#          local port, using backend/.venv/bin/python3,
#        - serves the React UI via Vite on http://localhost:1420.
#
# Usage:
#   ./start.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ─── Python venv ──────────────────────────────────────────────────────
PYTHON="backend/.venv/bin/python3"
if [ ! -x "$PYTHON" ]; then
  echo "[start] Creating backend/.venv …"
  python3 -m venv backend/.venv
fi

# A venv directory can survive a source checkout while its editable
# ``clawagents`` package or the optional MCP dependency is absent/stale. Check
# imports rather than treating the presence of a Python executable as healthy.
if ! "$PYTHON" - <<'PY' >/dev/null 2>&1
from importlib.metadata import version
import clawagents  # noqa: F401

assert int(version("mcp").split(".", 1)[0]) < 2
PY
then
  echo "[start] Installing compatible desktop backend + MCP support …"
  "$PYTHON" -m pip install --upgrade pip >/dev/null
  "$PYTHON" -m pip install -e "backend[mcp]" tiktoken
else
  echo "[start] Python venv OK."
fi

# ─── UI node_modules ──────────────────────────────────────────────────
if [ ! -d "ui/node_modules" ]; then
  echo "[start] Installing UI deps (npm install) …"
  (cd ui && npm install)
else
  echo "[start] UI node_modules OK."
fi

# ─── Sanity: .env exists ──────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "[start] WARNING: clawagents_desktop/.env not found."
  echo "        Provider API keys will not be picked up from a file."
  echo "        You can still set them in Settings (stored in Keychain)."
fi

# ─── Sanity: pandoc is on PATH ────────────────────────────────────────
# The bundled DOCX/PDF skills shell out to pandoc. Without it, the agent
# falls back to ad-hoc Python parsing — which is slow and lossy.
if ! command -v pandoc >/dev/null 2>&1; then
  echo "[start] NOTE: pandoc is not on PATH."
  echo "        The agent's DOCX/PDF skills use pandoc to read these files."
  echo "        Install via: brew install pandoc"
fi

# ─── Launch ───────────────────────────────────────────────────────────
echo "[start] Launching Tauri dev shell. First run downloads Rust deps and"
echo "        takes a few minutes — subsequent launches are fast."
exec npm --prefix ui run tauri dev
