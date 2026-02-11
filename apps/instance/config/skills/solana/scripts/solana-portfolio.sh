#!/bin/bash
# Get full portfolio: SOL balance + all token balances
# Usage: solana-portfolio.sh <address>

set -euo pipefail

LOG_PREFIX="[solana-portfolio]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing address argument" >&2
    echo '{"error": "Usage: solana-portfolio.sh <address>"}' >&2
    exit 1
fi

ADDRESS="$1"
echo "$LOG_PREFIX Fetching portfolio for $ADDRESS" >&2

# Load config
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
if [ -f "$SKILL_DIR/config.json" ]; then
    CONFIG_RPC=$(jq -r '.rpcUrl // empty' "$SKILL_DIR/config.json" 2>/dev/null || true)
    if [ -n "$CONFIG_RPC" ]; then
        RPC_URL="$CONFIG_RPC"
    fi
fi

# Get SOL balance
SOL_RESPONSE=$(curl -sf -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 1,
        \"method\": \"getBalance\",
        \"params\": [\"$ADDRESS\"]
    }" 2>&1)

SOL_LAMPORTS=$(echo "$SOL_RESPONSE" | jq -r '.result.value // 0')
SOL_BALANCE=$(echo "scale=9; $SOL_LAMPORTS / 1000000000" | bc)

# Get SPL Token accounts
TOKEN_RESPONSE=$(curl -sf -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 2,
        \"method\": \"getTokenAccountsByOwner\",
        \"params\": [
            \"$ADDRESS\",
            {\"programId\": \"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA\"},
            {\"encoding\": \"jsonParsed\"}
        ]
    }" 2>&1)

# Get Token-2022 accounts
TOKEN22_RESPONSE=$(curl -sf -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 3,
        \"method\": \"getTokenAccountsByOwner\",
        \"params\": [
            \"$ADDRESS\",
            {\"programId\": \"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb\"},
            {\"encoding\": \"jsonParsed\"}
        ]
    }" 2>&1)

# Combine and format output
jq -n \
    --arg address "$ADDRESS" \
    --arg solLamports "$SOL_LAMPORTS" \
    --arg solBalance "$SOL_BALANCE" \
    --argjson tokenAccounts "$(echo "$TOKEN_RESPONSE" | jq '[.result.value[] | {
        address: .pubkey,
        mint: .account.data.parsed.info.mint,
        balance: .account.data.parsed.info.tokenAmount.uiAmountString,
        decimals: .account.data.parsed.info.tokenAmount.decimals,
        rawBalance: .account.data.parsed.info.tokenAmount.amount,
        program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    }]')" \
    --argjson token22Accounts "$(echo "$TOKEN22_RESPONSE" | jq '[.result.value[] | {
        address: .pubkey,
        mint: .account.data.parsed.info.mint,
        balance: .account.data.parsed.info.tokenAmount.uiAmountString,
        decimals: .account.data.parsed.info.tokenAmount.decimals,
        rawBalance: .account.data.parsed.info.tokenAmount.amount,
        program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
    }]')" \
    '{
        address: $address,
        sol: {
            lamports: ($solLamports | tonumber),
            balance: ($solBalance | tonumber)
        },
        tokens: ($tokenAccounts + $token22Accounts | map(select(.balance != "0" and .balance != null))),
        tokenCount: (($tokenAccounts + $token22Accounts) | map(select(.balance != "0" and .balance != null)) | length),
        totalAccounts: (($tokenAccounts + $token22Accounts) | length)
    }'

echo "$LOG_PREFIX SOL: $SOL_BALANCE, Token accounts: $(echo "$TOKEN_RESPONSE" | jq '.result.value | length' 2>/dev/null || echo 0)" >&2
