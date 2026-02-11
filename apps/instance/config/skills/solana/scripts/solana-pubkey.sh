#!/bin/bash
# Get public key from private key
# Usage: solana-pubkey.sh <private_key>
#        solana-pubkey.sh --file <keypair.json>

set -euo pipefail

LOG_PREFIX="[solana-pubkey]"
echo "$LOG_PREFIX Deriving public key..." >&2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &> /dev/null; then
    echo "$LOG_PREFIX ERROR: Node.js not found" >&2
    echo '{"error": "Node.js is required but not installed"}' >&2
    exit 1
fi

node "$SCRIPT_DIR/solana-pubkey.js" "$@"
EXIT_CODE=$?
echo "$LOG_PREFIX Exit code: $EXIT_CODE" >&2
exit $EXIT_CODE
