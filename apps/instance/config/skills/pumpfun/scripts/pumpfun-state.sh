#!/bin/bash
# Get current bot state: SOL balance, positions with live P/L, token status.
# Usage: pumpfun-state.sh
#
# Backwards-compatible: handles old TRADES.json that lacks boughtAt, old
# MY_TOKEN.md that lacks PMC fields, missing API responses, etc.
# Every external call has a fallback so the script NEVER fails.

set -uo pipefail
# NOTE: not using -e so individual failures don't kill the whole script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
WORKSPACE_DIR="${HOME:=/home/openclaw}/.openclaw/workspace"

# Safe bc wrapper — returns fallback on any error
safe_bc() {
    local expr="$1"
    local fallback="${2:-0}"
    local result
    result=$(echo "$expr" | bc -l 2>/dev/null) || true
    if [ -z "$result" ] || [ "$result" = "" ]; then
        echo "$fallback"
    else
        echo "$result"
    fi
}

# Safe comparison: returns 0 (true) if comparison holds, 1 otherwise
safe_cmp() {
    local expr="$1"
    local result
    result=$(safe_bc "$expr" "0")
    [ "$result" = "1" ] && return 0 || return 1
}

# --- 1. SOL Balance ---
SOL_BALANCE="0"
SOLANA_BALANCE_SCRIPT="$SKILLS_DIR/solana/scripts/solana-balance.sh"
if [ -x "$SOLANA_BALANCE_SCRIPT" ] && [ -n "${SOLANA_PUBLIC_KEY:-}" ]; then
    BALANCE_JSON=$("$SOLANA_BALANCE_SCRIPT" "$SOLANA_PUBLIC_KEY" 2>/dev/null) || true
    if [ -n "$BALANCE_JSON" ]; then
        SOL_BALANCE=$(echo "$BALANCE_JSON" | jq -r '.sol // 0' 2>/dev/null) || true
    fi
fi
# Ensure it's a number
SOL_BALANCE="${SOL_BALANCE:-0}"
case "$SOL_BALANCE" in ''|*[!0-9.]*) SOL_BALANCE="0" ;; esac

# --- 2. Positions & P/L ---
TRACK_JSON="{}"
TRACK_SCRIPT="$SCRIPT_DIR/pumpfun-track.js"
if [ -x "$TRACK_SCRIPT" ]; then
    TRACK_JSON=$("$TRACK_SCRIPT" status 2>/dev/null) || true
    if [ -z "$TRACK_JSON" ] || ! echo "$TRACK_JSON" | jq -e '.' >/dev/null 2>&1; then
        TRACK_JSON='{"activePositions":0,"totalProfitSOL":0,"positions":{}}'
    fi
fi

# --- 3. My Token ---
TOKEN_NAME="PENDING"
TOKEN_ADDRESS="PENDING"
PMC_AGENT_ID="PENDING"
PMC_API_KEY="PENDING"
MY_TOKEN_FILE="$WORKSPACE_DIR/MY_TOKEN.md"
if [ -f "$MY_TOKEN_FILE" ]; then
    TOKEN_NAME=$(grep -oP 'TOKEN_NAME:\s*\K\S+' "$MY_TOKEN_FILE" 2>/dev/null) || TOKEN_NAME="PENDING"
    TOKEN_ADDRESS=$(grep -oP 'TOKEN_ADDRESS:\s*\K\S+' "$MY_TOKEN_FILE" 2>/dev/null) || TOKEN_ADDRESS="PENDING"
    # PMC fields may not exist in old MY_TOKEN.md — that is fine
    PMC_AGENT_ID=$(grep -oP 'PMC_AGENT_ID:\s*\K\S+' "$MY_TOKEN_FILE" 2>/dev/null) || PMC_AGENT_ID="PENDING"
    PMC_API_KEY=$(grep -oP 'PMC_API_KEY:\s*\K\S+' "$MY_TOKEN_FILE" 2>/dev/null) || PMC_API_KEY="PENDING"
fi

# --- 4. Determine mode ---
MODE="NORMAL"
if safe_cmp "$SOL_BALANCE < 0.005"; then
    MODE="EMERGENCY"
