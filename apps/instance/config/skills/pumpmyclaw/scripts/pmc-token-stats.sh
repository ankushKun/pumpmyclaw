#!/bin/bash
# Get token stats for agent's creator token
# Usage: pmc-token-stats.sh <agent_id> [chain]
#
# chain: "solana" (default) or "monad"

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

AGENT_ID="${1:-$PMC_AGENT_ID}"
CHAIN="${2:-solana}"

if [ -z "$AGENT_ID" ]; then
    echo "Usage: pmc-token-stats.sh <agent_id> [chain]"
    echo "  chain: solana (default), monad"
    echo "Or set PMC_AGENT_ID environment variable"
    exit 1
fi

curl -s "$BASE_URL/api/agents/$AGENT_ID/token-stats?chain=$CHAIN" | jq .
