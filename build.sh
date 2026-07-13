#!/usr/bin/env bash
# Build a production .app bundle for ClawAgents Desktop.
#
# Output:
#   ui/src-tauri/target/release/bundle/macos/ClawAgents Desktop.app
#   ui/src-tauri/target/release/bundle/dmg/ClawAgents Desktop_<ver>_<arch>.dmg
#
# Usage:
#   ./build.sh           # build for the host architecture
#   ./build.sh universal # build a universal (arm64 + x86_64) bundle

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ─── Sanity checks ────────────────────────────────────────────────────
if [ ! -x "backend/.venv/bin/python3" ]; then
  echo "[build] Missing backend/.venv. Run ./start.sh once first to set it up."
  exit 1
fi
if [ ! -d "ui/node_modules" ]; then
  echo "[build] Installing UI deps …"
  (cd ui && npm install)
fi

# ─── Build ────────────────────────────────────────────────────────────
TARGET_FLAG=""
if [ "${1:-}" = "universal" ]; then
  TARGET_FLAG="--target universal-apple-darwin"
  echo "[build] Universal binary requested. Adding rustup targets if needed …"
  rustup target add aarch64-apple-darwin x86_64-apple-darwin || true
fi

echo "[build] Building production bundle (this takes several minutes) …"
npm --prefix ui run tauri build -- $TARGET_FLAG

APP="ui/src-tauri/target/release/bundle/macos/ClawAgents Desktop.app"
if [ ! -d "$APP" ]; then
  APP="$(find ui/src-tauri/target -type d -name 'ClawAgents Desktop.app' 2>/dev/null | head -1 || true)"
fi
if [ -z "${APP:-}" ] || [ ! -d "$APP" ]; then
  echo "[build] ERROR: could not find bundled .app under ui/src-tauri/target"
  exit 1
fi

echo "[build] Embedding Python gateway into: $APP"

# Prefer the project venv's interpreter so we match the same Python major.
HOST_PY="$ROOT/backend/.venv/bin/python3"
RES_BACKEND="$APP/Contents/Resources/backend"
rm -rf "$RES_BACKEND"
mkdir -p "$RES_BACKEND"

echo "[build] Creating relocatable venv inside the app (non-editable install) …"
# --copies: copy the interpreter into the bundle. Symlinks to a host Python
# outside the .app break codesign --deep --strict and Apple notarization.
"$HOST_PY" -m venv --copies "$RES_BACKEND/.venv"
"$RES_BACKEND/.venv/bin/pip" install --upgrade pip wheel >/dev/null
# Non-editable so site-packages are self-contained (editable .pth would point
# at the source tree and break when the .app is moved to /Applications).
"$RES_BACKEND/.venv/bin/pip" install \
  "$ROOT/backend[gemini,anthropic,bedrock,mcp,accurate-tokens]"

# Rewrite any remaining absolute/out-of-bundle symlinks under Resources/backend.
echo "[build] Ensuring no external symlinks in embedded backend …"
python3 - <<'PY' "$RES_BACKEND"
import os, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
fixed = 0
for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
    for name in dirnames + filenames:
        p = Path(dirpath) / name
        if not p.is_symlink():
            continue
        target = p.resolve()
        try:
            target.relative_to(root)
            continue  # points inside the bundle
        except ValueError:
            pass
        if target.is_file():
            p.unlink()
            # copy2 preserves mode; follow_symlinks=True copies real file
            import shutil
            shutil.copy2(target, p, follow_symlinks=True)
            fixed += 1
            print(f"  copied symlink -> file: {p.relative_to(root)}")
        elif target.is_dir():
            # Replace dir symlink with a real directory copy (rare in venvs).
            p.unlink()
            import shutil
            shutil.copytree(target, p, symlinks=False)
            fixed += 1
            print(f"  copied symlink -> dir: {p.relative_to(root)}")
        else:
            print(f"  WARN: dangling symlink removed: {p.relative_to(root)} -> {os.readlink(p)}")
            p.unlink()
            fixed += 1
print(f"[build] Fixed {fixed} external symlink(s)")
PY

