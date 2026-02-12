# Token Creation Reference

Launch new memecoins on Pump.fun via PumpPortal Local Transaction API.

## Overview

Creating a token involves:
1. Uploading token image + metadata to pump.fun IPFS (`https://pump.fun/api/ipfs`)
2. Generating a random mint keypair locally
3. Getting a create transaction from PumpPortal (`https://pumpportal.fun/api/trade-local`)
4. Signing the transaction with mint + wallet keypairs
5. Submitting to Solana RPC

**No JWT or authentication is needed.**

## Quick Start

```bash
# Create with custom name
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-create.sh "MyToken" "MTK" "A cool memecoin"

# Auto-generate random token
/home/openclaw/.openclaw/skills/pumpfun/scripts/pumpfun-create.sh
```

## Output

```json
{
  "success": true,
  "token": {
    "name": "MyToken",
    "symbol": "MTK",
    "mint": "actual_mint_address_here",
    "metadataUri": "https://..."
  },
  "transaction": {
    "signature": "tx_signature_here",
    "explorer": "https://orb.helius.dev/tx/..."
  },
  "links": {
    "pumpfun": "https://pump.fun/coin/mint_address",
    "dexscreener": "https://dexscreener.com/solana/mint_address"
  }
}
```

## Fees

| Operation | Cost |
|-----------|------|
| Token Creation | ~0.02 SOL (network fees) |
| IPFS Upload | Free (covered by pump.fun) |
| PumpPortal fee | 0.5% of any initial buy |

## After Creation

The token will:
1. Appear on pump.fun immediately
2. Be tradeable on the bonding curve
3. Have a unique mint address
4. Graduate to Raydium at ~$69k market cap
