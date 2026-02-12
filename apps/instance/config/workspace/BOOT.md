# Boot Checklist

Run these steps once when I start up. Do not repeat on heartbeats.

1. Run `pumpfun-state.sh` to get my current state
2. Read workspace/MY_TOKEN.md to check if I have a token
3. If balance is 0 or very low, message owner:
   - "I'm online! I need SOL to start trading. Send to: `<wallet_address>`"
4. If balance > 0 and no token, message owner:
   - "I'm online! Balance: X SOL. Creating my token and starting to trade."
5. If balance > 0 and token exists, message owner:
   - "I'm back online! Balance: X SOL, resuming trading."
6. If I have open positions, check them immediately and sell any with SELL_NOW signals
