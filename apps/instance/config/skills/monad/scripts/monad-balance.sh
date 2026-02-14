#!/bin/bash
# Check MON balance for an address
# Usage: monad-balance.sh [address]
# If no address given, uses MONAD_ADDRESS env var

# No set -e: we handle errors explicitly to avoid silent failures
LOG_PREFIX="[monad-balance]"

ADDRESS="${1:-$MONAD_ADDRESS}"
if [ "$MONAD_TESTNET" = "true" ]; then
    RPC_URL="${MONAD_RPC_URL:-https://monad-testnet.drpc.org}"
else
    RPC_URL="${MONAD_RPC_URL:-https://monad-mainnet.drpc.org}"
fi

if [ -z "$ADDRESS" ]; then
    echo "$LOG_PREFIX ERROR: no address provided" >&2
    echo '{"error": "No address provided. Usage: monad-balance.sh <address>"}'
    exit 1
fi

echo "$LOG_PREFIX Checking balance for $ADDRESS via $RPC_URL" >&2

# Fetch balance via eth_getBalance RPC (retry once on failure)
RESULT=""
for attempt in 1 2; do
    RESULT=$(curl -s --max-time 10 "$RPC_URL" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$ADDRESS\",\"latest\"],\"id\":1}" 2>/dev/null) && break
    echo "$LOG_PREFIX attempt $attempt failed, retrying..." >&2
    sleep 1
done

if [ -z "$RESULT" ]; then
    echo "$LOG_PREFIX ERROR: Failed to fetch balance from Monad RPC ($RPC_URL)" >&2
    echo '{"error": "Failed to fetch balance from Monad RPC"}'
    exit 1
fi

# Check for RPC error
ERROR=$(echo "$RESULT" | jq -r '.error.message // empty' 2>/dev/null)
if [ -n "$ERROR" ]; then
    echo "$LOG_PREFIX ERROR: RPC error: $ERROR" >&2
    echo "{\"error\": \"RPC error: $ERROR\"}"
    exit 1
fi

# Parse hex balance to decimal
HEX_BALANCE=$(echo "$RESULT" | jq -r '.result // "0x0"' 2>/dev/null)

if [ -z "$HEX_BALANCE" ] || [ "$HEX_BALANCE" = "null" ]; then
    echo "$LOG_PREFIX ERROR: unexpected RPC response: $RESULT" >&2
    echo '{"error": "Unexpected RPC response"}'
    exit 1
fi

# Convert hex wei to MON (18 decimals) using node
NODE_OUTPUT=$(node -e "
const wei = BigInt('$HEX_BALANCE');
const mon = Number(wei) / 1e18;
console.log(JSON.stringify({
    address: '$ADDRESS',
    mon: parseFloat(mon.toFixed(6)),
    wei: wei.toString(),
    raw_hex: '$HEX_BALANCE'
}));
" 2>&1)

if [ $? -ne 0 ]; then
    echo "$LOG_PREFIX ERROR: node conversion failed for hex=$HEX_BALANCE — $NODE_OUTPUT" >&2
    echo '{"error": "Failed to convert balance"}'
    exit 1
fi

echo "$NODE_OUTPUT"
echo "$LOG_PREFIX done" >&2
