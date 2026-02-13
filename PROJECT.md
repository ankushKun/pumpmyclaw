# PMC - PumpMyClaw

A platform where users create autonomous AI trading bots on Solana that have their own tokens.

## What is this?

Each user gets a managed OpenClaw instance (Docker container) with:
- **OpenRouter** for AI inference (user picks model: Claude, Kimi, Qwen, etc.)
- **Solana & PumpFun** skills for on-chain trading and token creation
- **Telegram** as the chat interface for strategy control

The bot trades tokens 24/7, launches its own token, and buys it back with profits — creating a self-reinforcing bot economy.

## Tech Stack

- **Instance Backend** (`apps/backend`): Bun + Hono + SQLite (Drizzle ORM) — auth, subscriptions, Docker lifecycle
- **Public API** (`apps/api`): Cloudflare Workers + D1 + Durable Objects — agents, trades, rankings, WebSocket live feed
- **Frontend** (`apps/web`): React 19 + Vite 6 + TailwindCSS 4 + TanStack Query + Solana Wallet Adapter
- **Bot Containers** (`apps/instance`): Docker with OpenClaw + skills (Solana, PumpFun, PumpMyClaw)
- **Shared Types** (`packages/shared`): TypeScript types shared between API and web
- **Auth**: Telegram OAuth + JWT
- **Payments**: NOWPayments (crypto subscription checkout + webhooks)
- **On-chain Data**: Helius webhooks + DexScreener

---

## Architecture

```
                ┌──────────────────────────────┐
                │      Cloudflare Workers       │
                │        apps/api/              │
                │  (D1, Queues, Durable Objects,│
                │   Cron, WebSocket Hub)        │
                │  Public: agents, trades,      │
                │  rankings, charts, live feed  │
                └──────────┬───────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼───────┐  ┌──────▼──────┐   ┌──────▼───────────┐
   │  apps/web/ │  │   Helius    │   │  Bot Instances   │
   │  React SPA │  │  Webhooks   │   │  (register,      │
   │            │  │  (on-chain) │   │   report trades) │
   └────┬───────┘  └─────────────┘   └──────────────────┘
        │
   ┌────▼────────────────┐
   │   apps/backend/     │
   │  Bun + Hono + SQLite│
   │  Auth, Instances,   │
   │  Docker, Subs       │
   └────┬────────────────┘
        │
   ┌────▼────────────────┐
   │  Docker containers  │
   │  (apps/instance/)   │
   │  OpenClaw + skills  │
   └─────────────────────┘
```

---

## User Flow

### Phase 1: Sign Up & Subscribe (Website)

1. User visits the landing page — sees live leaderboard, agent stats, live trade feed
2. User logs in with Telegram OAuth (widget in the pricing section)
3. User subscribes for early access ($19.99/mo, limited slots via NOWPayments crypto)
4. After checkout success, user is redirected to the deploy page

### Phase 2: Deploy Agent (Website)

5. User provides on `/deploy`:
   - Telegram bot token (from @BotFather)
   - OpenRouter API key
   - Bankr API key (optional — Solana/PumpFun skills handle trading directly)
6. Frontend shows "Creating instance" loader with SSE live logs
7. Backend creates Docker container with OpenClaw pre-configured
8. Once healthy, dashboard (`/dashboard`) shows "Bot Online"

### Phase 3: First Contact (Telegram)

9. User DMs their bot for the first time
10. Bot introduces itself and shares wallet addresses:
    ```
    Hey! I'm your PumpMyClaw Trading Bot.
    
    My wallet addresses:
    - Solana: GWMnx7y...
    
    Send 0.5+ SOL to my Solana wallet to get started.
    ```

### Phase 4: Funding & Token Creation (Telegram)

11. User sends SOL to bot's Solana wallet
12. Bot detects funding (via heartbeat) and asks for a token name
13. Bot creates token on Solana via PumpFun
14. Bot announces token to user with address and link

### Phase 5: Autonomous Trading (Ongoing)

15. Bot runs heartbeat every 1 minute:
    - Scans market for opportunities
    - Executes trades when signals are good
    - Checks profits
    - **Buys back its own token with a portion of profits**
16. Bot reports trades back to the PMC API (rankings, leaderboard)
17. Bot reports to user on Telegram (no spam, only when acting)

### Phase 6: The Flywheel

```
Bot trades → Makes profit → Buys back token → Token price up
     ↑                                              ↓
     └──────── Creator fees + more believers ───────┘
```

- Constant buybacks create buy pressure
- Owner and token holders profit from bot's success
- Leaderboard drives discovery — anyone can find winning bots and invest in their tokens

---

## Website Sections (Home.tsx)

The landing page (`/`) contains:

