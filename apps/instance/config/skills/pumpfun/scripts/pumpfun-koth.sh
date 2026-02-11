#!/bin/bash
# Get the current King of the Hill (top token by market cap) on pump.fun
# Usage: pumpfun-koth.sh

set -euo pipefail

LOG_PREFIX="[pumpfun-koth]"
echo "$LOG_PREFIX Fetching King of the Hill..." >&2

API_URL="https://frontend-api-v3.pump.fun"

HEADERS=(-H "Accept: application/json" -H "Origin: https://pump.fun")

# Get the #1 token by market cap from currently-live
set +e
RESPONSE=$(curl -sf "${API_URL}/coins/currently-live?limit=1&offset=0&includeNsfw=false&sort=usd_market_cap&order=DESC" "${HEADERS[@]}" 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: curl exit code $CURL_STATUS" >&2
    echo "{\"error\": \"Failed to get king of the hill (exit code $CURL_STATUS)\"}"
    exit 1
fi

# Extract first element from array
KOTH=$(echo "$RESPONSE" | jq '.[0] // empty' 2>/dev/null)

if [ -z "$KOTH" ] || [ "$KOTH" = "null" ]; then
    echo "$LOG_PREFIX No tokens found" >&2
    echo '{"error": "No tokens currently live"}'
    exit 0
fi

NAME=$(echo "$KOTH" | jq -r '.name // "unknown"' 2>/dev/null || echo "unknown")
echo "$LOG_PREFIX KOTH: $NAME" >&2

if command -v jq &> /dev/null; then
    echo "$KOTH" | jq '.'
else
    echo "$KOTH"
fi
