#!/bin/bash
# Request SOL airdrop (devnet/testnet only)
# Usage: solana-airdrop.sh <address> [amount_sol]

set -euo pipefail

LOG_PREFIX="[solana-airdrop]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing address argument" >&2
    echo '{"error": "Usage: solana-airdrop.sh <address> [amount_sol]"}' >&2
    exit 1
fi

ADDRESS="$1"
AMOUNT_SOL="${2:-1}"
echo "$LOG_PREFIX Requesting $AMOUNT_SOL SOL airdrop to $ADDRESS" >&2

# Convert to lamports
LAMPORTS=$(echo "$AMOUNT_SOL * 1000000000" | bc | cut -d. -f1)

# Default to devnet for airdrop
RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
if [ -f "$SKILL_DIR/config.json" ]; then
    CONFIG_RPC=$(jq -r '.rpcUrl // empty' "$SKILL_DIR/config.json" 2>/dev/null || true)
    if [ -n "$CONFIG_RPC" ]; then
        RPC_URL="$CONFIG_RPC"
    fi
fi

# Check if mainnet (airdrop won't work)
if [[ "$RPC_URL" == *"mainnet"* ]]; then
    echo '{"error": "Airdrop is only available on devnet and testnet"}' >&2
    exit 1
fi

echo "Requesting $AMOUNT_SOL SOL airdrop to $ADDRESS on $RPC_URL..." >&2

# Request airdrop
RESPONSE=$(curl -sf -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 1,
        \"method\": \"requestAirdrop\",
        \"params\": [\"$ADDRESS\", $LAMPORTS]
    }" 2>&1)

if [ $? -ne 0 ]; then
    echo "{\"error\": \"RPC request failed\"}" >&2
    exit 1
fi

# Extract signature
SIGNATURE=$(echo "$RESPONSE" | jq -r '.result // empty')

if [ -z "$SIGNATURE" ] || [ "$SIGNATURE" = "null" ]; then
    ERROR=$(echo "$RESPONSE" | jq -r '.error.message // "Airdrop failed"')
    echo "{\"error\": \"$ERROR\"}" >&2
    exit 1
fi

jq -n \
    --arg address "$ADDRESS" \
    --arg amount "$AMOUNT_SOL" \
    --arg lamports "$LAMPORTS" \
    --arg signature "$SIGNATURE" \
    '{
        success: true,
        address: $address,
        amount: ($amount | tonumber),
        lamports: ($lamports | tonumber),
        signature: $signature,
        message: "Airdrop requested. Wait a few seconds for confirmation."
    }'
