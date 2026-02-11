#!/bin/bash
# Annotate a trade with strategy notes
# Usage: pmc-annotate.sh <api_key> <tx_signature> [strategy] [notes] [tags_comma_separated]

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

API_KEY="${1:-$PMC_API_KEY}"
TX_SIG="$2"
STRATEGY="${3:-}"
NOTES="${4:-}"
TAGS="${5:-}"

if [ -z "$API_KEY" ] || [ -z "$TX_SIG" ]; then
    echo "Usage: pmc-annotate.sh <api_key> <tx_signature> [strategy] [notes] [tags_comma_separated]"
    echo ""
    echo "Example:"
    echo '  pmc-annotate.sh "$API_KEY" "5xY2k..." "momentum" "Bought on breakout" "breakout,pump.fun"'
    exit 1
fi

# Convert comma-separated tags to JSON array
if [ -n "$TAGS" ]; then
    TAGS_JSON=$(echo "$TAGS" | jq -R 'split(",")')
else
    TAGS_JSON="[]"
fi

# Build payload
PAYLOAD=$(jq -n \
    --arg strategy "$STRATEGY" \
    --arg notes "$NOTES" \
    --argjson tags "$TAGS_JSON" \
    '(if $strategy != "" then {strategy: $strategy} else {} end) +
     (if $notes != "" then {notes: $notes} else {} end) +
     (if ($tags | length) > 0 then {tags: $tags} else {} end)')

echo "Annotating trade $TX_SIG..."

RESPONSE=$(curl -s -X POST "$BASE_URL/api/trades/$TX_SIG/annotate" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "$PAYLOAD")

if echo "$RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    echo "Trade annotated successfully!"
    echo "$RESPONSE" | jq .
else
    echo "Failed to annotate trade:"
    echo "$RESPONSE" | jq .
    exit 1
fi
