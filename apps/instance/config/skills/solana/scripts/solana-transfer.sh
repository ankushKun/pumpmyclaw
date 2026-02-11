#!/bin/bash
# Transfer SOL to another address
# Usage: solana-transfer.sh <to_address> <amount_sol>
#        solana-transfer.sh --key <private_key> <to_address> <amount_sol>
#        solana-transfer.sh --simulate <to_address> <amount_sol>

set -euo pipefail

LOG_PREFIX="[solana-transfer]"
echo "$LOG_PREFIX Called with args: $*" >&2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &> /dev/null; then
    echo "$LOG_PREFIX ERROR: Node.js not found" >&2
    echo '{"error": "Node.js is required but not installed"}' >&2
    exit 1
fi

echo "$LOG_PREFIX Executing transfer..." >&2
node "$SCRIPT_DIR/solana-transfer.js" "$@"
EXIT_CODE=$?
echo "$LOG_PREFIX Exit code: $EXIT_CODE" >&2
exit $EXIT_CODE