# Source tree for SSH remote bootstrap (rsync to remote hosts).
echo "[build] Embedding backend source for remote SSH sync …"
mkdir -p "$RES_BACKEND/src"
rsync -a --delete \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.ruff_cache' \
  "$ROOT/backend/src/clawagents/" "$RES_BACKEND/src/clawagents/"
cp "$ROOT/backend/pyproject.toml" "$RES_BACKEND/pyproject.toml"

# Smoke-check the bundled interpreter before we ship the DMG.
if ! "$RES_BACKEND/.venv/bin/python3" -c "import clawagents; print(clawagents.__version__ if hasattr(clawagents,'__version__') else 'ok')"; then
  echo "[build] ERROR: bundled python cannot import clawagents"
  exit 1
fi

# Sign the .app AFTER embedding Python (embedding invalidates any earlier signature).
SIGN_SCRIPT="$ROOT/scripts/macos_sign_notarize.sh"
HAS_DEVELOPER_ID=0
if security find-identity -v -p codesigning 2>/dev/null | grep -q 'Developer ID Application:'; then
  HAS_DEVELOPER_ID=1
fi

# Rebuild the DMG so it includes the embedded venv.
DMG_DIR="$(dirname "$APP")/../dmg"
VER="$(python3 -c "import json; print(json.load(open('ui/src-tauri/tauri.conf.json'))['version'])")"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) ARCH_LABEL=aarch64 ;;
  x86_64) ARCH_LABEL=x86_64 ;;
  *) ARCH_LABEL="$ARCH" ;;
esac
DMG_OUT="$DMG_DIR/ClawAgents Desktop_${VER}_${ARCH_LABEL}.dmg"

# Sign app before packaging DMG when a Developer ID is available.
if [ "$HAS_DEVELOPER_ID" = "1" ] && [ -x "$SIGN_SCRIPT" ]; then
  echo "[build] Developer ID found — signing .app before DMG …"
  SIGN_REQUIRED=1 SKIP_NOTARIZE=1 "$SIGN_SCRIPT" "$APP"
elif [ "${REQUIRE_SIGN:-0}" = "1" ]; then
  echo "[build] ERROR: REQUIRE_SIGN=1 but no Developer ID Application identity."
  echo "        Run: ./scripts/create_developer_id_csr.sh"
  exit 1
else
  echo "[build] No Developer ID Application identity — shipping unsigned (Gatekeeper will block downloads)."
  echo "        Create one via Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application"
fi

if [ -x "$DMG_DIR/bundle_dmg.sh" ] || [ -d "$DMG_DIR" ]; then
  echo "[build] Rebuilding DMG with embedded Python …"
  mkdir -p "$DMG_DIR"
  rm -f "$DMG_OUT"
  # Tauri's helper expects to be run from the dmg folder with app path args;
  # fall back to hdiutil if the helper signature is unknown.
  if [ -x "$DMG_DIR/bundle_dmg.sh" ] && "$DMG_DIR/bundle_dmg.sh" --help >/dev/null 2>&1; then
    (cd "$DMG_DIR" && ./bundle_dmg.sh) || true
  fi
  if [ ! -f "$DMG_OUT" ]; then
    echo "[build] Creating DMG via hdiutil …"
    STAGE=$(mktemp -d)
    cp -R "$APP" "$STAGE/"
    ln -sf /Applications "$STAGE/Applications"
    hdiutil create -volname "ClawAgents Desktop" -srcfolder "$STAGE" -ov -format UDZO "$DMG_OUT"
    rm -rf "$STAGE"
  fi
fi

# Notarize the DMG (preferred) so Gatekeeper accepts internet downloads.
# Do this AFTER the DMG is built from the already-signed .app.
if [ "$HAS_DEVELOPER_ID" = "1" ] && [ -f "$DMG_OUT" ] && [ -x "$SIGN_SCRIPT" ]; then
  echo "[build] Signing/notarizing DMG …"
  SIGN_REQUIRED=1 "$SIGN_SCRIPT" --notarize-dmg "$DMG_OUT" "$APP"
fi

echo ""
echo "[build] Done. Output:"
echo "  $APP"
[ -f "$DMG_OUT" ] && echo "  $DMG_OUT"
echo ""
echo "[build] Tip: install the .app to /Applications (or open it in place)."
echo "        Gateway logs: ~/Library/Logs/ClawAgentsDesktop/"
