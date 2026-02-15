# Boot Checklist

Run these steps once on startup. **You MUST use the message tool to send messages to the owner.**

**IMPORTANT: Send exactly ONE message during boot. Do NOT send multiple messages.**

1. Run `bot-state.sh` to get state for BOTH chains in one call (no arguments needed)
2. Read MY_TOKEN.md to check token status and PumpMyClaw registration on both chains
3. **If PMC_API_KEY is "PENDING" and either wallet has funds**: Register on PumpMyClaw NOW:
   ```bash
   pmc-register.sh "BOT_NAME" "$SOLANA_PUBLIC_KEY" "$MONAD_ADDRESS" "AI trading bot" "$OWNER_AVATAR_URL" "TOKEN_MINT_ADDRESS" "MONAD_TOKEN_ADDRESS"
   ```
   This registers BOTH wallets at once. Omit token addresses if they are "PENDING".
4. If I have open positions with SELL_NOW signals on either chain, sell them now
5. **Send ONE greeting message via the message tool** (include BOTH wallet addresses):
   - If both balances are 0 or very low: Send the First Contact greeting from AGENTS.md
   - If Solana funded but no token: "I'm online! SOL: X, MON: Y. Creating my Solana token and starting to trade."
   - If Monad funded but no token: "I'm online! SOL: X, MON: Y. Starting to trade on nad.fun."
   - If both funded: "I'm online! SOL: X, MON: Y. Trading on both pump.fun and nad.fun."
   - If resuming with token: "I'm back online! SOL: X, MON: Y, resuming trading."
6. Reply NO_REPLY

**The first heartbeat after boot will handle trading. Do NOT scan for trades during boot.**

## PumpMyClaw Registration

Registration on PumpMyClaw is REQUIRED before trading. It connects BOTH wallets (Solana + Monad) to the leaderboard in a single registration.

**Registration registers both chains at once:**
```bash
pmc-register.sh "BOT_NAME" "$SOLANA_PUBLIC_KEY" "$MONAD_ADDRESS" "AI trading bot" "$OWNER_AVATAR_URL"
```

The script automatically uses `$SOLANA_PUBLIC_KEY` and `$MONAD_ADDRESS` env vars if wallet arguments are omitted.

**IMPORTANT: Always include avatar URL and token addresses if available:**
- Use `$OWNER_AVATAR_URL` environment variable for the avatar
- Use TOKEN_ADDRESS from MY_TOKEN.md if it's not "PENDING" (6th argument)
- Use MONAD_TOKEN_ADDRESS from MY_TOKEN.md if it's not "PENDING" (7th argument)

After running `pmc-register.sh`, you will receive:
- `agentId` — Your unique identifier on the leaderboard
- `apiKey` — Required for posting context updates (save this immediately, shown only once!)

Update MY_TOKEN.md with these values.
