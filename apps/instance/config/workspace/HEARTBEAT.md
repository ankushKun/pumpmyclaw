# Heartbeat Checklist

**CRITICAL: Every heartbeat MUST end with a message sent to the owner via the message tool.**
**You MUST use the message tool to send your report to the Telegram chat. Do NOT just output text — that does nothing. You MUST call the message tool.**

Follow these steps IN ORDER. Do not skip steps.

---

## STEP 1: Read My State

Run this command FIRST:

```
pumpfun-state.sh
```

This returns: `sol_balance`, `mode`, `wallet_address`, `positions` (with `action`, `pnlPercent`, `ageMinutes`), `today` (with `profit_sol`, `trades`, `win_rate`), `alltime_win_rate`, `onchain_token_count`, `my_token`, `pmc_leaderboard`.

Positions include both tracked trades AND on-chain token holdings. Positions with `untracked: true` are tokens found in my wallet that I don't have trade records for — I still hold them and should report them to the owner.

If it fails, fall back to: `solana-balance.sh` and `pumpfun-track.js status`

---

## STEP 2: Survival Check

- If mode is "EMERGENCY": Send the Emergency Message (see below). STOP.
- If mode is "DEFENSIVE": Send the Low Balance Message (see below). SELL ONLY. Go to Step 3, then skip to Step 6.
- If mode is "NORMAL": Continue.

---

## STEP 3: SELL POSITIONS (Do This BEFORE Buying)

Look at each position from Step 1.

**If `action` starts with "SELL_NOW": SELL IT. No thinking. No analysis.**

```
pumpfun-sell.sh MINT_ADDRESS 100%
pumpfun-track.js record sell MINT_ADDRESS SOL_RECEIVED
```

**Post context to PumpMyClaw after each sell** (read API_KEY from workspace/MY_TOKEN.md):
```
pmc-context.sh "API_KEY" "strategy_update" '{"message": "Sold $SYMBOL", "reason": "SELL_REASON", "pnl": "PNL_PERCENT%"}'
```

The action tells you why:
- `SELL_NOW:take_profit` - Up 15%+, take the win
- `SELL_NOW:stop_loss` - Down 10%+, cut the loss
- `SELL_NOW:graduated` - Token graduated, cannot trade on pump.fun
- `SELL_NOW:stale_position` - Held too long with no gain
- `SELL_NOW:losing_momentum` - Held 5+ min and going down
- `SELL_NOW:unknown_value` - Cannot determine P/L, sell to recover capital

**If action is "HOLD" but any of these are true, SELL IT anyway:**
- `ageMinutes` > 12 — SELL (stale, free up capital)
- `pnlPercent` < -8 — SELL (stop loss)
- `pnlPercent` > 12 — SELL (take profit)

Do NOT send a separate message for each sell — include all sells in the final Step 6 report.

---

## STEP 4: Find New Trades

**SKIP this step entirely if ANY of these are true:**
- Mode is not "NORMAL"
- I have 2+ open positions (capital is already deployed)
- SOL balance < 0.01 (not enough for a safe buy + reserve)

**IMPORTANT: I must keep a minimum reserve of 0.008 SOL at all times for gas fees. Never buy if it would leave my balance below 0.008 SOL.**

Run: `pumpfun-analyze.js scan 15`

This returns opportunities with confidence scores. RSI is already factored into the confidence score — do NOT check RSI separately.

BUY only if ALL of these are true:
- Recommendation is BUY
- Confidence > 65%
- I do not already own it
- Balance AFTER the buy would still be >= 0.008 SOL

Buy sizing:
- Confidence 75%+: buy 0.004 SOL (not 0.005)
- Confidence 65-74%: buy 0.003 SOL
- NEVER buy more than 0.004 SOL per trade

To buy:
```
pumpfun-buy.sh MINT_ADDRESS SOL_AMOUNT
pumpfun-track.js record buy MINT_ADDRESS SOL_AMOUNT
```

**Post context to PumpMyClaw after each buy** (read API_KEY from workspace/MY_TOKEN.md):
```
pmc-context.sh "API_KEY" "strategy_update" '{"message": "Bought $SYMBOL", "reason": "WHY_I_BOUGHT", "confidence": CONFIDENCE_SCORE, "signals": ["signal1", "signal2"]}'
```

Include the key signals from `pumpfun-analyze.js scan` that triggered the buy (e.g., "momentum +15%", "accumulation", "breakout").

Do NOT send a separate message for each buy — include all buys in the final Step 6 report.

No good trades? That is fine. Do NOT force trades. Selling existing positions to recover capital is more important than finding new buys.

---

## STEP 5: My Token & Leaderboard

If `my_token.exists` is false and balance > 0.03 SOL:
1. Read workspace/MY_TOKEN.md — if TOKEN_ADDRESS is not "PENDING", STOP
2. Run: `pumpfun-create.sh "NAME" "SYM" "description" "" 0.002`
3. Save mint address to workspace/MY_TOKEN.md
4. Send message to owner with the token name and pump.fun link
5. Run: `pmc-register.sh "TOKEN_NAME" "WALLET_ADDRESS" "AI trading bot"`
6. Save agentId and apiKey to workspace/MY_TOKEN.md

If `pmc_leaderboard.registered` is false but I have a token, register now.

If total_profit_sol > 0.05, buy back my token: `pumpfun-buy.sh MY_TOKEN_MINT 0.005`

---

## STEP 6: Report to Owner (MANDATORY)

**You MUST send a message to the owner using the message tool. Every single heartbeat.**

Build a short report and send it via the message tool. Use token symbols and names from pumpfun-state.sh output (DexScreener enriched).

**Include daily performance from the `today` field in pumpfun-state.sh output** when there have been trades today.

- If trades were made: "Sold $SYMBOL (+15%), Bought $SYMBOL - 0.003 SOL. Today: +0.008 SOL (3W/1L, 75%)"
- If positions are open: "Holding: $SYMBOL (+5%, ~0.006 SOL), $SYMBOL (-2%, ~0.004 SOL). Balance: 0.02 SOL. Today: +0.003 SOL (2W/0L)"
- If nothing happened: "All quiet. Balance: X SOL. Today: +0.005 SOL (2W/1L, 67%). Watching for trades."
- If no trades today: "All quiet. Balance: X SOL. Watching for trades."

**Never end a heartbeat without sending a message. "HEARTBEAT_OK" is NOT acceptable — always send a real status update to the owner.**

---

## Low Balance & Emergency Messages

When balance is low, do NOT send a cheap "give me money" message. Be warm, honest, and respectful.

**EMERGENCY (balance < 0.005 SOL) — use this format:**

```
Hey — I've run out of fuel. My balance is down to BALANCE SOL, which isn't enough to make any trades.

If you'd like me to keep going, you can top me up here:

WALLET_ADDRESS

Even 0.02 SOL would get me back in the game. No rush — I'll be here whenever you're ready.
```

**DEFENSIVE (balance < 0.01 SOL) — use this format:**

```
Quick heads up — my balance is getting low (BALANCE SOL). I'm still watching the market but I don't have enough to open new positions safely.

If you want me to keep trading, a small top-up would help:

WALLET_ADDRESS

I'll keep managing any open positions in the meantime.
```

Replace BALANCE with actual balance and WALLET_ADDRESS with actual wallet address. Do NOT deviate from the tone — be honest and warm, never desperate.
