#!/bin/bash
# Get trending tokens on pump.fun (sorted by market cap)
# Usage: pumpfun-trending.sh [limit]

set -euo pipefail

LOG_PREFIX="[pumpfun-trending]"

LIMIT="${1:-20}"
echo "$LOG_PREFIX Fetching top $LIMIT tokens by market cap..." >&2
API_URL="https://frontend-api-v3.pump.fun"

HEADERS=(-H "Accept: application/json" -H "Origin: https://pump.fun")

set +e
RESPONSE=$(curl -sf --max-time 10 "${API_URL}/coins/currently-live?limit=${LIMIT}&offset=0&includeNsfw=false&sort=usd_market_cap&order=DESC" "${HEADERS[@]}" 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: curl exit code $CURL_STATUS" >&2
    echo "{\"error\": \"Failed to get trending coins (exit code $CURL_STATUS)\"}"
    exit 1
fi

COUNT=$(echo "$RESPONSE" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)
echo "$LOG_PREFIX Got $COUNT trending coins" >&2

if command -v jq &> /dev/null; then
    echo "$RESPONSE" | jq '.'
else
    echo "$RESPONSE"
fi
