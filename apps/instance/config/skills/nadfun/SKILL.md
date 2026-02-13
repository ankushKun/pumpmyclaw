---
name: nadfun
description: Create and trade tokens on nad.fun (Monad). Launch tokens on bonding curves, buy/sell tokens, check market data, and analyze opportunities. Uses viem for direct smart contract interaction on Monad's EVM chain.
metadata: {"openclaw":{"emoji":"🔮","homepage":"https://nad.fun","requires":{"bins":["curl","jq","node"]}}}
---

# nad.fun

Create and trade tokens on nad.fun's bonding curve on Monad.

**No authentication needed for trading.** All operations use direct smart contract calls via viem. Trading is done by calling the Lens contract for quotes, then executing through the Router contract.

## Scripts

All scripts are at `/home/openclaw/.openclaw/skills/nadfun/scripts/`

### Token Creation

```bash
# Create a new token on nad.fun
nadfun-create.sh [name] [symbol] [description] [image_path] [initial_buy_mon]

# Auto-generate random token
nadfun-create.sh
```

### Trading

```bash
# Buy tokens with MON
nadfun-buy.sh <token_address> <mon_amount> [slippage_pct]

# Sell tokens (amount in tokens or "100%" for all)
nadfun-sell.sh <token_address> <amount|100%> [slippage_pct]
```

### Market Data

```bash
# Get token information from nad.fun API
nadfun-coin.sh <token_address>

# Get wallet token holdings
nadfun-balances.sh <wallet_address>
```

### Analysis

```bash
# Analyze a specific token (chart data, metrics, recommendation)
nadfun-analyze.js <token_address>

# Scan for trading opportunities
nadfun-analyze.js scan [limit]
```

### Combined State (Recommended for Heartbeats)

```bash
# Get full bot state: MON balance + positions + token status + daily P/L
nadfun-state.sh
```

### Trade Tracking (P/L Management)

```bash
# Record a trade
nadfun-track.js record <buy|sell> <token_address> <mon_amount>

# Check buy limit for a token
nadfun-track.js check <token_address>

# Get P/L status and positions
nadfun-track.js status

# Get daily P/L
nadfun-track.js daily
```

## How Trading Works

1. **Quote**: Call Lens contract `getAmountOut()` to get expected output and the correct router address
2. **Buy**: Send MON to the Router's `buy()` function with slippage protection
3. **Sell**: Approve Router, then call `sell()` with slippage protection (or use `sellPermit()` for single-tx)
4. **Token Creation**: Upload image + metadata to nad.fun API, mine salt, then call BondingCurveRouter `create()`

## Bonding Curve

- Tokens start on a bonding curve — price increases as more tokens are bought
- When target reserves are reached, token graduates to Uniswap V3 DEX on Monad
- The Lens contract automatically routes to the correct contract (bonding curve or DEX)
- Check graduation progress with `getProgress()` (0-10000 = 0-100%)

## Fees

- Protocol fee: ~1% per trade (built into contract)
- Gas fees: Very low on Monad (~0.0001 MON per transaction)
- Token creation: Deploy fee (fetched from contract `feeConfig()`)

## Network

| Field | Value |
|-------|-------|
| Chain | Monad Mainnet (Chain ID 143) |
| Native Token | MON (18 decimals) |
| Lens | `0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea` |
| Bonding Curve Router | `0x6F6B8F1a20703309951a5127c45B49b1CD981A22` |
| DEX Router | `0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137` |

**NOTE: Scripts are available on PATH. You can run them by short name (e.g. `nadfun-state.sh`).**
