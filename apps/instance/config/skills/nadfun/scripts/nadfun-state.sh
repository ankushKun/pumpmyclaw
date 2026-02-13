#!/bin/bash
# Get full nad.fun bot state: MON balance + positions + mode + daily P/L
# This is the Monad equivalent of pumpfun-state.sh
# Usage: nadfun-state.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONAD_SCRIPTS="$SCRIPT_DIR/../../monad/scripts"
WORKSPACE="$HOME/.openclaw/workspace"

MONAD_ADDR="${MONAD_ADDRESS:-}"
if [ -z "$MONAD_ADDR" ]; then
    echo '{"error": "MONAD_ADDRESS not set"}'
    exit 1
fi

# --- Step 1: Get MON balance ---
BALANCE_JSON=$("$MONAD_SCRIPTS/monad-balance.sh" "$MONAD_ADDR" 2>/dev/null || echo '{"mon": 0}')
MON_BALANCE=$(echo "$BALANCE_JSON" | jq -r '.mon // 0')

# --- Step 2: Determine mode ---
MODE="NORMAL"
if (( $(echo "$MON_BALANCE < 0.02" | bc -l) )); then
    MODE="EMERGENCY"
elif (( $(echo "$MON_BALANCE < 0.05" | bc -l) )); then
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
    ENRICHED_POSITIONS=$(node -e "
const path = require('path');
const https = require('https');
const { MONAD_CONFIG, getPublicClient, lensAbi, erc20Abi, viem } = require(path.join('$MONAD_SCRIPTS', 'monad-common.js'));

const positions = $(echo "$POSITIONS_JSON" | jq -c '.positions');
const API_URL = MONAD_CONFIG.apiUrl;
const API_KEY = process.env.NAD_API_KEY || '';

function apiGet(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url, API_URL);
    const headers = {};
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    https.get(parsed.toString(), { headers, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', () => resolve(null)).on('timeout', function() { this.destroy(); resolve(null); });
  });
}

async function main() {
  const publicClient = getPublicClient();
  const enriched = [];

  for (const pos of positions) {
    const entry = { ...pos, action: 'HOLD' };

    try {
      // Get token balance
      const balance = await publicClient.readContract({
        address: pos.token, abi: erc20Abi, functionName: 'balanceOf', args: [process.env.MONAD_ADDRESS],
      });
      entry.tokenBalance = viem.formatEther(balance);

      if (balance === 0n) {
        entry.action = 'SELL_NOW:no_balance';
        enriched.push(entry);
        continue;
      }

      // Get sell quote for current value
      const [, monOut] = await publicClient.readContract({
        address: MONAD_CONFIG.LENS, abi: lensAbi, functionName: 'getAmountOut', args: [pos.token, balance, false],
      });
      entry.currentValueMON = parseFloat(viem.formatEther(monOut));
      entry.pnlPercent = pos.totalCost > 0 ? parseFloat(((entry.currentValueMON - pos.totalCost) / pos.totalCost * 100).toFixed(1)) : 0;

      // Get token info from API
      const info = await apiGet('/agent/token/' + pos.token);
      if (info && info.token_info) {
        entry.symbol = info.token_info.symbol;
        entry.name = info.token_info.name;
      }

      // Get market data
      const market = await apiGet('/agent/market/' + pos.token);
      if (market && market.market_info) {
        entry.priceUsd = market.market_info.price_usd;
        entry.marketCap = market.market_info.market_cap;
      }

      // Determine sell signals
      if (entry.pnlPercent >= 15) entry.action = 'SELL_NOW:take_profit';
      else if (entry.pnlPercent <= -10) entry.action = 'SELL_NOW:stop_loss';
      else if (pos.ageMinutes > 10 && entry.pnlPercent < 0) entry.action = 'SELL_NOW:losing_momentum';
      else if (pos.ageMinutes > 15) entry.action = 'SELL_NOW:stale_position';

    } catch (e) {
      entry.error = e.message;
      if (pos.ageMinutes > 5) entry.action = 'SELL_NOW:unknown_value';
    }

    enriched.push(entry);
  }

  console.log(JSON.stringify(enriched));
}

main().catch(e => { console.log('[]'); });
" 2>/dev/null || echo "[]")
fi

# --- Step 6: Check for on-chain tokens not in position tracker ---
ONCHAIN_HOLDINGS=$(node -e "
const path = require('path');
const https = require('https');
const { MONAD_CONFIG } = require(path.join('$MONAD_SCRIPTS', 'monad-common.js'));
const API_URL = MONAD_CONFIG.apiUrl;
const API_KEY = process.env.NAD_API_KEY || '';

function apiGet(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url, API_URL);
    const headers = {};
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    https.get(parsed.toString(), { headers, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', () => resolve(null)).on('timeout', function() { this.destroy(); resolve(null); });
  });
}

async function main() {
  const result = await apiGet('/agent/holdings/$MONAD_ADDR?page=1&limit=50');
  console.log(JSON.stringify(result && result.tokens ? result.tokens.length : 0));
}
main().catch(() => console.log('0'));
" 2>/dev/null || echo "0")

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
