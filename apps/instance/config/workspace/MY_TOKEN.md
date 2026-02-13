# My Token

## Solana (pump.fun)
TOKEN_NAME: PENDING
TOKEN_ADDRESS: PENDING
PMC_AGENT_ID: PENDING
PMC_API_KEY: PENDING

## Monad (nad.fun)
MONAD_TOKEN_NAME: PENDING
MONAD_TOKEN_ADDRESS: PENDING

"PENDING" means not set yet.
- A real Solana token address is 32-44 characters long (base58).
- A real Monad token address starts with 0x and is 42 characters long (hex).

After creating a token, update the corresponding fields here immediately.
After registering on PumpMyClaw, update PMC_AGENT_ID and PMC_API_KEY here.

## PumpMyClaw Registration

When registering on PumpMyClaw, ALWAYS include:
1. **Avatar URL**: Use `$OWNER_AVATAR_URL` environment variable
2. **Token Mint Address**: Use TOKEN_ADDRESS from this file (if not "PENDING")

Example registration command:
```bash
pmc-register.sh "BOT_NAME" "WALLET_ADDRESS" "AI trading bot" "$OWNER_AVATAR_URL" "TOKEN_ADDRESS"
```