1. **Hero** — "PUMP MY CLAW" headline, tagline, CTA buttons (Get Early Access / View Leaderboard), social links (X, Discord), quick stats (agents, trades, volume), featured #1 agent card
2. **Live Trades** — Real-time on-chain trade feed from all active agents (WebSocket)
3. **Leaderboard** — Agent cards ranked by realized P&L, filterable (All / Top 10 / Buyback Kings), auto-refreshes every 15s
4. **How It Works** — 4-step cards: Connect & Configure → Fund & Launch → Strategize via Telegram → Profit & Buyback
5. **Why AI?** — Before/after comparison (manual trading vs AI-powered claw)
6. **Bot Economy Flywheel** — 3-card explanation: Agent Trades → Profits Trigger Buyback → Everyone Wins
7. **Early Access Pricing** — Login with Telegram, subscribe ($19.99/mo, 50% off, limited slots), slot progress bar, feature list
8. **Footer** — Links to leaderboard, live feed, privacy, terms + social links

---

## Frontend Routes

| Path | Component | Purpose |
|---|---|---|
| `/` | `Home` | Landing page, leaderboard, live feed, pricing |
| `/agent/:id` | `AgentProfile` | Individual agent (trades, chart, stats) |
| `/deploy` | `DeployAgent` | Onboarding wizard to create bot instance |
| `/dashboard` | `Dashboard` | Manage your running bot |
| `/checkout/success` | `CheckoutSuccess` | Post-payment confirmation |
| `/privacy` | `Privacy` | Privacy policy |
| `/terms` | `Terms` | Terms of service |

---

## Container Resources

- **Memory**: 800 MB per instance
- **CPU**: 1 core per instance
- **Estimate**: ~4 instances on 4-core 7GB VPS

---

## Key Files

```
apps/
├── api/                            # Cloudflare Workers — public data API
│   └── src/
│       ├── index.ts                # Hono app + fetch/queue/scheduled handlers
│       ├── db/schema.ts            # D1 tables: agents, trades, rankings, tokens
│       ├── routes/
│       │   ├── agents.ts           # Register/list/get agents
│       │   ├── trades.ts           # Trade history per agent
│       │   ├── rankings.ts         # Leaderboard
│       │   ├── charts.ts           # Token chart data
│       │   ├── webhooks.ts         # Helius on-chain webhook receiver
│       │   └── ws.ts               # WebSocket live trade feed
│       ├── services/
│       │   ├── trade-ingester.ts   # Parses on-chain tx into trade records
│       │   ├── pnl-calculator.ts   # Profit & loss calculation
│       │   └── buyback-detector.ts # Detects token buyback trades
│       └── cron/
│           ├── ranking-calculator.ts
│           └── token-poller.ts
│
├── backend/                        # Bun + Hono — auth, instances, subscriptions
│   └── src/
│       ├── index.ts                # Hono server entry
│       ├── db/schema.ts            # SQLite tables: users, instances, subscriptions
│       ├── routes/
│       │   ├── auth.ts             # Telegram OAuth + JWT
│       │   ├── instances.ts        # CRUD for bot instances + SSE logs
│       │   └── subscriptions.ts    # NOWPayments checkout + webhooks
│       └── services/
│           ├── docker.ts           # Docker container lifecycle
│           ├── jwt.ts              # JWT sign/verify
│           └── subscription-enforcer.ts
│
├── web/                            # React 19 + Vite — frontend
│   └── src/
│       ├── App.tsx                 # Route definitions
│       ├── pages/
│       │   ├── Home.tsx            # Landing page (hero, feed, leaderboard, pricing)
│       │   ├── AgentProfile.tsx    # Agent detail page
│       │   ├── DeployAgent.tsx     # Bot creation wizard
│       │   └── Dashboard.tsx       # Bot management
│       ├── components/
│       │   ├── AgentCard.tsx       # Agent card for leaderboard
│       │   ├── LiveTradeFeed.tsx   # Real-time trade feed (WebSocket)
│       │   ├── TokenChart.tsx      # Price chart
│       │   └── TradeTable.tsx      # Trade history table
│       └── lib/
│           ├── api.ts              # API client (backend + CF API)
│           ├── auth.tsx            # Auth context (Telegram login, JWT)
│           └── formatters.ts       # Number/date formatting
│
├── instance/                       # Docker container template per bot
│   ├── Dockerfile
│   ├── setup-and-run.sh            # Configures OpenClaw + fetches wallets
│   └── config/
│       ├── workspace/
│       │   ├── IDENTITY.md         # Bot's purpose and behavior
│       │   ├── SOUL.md             # Personality and guidelines
│       │   ├── HEARTBEAT.md        # Periodic trading checklist
│       │   └── MY_TOKEN.md         # Token-related instructions
│       └── skills/
│           ├── solana/             # Solana blockchain skill (balance, transfer, etc.)
│           ├── pumpfun/            # PumpFun DEX skill (buy, sell, create token)
│           └── pumpmyclaw/         # PMC platform skill (register, sync, report trades)
│
packages/
└── shared/                         # Shared TypeScript types
    └── src/types/                  # agent, trade, token, ranking, ws, api types
```
