---
name: monad
description: Core Monad blockchain operations - EVM wallet generation, MON transfers, and balance checks. Use when the user needs to generate EVM keypairs, send MON or ERC20 tokens, check balances, or interact with Monad RPC. Provides low-level primitives for EVM applications on Monad.
metadata: {"openclaw":{"emoji":"🟣","homepage":"https://monad.xyz","requires":{"bins":["curl","jq","node"]}}}
---

# Monad

Core Monad (EVM) blockchain operations: wallet generation, MON transfers, and balance checking.

## Quick Start

```bash
# Generate a new EVM wallet
monad-keygen.js

# Check MON balance
monad-balance.sh <address>

# Transfer MON
monad-transfer.js <to_address> <amount_mon>

# Check ERC20 token balance
monad-token-balance.sh <token_address> <wallet_address>
```

## Configuration

Use environment variables:
```bash
export MONAD_PRIVATE_KEY="0x..."   # 0x-prefixed hex private key
export MONAD_ADDRESS="0x..."       # EVM wallet address
export MONAD_RPC_URL="https://monad-mainnet.drpc.org"
export MONAD_TESTNET="false"       # Set to "true" for testnet (chain 10143)
```

### Testnet Mode

Set `MONAD_TESTNET=true` to switch all Monad operations to testnet. This automatically changes:
- Chain ID: 143 (mainnet) -> 10143 (testnet)
- RPC URL: `monad-mainnet.drpc.org` -> `monad-testnet.drpc.org`
- nad.fun API: `api.nadapp.net` -> `dev-api.nad.fun`
- All contract addresses (LENS, Router, Curve, etc.)

You can still override `MONAD_RPC_URL` manually — it takes precedence over the testnet default.

## Overview

Monad is a high-performance EVM-compatible blockchain with:
- **1 second block times**: Fast finality
- **10,000+ TPS**: High throughput via parallel execution
- **Full EVM compatibility**: Use standard Ethereum tools (viem, ethers.js)
- **Native token**: MON (18 decimals, like ETH)

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Private Key** | secp256k1 key, 0x-prefixed 64 hex chars |
| **Address** | 0x-prefixed 40 hex chars (checksummed) |
| **Wei** | Smallest MON unit (1 MON = 10^18 wei) |
| **Gas** | Transaction fee unit, similar to Ethereum |

## Scripts

All scripts at `/home/openclaw/.openclaw/skills/monad/scripts/`

### Wallet Management

```bash
# Generate new EVM wallet (outputs JSON with address and privateKey)
monad-keygen.js

# Check MON balance (returns JSON with mon and wei)
monad-balance.sh <address>
```

### Transfers

```bash
# Transfer MON to address
monad-transfer.js <to_address> <amount_mon>
```

### Token Operations

```bash
# Check ERC20 token balance
monad-token-balance.sh <token_address> <wallet_address>
```

## Network

| Field | Value |
|-------|-------|
| Chain ID | 143 |
| RPC URL | `https://monad-mainnet.drpc.org` |
| Native Token | MON (18 decimals) |
| Block Time | ~1 second |

## Security Notes

- **Never share private keys** - They control all funds
- **Use dedicated wallets** - Don't use main wallet for bots
- **Verify addresses** - Check recipient before transfers
- **Store keys securely** - Use environment variables, never hardcode

**NOTE: Scripts are available on PATH. You can run them by short name (e.g. `monad-balance.sh`).**
