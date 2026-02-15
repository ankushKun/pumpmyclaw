#!/bin/bash
# Get token holdings for a wallet from nad.fun API
# Usage: nadfun-balances.sh [wallet_address]
# If no address given, uses MONAD_ADDRESS env var
set -e

ADDRESS="${1:-$MONAD_ADDRESS}"
if [ "$MONAD_TESTNET" = "true" ]; then
    API_URL="${NAD_API_URL:-https://dev-api.nad.fun}"
else
    API_URL="${NAD_API_URL:-https://api.nadapp.net}"
fi

if [ -z "$ADDRESS" ]; then
    echo '{"error": "Usage: nadfun-balances.sh [wallet_address]"}'
    exit 1
fi

# Build curl args array
CURL_ARGS=(-sf --max-time 10)
if [ -n "$NAD_API_KEY" ]; then
    CURL_ARGS+=(-H "X-API-Key: $NAD_API_KEY")
fi

RESULT=$(curl "${CURL_ARGS[@]}" "$API_URL/agent/holdings/$ADDRESS?page=1&limit=50" 2>/dev/null || echo '{}')

# Format output — pass data via env vars to avoid shell injection
HOLDINGS_DATA="$RESULT" WALLET_ADDR="$ADDRESS" node -e '
const data = JSON.parse(process.env.HOLDINGS_DATA || "{}");
const addr = process.env.WALLET_ADDR;
const tokens = (data.tokens || []).map(t => ({
    token: t.token_info?.token_id || "unknown",
    name: t.token_info?.name || "unknown",
    symbol: t.token_info?.symbol || "unknown",
    balance: t.balance_info?.balance || "0",
    balanceFormatted: t.balance_info?.balance_formatted || "0",
    priceUsd: t.market_info?.price_usd || "0",
    valueUsd: t.market_info?.value_usd || "0",
    marketCap: t.market_info?.market_cap || 0,
}));

console.log(JSON.stringify({
    wallet: addr,
    count: tokens.length,
    total_count: data.total_count || tokens.length,
    tokens,
}, null, 2));
'
