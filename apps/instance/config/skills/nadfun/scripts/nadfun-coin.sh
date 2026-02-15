#!/bin/bash
# Get token information from nad.fun API
# Usage: nadfun-coin.sh <token_address>
set -e

TOKEN="${1:-}"
if [ "$MONAD_TESTNET" = "true" ]; then
    API_URL="${NAD_API_URL:-https://dev-api.nad.fun}"
else
    API_URL="${NAD_API_URL:-https://api.nadapp.net}"
fi

if [ -z "$TOKEN" ]; then
    echo '{"error": "Usage: nadfun-coin.sh <token_address>"}'
    exit 1
fi

# Build curl args array
CURL_ARGS=(-sf --max-time 10)
if [ -n "$NAD_API_KEY" ]; then
    CURL_ARGS+=(-H "X-API-Key: $NAD_API_KEY")
fi

# Get token info
TOKEN_INFO=$(curl "${CURL_ARGS[@]}" "$API_URL/agent/token/$TOKEN" 2>/dev/null || echo '{}')

# Get market data
MARKET_INFO=$(curl "${CURL_ARGS[@]}" "$API_URL/agent/market/$TOKEN" 2>/dev/null || echo '{}')

# Combine — pass data via env vars to avoid shell injection
TOKEN_DATA="$TOKEN_INFO" MARKET_DATA="$MARKET_INFO" TOKEN_ADDR="$TOKEN" node -e '
const token = JSON.parse(process.env.TOKEN_DATA || "{}");
const market = JSON.parse(process.env.MARKET_DATA || "{}");
const addr = process.env.TOKEN_ADDR;

const result = {
    token: addr,
    name: token.token_info?.name || "unknown",
    symbol: token.token_info?.symbol || "unknown",
    description: token.token_info?.description || "",
    image: token.token_info?.image_uri || "",
    creator: token.token_info?.creator || "",
    isGraduated: token.token_info?.is_graduated || false,
    priceUsd: market.market_info?.price_usd || "0",
    marketCap: market.market_info?.market_cap || 0,
    holderCount: market.market_info?.holder_count || 0,
    volume: market.market_info?.volume || "0",
    marketType: market.market_info?.market_type || "unknown",
    nadFunUrl: "https://nad.fun/token/" + addr,
};
console.log(JSON.stringify(result, null, 2));
'
