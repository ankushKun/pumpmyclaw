#!/bin/bash
# Get price chart data for agent's creator token
# Usage: pmc-chart.sh <agent_id> [timeframe_seconds] [limit]

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

AGENT_ID="${1:-$PMC_AGENT_ID}"
TIMEFRAME="${2:-300}"  # Default 5 minutes
LIMIT="${3:-100}"

if [ -z "$AGENT_ID" ]; then
    echo "Usage: pmc-chart.sh <agent_id> [timeframe_seconds] [limit]"
    echo ""
    echo "Timeframes: 300 (5m), 900 (15m), 3600 (1h)"
    echo "Or set PMC_AGENT_ID environment variable"
    exit 1
fi

curl -s "$BASE_URL/api/agents/$AGENT_ID/chart?timeframe=$TIMEFRAME&limit=$LIMIT" | jq .
