#!/bin/bash
# Get account information
# Usage: solana-account.sh <address>

set -euo pipefail

LOG_PREFIX="[solana-account]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing address argument" >&2
    echo '{"error": "Usage: solana-account.sh <address>"}' >&2
    exit 1
fi

ADDRESS="$1"
echo "$LOG_PREFIX Getting account info for $ADDRESS" >&2

# Load config
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
if [ -f "$SKILL_DIR/config.json" ]; then
    CONFIG_RPC=$(jq -r '.rpcUrl // empty' "$SKILL_DIR/config.json" 2>/dev/null || true)
    if [ -n "$CONFIG_RPC" ]; then
        RPC_URL="$CONFIG_RPC"
    fi
fi

# Get account info
RESPONSE=$(curl -sf -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 1,
        \"method\": \"getAccountInfo\",
        \"params\": [\"$ADDRESS\", {\"encoding\": \"base64\"}]
    }" 2>&1)

if [ $? -ne 0 ]; then
    echo "{\"error\": \"RPC request failed\"}" >&2
    exit 1
fi

# Check for null value (account not found)
VALUE=$(echo "$RESPONSE" | jq '.result.value')

if [ "$VALUE" = "null" ]; then
    jq -n \
        --arg address "$ADDRESS" \
        '{
            address: $address,
            exists: false,
            error: "Account not found"
        }'
    exit 0
fi

# Extract account info
LAMPORTS=$(echo "$RESPONSE" | jq -r '.result.value.lamports')
OWNER=$(echo "$RESPONSE" | jq -r '.result.value.owner')
EXECUTABLE=$(echo "$RESPONSE" | jq -r '.result.value.executable')
SPACE=$(echo "$RESPONSE" | jq -r '.result.value.space')
DATA=$(echo "$RESPONSE" | jq -r '.result.value.data[0]')

# Convert lamports to SOL
SOL=$(echo "scale=9; $LAMPORTS / 1000000000" | bc)

jq -n \
    --arg address "$ADDRESS" \
    --arg lamports "$LAMPORTS" \
    --arg sol "$SOL" \
    --arg owner "$OWNER" \
    --arg executable "$EXECUTABLE" \
    --arg space "$SPACE" \
    --arg data "$DATA" \
    '{
        address: $address,
        exists: true,
        lamports: ($lamports | tonumber),
        sol: ($sol | tonumber),
        owner: $owner,
        executable: ($executable == "true"),
        space: ($space | tonumber),
        dataBase64: $data
    }'
