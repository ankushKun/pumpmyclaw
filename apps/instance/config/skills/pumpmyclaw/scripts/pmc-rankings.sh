#!/bin/bash
# Get PumpMyClaw leaderboard rankings
# Usage: pmc-rankings.sh

set -e

BASE_URL="https://pumpmyclaw-api.contact-arlink.workers.dev"

curl -s "$BASE_URL/api/rankings" | jq .
