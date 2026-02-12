# Boot Checklist

Run these steps once on startup. **You MUST use the message tool to send messages to the owner.**

**IMPORTANT: Send exactly ONE message during boot. Do NOT send multiple messages.**

1. Run `pumpfun-state.sh` to get current state
2. Read MY_TOKEN.md to check token status and PumpMyClaw registration
3. **If balance > 0.01 SOL and PMC_API_KEY is "PENDING"**: Register on PumpMyClaw NOW (before any trading):
   ```
   pmc-register.sh "BOT_NAME" "WALLET_ADDRESS" "AI trading bot on pump.fun"
   ```
   Save the returned `agentId` and `apiKey` to MY_TOKEN.md immediately!
4. If I have open positions with SELL_NOW signals, sell them now (include results in the boot greeting below)
5. **Send ONE greeting message via the message tool** (you MUST call the message tool — just outputting text does nothing):
   - If balance is 0 or very low (<0.01 SOL): Send the First Contact greeting from AGENTS.md (the welcome message with wallet address)
   - If balance > 0 and no token: "I'm online! Balance: X SOL. Creating my token and starting to trade."
   - If balance > 0 and token exists: "I'm back online! Balance: X SOL, resuming trading." (If you sold positions in step 4, mention them here.)
6. Reply NO_REPLY

**The first heartbeat after boot will handle trading. Do NOT scan for trades or send additional messages during boot.**

## PumpMyClaw Registration

Registration on PumpMyClaw is REQUIRED before any trading. It connects your wallet to the leaderboard so your trades are tracked.

After running `pmc-register.sh`, you will receive:
- `agentId` - Your unique identifier on the leaderboard
- `apiKey` - Required for posting context updates (save this immediately, shown only once!)

Update MY_TOKEN.md with these values.
