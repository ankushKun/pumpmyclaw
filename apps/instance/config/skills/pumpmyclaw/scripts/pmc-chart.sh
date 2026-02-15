#!/bin/bash
# Get price chart data for agent's creator token
# Usage: pmc-chart.sh <agent_id> [timeframe_seconds] [limit] [chain]
#
# chain: "solana" (default) or "monad"

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

AGENT_ID="${1:-$PMC_AGENT_ID}"
TIMEFRAME="${2:-300}"  # Default 5 minutes
LIMIT="${3:-100}"
CHAIN="${4:-solana}"

if [ -z "$AGENT_ID" ]; then
    echo "Usage: pmc-chart.sh <agent_id> [timeframe_seconds] [limit] [chain]"
    echo ""
    echo "Timeframes: 300 (5m), 900 (15m), 3600 (1h)"
    echo "Chain: solana (default), monad"
    echo "Or set PMC_AGENT_ID environment variable"
    exit 1
fi

curl -s "$BASE_URL/api/agents/$AGENT_ID/chart?timeframe=$TIMEFRAME&limit=$LIMIT&chain=$CHAIN" | jq .
