#!/usr/bin/env bash
# Generate a CSR + private key for creating a Developer ID Application certificate.
# Keep the .key private. Upload the .certSigningRequest at:
#   https://developer.apple.com/account/resources/certificates/add
# Choose: Developer ID Application
#
# After Apple issues the .cer, double-click it to import into Keychain
# (must be the same Mac / same private key).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/certs}"
mkdir -p "$OUT"
chmod 700 "$OUT"

EMAIL="${APPLE_ID_EMAIL:-}"
CN="${CSR_CN:-Xiaoqian Jiang}"
COUNTRY="${CSR_COUNTRY:-US}"

KEY="$OUT/DeveloperIDApplication.key"
CSR="$OUT/DeveloperIDApplication.certSigningRequest"

if [ -f "$KEY" ]; then
  echo "[csr] Reusing existing key: $KEY"
else
  echo "[csr] Generating RSA-2048 key …"
  openssl genrsa -out "$KEY" 2048
  chmod 600 "$KEY"
fi

SUBJ="/CN=$CN/C=$COUNTRY"
if [ -n "$EMAIL" ]; then
  SUBJ="/emailAddress=$EMAIL$SUBJ"
fi

openssl req -new -key "$KEY" -out "$CSR" -subj "$SUBJ"
chmod 600 "$CSR"

echo ""
echo "[csr] Created:"
echo "  $KEY   (KEEP PRIVATE — do not commit)"
echo "  $CSR   (upload to Apple)"
echo ""
echo "Next:"
echo "  1. Open https://developer.apple.com/account/resources/certificates/add"
echo "  2. Select Developer ID Application → Continue"
echo "  3. Upload: $CSR"
echo "  4. Download the .cer and open it (imports into Keychain Login)"
echo "  5. Verify: security find-identity -v -p codesigning | grep 'Developer ID Application'"
echo "  6. ./build.sh"
