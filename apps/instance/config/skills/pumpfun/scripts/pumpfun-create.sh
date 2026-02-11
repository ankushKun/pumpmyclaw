#!/bin/bash
# Create a new token on pump.fun
# Usage: pumpfun-create.sh [name] [symbol] [description] [image_path] [dev_buy_sol]
#
# If name/symbol not provided, generates random meme token
# If image not provided, generates a placeholder image
# dev_buy_sol: Amount of SOL to spend on initial dev buy (default: 0 = none)
#
# Requires SOLANA_PRIVATE_KEY to be set in environment or config.json

set -euo pipefail

LOG_PREFIX="[pumpfun-create]"
echo "$LOG_PREFIX Called with args: $*" >&2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if node is available
if ! command -v node &> /dev/null; then
    echo "$LOG_PREFIX ERROR: Node.js not found" >&2
    echo '{"error": "Node.js is required but not installed"}' >&2
    exit 1
fi

# Run the create script with all arguments
echo "$LOG_PREFIX Executing pumpfun-create.js..." >&2
node "$SCRIPT_DIR/pumpfun-create.js" "$@"
EXIT_CODE=$?
echo "$LOG_PREFIX Exit code: $EXIT_CODE" >&2
exit $EXIT_CODE
