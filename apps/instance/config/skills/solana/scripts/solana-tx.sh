#!/bin/bash
# Get transaction status/details
# Usage: solana-tx.sh <signature>

set -euo pipefail

LOG_PREFIX="[solana-tx]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing signature argument" >&2
    echo '{"error": "Usage: solana-tx.sh <signature>"}' >&2
    exit 1
fi

SIGNATURE="$1"
echo "$LOG_PREFIX Checking transaction: $SIGNATURE" >&2

# Load config
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
if [ -f "$SKILL_DIR/config.json" ]; then
    CONFIG_RPC=$(jq -r '.rpcUrl // empty' "$SKILL_DIR/config.json" 2>/dev/null || true)
    if [ -n "$CONFIG_RPC" ]; then
        RPC_URL="$CONFIG_RPC"
    fi
fi

# Get signature status
STATUS_RESPONSE=$(curl -sf -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 1,
        \"method\": \"getSignatureStatuses\",
        \"params\": [[\"$SIGNATURE\"], {\"searchTransactionHistory\": true}]
    }" 2>&1)

if [ $? -ne 0 ]; then
    echo "{\"error\": \"RPC request failed\"}" >&2
    exit 1
fi

# Extract status
STATUS=$(echo "$STATUS_RESPONSE" | jq '.result.value[0]')

if [ "$STATUS" = "null" ]; then
    jq -n \
        --arg signature "$SIGNATURE" \
        '{
            signature: $signature,
            found: false,
            status: "not_found",
            message: "Transaction not found. It may still be processing or the signature is invalid."
        }'
    exit 0
fi

# Extract fields
SLOT=$(echo "$STATUS" | jq -r '.slot // empty')
CONFIRMATIONS=$(echo "$STATUS" | jq -r '.confirmations // "null"')
ERR=$(echo "$STATUS" | jq '.err')
CONFIRMATION_STATUS=$(echo "$STATUS" | jq -r '.confirmationStatus // empty')

if [ "$ERR" = "null" ]; then
    SUCCESS="true"
    ERROR_MSG=""
else
    SUCCESS="false"
    ERROR_MSG=$(echo "$ERR" | jq -r 'if type == "object" then (keys[0] // "Unknown error") else . end')
fi

jq -n \
    --arg signature "$SIGNATURE" \
    --arg slot "$SLOT" \
    --arg confirmations "$CONFIRMATIONS" \
    --arg confirmationStatus "$CONFIRMATION_STATUS" \
    --arg success "$SUCCESS" \
    --arg error "$ERROR_MSG" \
    '{
        signature: $signature,
        found: true,
        success: ($success == "true"),
        slot: (if $slot != "" then ($slot | tonumber) else null end),
        confirmations: (if $confirmations != "null" and $confirmations != "" then ($confirmations | tonumber) else null end),
        confirmationStatus: $confirmationStatus,
        error: (if $error != "" then $error else null end),
        explorer: ("https://solscan.io/tx/" + $signature)
    }'
