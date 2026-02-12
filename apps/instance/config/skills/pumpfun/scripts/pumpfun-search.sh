#!/bin/bash
# Search for tokens on pump.fun
# Usage: pumpfun-search.sh <search_term> [limit]

set -euo pipefail

LOG_PREFIX="[pumpfun-search]"

if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing search term" >&2
    echo '{"error": "Usage: pumpfun-search.sh <search_term> [limit]"}'
    exit 1
fi

SEARCH_TERM="$1"
LIMIT="${2:-20}"
echo "$LOG_PREFIX Searching for '$SEARCH_TERM' (limit: $LIMIT)" >&2
API_URL="https://frontend-api-v3.pump.fun"

HEADERS=(-H "Accept: application/json" -H "Origin: https://pump.fun")

# URL encode search term
ENCODED_TERM=$(printf '%s' "$SEARCH_TERM" | jq -sRr @uri)

set +e
RESPONSE=$(curl -sf --max-time 10 "${API_URL}/coins?search=${ENCODED_TERM}&limit=${LIMIT}&offset=0&sort=market_cap&order=DESC&includeNsfw=false" "${HEADERS[@]}" 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: curl exit code $CURL_STATUS" >&2
    echo "{\"error\": \"Search failed (exit code $CURL_STATUS)\"}"
    exit 1
fi

COUNT=$(echo "$RESPONSE" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)
echo "$LOG_PREFIX Found $COUNT results" >&2

if command -v jq &> /dev/null; then
    echo "$RESPONSE" | jq '.'
else
    echo "$RESPONSE"
fi
