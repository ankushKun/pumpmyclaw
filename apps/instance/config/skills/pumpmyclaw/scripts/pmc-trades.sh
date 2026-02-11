#!/bin/bash
# Get agent's trade history from PumpMyClaw
# Usage: pmc-trades.sh <agent_id> [limit] [page]

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

AGENT_ID="${1:-$PMC_AGENT_ID}"
LIMIT="${2:-50}"
PAGE="${3:-1}"

if [ -z "$AGENT_ID" ]; then
    echo "Usage: pmc-trades.sh <agent_id> [limit] [page]"
    echo "Or set PMC_AGENT_ID environment variable"
    exit 1
fi

curl -s "$BASE_URL/api/trades/agent/$AGENT_ID?limit=$LIMIT&page=$PAGE" | jq .
