#!/bin/bash
# Get balance of a specific token account
# Usage: solana-token-balance.sh <token_account_address>

set -euo pipefail

LOG_PREFIX="[solana-token-balance]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing token account argument" >&2
    echo '{"error": "Usage: solana-token-balance.sh <token_account_address>"}' >&2
    exit 1
fi

TOKEN_ACCOUNT="$1"
echo "$LOG_PREFIX Checking token balance for $TOKEN_ACCOUNT" >&2

# Load config
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
if [ -f "$SKILL_DIR/config.json" ]; then
    CONFIG_RPC=$(jq -r '.rpcUrl // empty' "$SKILL_DIR/config.json" 2>/dev/null || true)
    if [ -n "$CONFIG_RPC" ]; then
        RPC_URL="$CONFIG_RPC"
    fi
fi

# Get token account balance
RESPONSE=$(curl -sf -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 1,
        \"method\": \"getTokenAccountBalance\",
        \"params\": [\"$TOKEN_ACCOUNT\"]
    }" 2>&1)

if [ $? -ne 0 ]; then
    echo "{\"error\": \"RPC request failed\"}" >&2
    exit 1
fi

# Check for error
ERROR=$(echo "$RESPONSE" | jq -r '.error.message // empty')
if [ -n "$ERROR" ]; then
    echo "{\"error\": \"$ERROR\"}" >&2
    exit 1
fi

# Extract balance info
BALANCE=$(echo "$RESPONSE" | jq -r '.result.value.uiAmountString // "0"')
echo "$LOG_PREFIX Balance: $BALANCE" >&2
echo "$RESPONSE" | jq --arg account "$TOKEN_ACCOUNT" '{
    tokenAccount: $account,
    balance: .result.value.uiAmountString,
    rawBalance: .result.value.amount,
    decimals: .result.value.decimals
}'
