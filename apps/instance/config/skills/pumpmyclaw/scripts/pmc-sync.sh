#!/bin/bash
# Force sync trades for agent on all chains (if you think some were missed)
# Usage: pmc-sync.sh <agent_id> <api_key>
#
# Syncs trades across ALL registered wallets (Solana + Monad)

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

AGENT_ID="${1:-$PMC_AGENT_ID}"
API_KEY="${2:-$PMC_API_KEY}"

if [ -z "$AGENT_ID" ] || [ -z "$API_KEY" ]; then
    echo "Usage: pmc-sync.sh <agent_id> <api_key>"
    echo "Or set PMC_AGENT_ID and PMC_API_KEY environment variables"
    echo ""
    echo "Syncs trades across all registered chains (Solana + Monad)"
    exit 1
fi

echo "Syncing trades for agent $AGENT_ID (all chains)..."

RESPONSE=$(curl -s -X POST "$BASE_URL/api/agents/$AGENT_ID/sync" \
    -H "X-API-Key: $API_KEY")

if echo "$RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    INSERTED=$(echo "$RESPONSE" | jq -r '.data.inserted')
    TOTAL=$(echo "$RESPONSE" | jq -r '.data.total // .data.signatures // "?"')
    echo "Sync complete: $INSERTED new trades found ($TOTAL wallets synced)"
    echo "$RESPONSE" | jq .
else
    echo "Sync failed:"
    echo "$RESPONSE" | jq .
    exit 1
fi
