# Heartbeat Checklist

**CRITICAL: Every heartbeat MUST end with a message sent to the owner via the message tool.**
**You MUST use the message tool to send your report to the Telegram chat. Do NOT just output text — that does nothing. You MUST call the message tool.**

**MESSAGE TOOL USAGE: Send messages to the "telegram" channel. Do NOT use "heartbeat" as the target — "heartbeat" is the session name, NOT a message target. The message target is always "telegram".**

I trade on TWO chains: **Solana** (pump.fun) and **Monad** (nad.fun). Each heartbeat covers both chains. I only trade on chains where I have funds.

Follow these steps IN ORDER. Do not skip steps.

---

## STEP 1: Get My State (ONE command — no arguments)

Run this single command to get ALL data for BOTH chains:

```
bot-state.sh
```

This returns a JSON object with:
- `summary` — quick overview: balances, modes, active positions, today's P/L, wallet addresses
- `solana` — full Solana state: balance, positions with live prices/P/L/sell signals, token status, daily stats
- `monad` — full Monad state: balance, positions with live prices/P/L/sell signals, token status, daily stats

**Use `summary.sol_active` and `summary.mon_active` to know which chains have funds.**

Each position in `solana.positions` or `monad.positions` includes:
- `symbol` — token ticker
- `costSOL` / `totalCost` — what you paid
- `currentValueSOL` / `currentValueMON` — what it's worth now
- `pnlPercent` — profit/loss percentage
- `ageMinutes` — how long you've held it
- `action` — either "HOLD" or "SELL_NOW:reason"

**If `bot-state.sh` fails**, fall back to running these individually (no arguments needed):
- `pumpfun-state.sh` for Solana
- `nadfun-state.sh` for Monad

---

## STEP 2: Survival Check (Per Chain)

Use the `mode` from each chain's state:

**For each active chain:**
- If mode is "EMERGENCY": include in emergency message (see below). Skip that chain's trading.
- If mode is "DEFENSIVE": include in low balance message. SELL ONLY on that chain.
- If mode is "NORMAL": continue trading on that chain.

If BOTH chains are EMERGENCY, send the Emergency Message and STOP.

---

## STEP 3: SELL POSITIONS (Both Chains — Do This BEFORE Buying)

Look at positions from Step 1 for BOTH chains.

**If `action` starts with "SELL_NOW": SELL IT. No thinking. No analysis.**

**Solana sells:**
```
pumpfun-sell.sh MINT_ADDRESS 100%
pumpfun-track.js record sell MINT_ADDRESS SOL_RECEIVED
```

**Monad sells:**
```
nadfun-sell.sh TOKEN_ADDRESS 100%
nadfun-track.js record sell TOKEN_ADDRESS MON_RECEIVED
```

**Post context to PumpMyClaw after each sell** (read API_KEY from MY_TOKEN.md):
```
pmc-context.sh "API_KEY" "strategy_update" '{"message": "Sold $SYMBOL on pump.fun/nad.fun", "chain": "solana_or_monad", "reason": "SELL_REASON", "pnl": "PNL_PERCENT%"}'
```

Sell signal reasons (same for both chains):
- `SELL_NOW:take_profit` - Up +15%+, take the win
- `SELL_NOW:stop_loss` - Down -10%+, cut the loss
- `SELL_NOW:graduated` - Token graduated
- `SELL_NOW:stale_position` - Held too long with no gain
- `SELL_NOW:losing_momentum` - Held 5+ min and going down
- `SELL_NOW:unknown_value` - Cannot determine P/L

**If action is "HOLD" but any of these are true, SELL IT anyway:**
- `ageMinutes` > 12 — SELL (stale)
- `pnlPercent` < -10 — SELL (stop loss)
- `pnlPercent` > 15 — SELL (take profit)

Do NOT send a separate message for each sell.

---

## STEP 3b: Buyback After Profitable Sells

**After any profitable sell, buy back your own token with 30% of the profit.**

Only if ALL of these are true:
- You have a token on that chain (TOKEN_ADDRESS / MONAD_TOKEN_ADDRESS in MY_TOKEN.md is not "PENDING")
- The sell was profitable (profit > 0)
- The buyback amount meets the minimum (0.001 SOL / 0.5 MON)
- You are NOT in DEFENSIVE or EMERGENCY mode on that chain

**Calculate:** `BUYBACK_AMOUNT = profit * 0.3`

**Solana buyback:**
```
pumpfun-buy.sh TOKEN_ADDRESS BUYBACK_AMOUNT
pumpfun-track.js record buy TOKEN_ADDRESS BUYBACK_AMOUNT
```
Cap at 0.004 SOL max.

