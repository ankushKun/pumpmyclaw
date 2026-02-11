#!/bin/bash
# Generate a new Solana keypair
# Usage: solana-keygen.sh [--vanity <prefix>] [--from-seed <seed>]

set -euo pipefail

LOG_PREFIX="[solana-keygen]"
echo "$LOG_PREFIX Generating new keypair..." >&2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &> /dev/null; then
    echo "$LOG_PREFIX ERROR: Node.js not found" >&2
    echo '{"error": "Node.js is required but not installed"}' >&2
    exit 1
fi

node "$SCRIPT_DIR/solana-keygen.js" "$@"
EXIT_CODE=$?
echo "$LOG_PREFIX Exit code: $EXIT_CODE" >&2
exit $EXIT_CODE
