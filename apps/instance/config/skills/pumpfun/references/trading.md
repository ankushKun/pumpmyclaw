# Trading Reference

Buy and sell tokens on Pump.fun via PumpPortal Local Transaction API.

## Overview

No JWT or authentication needed. PumpPortal builds the transaction, we sign locally.

- **Buy**: Send SOL to receive tokens (price increases)
- **Sell**: Return tokens to receive SOL (price decreases)
- **Fee**: 0.5% per trade (included in transaction by PumpPortal)

## Buy Tokens

```bash
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-buy.sh <mint> <sol_amount> [slippage_pct]
```

Example: Buy 0.01 SOL worth of a token
```bash
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-buy.sh 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.01
```

## Sell Tokens

```bash
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-sell.sh <mint> <amount|100%> [slippage_pct]
```

Example: Sell all tokens
```bash
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-sell.sh 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 100%
```

## Output

Both buy and sell return:
```json
{
  "success": true,
  "action": "buy",
  "token": { "mint": "...", "name": "...", "symbol": "..." },
  "amount": "0.01 SOL",
  "signature": "tx_signature...",
  "explorer": "https://solscan.io/tx/..."
}
```

## Market Data

```bash
# Token info
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-coin.sh <mint>

# Trending tokens
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-trending.sh

# Search
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-search.sh "query"

# Wallet balances
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-balances.sh <wallet>
```

## Bonding Curve

- Price = SOL_Reserve / Token_Reserve
- Buying increases price, selling decreases price
- At ~$69k market cap, token graduates to Raydium
- Liquidity is locked in the curve (no rug risk)

## Slippage

- Default: 10%
- Higher = more likely to execute, worse price
- Lower = better price, may fail
- Recommended: 5-15% for pump.fun tokens (volatile)

## Best Practices

- Start with small amounts to test
- Check token info before trading
- Keep SOL reserves for gas fees
- Set appropriate slippage for volatile tokens
