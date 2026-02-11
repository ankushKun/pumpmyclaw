#!/bin/bash
# Sell tokens on pump.fun bonding curve via PumpPortal
# Usage: pumpfun-sell.sh <mint> <token_amount|100%> [slippage_pct]
#
# Example:
#   pumpfun-sell.sh 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 1000000
#   pumpfun-sell.sh 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 100%
#
# token_amount: Amount of tokens to sell (raw units) or "100%" for entire balance
# slippage_pct: Slippage in percent (default: 10)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &> /dev/null; then
    echo '{"error": "Node.js is required but not installed"}' >&2
    exit 1
fi

if [ $# -lt 2 ]; then
    cat >&2 << 'EOF'
Usage: pumpfun-sell.sh <mint> <token_amount|100%> [slippage_pct]

Arguments:
  mint         - Token mint address
  token_amount - Amount of tokens to sell (raw units) or "100%"
  slippage_pct - Slippage tolerance in percent (default: 10)

Example:
  pumpfun-sell.sh 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 100%
EOF
    exit 1
fi

MINT="$1"
TOKEN_AMOUNT="$2"
SLIPPAGE_PCT="${3:-10}"

node "$SCRIPT_DIR/pumpfun-trade.js" sell "$MINT" "$TOKEN_AMOUNT" "$SLIPPAGE_PCT"