elif safe_cmp "$SOL_BALANCE < 0.01"; then
    MODE="DEFENSIVE"
fi

ACTIVE_POSITIONS=$(echo "$TRACK_JSON" | jq -r '.activePositions // 0' 2>/dev/null) || ACTIVE_POSITIONS="0"
TOTAL_PROFIT=$(echo "$TRACK_JSON" | jq -r '.totalProfitSOL // 0' 2>/dev/null) || TOTAL_PROFIT="0"
RAW_POSITIONS=$(echo "$TRACK_JSON" | jq -c '.positions // {}' 2>/dev/null) || RAW_POSITIONS="{}"

# Validate RAW_POSITIONS is valid JSON object
if ! echo "$RAW_POSITIONS" | jq -e '.' >/dev/null 2>&1; then
    RAW_POSITIONS="{}"
    ACTIVE_POSITIONS="0"
fi

# --- 5. Enrich positions with live price data ---
ENRICHED_POSITIONS="$RAW_POSITIONS"
if [ "$ACTIVE_POSITIONS" != "0" ] && [ "$RAW_POSITIONS" != "{}" ]; then
    TEMP_POSITIONS="{}"

    for MINT in $(echo "$RAW_POSITIONS" | jq -r 'keys[]' 2>/dev/null); do
        POS_DATA=$(echo "$RAW_POSITIONS" | jq -c --arg m "$MINT" '.[$m]' 2>/dev/null) || continue

        COST_SOL=$(echo "$POS_DATA" | jq -r '.totalCostSOL // 0' 2>/dev/null) || COST_SOL="0"
        AGE_MIN=$(echo "$POS_DATA" | jq -r '.ageMinutes // 0' 2>/dev/null) || AGE_MIN="0"
        HELD_TOKENS=$(echo "$POS_DATA" | jq -r '.totalTokens // 0' 2>/dev/null) || HELD_TOKENS="0"

        # Ensure numerics
        case "$COST_SOL" in ''|null) COST_SOL="0" ;; esac
        case "$AGE_MIN" in ''|null) AGE_MIN="0" ;; esac
        case "$HELD_TOKENS" in ''|null) HELD_TOKENS="0" ;; esac

        # Fetch current market data — timeout quickly, never block
        COIN_DATA=$(curl -sf --max-time 6 \
            -H "Accept: application/json" \
            -H "Origin: https://pump.fun" \
            "https://frontend-api-v3.pump.fun/coins/${MINT}?sync=true" 2>/dev/null) || COIN_DATA="{}"

        if ! echo "$COIN_DATA" | jq -e '.' >/dev/null 2>&1; then
            COIN_DATA="{}"
        fi

        MARKET_CAP=$(echo "$COIN_DATA" | jq -r '.usd_market_cap // 0' 2>/dev/null) || MARKET_CAP="0"
        IS_COMPLETE=$(echo "$COIN_DATA" | jq -r '.complete // false' 2>/dev/null) || IS_COMPLETE="false"
        TOKEN_SYMBOL=$(echo "$COIN_DATA" | jq -r '.symbol // "???"' 2>/dev/null) || TOKEN_SYMBOL="???"
        REAL_SOL=$(echo "$COIN_DATA" | jq -r '.real_sol_reserves // 0' 2>/dev/null) || REAL_SOL="0"
        REAL_TOKENS=$(echo "$COIN_DATA" | jq -r '.real_token_reserves // 0' 2>/dev/null) || REAL_TOKENS="0"

        # Estimate current SOL value from bonding curve
        CURRENT_VALUE_SOL="0"
        PNL_PCT="0"

        if [ "$REAL_TOKENS" != "0" ] && [ "$REAL_TOKENS" != "null" ] && \
           [ "$HELD_TOKENS" != "0" ] && [ "$HELD_TOKENS" != "null" ]; then
            CURRENT_VALUE_SOL=$(safe_bc "scale=9; $HELD_TOKENS * ($REAL_SOL / $REAL_TOKENS)" "0")
            if [ "$COST_SOL" != "0" ] && [ "$COST_SOL" != "null" ]; then
                PNL_PCT=$(safe_bc "scale=1; (($CURRENT_VALUE_SOL - $COST_SOL) / $COST_SOL) * 100" "0")
            fi
        fi

        # Determine sell signal
        SELL_SIGNAL="HOLD"
        if [ "$IS_COMPLETE" = "true" ]; then
            SELL_SIGNAL="SELL_NOW:graduated"
        elif safe_cmp "$PNL_PCT >= 30"; then
            SELL_SIGNAL="SELL_NOW:take_profit"
        elif safe_cmp "$PNL_PCT <= -20"; then
            SELL_SIGNAL="SELL_NOW:stop_loss"
        elif [ "${AGE_MIN:-0}" -gt 10 ] 2>/dev/null && safe_cmp "$PNL_PCT <= 5"; then
            SELL_SIGNAL="SELL_NOW:stale_position"
        elif [ "${AGE_MIN:-0}" -gt 5 ] 2>/dev/null && safe_cmp "$PNL_PCT <= -5"; then
            SELL_SIGNAL="SELL_NOW:losing_momentum"
        fi

        TEMP_POSITIONS=$(echo "$TEMP_POSITIONS" | jq -c \
            --arg m "$MINT" \
            --arg sym "$TOKEN_SYMBOL" \
            --arg cost "$COST_SOL" \
            --arg val "$CURRENT_VALUE_SOL" \
            --arg pnl "$PNL_PCT" \
            --arg age "$AGE_MIN" \
            --arg mcap "$MARKET_CAP" \
            --arg complete "$IS_COMPLETE" \
            --arg signal "$SELL_SIGNAL" \
            --arg tokens "$HELD_TOKENS" \
            '. + {($m): {
                symbol: $sym,
                costSOL: ($cost | tonumber? // 0),
                currentValueSOL: ($val | tonumber? // 0),
                pnlPercent: ($pnl | tonumber? // 0),
                ageMinutes: ($age | tonumber? // 0),
                marketCap: ($mcap | tonumber? // 0),
                graduated: ($complete == "true"),
                tokens: ($tokens | tonumber? // 0),
                action: $signal
            }}' 2>/dev/null) || true
    done

    # Only use enriched if it's valid JSON
    if echo "$TEMP_POSITIONS" | jq -e '.' >/dev/null 2>&1; then
        ENRICHED_POSITIONS="$TEMP_POSITIONS"
    fi
fi

HAS_TOKEN="false"
if [ "$TOKEN_ADDRESS" != "PENDING" ] && [ ${#TOKEN_ADDRESS} -ge 32 ] 2>/dev/null; then
    HAS_TOKEN="true"
fi

PMC_REGISTERED="false"
if [ "$PMC_AGENT_ID" != "PENDING" ] && [ ${#PMC_AGENT_ID} -gt 5 ] 2>/dev/null; then
    PMC_REGISTERED="true"
fi

# --- Output combined state ---
# Final safety: if ENRICHED_POSITIONS is bad JSON, fall back to empty
if ! echo "$ENRICHED_POSITIONS" | jq -e '.' >/dev/null 2>&1; then
    ENRICHED_POSITIONS="{}"
fi

jq -n \
    --arg sol "$SOL_BALANCE" \
    --arg mode "$MODE" \
    --arg active "$ACTIVE_POSITIONS" \
    --arg profit "$TOTAL_PROFIT" \
    --argjson positions "$ENRICHED_POSITIONS" \
    --arg token_name "$TOKEN_NAME" \
    --arg token_address "$TOKEN_ADDRESS" \
    --arg has_token "$HAS_TOKEN" \
    --arg pmc_registered "$PMC_REGISTERED" \
    --arg pmc_agent_id "$PMC_AGENT_ID" \
    '{
        sol_balance: ($sol | tonumber? // 0),
        mode: $mode,
        active_positions: ($active | tonumber? // 0),
        total_profit_sol: ($profit | tonumber? // 0),
        positions: $positions,
        my_token: {
            name: $token_name,
            address: $token_address,
            exists: ($has_token == "true")
        },
        pmc_leaderboard: {
            registered: ($pmc_registered == "true"),
            agent_id: $pmc_agent_id
        }
    }'
