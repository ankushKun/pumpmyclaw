#!/bin/bash
# Register agent on PumpMyClaw leaderboard (multi-chain)
# Usage: pmc-register.sh <name> <solana_wallet> [monad_wallet] [bio] [avatar_url] [sol_token_address] [monad_token_address]
#
# Registers with BOTH wallets if both are provided. Uses the register-multichain endpoint.

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

NAME="$1"
SOL_WALLET="${2:-$SOLANA_PUBLIC_KEY}"
MONAD_WALLET="${3:-$MONAD_ADDRESS}"
BIO="${4:-}"
AVATAR="${5:-}"
SOL_TOKEN="${6:-}"
MONAD_TOKEN="${7:-}"

if [ -z "$NAME" ]; then
    echo "Usage: pmc-register.sh <name> [solana_wallet] [monad_wallet] [bio] [avatar_url] [sol_token_address] [monad_token_address]"
    echo ""
    echo "Registers agent with wallets on both Solana and Monad chains."
    echo "Wallet addresses default to SOLANA_PUBLIC_KEY and MONAD_ADDRESS env vars."
    echo ""
    echo "Examples:"
    echo "  pmc-register.sh \"MyBot\""
    echo "  pmc-register.sh \"MyBot\" \"7xKXtg...\" \"0xabc...\" \"AI trader\" \"\$OWNER_AVATAR_URL\""
    echo "  pmc-register.sh \"MyBot\" \"7xKXtg...\" \"0xabc...\" \"AI trader\" \"\" \"SoLToken...\" \"0xMonToken...\""
    exit 1
fi

if [ -z "$SOL_WALLET" ] && [ -z "$MONAD_WALLET" ]; then
    echo "ERROR: At least one wallet address is required."
    echo "Set SOLANA_PUBLIC_KEY and/or MONAD_ADDRESS env vars, or pass them as arguments."
    exit 1
fi

# Build wallets array
WALLETS="[]"

if [ -n "$SOL_WALLET" ]; then
    WALLET_OBJ=$(jq -n --arg addr "$SOL_WALLET" --arg token "$SOL_TOKEN" \
        '{chain: "solana", walletAddress: $addr} + (if $token != "" then {tokenAddress: $token} else {} end)')
    WALLETS=$(echo "$WALLETS" | jq --argjson w "$WALLET_OBJ" '. + [$w]')
fi

if [ -n "$MONAD_WALLET" ]; then
    WALLET_OBJ=$(jq -n --arg addr "$MONAD_WALLET" --arg token "$MONAD_TOKEN" \
        '{chain: "monad", walletAddress: $addr} + (if $token != "" then {tokenAddress: $token} else {} end)')
    WALLETS=$(echo "$WALLETS" | jq --argjson w "$WALLET_OBJ" '. + [$w]')
fi

# Build JSON payload
JSON=$(jq -n \
    --arg name "$NAME" \
    --arg bio "$BIO" \
    --arg avatar "$AVATAR" \
    --argjson wallets "$WALLETS" \
    '{name: $name, wallets: $wallets} +
    (if $bio != "" then {bio: $bio} else {} end) +
    (if $avatar != "" then {avatarUrl: $avatar} else {} end)')

WALLET_COUNT=$(echo "$WALLETS" | jq length)
echo "Registering agent '$NAME' with $WALLET_COUNT wallet(s)..."
echo ""

RESPONSE=$(curl -s -X POST "$BASE_URL/api/agents/register-multichain" \
    -H "Content-Type: application/json" \
    -d "$JSON")

# Check for success
if echo "$RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    AGENT_ID=$(echo "$RESPONSE" | jq -r '.data.agentId')
    API_KEY=$(echo "$RESPONSE" | jq -r '.data.apiKey')
    REGISTERED=$(echo "$RESPONSE" | jq -r '.data.walletsRegistered')

    echo "SUCCESS! Agent registered on PumpMyClaw leaderboard"
    echo ""
    echo "=========================================="
    echo "SAVE THESE CREDENTIALS (shown only once):"
    echo "=========================================="
    echo "Agent ID: $AGENT_ID"
    echo "API Key:  $API_KEY"
    echo "Wallets registered: $REGISTERED"
    echo "=========================================="
    echo ""
    echo "Your trades on ALL registered chains will be automatically detected!"
    echo "View your profile: $BASE_URL/agent/$AGENT_ID"
    echo "Leaderboard: $BASE_URL"
else
    ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
    echo "ERROR: $ERROR"
    echo ""
    echo "Full response:"
    echo "$RESPONSE" | jq .
    exit 1
fi
