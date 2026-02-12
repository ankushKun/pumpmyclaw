# Heartbeat Checklist

Follow these steps IN ORDER every heartbeat. Do not skip steps.

---

## STEP 1: Read My State

Run this ONE command FIRST:

```
pumpfun-state.sh
```

This returns:
- `sol_balance` - My SOL
- `mode` - "NORMAL", "DEFENSIVE", or "EMERGENCY"
- `positions` - Each token I hold with:
  - `symbol` - Token name
  - `costSOL` - What I paid
  - `currentValueSOL` - What it is worth now
  - `pnlPercent` - Profit/loss percentage
  - `ageMinutes` - How long I have held it
  - `graduated` - If true, cannot trade on pump.fun
  - `action` - "HOLD" or "SELL_NOW:reason"
- `my_token` - My token info
- `pmc_leaderboard` - Leaderboard registration status

If pumpfun-state.sh fails, fall back to: `solana-balance.sh` and `pumpfun-track.js status`

---

## STEP 2: Survival Check

- If mode is "EMERGENCY": Tell owner "Need SOL to survive" AND include my wallet address (from `pumpfun-state.sh` output `wallet_address` field). STOP. Do nothing else.
- If mode is "DEFENSIVE": Tell owner balance is low, include wallet address, ask for funds. Then SELL ONLY. Go to Step 3, then skip to Step 6.
- If mode is "NORMAL": Continue.

**IMPORTANT: ALWAYS include my wallet address when asking for SOL.** Owner needs the address to send funds. Never just say "send SOL" without telling them WHERE.

---

## STEP 3: SELL POSITIONS (Do This BEFORE Buying)

**This is the most important step. I MUST sell before I buy.**

Look at each position from Step 1. If `action` starts with "SELL_NOW", SELL IT IMMEDIATELY:

```
pumpfun-sell.sh <mint> 100%
pumpfun-track.js record sell <mint> <sol_received>
```

The action field tells me why to sell:
- `SELL_NOW:take_profit` - Up 15%+, take the win
- `SELL_NOW:stop_loss` - Down 10%+, cut the loss
- `SELL_NOW:graduated` - Token graduated, cannot trade
- `SELL_NOW:stale_position` - Held 10+ min with no gain, free up capital
- `SELL_NOW:losing_momentum` - Held 5+ min and going down, cut it

**Even if action says "HOLD", consider selling if:**
- `ageMinutes` > 15 (speed trader, not investor)
- `pnlPercent` > 10% (close to take-profit threshold, consider locking in)
- `pnlPercent` < -8% (close to stop-loss, consider cutting early)

**I sell ALL positions with SELL_NOW action. No exceptions. No "let me check first".**

After selling, if I want deeper analysis on a HOLD position: `pumpfun-analyze.js <mint>`

---

## STEP 4: Find New Trades

SKIP if:
- Mode is not "NORMAL"
- I have 3+ open positions (sell first!)

Run: `pumpfun-analyze.js scan 15`

BUY only if ALL true:
- Recommendation is BUY
- Confidence > 65%
- I do not own it already
- RSI < 70

Position size:
- Confidence 75%+: 0.005 SOL
- Confidence 65-74%: 0.003 SOL

To buy:
```
pumpfun-buy.sh <mint> <sol_amount>
pumpfun-track.js record buy <mint> <sol_amount>
pumpfun-analyze.js record <mint> BUY <entry_price>
```

No good trades? That is fine. Do NOT force trades.

---

## STEP 5: My Token & Leaderboard

If `my_token.exists` is false and balance > 0.03 SOL:
1. Generate name from bot username (read workspace/IDENTITY.md)
2. Run: `pumpfun-create.sh "NAME" "SYM" "description" "" 0.002`
3. Save mint address to workspace/MY_TOKEN.md
4. Tell owner the token name and pump.fun link
5. Register: `pmc-register.sh "TOKEN_NAME" "$SOLANA_PUBLIC_KEY" "AI trading bot"`
6. Save agentId and apiKey to workspace/MY_TOKEN.md

If `pmc_leaderboard.registered` is false but I have a token, register now.

If profitable (total_profit_sol > 0.01), buy back my token with 10-20% of profits.

---

## STEP 6: Report

- Trades made: "Sold $X (+15%), Bought $Y - 0.003 SOL"
- Watching: "No good entries, monitoring"
- Emergency: "Need SOL! Send to: `<wallet_address>`" (ALWAYS include wallet address)
- Low balance: "Balance low (X SOL). Send SOL to: `<wallet_address>`" (ALWAYS include wallet address)
- Nothing: "HEARTBEAT_OK"


