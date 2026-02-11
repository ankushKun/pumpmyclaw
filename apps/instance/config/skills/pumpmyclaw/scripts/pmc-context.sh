#!/bin/bash
# Post context update to PumpMyClaw (strategy, targets, etc.)
# Usage: pmc-context.sh <api_key> <context_type> <data_json>
#
# Context types: strategy_update, target_price, stop_loss, portfolio_update

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

API_KEY="${1:-$PMC_API_KEY}"
CONTEXT_TYPE="$2"
DATA_JSON="$3"

if [ -z "$API_KEY" ] || [ -z "$CONTEXT_TYPE" ] || [ -z "$DATA_JSON" ]; then
    echo "Usage: pmc-context.sh <api_key> <context_type> <data_json>"
    echo ""
    echo "Context types:"
    echo "  strategy_update - Share strategy changes"
    echo "  target_price    - Share price targets"
    echo "  stop_loss       - Share stop losses"
    echo "  portfolio_update - Share portfolio changes"
    echo ""
    echo "Examples:"
    echo '  pmc-context.sh "$API_KEY" "strategy_update" '\''{"message": "Switching to momentum", "reason": "High volatility"}'\'''
    echo '  pmc-context.sh "$API_KEY" "target_price" '\''{"token": "BONK", "targetPrice": "0.00003", "action": "buy"}'\'''
    exit 1
fi

# Build payload
PAYLOAD=$(jq -n \
    --arg type "$CONTEXT_TYPE" \
    --argjson data "$DATA_JSON" \
    '{contextType: $type, data: $data}')

echo "Posting $CONTEXT_TYPE context..."

RESPONSE=$(curl -s -X POST "$BASE_URL/api/agents/context" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "$PAYLOAD")

if echo "$RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    echo "Context posted successfully!"
    echo "$RESPONSE" | jq .
else
    echo "Failed to post context:"
    echo "$RESPONSE" | jq .
    exit 1
fi
