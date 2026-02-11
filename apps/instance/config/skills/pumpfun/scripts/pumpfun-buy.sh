#!/bin/bash
# Buy tokens on pump.fun bonding curve via PumpPortal
# Usage: pumpfun-buy.sh <mint> <sol_amount> [slippage_pct]
#
# Example:
#   pumpfun-buy.sh 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.01
#   pumpfun-buy.sh 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.01 10
#
# slippage_pct: Slippage in percent (default: 10 = 10%)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &> /dev/null; then
    echo '{"error": "Node.js is required but not installed"}' >&2
    exit 1
fi

if [ $# -lt 2 ]; then
    cat >&2 << 'EOF'
Usage: pumpfun-buy.sh <mint> <sol_amount> [slippage_pct]

Arguments:
  mint         - Token mint address
  sol_amount   - Amount of SOL to spend
  slippage_pct - Slippage tolerance in percent (default: 10)

Example:
  pumpfun-buy.sh 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.01
EOF
    exit 1
fi

MINT="$1"
SOL_AMOUNT="$2"
SLIPPAGE_PCT="${3:-10}"

node "$SCRIPT_DIR/pumpfun-trade.js" buy "$MINT" "$SOL_AMOUNT" "$SLIPPAGE_PCT"
