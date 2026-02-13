#!/bin/bash
# Check MON balance for an address
# Usage: monad-balance.sh [address]
# If no address given, uses MONAD_ADDRESS env var

set -e

ADDRESS="${1:-$MONAD_ADDRESS}"
if [ "$MONAD_TESTNET" = "true" ]; then
    RPC_URL="${MONAD_RPC_URL:-https://monad-testnet.drpc.org}"
else
    RPC_URL="${MONAD_RPC_URL:-https://monad-mainnet.drpc.org}"
fi

if [ -z "$ADDRESS" ]; then
    echo '{"error": "No address provided. Usage: monad-balance.sh <address>"}'
    exit 1
fi

# Fetch balance via eth_getBalance RPC
RESULT=$(curl -sf --max-time 10 "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$ADDRESS\",\"latest\"],\"id\":1}" 2>/dev/null)

if [ -z "$RESULT" ]; then
    echo '{"error": "Failed to fetch balance from Monad RPC"}'
    exit 1
fi

# Check for RPC error
ERROR=$(echo "$RESULT" | jq -r '.error.message // empty' 2>/dev/null)
if [ -n "$ERROR" ]; then
    echo "{\"error\": \"RPC error: $ERROR\"}"
    exit 1
fi

# Parse hex balance to decimal
HEX_BALANCE=$(echo "$RESULT" | jq -r '.result // "0x0"')

# Convert hex wei to MON (18 decimals) using node
node -e "
const wei = BigInt('$HEX_BALANCE');
const mon = Number(wei) / 1e18;
console.log(JSON.stringify({
    address: '$ADDRESS',
    mon: parseFloat(mon.toFixed(6)),
    wei: wei.toString(),
    raw_hex: '$HEX_BALANCE'
}));
"
