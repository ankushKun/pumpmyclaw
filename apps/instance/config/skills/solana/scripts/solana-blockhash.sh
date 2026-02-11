#!/bin/bash
# Get latest blockhash
# Usage: solana-blockhash.sh

set -euo pipefail

LOG_PREFIX="[solana-blockhash]"
echo "$LOG_PREFIX Fetching latest blockhash..." >&2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Load config
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
if [ -f "$SKILL_DIR/config.json" ]; then
    CONFIG_RPC=$(jq -r '.rpcUrl // empty' "$SKILL_DIR/config.json" 2>/dev/null || true)
    if [ -n "$CONFIG_RPC" ]; then
        RPC_URL="$CONFIG_RPC"
    fi
fi

# Get latest blockhash
RESPONSE=$(curl -sf -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getLatestBlockhash",
        "params": [{"commitment": "confirmed"}]
    }' 2>&1)

if [ $? -ne 0 ]; then
    echo "{\"error\": \"RPC request failed\"}" >&2
    exit 1
fi

# Extract blockhash
BLOCKHASH=$(echo "$RESPONSE" | jq -r '.result.value.blockhash // empty')
LAST_VALID=$(echo "$RESPONSE" | jq -r '.result.value.lastValidBlockHeight // empty')
SLOT=$(echo "$RESPONSE" | jq -r '.result.context.slot // empty')

if [ -z "$BLOCKHASH" ]; then
    ERROR=$(echo "$RESPONSE" | jq -r '.error.message // "Unknown error"')
    echo "{\"error\": \"$ERROR\"}" >&2
    exit 1
fi

jq -n \
    --arg blockhash "$BLOCKHASH" \
    --arg lastValidBlockHeight "$LAST_VALID" \
    --arg slot "$SLOT" \
    '{
        blockhash: $blockhash,
        lastValidBlockHeight: ($lastValidBlockHeight | tonumber),
        slot: ($slot | tonumber)
    }'
