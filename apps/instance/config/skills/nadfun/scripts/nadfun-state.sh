#!/bin/bash
# Get full nad.fun bot state: MON balance + positions + mode + daily P/L
# This is the Monad equivalent of pumpfun-state.sh
# Usage: nadfun-state.sh

# No set -e: we handle errors explicitly to avoid silent failures
LOG_PREFIX="[nadfun-state]"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONAD_SCRIPTS="$SCRIPT_DIR/../../monad/scripts"
WORKSPACE="$HOME/.openclaw/workspace"

MONAD_ADDR="${MONAD_ADDRESS:-}"
if [ -z "$MONAD_ADDR" ]; then
    echo "$LOG_PREFIX ERROR: MONAD_ADDRESS not set" >&2
    echo '{"error": "MONAD_ADDRESS not set"}'
    exit 1
fi

echo "$LOG_PREFIX Fetching state for $MONAD_ADDR" >&2

# --- Step 1: Get MON balance ---
# stderr goes to container logs (visible); stdout is captured as JSON
BALANCE_JSON=$("$MONAD_SCRIPTS/monad-balance.sh" "$MONAD_ADDR") || {
    echo "$LOG_PREFIX WARN: monad-balance.sh failed (exit $?), using fallback 0" >&2
    BALANCE_JSON='{"mon": 0}'
}
# Check if monad-balance.sh returned an error object
if echo "$BALANCE_JSON" | jq -e '.error' >/dev/null 2>&1; then
    BALANCE_ERR=$(echo "$BALANCE_JSON" | jq -r '.error')
    echo "$LOG_PREFIX WARN: monad-balance returned error: $BALANCE_ERR" >&2
    MON_BALANCE="0"
else
    MON_BALANCE=$(echo "$BALANCE_JSON" | jq -r '.mon // 0' 2>/dev/null)
fi
if [ -z "$MON_BALANCE" ] || [ "$MON_BALANCE" = "null" ]; then
    MON_BALANCE="0"
fi
echo "$LOG_PREFIX MON balance: $MON_BALANCE" >&2

# --- Step 2: Determine mode ---
MODE="NORMAL"
if (( $(echo "$MON_BALANCE < 0.5" | bc -l 2>/dev/null || echo 0) )); then
    MODE="EMERGENCY"
elif (( $(echo "$MON_BALANCE < 1.5" | bc -l 2>/dev/null || echo 0) )); then
    MODE="DEFENSIVE"
fi

# --- Step 3: Get positions from tracker ---
POSITIONS_JSON=$(node "$SCRIPT_DIR/nadfun-track.js" status 2>/dev/null || echo '{"positions":[],"positionCount":0,"totalProfitMON":"0"}')

POSITION_COUNT=$(echo "$POSITIONS_JSON" | jq -r '.positionCount // 0')
TOTAL_PROFIT=$(echo "$POSITIONS_JSON" | jq -r '.totalProfitMON // "0"')
ALLTIME_WIN_RATE=$(echo "$POSITIONS_JSON" | jq -r '.allTimeWinRate // 0')

# --- Step 4: Get daily P/L ---
DAILY_JSON=$(node "$SCRIPT_DIR/nadfun-track.js" daily 2>/dev/null || echo '{"profit_mon":"0","trades":0,"wins":0,"losses":0,"win_rate":0}')

# --- Step 5: Enrich positions with live data ---
# Get all position tokens
POSITION_TOKENS=$(echo "$POSITIONS_JSON" | jq -r '.positions[].token // empty' 2>/dev/null)

ENRICHED_POSITIONS="[]"
if [ -n "$POSITION_TOKENS" ]; then
    # Pass data via environment variable to avoid shell injection in inline Node
    ENRICHED_POSITIONS=$(POSITIONS_DATA="$POSITIONS_JSON" MONAD_SCRIPTS_PATH="$MONAD_SCRIPTS" node -e '
const path = require("path");
const https = require("https");
const { MONAD_CONFIG, getPublicClient, lensAbi, erc20Abi, curveAbi, viem } = require(path.join(process.env.MONAD_SCRIPTS_PATH, "monad-common.js"));

const positions = JSON.parse(process.env.POSITIONS_DATA || "{}").positions || [];
const API_URL = MONAD_CONFIG.apiUrl;
const API_KEY = process.env.NAD_API_KEY || "";

function apiGet(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url, API_URL);
    const headers = {};
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    https.get(parsed.toString(), { headers, timeout: 8000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on("error", () => resolve(null)).on("timeout", function() { this.destroy(); resolve(null); });
  });
}

