#!/bin/bash
# Get SOL balance for an address
# Usage: solana-balance.sh <address>

set -euo pipefail

LOG_PREFIX="[solana-balance]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing address argument" >&2
    echo '{"error": "Usage: solana-balance.sh <address>"}' >&2
    exit 1
fi

ADDRESS="$1"
echo "$LOG_PREFIX Checking balance for $ADDRESS" >&2

# Load config
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
if [ -f "$SKILL_DIR/config.json" ]; then
    CONFIG_RPC=$(jq -r '.rpcUrl // empty' "$SKILL_DIR/config.json" 2>/dev/null || true)
    if [ -n "$CONFIG_RPC" ]; then
        RPC_URL="$CONFIG_RPC"
    fi
fi

# Get balance
RESPONSE=$(curl -sf -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 1,
        \"method\": \"getBalance\",
        \"params\": [\"$ADDRESS\"]
    }" 2>&1)

if [ $? -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: RPC request failed" >&2
    echo "{\"error\": \"RPC request failed\"}" >&2
    exit 1
fi

# Extract balance
LAMPORTS=$(echo "$RESPONSE" | jq -r '.result.value // empty')

if [ -z "$LAMPORTS" ] || [ "$LAMPORTS" = "null" ]; then
    ERROR=$(echo "$RESPONSE" | jq -r '.error.message // "Unknown error"')
    echo "$LOG_PREFIX ERROR: $ERROR" >&2
    echo "{\"error\": \"$ERROR\"}" >&2
    exit 1
fi

# Convert to SOL
SOL=$(echo "scale=9; $LAMPORTS / 1000000000" | bc)
echo "$LOG_PREFIX Balance: $SOL SOL ($LAMPORTS lamports)" >&2

jq -n \
    --arg address "$ADDRESS" \
    --arg lamports "$LAMPORTS" \
    --arg sol "$SOL" \
    '{
        address: $address,
        lamports: ($lamports | tonumber),
        sol: ($sol | tonumber)
    }'
