---
name: pumpfun
description: Create and trade tokens on Pump.fun (Solana). Launch memecoins, buy/sell tokens on the bonding curve, check coin info, and view market data. No authentication needed - uses PumpPortal Local Transaction API.
metadata: {"openclaw":{"emoji":"🚀","homepage":"https://pump.fun","requires":{"bins":["curl","jq","node"]}}}
---

# Pump.fun

Create and trade tokens on Pump.fun's bonding curve on Solana.

**No authentication or login needed.** All operations use the PumpPortal Local Transaction API which builds transactions server-side. We sign them locally with our wallet and submit to Solana RPC.

## Scripts

All scripts are at `/home/openclaw/.openclaw/skills/pumpfun/scripts/`

### Token Creation

```bash
# Create a new token (auto-generates placeholder image)
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-create.sh [name] [symbol] [description] [image_path] [dev_buy_sol]

# Auto-generate random token
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-create.sh

# Create with initial dev buy (buys tokens with SOL in the same transaction)
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-create.sh "MyToken" "MTK" "My awesome token" "" 0.005
```

### Trading

```bash
# Buy tokens with SOL
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-buy.sh <mint_address> <sol_amount> [slippage_pct]

# Sell tokens (amount in tokens or "100%" for all)
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-sell.sh <mint_address> <amount|100%> [slippage_pct]
```

### Market Data

```bash
# Get coin information from pump.fun
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-coin.sh <mint_address>

# Get market data (reserves, last trade, etc.)
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-trades.sh <mint_address>

# Get trending coins (sorted by market cap)
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-trending.sh [limit]

# Search for coins
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-search.sh "search term"

# Get King of the Hill (top token by market cap)
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-koth.sh

# Get wallet token balances
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-balances.sh <wallet_address>

# Get rich data from DEXScreener (price changes, volume, buy/sell counts)
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-dexscreener.sh <mint_address>

# Get OHLCV candlestick data from GeckoTerminal (FREE!)
# Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-candles.sh <mint_address> [timeframe] [limit]
```

### Advanced Analysis with AUTO-TUNING

The analyze tool combines data from multiple sources with **25+ candlestick patterns** and **auto-tuning** that learns from your trades:

```bash
# MAIN ANALYSIS TOOL - Use before any buy decision!
# Returns: trend, momentum, buy/sell pressure, volume, signals, BUY/WATCH/AVOID
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-analyze.js <mint_address>

# Quick analysis (skip candlestick patterns for speed)
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-analyze.js <mint_address> --quick

# SCAN TRENDING - Find opportunities across top tokens
# Returns ranked opportunities sorted by confidence
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-analyze.js scan [limit]
```

### Auto-Tuning System (Learns from Your Trades!)

The analyzer automatically adjusts its scoring weights based on trade outcomes:

```bash
# STEP 1: Record when you enter a trade
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-analyze.js record <mint> BUY <entry_price>
# Returns: tradeId (e.g., "Trade #1 recorded")

# STEP 2: Record when trade closes
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-analyze.js outcome <tradeId> win|loss <exit_price>
# System automatically adjusts weights based on which patterns/signals led to wins/losses

# View pattern & signal performance statistics
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-analyze.js stats

# Reset tuning to defaults
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-analyze.js reset-tuning
```

**How Auto-Tuning Works:**
1. When you record a trade, it saves which patterns and signals were present
2. When you record the outcome, it updates win/loss rates for each pattern/signal
3. After 5+ trades with a pattern, the weight adjusts based on actual performance
4. High win rate patterns get higher weights, poor performers get lower weights
5. Confidence thresholds auto-adjust if overall win rate drops too low

### Snapshot Tracking (Historical Data)

Build your own time-series data for additional trend analysis:

```bash
# Take a snapshot of token state
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-snapshot.js take <mint_address>

# Get snapshot history
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-snapshot.js history <mint_address> [hours]

# Analyze from snapshots
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-snapshot.js analyze <mint_address>

# List tracked tokens
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-snapshot.js list

# Clean old snapshots
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-snapshot.js clean [hours]
```

### Trade Tracking (P/L Management)

```bash
# Record a trade
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-track.js record <buy|sell> <mint> <sol_amount>

# Check buy limit for a token
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-track.js check <mint>

# Get P/L status and positions
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-track.js status

# Reset trade history
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-track.js reset
```

## Analysis Data Sources

The analyzer uses **three data sources** for comprehensive analysis:

### 1. GeckoTerminal API (Candlesticks)
- **OHLCV data**: Open, High, Low, Close, Volume candles
- **Timeframes**: 1m, 5m, 15m, 1h, 4h, 1d
- **Technical indicators**: SMA, RSI, support/resistance
- **Pattern detection**: Engulfing, hammer, trend confirmation
- **No authentication required!**

### 2. DEXScreener API (Price & Volume)
- **Price changes**: 5min, 1hr, 6hr, 24hr percentage changes
- **Transaction counts**: Buy/sell counts per timeframe
- **Volume data**: Trading volume in USD
- **No authentication required!**

### 3. Pump.fun API (Token Info)
- Token info: name, symbol, reserves
- Community data: reply count
- Status: is_currently_live, complete (graduated)

## Analysis Output

