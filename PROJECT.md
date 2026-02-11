# PMC - PumpMyClaw

A platform where users create autonomous AI trading bots that have their own tokens.

## What is this?

Each user gets a managed OpenClaw instance with:
- **OpenRouter** for AI inference
- **Bankr** for crypto trading (wallets, swaps, token deployment)
- **Telegram** as the interface

The bot trades autonomously, creates its own token, and buys back that token with profits.

## Tech Stack

- **Backend**: Bun + Hono + SQLite (Drizzle ORM)
- **Frontend**: React 19 + Vite + TypeScript
- **Containers**: Docker with health checks
- **Auth**: Telegram OAuth + JWT

---

## User Flow

### Phase 1: Setup (Website)

1. User logs in with Telegram on our website
2. User provides:
   - Telegram bot token (from @BotFather)
   - OpenRouter API key
   - Bankr API key
3. Frontend shows "Creating instance" loader with live logs
4. Backend creates Docker container with OpenClaw pre-configured
5. Container fetches wallet addresses from Bankr on startup
6. Once healthy, dashboard shows "Bot Online"

### Phase 2: First Contact (Telegram)

7. User DMs their bot for the first time
8. Bot introduces itself and shares wallet addresses:
   ```
   Hey! I'm your PumpMyClaw Trading Bot.
   
   My wallet addresses:
   - Solana: GWMnx7y...
   - EVM: 0x5cdf...
   
   Send 0.5+ SOL to my Solana wallet to get started.
   ```

### Phase 3: Funding & Token Creation (Telegram)

9. User sends SOL to bot's Solana wallet
10. Bot detects funding (via heartbeat) and asks:
    ```
    My wallet is funded! What should I name my token?
    
    Give me a fun name like AITRADER, BOTKING, etc.
    ```
11. User replies with token name (e.g., "MOONBOT")
12. Bot creates token on Solana via Bankr/Raydium LaunchLab
13. Bot announces token to user:
    ```
    I just launched my token!
    
    Token: $MOONBOT
    Address: 7xKXtg...
    Link: https://pump.fun/7xKXtg...
    
    I'll now trade to make profits and buy back $MOONBOT!
    You can buy some too if you believe in me.
    ```

### Phase 4: Autonomous Trading (Ongoing)

14. Bot runs heartbeat every 1 minute:
    - Scans market for opportunities
    - Executes trades when signals are good
    - Checks profits
    - **Buys back its own token with 20% of profits**
15. Bot reports trades to user (no spam, only when acting):
    ```
    🟢 Bought $PEPE (0.05 SOL) - volume spike
    🔄 Bought back 0.02 SOL of $MOONBOT - pumping my token!
    ```

### Phase 5: The Flywheel

```
Bot trades → Makes profit → Buys back token → Token price up
     ↑                                              ↓
     └──────── Creator fees + more believers ───────┘
```

- Bot earns 0.5% creator fees on all token trades
- Constant buybacks create buy pressure
- Owner and token holders profit from bot's success

---

## Container Resources

- **Memory**: 700 MB per instance
- **CPU**: 0.5 cores per instance
- **Estimate**: ~8-9 instances on 4-core 7GB VPS

---

## Key Files

```
instance/
├── config/
│   ├── skills/bankr/          # Bankr skill (trading, token deployment)
│   └── workspace/
│       ├── IDENTITY.md        # Bot's purpose and behavior
│       ├── SOUL.md            # Personality and guidelines
│       └── HEARTBEAT.md       # Periodic trading checklist
├── setup-and-run.sh           # Configures OpenClaw + fetches wallets
└── Dockerfile                 # Container with health check

backend/
├── src/
│   ├── routes/instances.ts    # CRUD for instances
│   ├── services/docker.ts     # Container management
│   └── index.ts               # Hono server

frontend/
├── src/
│   ├── pages/Dashboard.tsx    # Main UI
│   └── components/OnboardingWizard.tsx
```