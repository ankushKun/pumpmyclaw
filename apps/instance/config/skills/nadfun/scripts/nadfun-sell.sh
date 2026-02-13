#!/bin/bash
# Sell tokens on nad.fun for MON
# Usage: nadfun-sell.sh <token_address> <amount|100%> [slippage_pct]
# Example: nadfun-sell.sh 0x1234... 100% 2
set -e

TOKEN="${1:-}"
AMOUNT="${2:-100%}"
SLIPPAGE_PCT="${3:-2}"

if [ -z "$TOKEN" ]; then
    echo '{"error": "Usage: nadfun-sell.sh <token_address> <amount|100%> [slippage_pct]"}'
    exit 1
fi

# Convert percentage to basis points (2% -> 200)
SLIPPAGE_BPS=$(echo "$SLIPPAGE_PCT * 100" | bc | cut -d. -f1)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/nadfun-trade.js" sell "$TOKEN" "$AMOUNT" "$SLIPPAGE_BPS"
