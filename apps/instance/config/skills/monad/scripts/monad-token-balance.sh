#!/bin/bash
# Check ERC20 token balance on Monad
# Usage: monad-token-balance.sh <token_address> [wallet_address]
# If no wallet address given, uses MONAD_ADDRESS env var

set -e

TOKEN="${1:-}"
ADDRESS="${2:-$MONAD_ADDRESS}"
if [ "$MONAD_TESTNET" = "true" ]; then
    RPC_URL="${MONAD_RPC_URL:-https://monad-testnet.drpc.org}"
else
    RPC_URL="${MONAD_RPC_URL:-https://monad-mainnet.drpc.org}"
fi

if [ -z "$TOKEN" ] || [ -z "$ADDRESS" ]; then
    echo '{"error": "Usage: monad-token-balance.sh <token_address> [wallet_address]"}'
    exit 1
fi

# ERC20 balanceOf(address) selector = 0x70a08231
# Encode: selector + padded address
ADDR_PADDED=$(echo "$ADDRESS" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
ADDR_PADDED=$(printf '%064s' "$ADDR_PADDED" | tr ' ' '0')
CALLDATA="0x70a08231${ADDR_PADDED}"

RESULT=$(curl -sf --max-time 10 "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$TOKEN\",\"data\":\"$CALLDATA\"},\"latest\"],\"id\":1}" 2>/dev/null)

if [ -z "$RESULT" ]; then
    echo '{"error": "Failed to query token balance from Monad RPC"}'
    exit 1
fi

ERROR=$(echo "$RESULT" | jq -r '.error.message // empty' 2>/dev/null)
if [ -n "$ERROR" ]; then
    echo "{\"error\": \"RPC error: $ERROR\"}"
    exit 1
fi

HEX_BALANCE=$(echo "$RESULT" | jq -r '.result // "0x0"')

# Also get decimals: decimals() selector = 0x313ce567
DEC_RESULT=$(curl -sf --max-time 10 "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$TOKEN\",\"data\":\"0x313ce567\"},\"latest\"],\"id\":2}" 2>/dev/null)

DEC_HEX=$(echo "$DEC_RESULT" | jq -r '.result // "0x12"' 2>/dev/null)

node -e "
const rawBalance = BigInt('$HEX_BALANCE');
const decimals = Number(BigInt('$DEC_HEX'));
const formatted = Number(rawBalance) / Math.pow(10, decimals);
console.log(JSON.stringify({
    token: '$TOKEN',
    wallet: '$ADDRESS',
    balance: formatted,
    raw: rawBalance.toString(),
    decimals: decimals
}));
"