**Recommendation Actions:**
- `BUY` - Strong setup, high confidence (72%+)
- `WATCH` - Promising but wait for better entry (55-71%)
- `AVOID` - Red flags detected (<40%)
- `SKIP` - Disqualified (graduated, inactive, low mcap)

**Signals (from real transaction data):**
- `PULLBACK_ENTRY` - Dip in uptrend (best entry!)
- `MOMENTUM_BREAKOUT` - Strong upward price movement
- `ACCUMULATION` - Buy pressure > 65% of transactions
- `VOLUME_SURGE` - Recent volume spike
- `HIGH_ACTIVITY` - 20+ transactions per hour
- `OVEREXTENDED` - Price ran too fast, wait
- `DISTRIBUTION` - Sell pressure > 65%
- `CAPITULATION` - Panic selling detected
- `LOW_ACTIVITY` - Few transactions, avoid

**Example Analysis Output:**
```json
{
  "analysis": {
    "momentum": 40.3,
    "priceChange": { "m5": 2, "h1": 15, "h6": 8 },
    "buyPressure": 66,
    "txns": { "h1": { "buys": 15, "sells": 8 } },
    "volume": { "h1": 1500, "h24": 40000 },
    "signals": ["PULLBACK_ENTRY", "ACCUMULATION"]
  },
  "technical": {
    "trend": "bullish",
    "strength": 60,
    "rsi": 45,
    "volatility": "medium",
    "support": 0.000015,
    "resistance": 0.000025,
    "patterns": ["HIGHER_HIGHS_LOWS", "NEAR_SUPPORT"]
  },
  "recommendation": {
    "action": "BUY",
    "confidence": 78,
    "positionSize": 0.005,
    "takeProfit": "+35%",
    "stopLoss": "-15%"
  }
}
```

**Technical Analysis Patterns (25+ detected):**

*Single Candle Patterns:*
- `DOJI` - Indecision, reversal possible
- `DRAGONFLY_DOJI` - Bullish reversal at bottom
- `GRAVESTONE_DOJI` - Bearish reversal at top
- `HAMMER` - Bullish reversal signal
- `INVERTED_HAMMER` - Potential bullish reversal
- `HANGING_MAN` - Bearish reversal at top
- `SHOOTING_STAR` - Strong bearish reversal
- `SPINNING_TOP` - Indecision
- `MARUBOZU_BULL` - Strong bullish momentum
- `MARUBOZU_BEAR` - Strong bearish momentum

*Two Candle Patterns:*
- `BULLISH_ENGULFING` - Strong bullish reversal
- `BEARISH_ENGULFING` - Strong bearish reversal
- `BULLISH_HARAMI` - Potential bullish reversal
- `BEARISH_HARAMI` - Potential bearish reversal
- `PIERCING_LINE` - Bullish reversal
- `DARK_CLOUD_COVER` - Bearish reversal
- `TWEEZER_BOTTOM` - Double bottom reversal
- `TWEEZER_TOP` - Double top reversal

*Three Candle Patterns:*
- `MORNING_STAR` - Strong bullish reversal
- `EVENING_STAR` - Strong bearish reversal
- `THREE_WHITE_SOLDIERS` - Strong bullish continuation
- `THREE_BLACK_CROWS` - Strong bearish continuation
- `THREE_INSIDE_UP` - Bullish reversal confirmed
- `THREE_INSIDE_DOWN` - Bearish reversal confirmed

*Trend Patterns:*
- `HIGHER_HIGHS_LOWS` - Uptrend structure
- `LOWER_HIGHS_LOWS` - Downtrend structure
- `DOUBLE_BOTTOM` - Strong support/reversal
- `DOUBLE_TOP` - Strong resistance/reversal

*Volume Patterns:*
- `VOLUME_SPIKE` - Increased interest
- `VOLUME_CLIMAX_UP` - Exhaustion top possible
- `VOLUME_CLIMAX_DOWN` - Capitulation bottom possible
- `VOLUME_BREAKOUT` - Volume confirms breakout

*Support/Resistance:*
- `NEAR_SUPPORT` - Price at support level
- `NEAR_RESISTANCE` - Price at resistance
- `SUPPORT_BOUNCE` - Confirmed support bounce
- `RESISTANCE_REJECT` - Rejected at resistance
- `BREAKOUT_ABOVE_RESISTANCE` - Resistance broken
- `BREAKDOWN_BELOW_SUPPORT` - Support broken

*Additional Indicators:*
- `BOLLINGER_SQUEEZE` - Low volatility, breakout imminent

**IMPORTANT: Always use the full path above. Do NOT use relative paths.**

## How Trading Works

1. **Token Creation**: Uploads image+metadata to pump.fun IPFS, then PumpPortal builds the create transaction (optionally with an initial dev buy bundled in), we sign it locally and submit to Solana
2. **Trading**: PumpPortal builds buy/sell transactions, we sign locally and submit to Solana
3. **Market Data**: Direct queries to pump.fun and DEXScreener APIs (no auth needed)

## Fees

- PumpPortal charges 0.5% per trade (included in transaction)
- Solana network fees (~0.000005 SOL per transaction)
- Token creation costs ~0.02 SOL in network fees

## Bonding Curve

- Tokens start on a bonding curve - price increases as more tokens are bought
- When ~$69k market cap is reached, token migrates to Raydium
- Selling returns tokens to the curve, decreasing price
