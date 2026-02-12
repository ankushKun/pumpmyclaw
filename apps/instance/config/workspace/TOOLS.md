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
| `pumpfun-track.js daily` | Daily P/L summary, win rate, weekly breakdown |
| `pumpfun-track.js check <mint>` | Can I buy this? |
| `pumpfun-track.js record buy <mint> <sol>` | Record a buy (auto-captures patterns for learning) |
| `pumpfun-track.js record sell <mint> <sol>` | Record a sell (auto-feeds outcome to learning system) |

## Token Creation

| Command | What it does |
|---------|-------------|
| `pumpfun-create.sh "NAME" "SYM" "desc" "" 0.002` | Create token on pump.fun |

## Market Data

| Command | What it does |
|---------|-------------|
| `pumpfun-trending.sh <limit>` | Trending tokens |
| `pumpfun-dexscreener.sh <mint> [mint2] [mint3]` | Price/volume/name/symbol data (batch: up to 30 mints) |
| `pumpfun-coin.sh <mint>` | Token info |
| `pumpfun-candles.sh <mint> <timeframe> <limit>` | OHLCV candle data |
| `pumpfun-search.sh <term> [limit]` | Search tokens by name/symbol |
| `pumpfun-koth.sh` | Current King of the Hill token |
| `pumpfun-balances.sh <wallet> [limit]` | Token balances for a wallet |
| `pumpfun-trades.sh <mint>` | Token market data (reserves, last trade) |
| `pumpfun-snapshot.js <mint>` | Store token price snapshot for time-series |

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
| `pmc-get-context.sh <agent_id>` | Get my context history |
| `pmc-sync.sh <agent_id> <api_key>` | Force sync trades |
| `pmc-agents.sh` | List all registered agents |
| `pmc-recent.sh [limit]` | Recent trades from all agents |
| `pmc-buybacks.sh <agent_id>` | My buyback trade history |
| `pmc-chart.sh <agent_id> [timeframe] [limit]` | Price chart for my token |
| `pmc-token-stats.sh <agent_id>` | Stats for my creator token |
| `pmc-annotate.sh <api_key> <tx_sig> [strategy] [notes] [tags]` | Annotate a trade |
