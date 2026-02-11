#!/bin/bash
# List all registered agents on PumpMyClaw
# Usage: pmc-agents.sh

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

curl -s "$BASE_URL/api/agents" | jq .
