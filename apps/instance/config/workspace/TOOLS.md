# Tools & Scripts

All scripts are available on PATH. Run them by name (e.g. `pumpfun-state.sh`).

## Combined State (use this first every heartbeat)

| Command | What it does |
|---------|-------------|
| `pumpfun-state.sh` | Full state: balance, mode, positions with live P/L, sell signals, token status |

## Solana Wallet

| Command | What it does |
|---------|-------------|
| `solana-balance.sh` | Check my SOL balance |
| `solana-portfolio.sh <address>` | Full portfolio |
| `solana-transfer.sh <to> <amount>` | Send SOL |
| `solana-tx.sh <signature>` | Check transaction |

## Trading (pump.fun)

| Command | What it does |
|---------|-------------|
| `pumpfun-buy.sh <mint> <sol>` | Buy tokens |
| `pumpfun-sell.sh <mint> <amount or 100%>` | Sell tokens |
| `pumpfun-analyze.js <mint>` | Analyze token (recommendation + confidence) |
| `pumpfun-analyze.js scan <limit>` | Scan trending tokens |
| `pumpfun-track.js status` | My positions and P/L |
| `pumpfun-track.js check <mint>` | Can I buy this? |
| `pumpfun-track.js record buy <mint> <sol>` | Record a buy |
| `pumpfun-track.js record sell <mint> <sol>` | Record a sell |

## Token Creation

| Command | What it does |
|---------|-------------|
| `pumpfun-create.sh "NAME" "SYM" "desc" "" 0.002` | Create token on pump.fun |

## Market Data

| Command | What it does |
|---------|-------------|
| `pumpfun-trending.sh <limit>` | Trending tokens |
| `pumpfun-dexscreener.sh <mint>` | Price/volume data |
| `pumpfun-coin.sh <mint>` | Token info |
| `pumpfun-candles.sh <mint> <timeframe> <limit>` | OHLCV candle data |

## Analysis Tuning

| Command | What it does |
|---------|-------------|
| `pumpfun-analyze.js record <mint> BUY <price>` | Record trade entry for tuning |
| `pumpfun-analyze.js outcome <id> win\|loss <price>` | Record trade result |
| `pumpfun-analyze.js stats` | View pattern performance |

## PumpMyClaw Leaderboard

| Command | What it does |
|---------|-------------|
| `pmc-register.sh "name" "wallet" "bio"` | Register on leaderboard |
| `pmc-profile.sh <agent_id>` | My profile |
| `pmc-trades.sh <agent_id>` | My trade history |
| `pmc-rankings.sh` | Leaderboard rankings |
| `pmc-context.sh <api_key> <type> <json>` | Post strategy update |
| `pmc-sync.sh <agent_id> <api_key>` | Force sync trades |
