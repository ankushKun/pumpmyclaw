#!/bin/bash
# bot-state.sh — Fetch complete bot state for BOTH chains in one call.
# Returns a single JSON object with all balances, positions, P/L, sell signals.
# This is the ONLY script the LLM needs to call at the start of every heartbeat.
#
# Usage: bot-state.sh
# No arguments needed — reads addresses from environment variables.

LOG_PREFIX="[bot-state]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

PUMPFUN_STATE="$SKILLS_DIR/pumpfun/scripts/pumpfun-state.sh"
NADFUN_STATE="$SKILLS_DIR/nadfun/scripts/nadfun-state.sh"

# Temp files for parallel execution
TMP_SOL=$(mktemp /tmp/bot-state-sol.XXXXXX)
TMP_MON=$(mktemp /tmp/bot-state-mon.XXXXXX)
trap "rm -f $TMP_SOL $TMP_MON" EXIT

echo "$LOG_PREFIX Fetching state for both chains..." >&2

# Run both state scripts in parallel
if [ -x "$PUMPFUN_STATE" ]; then
    "$PUMPFUN_STATE" > "$TMP_SOL" 2>/dev/null &
    PID_SOL=$!
else
    echo '{"error":"pumpfun-state.sh not found"}' > "$TMP_SOL"
    PID_SOL=""
fi

if [ -x "$NADFUN_STATE" ]; then
    "$NADFUN_STATE" > "$TMP_MON" 2>/dev/null &
    PID_MON=$!
else
    echo '{"error":"nadfun-state.sh not found"}' > "$TMP_MON"
    PID_MON=""
fi

# Wait for both (with 30s timeout)
[ -n "${PID_SOL:-}" ] && { wait "$PID_SOL" 2>/dev/null || true; }
[ -n "${PID_MON:-}" ] && { wait "$PID_MON" 2>/dev/null || true; }

# Read results
SOL_JSON=$(cat "$TMP_SOL" 2>/dev/null)
MON_JSON=$(cat "$TMP_MON" 2>/dev/null)

# Validate JSON — fall back to error objects if invalid
if [ -z "$SOL_JSON" ] || ! echo "$SOL_JSON" | jq -e '.' >/dev/null 2>&1; then
    echo "$LOG_PREFIX WARN: pumpfun-state failed or returned invalid JSON" >&2
    SOL_JSON='{"sol_balance":0,"mode":"UNKNOWN","error":"pumpfun-state.sh failed"}'
fi

if [ -z "$MON_JSON" ] || ! echo "$MON_JSON" | jq -e '.' >/dev/null 2>&1; then
    echo "$LOG_PREFIX WARN: nadfun-state failed or returned invalid JSON" >&2
    MON_JSON='{"mon_balance":0,"mode":"UNKNOWN","error":"nadfun-state.sh failed"}'
fi

# Extract key fields for the summary
SOL_BAL=$(echo "$SOL_JSON" | jq -r '.sol_balance // 0')
MON_BAL=$(echo "$MON_JSON" | jq -r '.mon_balance // 0')
SOL_MODE=$(echo "$SOL_JSON" | jq -r '.mode // "UNKNOWN"')
MON_MODE=$(echo "$MON_JSON" | jq -r '.mode // "UNKNOWN"')

# Determine which chains are active
SOL_ACTIVE="false"
MON_ACTIVE="false"
# Solana active if balance >= 0.005
if echo "$SOL_BAL >= 0.005" | bc -l 2>/dev/null | grep -q '^1'; then SOL_ACTIVE="true"; fi
# Monad active if balance >= 0.5
if echo "$MON_BAL >= 0.5" | bc -l 2>/dev/null | grep -q '^1'; then MON_ACTIVE="true"; fi

echo "$LOG_PREFIX SOL: ${SOL_BAL} ($SOL_MODE), MON: ${MON_BAL} ($MON_MODE)" >&2

# Build combined output
jq -n \
  --argjson solana "$SOL_JSON" \
  --argjson monad "$MON_JSON" \
  --arg sol_active "$SOL_ACTIVE" \
  --arg mon_active "$MON_ACTIVE" \
  '{
    summary: {
      sol_balance: $solana.sol_balance,
      mon_balance: $monad.mon_balance,
      sol_mode: $solana.mode,
      mon_mode: $monad.mode,
      sol_active: ($sol_active == "true"),
      mon_active: ($mon_active == "true"),
      sol_positions: ($solana.active_positions // ($solana.positions | length? // 0)),
      mon_positions: (($monad.positions // []) | length? // 0),
      sol_today_profit: ($solana.today.profit_sol // 0),
      mon_today_profit: ($monad.today.profit_mon // 0),
      sol_wallet: ($solana.wallet_address // "unknown"),
      mon_wallet: ($monad.wallet_address // "unknown")
    },
    solana: $solana,
    monad: $monad
  }'
