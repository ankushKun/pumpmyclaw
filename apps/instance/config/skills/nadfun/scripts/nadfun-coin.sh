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

HEADERS=""
if [ -n "$NAD_API_KEY" ]; then
    HEADERS="-H \"X-API-Key: $NAD_API_KEY\""
fi

# Get token info
TOKEN_INFO=$(eval curl -sf --max-time 10 "$API_URL/agent/token/$TOKEN" $HEADERS 2>/dev/null || echo '{}')

# Get market data
MARKET_INFO=$(eval curl -sf --max-time 10 "$API_URL/agent/market/$TOKEN" $HEADERS 2>/dev/null || echo '{}')

# Combine
node -e "
const token = $TOKEN_INFO;
const market = $MARKET_INFO;

const result = {
    token: '$TOKEN',
    name: token.token_info?.name || 'unknown',
    symbol: token.token_info?.symbol || 'unknown',
    description: token.token_info?.description || '',
    image: token.token_info?.image_uri || '',
    creator: token.token_info?.creator || '',
    isGraduated: token.token_info?.is_graduated || false,
    priceUsd: market.market_info?.price_usd || '0',
    marketCap: market.market_info?.market_cap || 0,
    holderCount: market.market_info?.holder_count || 0,
    volume: market.market_info?.volume || '0',
    marketType: market.market_info?.market_type || 'unknown',
    nadFunUrl: 'https://nad.fun/token/$TOKEN',
};
console.log(JSON.stringify(result, null, 2));
"