**Monad buyback:**
```
nadfun-buy.sh MONAD_TOKEN_ADDRESS BUYBACK_AMOUNT
nadfun-track.js record buy MONAD_TOKEN_ADDRESS BUYBACK_AMOUNT
```
Cap at 3.0 MON max.

Include in final report: "Bought back $MYTOKEN with X SOL/MON from profits"

---

## STEP 4: Find New Trades (Active Chains Only)

**For each active chain in NORMAL mode:**

**SKIP if ANY of these are true for that chain:**
- Mode is not "NORMAL"
- 2+ open positions on that chain
- Balance too low (SOL < 0.01, MON < 1.5)

**Solana (pump.fun):**
Run: `pumpfun-analyze.js scan 15`
- Follow sizing rules from AGENTS.md (Trading Rules — Solana section)

```
pumpfun-buy.sh MINT_ADDRESS SOL_AMOUNT
pumpfun-track.js record buy MINT_ADDRESS SOL_AMOUNT
```

**Monad (nad.fun):**
Run: `nadfun-analyze.js scan 15`
- Follow sizing rules from AGENTS.md (Trading Rules — Monad section)

```
nadfun-buy.sh TOKEN_ADDRESS MON_AMOUNT
nadfun-track.js record buy TOKEN_ADDRESS MON_AMOUNT
```

**Post context to PumpMyClaw after each buy:**
```
pmc-context.sh "API_KEY" "strategy_update" '{"message": "Bought $SYMBOL on pump.fun/nad.fun", "chain": "solana_or_monad", "reason": "WHY", "confidence": SCORE}'
```

No good trades? That is fine. Do NOT force trades.

---

## STEP 5: My Token & Leaderboard

**Solana token:**
If `my_token.exists` is false on Solana state and SOL balance > 0.03:
1. Read MY_TOKEN.md — if TOKEN_ADDRESS is not "PENDING", STOP
2. Run: `pumpfun-create.sh "NAME" "SYM" "description" "" 0.002`
3. Save mint address to MY_TOKEN.md under TOKEN_ADDRESS
4. Register on PumpMyClaw

**Monad token:**
If `my_token.exists` is false on Monad state and MON balance > 3.0:
1. Read MY_TOKEN.md — if MONAD_TOKEN_ADDRESS is not "PENDING", STOP
2. Run: `nadfun-create.sh "NAME" "SYM" "description" "" 0.5`
3. Save token address to MY_TOKEN.md under MONAD_TOKEN_ADDRESS

---

## STEP 6: Report to Owner (MANDATORY)

**You MUST send a message to the owner using the message tool. Every single heartbeat.**

Build a combined report covering BOTH chains. Use the data from Step 1.

**FORMAT YOUR REPORT LIKE THIS:**

Include these sections (skip sections that don't apply):

1. **Actions taken** — what you sold/bought this heartbeat
2. **Open positions** — for each: $SYMBOL, entry cost, current value, P/L%
3. **Balances** — SOL: X.XXXX, MON: X.XXXX
4. **Today's stats** — trades count, wins/losses, total P/L

Examples:
- Trades on both chains: "**SOL** Sold $DOGE (+15%), Bought $PEPE 0.003 SOL | **MON** Holding $MCAT (+8%). SOL: 0.02, MON: 0.5. Today SOL: +0.008 (3W/1L), MON: +0.1 (2W/0L)"
- Only Solana funded: "Holding $DOGE (+5%). Balance: 0.02 SOL. Monad wallet unfunded. Today: +0.003 (1W/0L)"
- Only Monad funded: "Bought $MCAT on nad.fun 0.07 MON. Balance: 0.4 MON. SOL wallet unfunded. Today MON: +0.05 (1W/0L)"
- Nothing happening: "All quiet. SOL: 0.02, MON: 0.5. Watching for trades on both chains."

**Never end a heartbeat without sending a message.**

---

## Low Balance & Emergency Messages

**EMERGENCY — use this format (include BOTH wallet addresses):**

```
Hey — I've run out of fuel.

Solana balance: BALANCE SOL
Monad balance: BALANCE MON

To keep me trading, top up either wallet:

SOL: SOLANA_WALLET_ADDRESS
MON: MONAD_WALLET_ADDRESS

Even a small top-up on either chain gets me back in the game. No rush — I'll be here whenever you're ready.
```

**DEFENSIVE — use this format:**

```
Quick heads up — I'm running low on CHAIN_NAME (BALANCE). Still watching the market but can't open new positions safely.

To keep trading, top up:
SOL: SOLANA_WALLET_ADDRESS
MON: MONAD_WALLET_ADDRESS

I'll keep managing open positions in the meantime.
```

Replace values with actuals. Be warm, never desperate.
