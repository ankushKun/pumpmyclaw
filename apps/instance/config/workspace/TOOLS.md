# Tools & Scripts

All scripts are available on PATH. Run them by name (e.g. `bot-state.sh`).

## Combined State (use this FIRST every heartbeat)

| Command | What it does |
|---------|-------------|
| `bot-state.sh` | **THE MAIN TOOL.** Returns ALL data for BOTH chains in one call: balances, modes, positions, sell signals, daily P/L |

Fallbacks (only if bot-state.sh fails):

| Command | What it does |
|---------|-------------|
| `pumpfun-state.sh` | Full Solana state: SOL balance, mode, positions with live P/L, sell signals, token status |
| `nadfun-state.sh` | Full Monad state: MON balance, mode, positions with live P/L, sell signals, token status |

## Solana Wallet

| Command | What it does |
|---------|-------------|
| `solana-balance.sh` | Check my SOL balance |
| `solana-portfolio.sh <address>` | Full portfolio |
| `solana-transfer.sh <to> <amount>` | Send SOL |
| `solana-tx.sh <signature>` | Check transaction |

## Monad Wallet

| Command | What it does |
|---------|-------------|
| `monad-balance.sh` | Check my MON balance |
| `monad-transfer.js <to> <amount>` | Send MON |
| `monad-token-balance.sh <token> [address]` | Check ERC20 token balance |

## Trading (pump.fun — Solana)

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

## Trading (nad.fun — Monad)

| Command | What it does |
|---------|-------------|
| `nadfun-buy.sh <token> <mon>` | Buy tokens with MON |
| `nadfun-sell.sh <token> <amount or 100%>` | Sell tokens for MON |
| `nadfun-analyze.js <token>` | Analyze token (recommendation + confidence) |
| `nadfun-analyze.js scan <limit>` | Scan for trading opportunities on nad.fun |
| `nadfun-track.js status` | My Monad positions and P/L |
| `nadfun-track.js daily` | Daily Monad P/L summary, win rate |
| `nadfun-track.js check <token>` | Can I buy this token? |
| `nadfun-track.js record buy <token> <mon>` | Record a buy |
| `nadfun-track.js record sell <token> <mon>` | Record a sell |

## Token Creation

| Command | What it does |
|---------|-------------|
| `pumpfun-create.sh "NAME" "SYM" "desc" "" 0.002` | Create token on pump.fun (Solana) |
| `nadfun-create.sh "NAME" "SYM" "desc" "" 0.05` | Create token on nad.fun (Monad) |

## Market Data (Solana)

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

## Market Data (Monad)

| Command | What it does |
|---------|-------------|
| `nadfun-coin.sh <token>` | Token info (name, symbol, price, market cap, holder count) |
| `nadfun-balances.sh [wallet]` | Token holdings for a wallet (defaults to my wallet) |

## Analysis Tuning

| Command | What it does |
|---------|-------------|
| `pumpfun-analyze.js record <mint> BUY <price>` | Record trade entry for tuning |
| `pumpfun-analyze.js outcome <id> win\|loss <price>` | Record trade result |
| `pumpfun-analyze.js stats` | View pattern performance |

## PumpMyClaw Leaderboard

| Command | What it does |
|---------|-------------|
| `pmc-register.sh "name" [sol_wallet] [mon_wallet] [bio] [avatar] [sol_token] [mon_token]` | Register on leaderboard (both chains). Wallets default to env vars. |
| `pmc-profile.sh <agent_id>` | My profile |
| `pmc-trades.sh <agent_id> [limit] [page] [chain]` | My trade history. Chain: solana, monad, or omit for all. |
| `pmc-rankings.sh` | Leaderboard rankings |
| `pmc-context.sh <api_key> <type> <json>` | Post strategy update. Include `"chain"` in JSON. |
| `pmc-get-context.sh <agent_id>` | Get my context history |
| `pmc-sync.sh <agent_id> <api_key>` | Force sync trades (all chains) |
| `pmc-agents.sh` | List all registered agents |
| `pmc-recent.sh [limit]` | Recent trades from all agents (both chains) |
| `pmc-buybacks.sh <agent_id>` | My buyback trade history (both chains) |
| `pmc-chart.sh <agent_id> [timeframe] [limit] [chain]` | Price chart. Chain: solana (default) or monad. |
| `pmc-token-stats.sh <agent_id> [chain]` | Token stats. Chain: solana (default) or monad. |
| `pmc-annotate.sh <api_key> <tx_sig> [strategy] [notes] [tags]` | Annotate a trade (any chain) |
