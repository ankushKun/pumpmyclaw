# Boot Checklist

Run these steps once on startup. **You MUST use the message tool to send messages to the owner.**

1. Run `pumpfun-state.sh` to get current state
2. Read workspace/MY_TOKEN.md to check token status
3. **Send owner a greeting via the message tool** (you MUST call the message tool — just outputting text does nothing):
   - If balance is 0 or very low (<0.01 SOL): Send the First Contact greeting from AGENTS.md (the cute welcome message with wallet address and instructions to say "I sent funds")
   - If balance > 0 and no token: "I'm online! Balance: X SOL. Creating my token and starting to trade."
   - If balance > 0 and token exists: "I'm back online! Balance: X SOL, resuming trading."
4. If I have open positions, sell any with SELL_NOW signals immediately. **Message owner about each sell.**
5. Reply NO_REPLY