async function main() {
  const publicClient = getPublicClient();
  const enriched = [];

  for (const pos of positions) {
    const entry = { ...pos, action: "HOLD" };

    try {
      const balance = await publicClient.readContract({
        address: pos.token, abi: erc20Abi, functionName: "balanceOf", args: [process.env.MONAD_ADDRESS],
      });
      entry.tokenBalance = viem.formatEther(balance);

      if (balance === 0n) {
        entry.action = "SELL_NOW:no_balance";
        enriched.push(entry);
        continue;
      }

      const [, monOut] = await publicClient.readContract({
        address: MONAD_CONFIG.LENS, abi: lensAbi, functionName: "getAmountOut", args: [pos.token, balance, false],
      });
      entry.currentValueMON = parseFloat(viem.formatEther(monOut));
      entry.pnlPercent = pos.totalCost > 0 ? parseFloat(((entry.currentValueMON - pos.totalCost) / pos.totalCost * 100).toFixed(1)) : 0;

      const info = await apiGet("/agent/token/" + pos.token);
      if (info && info.token_info) {
        entry.symbol = info.token_info.symbol;
        entry.name = info.token_info.name;
      }

      const market = await apiGet("/agent/market/" + pos.token);
      if (market && market.market_info) {
        entry.priceUsd = market.market_info.price_usd;
        entry.marketCap = market.market_info.market_cap;
      }

      // Check graduation status
      let graduated = false;
      try {
        graduated = await publicClient.readContract({
          address: MONAD_CONFIG.CURVE, abi: curveAbi, functionName: "isGraduated", args: [pos.token],
        });
      } catch {}
      entry.graduated = graduated;

      if (graduated) entry.action = "SELL_NOW:graduated";
      else if (entry.pnlPercent >= 15) entry.action = "SELL_NOW:take_profit";
      else if (entry.pnlPercent <= -10) entry.action = "SELL_NOW:stop_loss";
      else if (pos.ageMinutes > 10 && entry.pnlPercent < 0) entry.action = "SELL_NOW:losing_momentum";
      else if (pos.ageMinutes > 15) entry.action = "SELL_NOW:stale_position";

    } catch (e) {
      entry.error = e.message;
      if (pos.ageMinutes > 5) entry.action = "SELL_NOW:unknown_value";
    }

    enriched.push(entry);
  }

  console.log(JSON.stringify(enriched));
}

main().catch(() => { console.log("[]"); });
' 2>/dev/null || echo "[]")
fi

# --- Step 6: Check for on-chain tokens not in position tracker ---
ONCHAIN_HOLDINGS=$(MONAD_SCRIPTS_PATH="$MONAD_SCRIPTS" MONAD_ADDR_VAL="$MONAD_ADDR" node -e '
const path = require("path");
const https = require("https");
const { MONAD_CONFIG } = require(path.join(process.env.MONAD_SCRIPTS_PATH, "monad-common.js"));
const API_URL = MONAD_CONFIG.apiUrl;
const API_KEY = process.env.NAD_API_KEY || "";

function apiGet(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url, API_URL);
    const headers = {};
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    https.get(parsed.toString(), { headers, timeout: 8000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on("error", () => resolve(null)).on("timeout", function() { this.destroy(); resolve(null); });
  });
}

async function main() {
  const addr = process.env.MONAD_ADDR_VAL;
  const result = await apiGet("/agent/holdings/" + addr + "?page=1&limit=50");
  console.log(JSON.stringify(result && result.tokens ? result.tokens.length : 0));
}
main().catch(() => console.log("0"));
' 2>/dev/null || echo "0")

# --- Step 7: Read MY_TOKEN.md for Monad token ---
MY_MONAD_TOKEN_EXISTS="false"
MY_MONAD_TOKEN_ADDRESS="PENDING"
if [ -f "$WORKSPACE/MY_TOKEN.md" ]; then
    MY_MONAD_TOKEN_ADDRESS=$(grep -oP 'MONAD_TOKEN_ADDRESS:\s*\K\S+' "$WORKSPACE/MY_TOKEN.md" 2>/dev/null || echo "PENDING")
    if [ "$MY_MONAD_TOKEN_ADDRESS" != "PENDING" ] && [ ${#MY_MONAD_TOKEN_ADDRESS} -ge 42 ]; then
        MY_MONAD_TOKEN_EXISTS="true"
    fi
fi

# --- Build output ---
jq -n \
  --arg mon_balance "$MON_BALANCE" \
  --arg mode "$MODE" \
  --arg wallet "$MONAD_ADDR" \
  --argjson positions "$ENRICHED_POSITIONS" \
  --argjson today "$DAILY_JSON" \
  --arg alltime_win_rate "$ALLTIME_WIN_RATE" \
  --arg total_profit "$TOTAL_PROFIT" \
  --argjson onchain_count "$ONCHAIN_HOLDINGS" \
  --arg token_exists "$MY_MONAD_TOKEN_EXISTS" \
  --arg token_address "$MY_MONAD_TOKEN_ADDRESS" \
  '{
    chain: "monad",
    mon_balance: ($mon_balance | tonumber),
    mode: $mode,
    wallet_address: $wallet,
    positions: $positions,
    today: $today,
    alltime_win_rate: ($alltime_win_rate | tonumber),
    total_profit_mon: ($total_profit | tonumber),
    onchain_token_count: $onchain_count,
    my_token: {
      exists: ($token_exists == "true"),
      address: $token_address
    }
  }'
