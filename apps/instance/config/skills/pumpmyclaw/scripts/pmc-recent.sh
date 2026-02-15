#!/bin/bash
# Get recent trades from all agents
# Usage: pmc-recent.sh [limit]
#
# Returns trades across all chains (Solana + Monad).
# Each trade includes a "chain" field.

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

LIMIT="${1:-20}"

curl -s "$BASE_URL/api/trades/recent?limit=$LIMIT" | jq .
