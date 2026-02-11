#!/bin/bash
# Get detailed information about a pump.fun token
# Usage: pumpfun-coin.sh <mint_address>

set -euo pipefail

LOG_PREFIX="[pumpfun-coin]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Check arguments
if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing mint address argument" >&2
    echo '{"error": "Usage: pumpfun-coin.sh <mint_address>"}' >&2
    exit 1
fi

MINT="$1"
echo "$LOG_PREFIX Fetching coin info for $MINT" >&2
API_URL="https://frontend-api-v3.pump.fun"

# Build headers
HEADERS=(-H "Accept: application/json" -H "Origin: https://pump.fun")

# Get coin info
set +e
RESPONSE=$(curl -sf "${API_URL}/coins/${MINT}?sync=true" "${HEADERS[@]}" 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: curl exit code $CURL_STATUS" >&2
    echo "{\"error\": \"Failed to get coin info (exit code $CURL_STATUS)\"}" >&2
    exit 1
fi

NAME=$(echo "$RESPONSE" | jq -r '.name // "unknown"' 2>/dev/null || echo "unknown")
echo "$LOG_PREFIX Got: $NAME ($MINT)" >&2

# Pretty print if jq available
if command -v jq &> /dev/null; then
    echo "$RESPONSE" | jq '.'
else
    echo "$RESPONSE"
fi
