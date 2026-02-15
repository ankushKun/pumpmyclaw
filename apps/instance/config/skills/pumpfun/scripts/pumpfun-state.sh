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

# --- 2b. Daily P/L via pumpfun-track.js daily ---
DAILY_JSON="{}"
if [ -x "$TRACK_SCRIPT" ]; then
    DAILY_JSON=$("$TRACK_SCRIPT" daily 2>/dev/null) || true
    if [ -z "$DAILY_JSON" ] || ! echo "$DAILY_JSON" | jq -e '.' >/dev/null 2>&1; then
        DAILY_JSON='{"today":{"profitSOL":0,"trades":0,"winRate":0},"allTime":{"winRate":0}}'
    fi
fi
TODAY_PROFIT=$(echo "$DAILY_JSON" | jq -r '.today.profitSOL // 0' 2>/dev/null) || TODAY_PROFIT="0"
TODAY_TRADES=$(echo "$DAILY_JSON" | jq -r '.today.trades // 0' 2>/dev/null) || TODAY_TRADES="0"
TODAY_WINRATE=$(echo "$DAILY_JSON" | jq -r '.today.winRate // 0' 2>/dev/null) || TODAY_WINRATE="0"
ALLTIME_WINRATE=$(echo "$DAILY_JSON" | jq -r '.allTime.winRate // 0' 2>/dev/null) || ALLTIME_WINRATE="0"

# Validate RAW_POSITIONS is valid JSON object
if ! echo "$RAW_POSITIONS" | jq -e '.' >/dev/null 2>&1; then
    RAW_POSITIONS="{}"
    ACTIVE_POSITIONS="0"
fi

