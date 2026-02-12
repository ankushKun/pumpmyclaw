#!/bin/bash
# Get trade/market data for a pump.fun token
# Usage: pumpfun-trades.sh <mint_address>
#
# Note: The historical trades endpoint was removed from the pump.fun API.
# This now returns the token's current market data including reserves and last trade time.

set -euo pipefail

LOG_PREFIX="[pumpfun-trades]"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing mint address" >&2
    echo '{"error": "Usage: pumpfun-trades.sh <mint_address>"}'
    exit 1
fi

MINT="$1"
echo "$LOG_PREFIX Fetching market data for $MINT" >&2
API_URL="https://frontend-api-v3.pump.fun"

HEADERS=(-H "Accept: application/json" -H "Origin: https://pump.fun")

set +e
RESPONSE=$(curl -sf --max-time 10 "${API_URL}/coins/${MINT}?sync=true" "${HEADERS[@]}" 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: curl exit code $CURL_STATUS" >&2
    echo "{\"error\": \"Failed to get token data (exit code $CURL_STATUS)\"}"
    exit 1
fi

NAME=$(echo "$RESPONSE" | jq -r '.name // "unknown"' 2>/dev/null || echo "unknown")
echo "$LOG_PREFIX Got market data for: $NAME" >&2

# Extract the most relevant trading info
if command -v jq &> /dev/null; then
    echo "$RESPONSE" | jq '{
        name, symbol, mint,
        usd_market_cap,
        virtual_sol_reserves,
        virtual_token_reserves,
        real_sol_reserves,
        real_token_reserves,
        total_supply,
        complete,
        last_trade_timestamp,
        reply_count,
        is_currently_live
    }'
else
    echo "$RESPONSE"
fi
