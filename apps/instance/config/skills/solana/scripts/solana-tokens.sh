#!/bin/bash
# Get all token accounts for an owner
# Usage: solana-tokens.sh <owner_address>

set -euo pipefail

LOG_PREFIX="[solana-tokens]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing owner address argument" >&2
    echo '{"error": "Usage: solana-tokens.sh <owner_address>"}' >&2
    exit 1
fi

OWNER="$1"
echo "$LOG_PREFIX Fetching token accounts for $OWNER" >&2

# Load config
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
if [ -f "$SKILL_DIR/config.json" ]; then
    CONFIG_RPC=$(jq -r '.rpcUrl // empty' "$SKILL_DIR/config.json" 2>/dev/null || true)
    if [ -n "$CONFIG_RPC" ]; then
        RPC_URL="$CONFIG_RPC"
    fi
fi

# Get token accounts
RESPONSE=$(curl -sf --max-time 10 -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 1,
        \"method\": \"getTokenAccountsByOwner\",
        \"params\": [
            \"$OWNER\",
            {\"programId\": \"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA\"},
            {\"encoding\": \"jsonParsed\"}
        ]
    }" 2>&1)

if [ $? -ne 0 ]; then
    echo "{\"error\": \"RPC request failed\"}" >&2
    exit 1
fi

# Extract and format token accounts
COUNT=$(echo "$RESPONSE" | jq '.result.value | length' 2>/dev/null || echo 0)
echo "$LOG_PREFIX Found $COUNT token accounts" >&2
echo "$RESPONSE" | jq --arg owner "$OWNER" '{
    owner: $owner,
    tokens: [.result.value[] | {
        address: .pubkey,
        mint: .account.data.parsed.info.mint,
        balance: .account.data.parsed.info.tokenAmount.uiAmountString,
        decimals: .account.data.parsed.info.tokenAmount.decimals,
        rawBalance: .account.data.parsed.info.tokenAmount.amount
    }],
    count: (.result.value | length)
}'
