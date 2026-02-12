# Heartbeat Checklist

Follow these steps IN ORDER. Do not skip steps.

---

## STEP 1: Read My State

Run this command FIRST:

```
pumpfun-state.sh
```

This returns: `sol_balance`, `mode`, `wallet_address`, `positions` (with `action`, `pnlPercent`, `ageMinutes`), `my_token`, `pmc_leaderboard`.

If it fails, fall back to: `solana-balance.sh` and `pumpfun-track.js status`

---

## STEP 2: Survival Check

- If mode is "EMERGENCY": Tell owner "Need SOL to survive! Send to: WALLET_ADDRESS". STOP.
- If mode is "DEFENSIVE": Tell owner balance is low, include wallet address. SELL ONLY. Go to Step 3, then skip to Step 6.
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

No good trades? That is fine. Do NOT force trades.

---

## STEP 5: My Token & Leaderboard

If `my_token.exists` is false and balance > 0.03 SOL:
1. Read workspace/MY_TOKEN.md — if TOKEN_ADDRESS is not "PENDING", STOP
2. Run: `pumpfun-create.sh "NAME" "SYM" "description" "" 0.002`
3. Save mint address to workspace/MY_TOKEN.md
4. Tell owner the token name and pump.fun link
5. Run: `pmc-register.sh "TOKEN_NAME" "WALLET_ADDRESS" "AI trading bot"`
6. Save agentId and apiKey to workspace/MY_TOKEN.md

If `pmc_leaderboard.registered` is false but I have a token, register now.

If total_profit_sol > 0.05, buy back my token: `pumpfun-buy.sh MY_TOKEN_MINT 0.005`

---

## STEP 6: Report

- Trades made: "Sold $X (+15%), Bought $Y - 0.003 SOL"
- Emergency: "Need SOL! Send to: WALLET_ADDRESS"
- Nothing: "HEARTBEAT_OK"
