#!/bin/bash
# Buy tokens on nad.fun with MON
# Usage: nadfun-buy.sh <token_address> <mon_amount> [slippage_pct]
# Example: nadfun-buy.sh 0x1234... 0.1 2
set -e

TOKEN="${1:-}"
AMOUNT="${2:-}"
SLIPPAGE_PCT="${3:-2}"

if [ -z "$TOKEN" ] || [ -z "$AMOUNT" ]; then
    echo '{"error": "Usage: nadfun-buy.sh <token_address> <mon_amount> [slippage_pct]"}'
    exit 1
fi

# Convert percentage to basis points (2% -> 200)
SLIPPAGE_BPS=$(echo "$SLIPPAGE_PCT * 100" | bc | cut -d. -f1)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/nadfun-trade.js" buy "$TOKEN" "$AMOUNT" "$SLIPPAGE_BPS"