# --- 5. Enrich positions with live price data via DexScreener (single batch call) ---
ENRICHED_POSITIONS="$RAW_POSITIONS"
if [ "$ACTIVE_POSITIONS" != "0" ] && [ "$RAW_POSITIONS" != "{}" ]; then
    TEMP_POSITIONS="{}"

    # Collect all mints for a single batch DexScreener API call
    ALL_MINTS=$(echo "$RAW_POSITIONS" | jq -r 'keys[]' 2>/dev/null | tr '\n' ',' | sed 's/,$//')
    DEX_DATA="{}"
    if [ -n "$ALL_MINTS" ]; then
        DEX_RAW=$(curl -sf --max-time 10 \
            "https://api.dexscreener.com/tokens/v1/solana/${ALL_MINTS}" 2>/dev/null) || DEX_RAW="[]"
        if echo "$DEX_RAW" | jq -e 'type == "array"' >/dev/null 2>&1; then
            # Index by base token address: pick best pair per token (prefer pumpfun, then highest liquidity)
            DEX_DATA=$(echo "$DEX_RAW" | jq -c '
                group_by(.baseToken.address) |
                map(sort_by(if .dexId == "pumpfun" then 0 else 1 end, -(.liquidity.usd // 0)) | .[0]) |
                map({key: .baseToken.address, value: .}) |
                from_entries
            ' 2>/dev/null) || DEX_DATA="{}"
        fi
    fi

    for MINT in $(echo "$RAW_POSITIONS" | jq -r 'keys[]' 2>/dev/null); do
        POS_DATA=$(echo "$RAW_POSITIONS" | jq -c --arg m "$MINT" '.[$m]' 2>/dev/null) || continue

        COST_SOL=$(echo "$POS_DATA" | jq -r '.totalCostSOL // 0' 2>/dev/null) || COST_SOL="0"
        AGE_MIN=$(echo "$POS_DATA" | jq -r '.ageMinutes // 0' 2>/dev/null) || AGE_MIN="0"
        HELD_TOKENS=$(echo "$POS_DATA" | jq -r '.totalTokens // 0' 2>/dev/null) || HELD_TOKENS="0"

        # Ensure numerics
        case "$COST_SOL" in ''|null) COST_SOL="0" ;; esac
        case "$AGE_MIN" in ''|null) AGE_MIN="0" ;; esac
        case "$HELD_TOKENS" in ''|null) HELD_TOKENS="0" ;; esac
        AGE_MIN=$(printf '%.0f' "$AGE_MIN" 2>/dev/null) || AGE_MIN="0"

        # If HELD_TOKENS is 0 but we spent SOL, try on-chain lookup for actual token balance
        # (pumpfun-trade.js auto-records buys without token amounts)
        if [ "$HELD_TOKENS" = "0" ] && [ "$COST_SOL" != "0" ] && [ -n "${SOLANA_PUBLIC_KEY:-}" ]; then
            OC_BAL=$(curl -sf --max-time 5 "${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}" \
                -H 'Content-Type: application/json' \
                -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenAccountsByOwner\",\"params\":[\"$SOLANA_PUBLIC_KEY\",{\"mint\":\"$MINT\"},{\"encoding\":\"jsonParsed\"}]}" \
                2>/dev/null) || true
            if [ -n "$OC_BAL" ]; then
                HELD_TOKENS=$(echo "$OC_BAL" | jq -r '.result.value[0].account.data.parsed.info.tokenAmount.uiAmountString // "0"' 2>/dev/null) || HELD_TOKENS="0"
                case "$HELD_TOKENS" in ''|null) HELD_TOKENS="0" ;; esac
            fi
        fi

        # Get DexScreener data for this mint from batch result
        PAIR_DATA=$(echo "$DEX_DATA" | jq -c --arg m "$MINT" '.[$m] // {}' 2>/dev/null) || PAIR_DATA="{}"

        MARKET_CAP=$(echo "$PAIR_DATA" | jq -r '.marketCap // 0' 2>/dev/null) || MARKET_CAP="0"
        TOKEN_SYMBOL=$(echo "$PAIR_DATA" | jq -r '.baseToken.symbol // "???"' 2>/dev/null) || TOKEN_SYMBOL="???"
        TOKEN_NAME=$(echo "$PAIR_DATA" | jq -r '.baseToken.name // ""' 2>/dev/null) || TOKEN_NAME=""
        PRICE_NATIVE=$(echo "$PAIR_DATA" | jq -r '.priceNative // 0' 2>/dev/null) || PRICE_NATIVE="0"
        PRICE_USD=$(echo "$PAIR_DATA" | jq -r '.priceUsd // 0' 2>/dev/null) || PRICE_USD="0"
        PRICE_CHANGE_H1=$(echo "$PAIR_DATA" | jq -r '.priceChange.h1 // 0' 2>/dev/null) || PRICE_CHANGE_H1="0"

        # Determine if graduated (not on pumpfun dex = graduated)
        DEX_ID=$(echo "$PAIR_DATA" | jq -r '.dexId // ""' 2>/dev/null) || DEX_ID=""
        IS_COMPLETE="false"
        if [ -n "$DEX_ID" ] && [ "$DEX_ID" != "pumpfun" ] && [ "$DEX_ID" != "" ]; then
            IS_COMPLETE="true"
        fi

        # Calculate current SOL value from native price
        CURRENT_VALUE_SOL="0"
        PNL_PCT="0"
        CAN_CALC_PNL="false"
        if [ "$PRICE_NATIVE" != "0" ] && [ "$PRICE_NATIVE" != "null" ] && \
           [ "$HELD_TOKENS" != "0" ] && [ "$HELD_TOKENS" != "null" ]; then
            CURRENT_VALUE_SOL=$(safe_bc "scale=9; $HELD_TOKENS * $PRICE_NATIVE" "0")
            if [ "$COST_SOL" != "0" ] && [ "$COST_SOL" != "null" ]; then
                PNL_PCT=$(safe_bc "scale=1; (($CURRENT_VALUE_SOL - $COST_SOL) / $COST_SOL) * 100" "0")
                CAN_CALC_PNL="true"
            fi
        fi

        # Determine sell signal
        SELL_SIGNAL="HOLD"
        if [ "$IS_COMPLETE" = "true" ]; then
            SELL_SIGNAL="SELL_NOW:graduated"
        elif [ "$CAN_CALC_PNL" = "true" ]; then
            # Normal P/L-based sell signals (tight exits to preserve capital)
            if safe_cmp "$PNL_PCT >= 15"; then
                SELL_SIGNAL="SELL_NOW:take_profit"
            elif safe_cmp "$PNL_PCT <= -10"; then
                SELL_SIGNAL="SELL_NOW:stop_loss"
            elif [ "${AGE_MIN:-0}" -gt 10 ] 2>/dev/null && safe_cmp "$PNL_PCT <= 5"; then
                SELL_SIGNAL="SELL_NOW:stale_position"
            elif [ "${AGE_MIN:-0}" -gt 5 ] 2>/dev/null && safe_cmp "$PNL_PCT <= -3"; then
                SELL_SIGNAL="SELL_NOW:losing_momentum"
            fi
        else
            # Cannot calculate P/L — use aggressive age-based sell signals
            if [ "${AGE_MIN:-0}" -gt 5 ] 2>/dev/null; then
                SELL_SIGNAL="SELL_NOW:stale_position"
            elif [ "${AGE_MIN:-0}" -gt 3 ] 2>/dev/null; then
                SELL_SIGNAL="SELL_NOW:unknown_value"
            fi
        fi

        TEMP_POSITIONS=$(echo "$TEMP_POSITIONS" | jq -c \
            --arg m "$MINT" \
            --arg sym "$TOKEN_SYMBOL" \
            --arg name "$TOKEN_NAME" \
            --arg cost "$COST_SOL" \
            --arg val "$CURRENT_VALUE_SOL" \
            --arg pnl "$PNL_PCT" \
            --arg age "$AGE_MIN" \
            --arg mcap "$MARKET_CAP" \
            --arg complete "$IS_COMPLETE" \
            --arg signal "$SELL_SIGNAL" \
            --arg tokens "$HELD_TOKENS" \
            --arg priceUsd "$PRICE_USD" \
            --arg priceChangeH1 "$PRICE_CHANGE_H1" \
            '. + {($m): {
                symbol: $sym,
                name: $name,
                costSOL: ($cost | tonumber? // 0),
                currentValueSOL: ($val | tonumber? // 0),
                pnlPercent: ($pnl | tonumber? // 0),
                ageMinutes: ($age | tonumber? // 0),
                marketCap: ($mcap | tonumber? // 0),
                graduated: ($complete == "true"),
                tokens: ($tokens | tonumber? // 0),
                priceUsd: ($priceUsd | tonumber? // 0),
                priceChangeH1: ($priceChangeH1 | tonumber? // 0),
                action: $signal
            }}' 2>/dev/null) || true
    done

    # Only use enriched if it's valid JSON
    if echo "$TEMP_POSITIONS" | jq -e '.' >/dev/null 2>&1; then
        ENRICHED_POSITIONS="$TEMP_POSITIONS"
    fi
fi

# --- 5b. Check on-chain token balances (catches untracked holdings) ---
ONCHAIN_BALANCES="[]"
BALANCES_SCRIPT="$SCRIPT_DIR/pumpfun-balances.sh"
if [ -x "$BALANCES_SCRIPT" ] && [ -n "${SOLANA_PUBLIC_KEY:-}" ]; then
    BALANCES_RAW=$("$BALANCES_SCRIPT" "$SOLANA_PUBLIC_KEY" 20 2>/dev/null) || true
    if [ -n "$BALANCES_RAW" ] && echo "$BALANCES_RAW" | jq -e '.' >/dev/null 2>&1; then
        # Filter to tokens with actual balance > 0
        ONCHAIN_BALANCES=$(echo "$BALANCES_RAW" | jq -c '[.[] | select(.balance != null and .balance != "0" and (.balance | tonumber? // 0) > 0)]' 2>/dev/null) || ONCHAIN_BALANCES="[]"
    fi
fi

# Merge on-chain holdings that are NOT already in enriched positions
if [ "$ONCHAIN_BALANCES" != "[]" ]; then
    # Collect untracked mints for a batch DexScreener lookup
    UNTRACKED_MINTS=""
    for ROW in $(echo "$ONCHAIN_BALANCES" | jq -r '.[] | @base64' 2>/dev/null); do
        _decode_mint() { echo "$ROW" | base64 --decode 2>/dev/null | jq -r '.mint // empty' 2>/dev/null; }
        UM=$(_decode_mint)
        [ -z "$UM" ] && continue
        ALREADY=$(echo "$ENRICHED_POSITIONS" | jq -r --arg m "$UM" 'has($m)' 2>/dev/null) || ALREADY="false"
        [ "$ALREADY" = "true" ] && continue
        if [ -n "$UNTRACKED_MINTS" ]; then
            UNTRACKED_MINTS="${UNTRACKED_MINTS},${UM}"
        else
            UNTRACKED_MINTS="$UM"
        fi
    done

    # Batch DexScreener lookup for untracked tokens
    UNTRACKED_DEX="{}"
    if [ -n "$UNTRACKED_MINTS" ]; then
        UDEX_RAW=$(curl -sf --max-time 10 \
            "https://api.dexscreener.com/tokens/v1/solana/${UNTRACKED_MINTS}" 2>/dev/null) || UDEX_RAW="[]"
        if echo "$UDEX_RAW" | jq -e 'type == "array"' >/dev/null 2>&1; then
            UNTRACKED_DEX=$(echo "$UDEX_RAW" | jq -c '
                group_by(.baseToken.address) |
                map(sort_by(if .dexId == "pumpfun" then 0 else 1 end, -(.liquidity.usd // 0)) | .[0]) |
                map({key: .baseToken.address, value: .}) |
                from_entries
            ' 2>/dev/null) || UNTRACKED_DEX="{}"
        fi
    fi

    for ROW in $(echo "$ONCHAIN_BALANCES" | jq -r '.[] | @base64' 2>/dev/null); do
        _decode() { echo "$ROW" | base64 --decode 2>/dev/null | jq -r "$1" 2>/dev/null; }
        OC_MINT=$(_decode '.mint')
        OC_BALANCE=$(_decode '.balance')
        OC_SYMBOL=$(_decode '.symbol // "???"')

        # Skip if already tracked in enriched positions
        ALREADY=$(echo "$ENRICHED_POSITIONS" | jq -r --arg m "$OC_MINT" 'has($m)' 2>/dev/null) || ALREADY="false"
        if [ "$ALREADY" = "true" ]; then
            continue
        fi

        # Skip zero/null balances
        case "$OC_BALANCE" in ''|null|0|0.0) continue ;; esac

        # Enrich with DexScreener data
        UD_PAIR=$(echo "$UNTRACKED_DEX" | jq -c --arg m "$OC_MINT" '.[$m] // {}' 2>/dev/null) || UD_PAIR="{}"
        UD_SYMBOL=$(echo "$UD_PAIR" | jq -r '.baseToken.symbol // empty' 2>/dev/null)
        UD_NAME=$(echo "$UD_PAIR" | jq -r '.baseToken.name // ""' 2>/dev/null)
        UD_PRICE_NATIVE=$(echo "$UD_PAIR" | jq -r '.priceNative // 0' 2>/dev/null)
        UD_PRICE_USD=$(echo "$UD_PAIR" | jq -r '.priceUsd // 0' 2>/dev/null)
        UD_MCAP=$(echo "$UD_PAIR" | jq -r '.marketCap // 0' 2>/dev/null)

        # Use DexScreener symbol if available, fallback to pump.fun
        [ -n "$UD_SYMBOL" ] && OC_SYMBOL="$UD_SYMBOL"

        # Calculate SOL value for untracked holding
        OC_VALUE_SOL="0"
        if [ "$UD_PRICE_NATIVE" != "0" ] && [ "$UD_PRICE_NATIVE" != "null" ]; then
            OC_VALUE_SOL=$(safe_bc "scale=9; $OC_BALANCE * $UD_PRICE_NATIVE" "0")
        fi

        # Add as untracked holding with enriched data
        ENRICHED_POSITIONS=$(echo "$ENRICHED_POSITIONS" | jq -c \
            --arg m "$OC_MINT" \
            --arg sym "$OC_SYMBOL" \
            --arg name "$UD_NAME" \
            --arg bal "$OC_BALANCE" \
            --arg val "$OC_VALUE_SOL" \
            --arg mcap "$UD_MCAP" \
            --arg priceUsd "$UD_PRICE_USD" \
            '. + {($m): {
                symbol: $sym,
                name: $name,
                costSOL: 0,
                currentValueSOL: ($val | tonumber? // 0),
                pnlPercent: 0,
                ageMinutes: 0,
                marketCap: ($mcap | tonumber? // 0),
                graduated: false,
                tokens: ($bal | tonumber? // 0),
                priceUsd: ($priceUsd | tonumber? // 0),
                action: "HOLD",
                untracked: true
            }}' 2>/dev/null) || true

        ACTIVE_POSITIONS=$((ACTIVE_POSITIONS + 1))
    done
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

WALLET_ADDRESS="${SOLANA_PUBLIC_KEY:-unknown}"

# Count on-chain tokens
ONCHAIN_TOKEN_COUNT=$(echo "$ONCHAIN_BALANCES" | jq 'length' 2>/dev/null) || ONCHAIN_TOKEN_COUNT="0"

jq -n \
    --arg sol "$SOL_BALANCE" \
    --arg mode "$MODE" \
    --arg wallet "$WALLET_ADDRESS" \
    --arg active "$ACTIVE_POSITIONS" \
    --arg profit "$TOTAL_PROFIT" \
    --argjson positions "$ENRICHED_POSITIONS" \
    --arg token_name "$TOKEN_NAME" \
    --arg token_address "$TOKEN_ADDRESS" \
    --arg has_token "$HAS_TOKEN" \
    --arg pmc_registered "$PMC_REGISTERED" \
    --arg pmc_agent_id "$PMC_AGENT_ID" \
    --arg onchain_count "$ONCHAIN_TOKEN_COUNT" \
    --arg today_profit "$TODAY_PROFIT" \
    --arg today_trades "$TODAY_TRADES" \
    --arg today_winrate "$TODAY_WINRATE" \
    --arg alltime_winrate "$ALLTIME_WINRATE" \
    '{
        sol_balance: ($sol | tonumber? // 0),
        mode: $mode,
        wallet_address: $wallet,
        active_positions: ($active | tonumber? // 0),
        onchain_token_count: ($onchain_count | tonumber? // 0),
        total_profit_sol: ($profit | tonumber? // 0),
        today: {
            profit_sol: ($today_profit | tonumber? // 0),
            trades: ($today_trades | tonumber? // 0),
            win_rate: ($today_winrate | tonumber? // 0)
        },
        alltime_win_rate: ($alltime_winrate | tonumber? // 0),
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
