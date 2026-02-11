#!/bin/bash
# Get OHLCV candlestick data from GeckoTerminal API (FREE, no auth!)
# Usage: pumpfun-candles.sh <mint_address> [timeframe] [limit]
#
# Timeframes:
#   1m, 5m, 15m, 1h, 4h, 1d
#
# Returns array of candles: [timestamp, open, high, low, close, volume]

set -euo pipefail

LOG_PREFIX="[pumpfun-candles]"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing mint address" >&2
    echo '{"error": "Usage: pumpfun-candles.sh <mint_address> [timeframe] [limit]"}'
    exit 1
fi

MINT="$1"
TIMEFRAME="${2:-5m}"
LIMIT="${3:-100}"

# Parse timeframe into GeckoTerminal format
# GeckoTerminal uses: minute (with aggregate), hour, day
case "$TIMEFRAME" in
    1m|1min)
        ENDPOINT="minute"
        AGGREGATE="1"
        ;;
    5m|5min)
        ENDPOINT="minute"
        AGGREGATE="5"
        ;;
    15m|15min)
        ENDPOINT="minute"
        AGGREGATE="15"
        ;;
    1h|1hr|hour)
        ENDPOINT="hour"
        AGGREGATE="1"
        ;;
    4h|4hr)
        ENDPOINT="hour"
        AGGREGATE="4"
        ;;
    1d|day)
        ENDPOINT="day"
        AGGREGATE="1"
        ;;
    *)
        echo "$LOG_PREFIX WARNING: Unknown timeframe '$TIMEFRAME', using 5m" >&2
        ENDPOINT="minute"
        AGGREGATE="5"
        ;;
esac

echo "$LOG_PREFIX Fetching $LIMIT candles ($TIMEFRAME) for $MINT" >&2

# First, we need to find the pool address from DEXScreener
POOL_ADDRESS=""

# Try to get pool from DEXScreener
DEX_RESPONSE=$(curl -sf "https://api.dexscreener.com/latest/dex/tokens/${MINT}" --max-time 10 2>&1 || echo "")
if [ -n "$DEX_RESPONSE" ]; then
    # Get pump.fun pool preferentially
    POOL_ADDRESS=$(echo "$DEX_RESPONSE" | jq -r '.pairs | map(select(.dexId == "pumpfun")) | .[0].pairAddress // .pairs[0].pairAddress // empty' 2>/dev/null || echo "")
fi

if [ -z "$POOL_ADDRESS" ] || [ "$POOL_ADDRESS" = "null" ]; then
    echo "$LOG_PREFIX ERROR: Could not find pool address for token" >&2
    echo '{"error": "Token not found on DEXScreener - cannot get pool address for candles"}'
    exit 1
fi

echo "$LOG_PREFIX Found pool: $POOL_ADDRESS" >&2

# Fetch candles from GeckoTerminal
API_URL="https://api.geckoterminal.com/api/v2/networks/solana/pools/${POOL_ADDRESS}/ohlcv/${ENDPOINT}?aggregate=${AGGREGATE}&limit=${LIMIT}"

set +e
RESPONSE=$(curl -sf "$API_URL" -H "Accept: application/json" --max-time 15 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: curl exit code $CURL_STATUS" >&2
    echo "{\"error\": \"Failed to fetch candles (exit code $CURL_STATUS)\"}"
    exit 1
fi

# Check for errors in response
if echo "$RESPONSE" | jq -e '.errors' > /dev/null 2>&1; then
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.errors[0].title // "Unknown error"')
    echo "$LOG_PREFIX ERROR: GeckoTerminal API error: $ERROR_MSG" >&2
    echo "{\"error\": \"$ERROR_MSG\"}"
    exit 1
fi

# Extract and format candles
CANDLES=$(echo "$RESPONSE" | jq -r '.data.attributes.ohlcv_list // []')
CANDLE_COUNT=$(echo "$CANDLES" | jq 'length')

if [ "$CANDLE_COUNT" = "0" ] || [ "$CANDLE_COUNT" = "null" ]; then
    echo "$LOG_PREFIX WARNING: No candles returned" >&2
    echo '{"error": "No candle data available", "pool": "'$POOL_ADDRESS'"}'
    exit 0
fi

echo "$LOG_PREFIX Got $CANDLE_COUNT candles" >&2

# Output formatted candles with metadata
echo "$RESPONSE" | jq '{
    pool: "'$POOL_ADDRESS'",
    mint: "'$MINT'",
    timeframe: "'$TIMEFRAME'",
    count: (.data.attributes.ohlcv_list | length),
    candles: [.data.attributes.ohlcv_list[] | {
        timestamp: .[0],
        time: (.[0] | todate),
        open: .[1],
        high: .[2],
        low: .[3],
        close: .[4],
        volume: .[5]
    }]
}'
