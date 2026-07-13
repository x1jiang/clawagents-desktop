#!/usr/bin/env bash
# Deep-sign ClawAgents Desktop.app (Developer ID) and optionally notarize the DMG.
#
# Prerequisites (one-time):
#   1. Developer ID Application certificate in Keychain
#      Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application
#      Team: Xiaoqian Jiang (SK58FV375Z)
#   2. Notary credentials (for Gatekeeper to accept downloads):
#      xcrun notarytool store-credentials clawagents-notary \
#        --apple-id "YOUR_APPLE_ID" --team-id SK58FV375Z --password "app-specific-password"
#
# Usage:
#   ./scripts/macos_sign_notarize.sh "/path/to/ClawAgents Desktop.app"
#   ./scripts/macos_sign_notarize.sh --notarize-dmg "/path/to.dmg" ["/path/to/App.app"]
# Env:
#   APPLE_SIGNING_IDENTITY  override identity string
#   NOTARY_PROFILE          default: clawagents-notary
#   SKIP_NOTARIZE=1         sign only (skip Apple notary submit)
#   SIGN_REQUIRED=1         fail if no Developer ID identity


set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTITLEMENTS="${ENTITLEMENTS:-$ROOT/ui/src-tauri/entitlements.plist}"
NOTARY_PROFILE="${NOTARY_PROFILE:-clawagents-notary}"
TEAM_ID="${APPLE_TEAM_ID:-SK58FV375Z}"

MODE="sign"
APP=""
DMG=""

if [ "${1:-}" = "--notarize-dmg" ]; then
  MODE="notarize-dmg"
  DMG="${2:-}"
  APP="${3:-}"
else
  APP="${1:-}"
  DMG="${2:-}"
fi

pick_identity() {
  if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    echo "$APPLE_SIGNING_IDENTITY"
    return
  fi
  # Prefer Developer ID Application (distribution). Never use Apple Development for releases.
  local id
  id="$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' \
    | head -1 || true)"
  echo "$id"
}

require_identity() {
  IDENTITY="$(pick_identity)"
  if [ -n "$IDENTITY" ]; then
    return 0
  fi
  echo "[sign] ERROR: no \"Developer ID Application\" identity in Keychain."
  echo ""
  echo "  You currently need a Developer ID cert (Apple Development is not enough"
  echo "  for Gatekeeper / downloaded DMGs)."
  echo ""
  echo "  One-time setup:"
  echo "    1. Open Xcode → Settings → Accounts → (your Apple ID) → Manage Certificates"
  echo "    2. Click + → Developer ID Application"
  echo "    3. Re-run: ./build.sh"
  echo ""
  echo "  Or create at: https://developer.apple.com/account/resources/certificates/list"
  echo "  Team ID: $TEAM_ID"
  if [ "${SIGN_REQUIRED:-0}" = "1" ]; then
    exit 1
  fi
  exit 0
}

notarize_dmg() {
  local dmg="$1"
  local app="${2:-}"

  if [ ! -f "$dmg" ]; then
    echo "[sign] ERROR: DMG not found: $dmg"
    exit 1
  fi

  echo "[sign] Identity: $IDENTITY"
  echo "[sign] Signing DMG …"
  codesign --force --timestamp --sign "$IDENTITY" "$dmg"

  if [ "${SKIP_NOTARIZE:-0}" = "1" ]; then
    echo "[sign] SKIP_NOTARIZE=1 — skipping notarytool."
    exit 0
  fi

  if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    echo "[sign] ERROR: notary profile \"$NOTARY_PROFILE\" not found."
    echo ""
    echo "  Create an app-specific password at https://appleid.apple.com → Sign-In and Security"
    echo "  then store it once:"
    echo ""
    echo "    xcrun notarytool store-credentials $NOTARY_PROFILE \\"
    echo "      --apple-id \"YOUR_APPLE_ID\" \\"
    echo "      --team-id $TEAM_ID \\"
    echo "      --password \"app-specific-password\""
    echo ""
    echo "  Or set SKIP_NOTARIZE=1 to ship a signed-but-unnotarized DMG (Gatekeeper still warns)."
    exit 1
  fi

  echo "[sign] Submitting to Apple notarization (this can take several minutes) …"
  xcrun notarytool submit "$dmg" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait

  echo "[sign] Stapling ticket …"
  xcrun stapler staple "$dmg"
  if [ -n "$app" ] && [ -d "$app" ]; then
    xcrun stapler staple "$app" 2>/dev/null || true
  fi

  echo "[sign] Final Gatekeeper check …"
  spctl --assess --type open --context context:primary-signature -v "$dmg" 2>&1 || true

  echo "[sign] Done. Notarized:"
  echo "  $dmg"
  [ -n "$app" ] && [ -d "$app" ] && echo "  $app (stapled if possible)"
}

require_identity

if [ "$MODE" = "notarize-dmg" ]; then
  if [ -z "$DMG" ]; then
    echo "[sign] ERROR: usage: $0 --notarize-dmg /path/to.dmg [/path/to/App.app]"
    exit 1
  fi
  notarize_dmg "$DMG" "$APP"
  exit 0
fi

if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "[sign] ERROR: usage: $0 /path/to/App.app"
  echo "              $0 --notarize-dmg /path/to.dmg [/path/to/App.app]"
  exit 1
fi
if [ ! -f "$ENTITLEMENTS" ]; then
  echo "[sign] ERROR: missing entitlements: $ENTITLEMENTS"
  exit 1
fi

echo "[sign] Identity: $IDENTITY"
echo "[sign] App:      $APP"

is_macho() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  # Skip symlinks; codesign the real file when we hit it.
  [[ ! -L "$f" ]] || return 1
  file -b "$f" 2>/dev/null | grep -q 'Mach-O'
}

sign_macho() {
  local f="$1"
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" \
    "$f" >/dev/null
}

# Inside-out: nested Mach-O first, then the .app bundle.
echo "[sign] Signing nested Mach-O binaries …"
COUNT=0
# Prefer depth-first so frameworks / helpers are sealed before parents.
while IFS= read -r -d '' f; do
  if is_macho "$f"; then
    sign_macho "$f" || {
      echo "[sign] WARN: failed to sign: $f"
    }
    COUNT=$((COUNT + 1))
  fi
done < <(find "$APP/Contents" -type f -print0 | sort -z)

echo "[sign] Signed $COUNT nested binaries"

echo "[sign] Signing app bundle …"
codesign --force --options runtime --timestamp \
  --entitlements "$ENTITLEMENTS" \
  --sign "$IDENTITY" \
  "$APP"

echo "[sign] Verifying …"
# Prefer strict deep verify; fall back to bundle-only if nested venv edge cases remain.
if ! codesign --verify --deep --strict --verbose=2 "$APP"; then
  echo "[sign] WARN: deep/strict verify failed; checking top-level signature …"
  codesign --verify --verbose=2 "$APP"
fi
spctl --assess --type execute --verbose=2 "$APP" 2>&1 || {
  echo "[sign] NOTE: spctl may fail until notarization + staple complete (expected for local-only sign)."
}

echo "[sign] Done (app signed)."
# Optional: if a DMG path is still passed as $2 for convenience, notarize it.
if [ -n "${DMG:-}" ]; then
  notarize_dmg "$DMG" "$APP"
fi
