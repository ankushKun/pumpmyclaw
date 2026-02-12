#!/bin/bash
# Get token balances for a wallet using Solana RPC (no JWT required)
# Falls back to pump.fun API if RPC fails
# Usage: pumpfun-balances.sh <wallet_address> [limit]

set -euo pipefail

LOG_PREFIX="[pumpfun-balances]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Check arguments
if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing wallet address" >&2
    echo '{"error": "Usage: pumpfun-balances.sh <wallet_address> [limit]"}' >&2
    exit 1
fi

ADDRESS="$1"
LIMIT="${2:-100}"
echo "$LOG_PREFIX Fetching balances for $ADDRESS via Solana RPC" >&2

# Use Solana RPC to get all token accounts (no auth required)
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"

set +e
RPC_RESPONSE=$(curl -sf --max-time 10 -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 1,
        \"method\": \"getTokenAccountsByOwner\",
        \"params\": [
            \"$ADDRESS\",
            {\"programId\": \"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA\"},
            {\"encoding\": \"jsonParsed\"}
        ]
    }" 2>&1)
RPC_STATUS=$?
set -e

if [ $RPC_STATUS -eq 0 ] && echo "$RPC_RESPONSE" | jq -e '.result.value' >/dev/null 2>&1; then
    # Format RPC response to match expected output format: [{mint, balance, symbol}, ...]
    RESULT=$(echo "$RPC_RESPONSE" | jq "[.result.value[] |
        select(.account.data.parsed.info.tokenAmount.uiAmount > 0) |
        {
            mint: .account.data.parsed.info.mint,
            balance: .account.data.parsed.info.tokenAmount.uiAmountString,
            symbol: \"???\",
            decimals: .account.data.parsed.info.tokenAmount.decimals,
            rawBalance: .account.data.parsed.info.tokenAmount.amount
        }
    ] | .[:${LIMIT}]" 2>/dev/null)

    if [ -n "$RESULT" ] && [ "$RESULT" != "null" ]; then
        COUNT=$(echo "$RESULT" | jq 'length' 2>/dev/null || echo 0)
        echo "$LOG_PREFIX Got $COUNT token balances via RPC" >&2
        echo "$RESULT"
        exit 0
    fi
fi

echo "$LOG_PREFIX RPC method failed, trying pump.fun API fallback..." >&2

# Fallback: try pump.fun API (may fail without JWT)
API_URL="https://frontend-api-v3.pump.fun"
HEADERS=(-H "Accept: application/json" -H "Origin: https://pump.fun")

set +e
RESPONSE=$(curl -sf --max-time 10 "${API_URL}/balances/${ADDRESS}?offset=0&limit=${LIMIT}&minBalance=0" "${HEADERS[@]}" 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: both RPC and pump.fun API failed" >&2
    echo "[]"
    exit 0
fi

COUNT=$(echo "$RESPONSE" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)
echo "$LOG_PREFIX Got $COUNT token balances via pump.fun API" >&2

if command -v jq &> /dev/null; then
    echo "$RESPONSE" | jq '.'
else
    echo "$RESPONSE"
fi
