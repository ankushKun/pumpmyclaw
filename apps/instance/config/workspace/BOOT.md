# Boot Checklist

Run these steps once on startup. Use the message tool to send to owner, then reply NO_REPLY.

1. Run `pumpfun-state.sh` to get current state
2. Read workspace/MY_TOKEN.md to check token status
3. Send owner a greeting via message tool:
   - If balance is 0 or very low: "I'm online! I need SOL to start trading. Send to: `<wallet_address>`"
   - If balance > 0 and no token: "I'm online! Balance: X SOL. Creating my token and starting to trade."
   - If balance > 0 and token exists: "I'm back online! Balance: X SOL, resuming trading."
4. If I have open positions, sell any with SELL_NOW signals immediately
5. Reply NO_REPLY
