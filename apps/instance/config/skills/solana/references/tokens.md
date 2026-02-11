# SPL Tokens Reference

Work with Solana tokens (SPL Token program).

## Overview

SPL Tokens are the standard for fungible and non-fungible tokens on Solana.

### Token Programs

| Program | Address | Use Case |
|---------|---------|----------|
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Standard tokens |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Extended features |

### Key Concepts

| Term | Description |
|------|-------------|
| **Mint** | Token factory that defines supply and decimals |
| **Token Account** | Holds tokens for a specific mint and owner |
| **ATA** | Associated Token Account - deterministic address |
| **Decimals** | Token precision (USDC = 6, most = 9) |

---

## Token Accounts

### Associated Token Account (ATA)

Deterministic address derived from owner + mint:

```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-ata.sh <owner> <mint>
```

**ATA Program**: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`

### Get Token Balance

```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-token-balance.sh <token_account>
```

### Get All Token Accounts

```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-tokens.sh <owner_address>
```

---

## Common Token Addresses

### Stablecoins

| Token | Mint Address |
|-------|--------------|
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |

### Wrapped Tokens

| Token | Mint Address |
|-------|--------------|
| wSOL | `So11111111111111111111111111111111111111112` |
| wETH | `7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs` |
| wBTC | `3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh` |

---

## Token Operations

### Check Balance

RPC method:
```json
{
  "method": "getTokenAccountBalance",
  "params": ["token_account_address"]
}
```

Response:
```json
{
  "amount": "1000000",
  "decimals": 6,
  "uiAmount": 1.0
}
```

### Get Token Accounts by Owner

```json
{
  "method": "getTokenAccountsByOwner",
  "params": [
    "owner_address",
    {"mint": "token_mint_address"},
    {"encoding": "jsonParsed"}
  ]
}
```

### Get Token Supply

```json
{
  "method": "getTokenSupply",
  "params": ["mint_address"]
}
```

### Get Largest Holders

```json
{
  "method": "getTokenLargestAccounts",
  "params": ["mint_address"]
}
```

---

## Token Account Structure

```rust
pub struct Account {
    pub mint: Pubkey,           // Token mint
    pub owner: Pubkey,          // Account owner
    pub amount: u64,            // Token balance
    pub delegate: COption<Pubkey>,
    pub state: AccountState,    // Initialized/Frozen
    pub is_native: COption<u64>,
    pub delegated_amount: u64,
    pub close_authority: COption<Pubkey>,
}
```

Account size: 165 bytes
Rent: ~0.00203 SOL

---

## Mint Structure

```rust
pub struct Mint {
    pub mint_authority: COption<Pubkey>,
    pub supply: u64,
    pub decimals: u8,
    pub is_initialized: bool,
    pub freeze_authority: COption<Pubkey>,
}
```

---

## Token-2022 Extensions

| Extension | Description |
|-----------|-------------|
| Transfer Fees | Automatic fee on transfers |
| Interest Bearing | Accrues interest over time |
| Non-Transferable | Soulbound tokens |
| Permanent Delegate | Permanent transfer authority |
| Transfer Hook | Custom logic on transfer |
| Metadata | On-chain metadata |
| Confidential Transfer | Encrypted amounts |

---

## Wrapped SOL

wSOL is native SOL wrapped as SPL token.

Mint: `So11111111111111111111111111111111111111112`

### Wrap SOL
1. Create wSOL token account
2. Transfer SOL to it
3. Sync native balance

### Unwrap SOL
1. Close wSOL account
2. SOL returned to owner

---

## Common Issues

| Issue | Resolution |
|-------|------------|
| Account not found | Create ATA first |
| Insufficient balance | Check token balance |
| Invalid mint | Verify mint address |
| Frozen account | Contact token issuer |
| Wrong decimals | Check mint decimals |

---

## Related Scripts

```bash
# Get token balance
solana-token-balance.sh <token_account>

# Get all tokens for owner
solana-tokens.sh <owner>

# Get ATA address
solana-ata.sh <owner> <mint>
```
