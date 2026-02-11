#!/bin/bash
# Get token data from DEXScreener API (alternative to pump.fun's auth-required endpoints)
# Usage: pumpfun-dexscreener.sh <mint_address>
#
# DEXScreener provides:
# - Price data (native and USD)
# - Transaction counts (5m, 1h, 6h, 24h buys/sells)
# - Volume data
# - Liquidity info
# - Price change percentages
#
# No authentication required!

set -euo pipefail

LOG_PREFIX="[dexscreener]"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing mint address" >&2
    echo '{"error": "Usage: pumpfun-dexscreener.sh <mint_address>"}'
    exit 1
fi

MINT="$1"
echo "$LOG_PREFIX Fetching DEXScreener data for $MINT" >&2

API_URL="https://api.dexscreener.com/latest/dex/tokens/${MINT}"

set +e
RESPONSE=$(curl -sf "$API_URL" --max-time 15 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: curl exit code $CURL_STATUS" >&2
    echo "{\"error\": \"Failed to fetch DEXScreener data (exit code $CURL_STATUS)\"}"
    exit 1
fi

# Check if we got valid data
PAIRS_COUNT=$(echo "$RESPONSE" | jq '.pairs | length' 2>/dev/null || echo 0)
if [ "$PAIRS_COUNT" = "0" ] || [ "$PAIRS_COUNT" = "null" ]; then
    echo "$LOG_PREFIX WARNING: No pairs found on DEXScreener" >&2
    echo '{"error": "Token not found on DEXScreener", "mint": "'$MINT'"}'
    exit 0
fi

echo "$LOG_PREFIX Found $PAIRS_COUNT pair(s)" >&2

# Get the pump.fun pair (or first pair if multiple)
PUMPFUN_PAIR=$(echo "$RESPONSE" | jq '.pairs | map(select(.dexId == "pumpfun")) | .[0]')
if [ "$PUMPFUN_PAIR" = "null" ]; then
    # Fallback to first pair if no pumpfun pair
    PUMPFUN_PAIR=$(echo "$RESPONSE" | jq '.pairs[0]')
fi

# Extract relevant data
echo "$PUMPFUN_PAIR" | jq '{
    dex: .dexId,
    name: .baseToken.name,
    symbol: .baseToken.symbol,
    mint: .baseToken.address,
    priceUsd: (.priceUsd | tonumber? // 0),
    priceNative: (.priceNative | tonumber? // 0),
    priceChange: {
        m5: (.priceChange.m5 // 0),
        h1: (.priceChange.h1 // 0),
        h6: (.priceChange.h6 // 0),
        h24: (.priceChange.h24 // 0)
    },
    txns: {
        m5: .txns.m5,
        h1: .txns.h1,
        h6: .txns.h6,
        h24: .txns.h24
    },
    volume: {
        h24: (.volume.h24 // 0),
        h6: (.volume.h6 // 0),
        h1: (.volume.h1 // 0),
        m5: (.volume.m5 // 0)
    },
    liquidity: {
        usd: (.liquidity.usd // 0),
        base: (.liquidity.base // 0),
        quote: (.liquidity.quote // 0)
    },
    fdv: (.fdv // 0),
    marketCap: (.marketCap // 0),
    pairCreatedAt: .pairCreatedAt,
    url: .url
}'
