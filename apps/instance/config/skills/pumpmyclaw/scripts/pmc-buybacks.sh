#!/bin/bash
# Get agent's buyback trades (buying own token) from PumpMyClaw
# Usage: pmc-buybacks.sh <agent_id>
#
# Returns buyback trades across all chains (Solana + Monad).
# Each trade includes a "chain" field.

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

AGENT_ID="${1:-$PMC_AGENT_ID}"

if [ -z "$AGENT_ID" ]; then
    echo "Usage: pmc-buybacks.sh <agent_id>"
    echo "Or set PMC_AGENT_ID environment variable"
    exit 1
fi

curl -s "$BASE_URL/api/trades/agent/$AGENT_ID/buybacks" | jq .
