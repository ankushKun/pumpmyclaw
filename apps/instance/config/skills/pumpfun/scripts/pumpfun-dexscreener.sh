#!/bin/bash
# Get token data from DEXScreener API (alternative to pump.fun's auth-required endpoints)
# Usage: pumpfun-dexscreener.sh <mint_address> [mint2] [mint3] ...
#
# Single mint: returns one token object
# Multiple mints (up to 30): returns array of token objects
#
# DEXScreener provides:
# - Price data (native and USD)
# - Transaction counts (5m, 1h, 6h, 24h buys/sells)
# - Volume data
# - Liquidity info
# - Price change percentages
# - Token name, symbol, image
#
# No authentication required! Rate limit: 300 req/min.

set -euo pipefail

LOG_PREFIX="[dexscreener]"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing mint address" >&2
    echo '{"error": "Usage: pumpfun-dexscreener.sh <mint_address> [mint2] [mint3] ..."}'
    exit 1
fi

# Join all arguments as comma-separated mints
MINTS=$(IFS=,; echo "$*")
MINT_COUNT=$#
echo "$LOG_PREFIX Fetching DEXScreener data for $MINT_COUNT token(s)" >&2

# Use the batch tokens endpoint (supports up to 30 comma-separated addresses)
API_URL="https://api.dexscreener.com/tokens/v1/solana/${MINTS}"

set +e
RESPONSE=$(curl -sf "$API_URL" --max-time 15 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: curl exit code $CURL_STATUS" >&2
    echo "{\"error\": \"Failed to fetch DEXScreener data (exit code $CURL_STATUS)\"}"
    exit 1
fi

# The /tokens/v1/ endpoint returns a flat array of Pair objects
PAIRS_COUNT=$(echo "$RESPONSE" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)
if [ "$PAIRS_COUNT" = "0" ] || [ "$PAIRS_COUNT" = "null" ]; then
    echo "$LOG_PREFIX WARNING: No pairs found on DEXScreener" >&2
    if [ $MINT_COUNT -eq 1 ]; then
        echo "{\"error\": \"Token not found on DEXScreener\", \"mint\": \"$1\"}"
    else
        echo "[]"
    fi
    exit 0
fi

echo "$LOG_PREFIX Found $PAIRS_COUNT pair(s)" >&2

# For each unique base token, pick the best pair (prefer pumpfun dex, then highest liquidity)
# Then format the output
RESULT=$(echo "$RESPONSE" | jq '
  # Group by base token address
  group_by(.baseToken.address) |
  map(
    # For each group, prefer pumpfun pair, then highest liquidity
    sort_by(
      if .dexId == "pumpfun" then 0 else 1 end,
      -(.liquidity.usd // 0)
    ) | .[0]
  ) |
  map({
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
    imageUrl: (.info.imageUrl // null),
    pairCreatedAt: .pairCreatedAt,
    url: .url
  })
')

# If single mint, return object; if multiple, return array
if [ $MINT_COUNT -eq 1 ]; then
    echo "$RESULT" | jq '.[0] // {error: "Token not found"}'
else
    echo "$RESULT"
fi
