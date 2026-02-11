---
name: solana
description: Core Solana blockchain operations - wallet generation, signing, and transactions. Use when the user needs to generate Solana keypairs, sign messages/transactions, send SOL or tokens, check balances, or interact with the Solana RPC. Provides low-level primitives for building Solana applications.
metadata: {"openclaw":{"emoji":"⚡","homepage":"https://solana.com","requires":{"bins":["curl","jq","node"]}}}
---

# Solana

Core Solana blockchain operations: wallet generation, message signing, and transaction handling.

## Quick Start

```bash
# Generate a new wallet
/home/openclaw/.openclaw/skills/solana/scripts/solana-keygen.sh

# Check SOL balance
/home/openclaw/.openclaw/skills/solana/scripts/solana-balance.sh <address>

# Get full portfolio (SOL + all tokens)
/home/openclaw/.openclaw/skills/solana/scripts/solana-portfolio.sh <address>

# Send SOL
/home/openclaw/.openclaw/skills/solana/scripts/solana-transfer.sh <to_address> <amount_sol>

# Sign a message
/home/openclaw/.openclaw/skills/solana/scripts/solana-sign.sh "message to sign"

# Get account info
/home/openclaw/.openclaw/skills/solana/scripts/solana-account.sh <address>
```

## Configuration

Create `config.json` with your settings:
```json
{
  "privateKey": "base58_private_key_or_path_to_keypair",
  "rpcUrl": "https://api.mainnet-beta.solana.com",
  "commitment": "confirmed"
}
```

Or use environment variables:
```bash
export SOLANA_PRIVATE_KEY="your_base58_private_key"
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
```

## Overview

Solana is a high-performance blockchain with:
- **Sub-second finality**: Transactions confirm in ~400ms
- **Low fees**: Typically 0.000005 SOL per transaction
- **High throughput**: Thousands of transactions per second

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Keypair** | Ed25519 key pair (32-byte private seed + 32-byte public key) |
| **Address** | Base58-encoded 32-byte public key |
| **Lamports** | Smallest SOL unit (1 SOL = 1,000,000,000 lamports) |
| **Account** | On-chain data storage unit with balance and data |
| **Transaction** | Signed instruction(s) to modify on-chain state |

## Scripts

### Wallet Management

```bash
# Generate new keypair (outputs JSON with public/private keys)
/home/openclaw/.openclaw/skills/solana/scripts/solana-keygen.sh

# Generate vanity address (starts with prefix)
/home/openclaw/.openclaw/skills/solana/scripts/solana-keygen.sh --vanity ABC

# Derive public key from private key
/home/openclaw/.openclaw/skills/solana/scripts/solana-pubkey.sh <private_key>
```

### Balance & Portfolio

```bash
# Get SOL balance
/home/openclaw/.openclaw/skills/solana/scripts/solana-balance.sh <address>

# Get full portfolio (SOL + all tokens)
/home/openclaw/.openclaw/skills/solana/scripts/solana-portfolio.sh <address>

# Get all token balances for wallet
/home/openclaw/.openclaw/skills/solana/scripts/solana-tokens.sh <address>

# Get specific token account balance
/home/openclaw/.openclaw/skills/solana/scripts/solana-token-balance.sh <token_account>

# Get account info (owner, data, executable)
/home/openclaw/.openclaw/skills/solana/scripts/solana-account.sh <address>
```

### Signing

```bash
# Sign a message (returns base58 signature)
/home/openclaw/.openclaw/skills/solana/scripts/solana-sign.sh "message"

# Verify a signature
/home/openclaw/.openclaw/skills/solana/scripts/solana-verify.sh <address> <signature> "message"
```

### Transactions

```bash
# Transfer SOL
/home/openclaw/.openclaw/skills/solana/scripts/solana-transfer.sh <to_address> <amount_sol>

# Send raw transaction
/home/openclaw/.openclaw/skills/solana/scripts/solana-send.sh <base64_transaction>

# Get transaction status
/home/openclaw/.openclaw/skills/solana/scripts/solana-tx.sh <signature>
```

### RPC Utilities

```bash
# Get latest blockhash
/home/openclaw/.openclaw/skills/solana/scripts/solana-blockhash.sh

# Request airdrop (devnet/testnet only)
/home/openclaw/.openclaw/skills/solana/scripts/solana-airdrop.sh <address> <amount_sol>

# Get slot/block info
/home/openclaw/.openclaw/skills/solana/scripts/solana-slot.sh
```

## Network Clusters

| Cluster | RPC URL | Use Case |
|---------|---------|----------|
| Mainnet | `https://api.mainnet-beta.solana.com` | Production |
| Devnet | `https://api.devnet.solana.com` | Development |
| Testnet | `https://api.testnet.solana.com` | Testing |
| Localhost | `http://localhost:8899` | Local validator |

## Transaction Fees

| Component | Cost |
|-----------|------|
| Base fee | 5,000 lamports per signature (~$0.001) |
| Priority fee | Optional, varies with network congestion |
| Rent | ~0.00089 SOL per KB for account creation |

## Common Operations

### Create Account
```bash
# Estimated rent for account
/home/openclaw/.openclaw/skills/solana/scripts/solana-rent.sh <bytes>
```

### Token Operations
```bash
# Get token account balance
/home/openclaw/.openclaw/skills/solana/scripts/solana-token-balance.sh <token_account>

# Get token accounts by owner
/home/openclaw/.openclaw/skills/solana/scripts/solana-tokens.sh <owner_address>
```

## Security Notes

- **Never share private keys** - They control all funds
- **Use dedicated wallets** - Don't use main wallet for bots
- **Verify transactions** - Always simulate before sending
- **Check addresses** - Verify recipient before transfers
- **Backup keypairs** - Store securely, multiple copies

## References

- [Wallet Management](references/wallet-management.md) - Keypair generation and derivation
- [Transactions](references/transactions.md) - Building and sending transactions
- [RPC Reference](references/rpc-reference.md) - JSON-RPC API documentation
- [Tokens](references/tokens.md) - SPL Token operations

## Tips

- Use `confirmed` commitment for most operations
- Add priority fees during network congestion
- Simulate transactions before sending
- Cache recent blockhash for batch operations (expires in ~1 minute)
- Token accounts require rent (~0.002 SOL)
