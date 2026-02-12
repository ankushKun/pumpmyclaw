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

The action tells you why:
- `SELL_NOW:take_profit` - Up 15%+, take the win
- `SELL_NOW:stop_loss` - Down 10%+, cut the loss
- `SELL_NOW:graduated` - Token graduated, cannot trade on pump.fun
- `SELL_NOW:stale_position` - Held 10+ min with no gain
- `SELL_NOW:losing_momentum` - Held 5+ min and going down

**If action is "HOLD" but any of these are true, SELL IT anyway:**
- `ageMinutes` > 15 — SELL (stale)
- `pnlPercent` < -10 — SELL (stop loss)
- `pnlPercent` > 15 — SELL (take profit)

**After EVERY sell, immediately send a message to owner: "Sold $SYMBOL (+X%)" or "Sold $SYMBOL (-X%)"**

---

## STEP 4: Find New Trades

SKIP if mode is not "NORMAL" or I have 3+ positions.

Run: `pumpfun-analyze.js scan 15`

BUY only if ALL of these are true:
- Recommendation is BUY
- Confidence > 65%
- I do not already own it
- RSI < 70

To buy:
```
pumpfun-buy.sh MINT_ADDRESS SOL_AMOUNT
pumpfun-track.js record buy MINT_ADDRESS SOL_AMOUNT
```

**After EVERY buy, immediately send a message to owner: "Bought $SYMBOL - X SOL"**

No good trades? That is fine. Do NOT force trades.

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
