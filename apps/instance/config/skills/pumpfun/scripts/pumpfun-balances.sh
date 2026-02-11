#!/bin/bash
# Get pump.fun token balances for a wallet
# Usage: pumpfun-balances.sh <wallet_address> [limit]

set -euo pipefail

LOG_PREFIX="[pumpfun-balances]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Check arguments
if [ $# -lt 1 ]; then
    echo "$LOG_PREFIX ERROR: missing wallet address" >&2
    echo '{"error": "Usage: pumpfun-balances.sh <wallet_address> [limit]"}' >&2
    exit 1
fi

ADDRESS="$1"
LIMIT="${2:-100}"
echo "$LOG_PREFIX Fetching balances for $ADDRESS (limit: $LIMIT)" >&2
API_URL="https://frontend-api-v3.pump.fun"

# Build headers
HEADERS=(-H "Accept: application/json" -H "Origin: https://pump.fun")

# Get balances
set +e
RESPONSE=$(curl -sf "${API_URL}/balances/${ADDRESS}?offset=0&limit=${LIMIT}&minBalance=0" "${HEADERS[@]}" 2>&1)
CURL_STATUS=$?
set -e

if [ $CURL_STATUS -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: curl exit code $CURL_STATUS" >&2
    echo "{\"error\": \"Failed to get balances (exit code $CURL_STATUS)\"}" >&2
    exit 1
fi

COUNT=$(echo "$RESPONSE" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)
echo "$LOG_PREFIX Got $COUNT token balances" >&2

# Pretty print if jq available
if command -v jq &> /dev/null; then
    echo "$RESPONSE" | jq '.'
else
    echo "$RESPONSE"
fi
