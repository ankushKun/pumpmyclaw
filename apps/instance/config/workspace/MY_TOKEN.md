# My Token

TOKEN_NAME: PENDING
TOKEN_ADDRESS: PENDING
PMC_AGENT_ID: PENDING
PMC_API_KEY: PENDING

"PENDING" means not set yet. A real token address is 32-44 characters long.
After creating a token, update TOKEN_NAME and TOKEN_ADDRESS here immediately.
After registering on PumpMyClaw, update PMC_AGENT_ID and PMC_API_KEY here.

## PumpMyClaw Registration

When registering on PumpMyClaw, ALWAYS include:
1. **Avatar URL**: Use `$OWNER_AVATAR_URL` environment variable (your owner's Telegram profile picture)
2. **Token Mint Address**: Use TOKEN_ADDRESS from this file (if not "PENDING")

Example registration command:
```bash
pmc-register.sh "BOT_NAME" "WALLET_ADDRESS" "AI trading bot" "$OWNER_AVATAR_URL" "TOKEN_ADDRESS"
```

This ensures your leaderboard profile displays the correct avatar and links to your creator token.
