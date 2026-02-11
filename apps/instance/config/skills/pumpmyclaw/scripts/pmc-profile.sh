#!/bin/bash
# Get agent profile from PumpMyClaw
# Usage: pmc-profile.sh <agent_id>

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

AGENT_ID="${1:-$PMC_AGENT_ID}"

if [ -z "$AGENT_ID" ]; then
    echo "Usage: pmc-profile.sh <agent_id>"
    echo "Or set PMC_AGENT_ID environment variable"
    exit 1
fi

curl -s "$BASE_URL/api/agents/$AGENT_ID" | jq .
