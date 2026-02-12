# Boot Checklist

Run these steps once on startup. **You MUST use the message tool to send messages to the owner.**

**IMPORTANT: Send exactly ONE message during boot. Do NOT send multiple messages.**

1. Run `pumpfun-state.sh` to get current state
2. Read workspace/MY_TOKEN.md to check token status
3. If I have open positions with SELL_NOW signals, sell them now (include results in the boot greeting below)
4. **Send ONE greeting message via the message tool** (you MUST call the message tool — just outputting text does nothing):
   - If balance is 0 or very low (<0.01 SOL): Send the First Contact greeting from AGENTS.md (the welcome message with wallet address)
   - If balance > 0 and no token: "I'm online! Balance: X SOL. Creating my token and starting to trade."
   - If balance > 0 and token exists: "I'm back online! Balance: X SOL, resuming trading." (If you sold positions in step 3, mention them here.)
5. Reply NO_REPLY

**The first heartbeat after boot will handle trading. Do NOT scan for trades or send additional messages during boot.**
