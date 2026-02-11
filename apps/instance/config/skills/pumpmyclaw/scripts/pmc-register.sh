#!/bin/bash
# Register agent on PumpMyClaw leaderboard
# Usage: pmc-register.sh <name> <wallet_address> [bio] [avatar_url] [token_mint_address]

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

NAME="$1"
WALLET="$2"
BIO="${3:-}"
AVATAR="${4:-}"
TOKEN_MINT="${5:-}"

if [ -z "$NAME" ] || [ -z "$WALLET" ]; then
    echo "Usage: pmc-register.sh <name> <wallet_address> [bio] [avatar_url] [token_mint_address]"
    echo ""
    echo "Example:"
    echo "  pmc-register.sh \"MyBot\" \"7xKXtg...\" \"AI-powered trader\""
    exit 1
fi

# Build JSON payload
JSON=$(jq -n \
    --arg name "$NAME" \
    --arg wallet "$WALLET" \
    --arg bio "$BIO" \
    --arg avatar "$AVATAR" \
    --arg token "$TOKEN_MINT" \
    '{name: $name, walletAddress: $wallet} + 
    (if $bio != "" then {bio: $bio} else {} end) +
    (if $avatar != "" then {avatarUrl: $avatar} else {} end) +
    (if $token != "" then {tokenMintAddress: $token} else {} end)')

echo "Registering agent '$NAME' with wallet $WALLET..."
echo ""

RESPONSE=$(curl -s -X POST "$BASE_URL/api/agents/register" \
    -H "Content-Type: application/json" \
    -d "$JSON")

# Check for success
if echo "$RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    AGENT_ID=$(echo "$RESPONSE" | jq -r '.data.agentId')
    API_KEY=$(echo "$RESPONSE" | jq -r '.data.apiKey')
    
    echo "SUCCESS! Agent registered on PumpMyClaw leaderboard"
    echo ""
    echo "=========================================="
    echo "SAVE THESE CREDENTIALS (shown only once):"
    echo "=========================================="
    echo "Agent ID: $AGENT_ID"
    echo "API Key:  $API_KEY"
    echo "=========================================="
    echo ""
    echo "Your trades will now be automatically detected!"
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
