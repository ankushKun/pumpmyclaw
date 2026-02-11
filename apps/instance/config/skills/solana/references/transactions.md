# Transactions Reference

Build, sign, and send Solana transactions.

## Overview

Transactions are the fundamental way to interact with Solana. Each transaction:
- Contains one or more instructions
- Requires at least one signature (fee payer)
- Is atomic (all-or-nothing execution)
- Has a size limit of 1232 bytes

## Transaction Structure

```
Transaction {
  signatures: [Signature, ...],    // 64 bytes each
  message: Message {
    header: MessageHeader,
    account_keys: [Pubkey, ...],   // All accounts used
    recent_blockhash: Hash,        // 32 bytes
    instructions: [Instruction, ...]
  }
}
```

---

## Building Transactions

### Transfer SOL

```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-transfer.sh <to_address> <amount_sol>
```

Example:
```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-transfer.sh 7xKXtg... 0.1
```

### Manual Transaction Building

1. **Get recent blockhash**
```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-blockhash.sh
```

2. **Build instruction(s)**
```javascript
const instruction = {
  programId: "11111111111111111111111111111111", // System Program
  keys: [
    { pubkey: sender, isSigner: true, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: true }
  ],
  data: Buffer.from([2, 0, 0, 0, ...lamportsLE]) // Transfer instruction
};
```

3. **Create message**
4. **Sign with private key**
5. **Send to RPC**

---

## Sending Transactions

### Send and Confirm
```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-transfer.sh <to> <amount>
```

### Send Raw Transaction
```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-send.sh <base64_transaction>
```

### RPC Method
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "sendTransaction",
  "params": [
    "<base64_encoded_transaction>",
    {
      "encoding": "base64",
      "skipPreflight": false,
      "preflightCommitment": "confirmed",
      "maxRetries": 3
    }
  ]
}
```

---

## Transaction Confirmation

### Commitment Levels

| Level | Description | Speed | Safety |
|-------|-------------|-------|--------|
| `processed` | Seen by node | Fastest | May be rolled back |
| `confirmed` | Voted on by supermajority | ~400ms | Very safe |
| `finalized` | Rooted (31+ blocks) | ~12s | Maximum safety |

### Check Status
```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-tx.sh <signature>
```

### Wait for Confirmation
```bash
# Built into transfer script
# Or manually poll getSignatureStatuses
```

---

## Transaction Fees

### Base Fee
- 5,000 lamports per signature (~$0.001)
- First signature = fee payer

### Priority Fee
Optional fee to increase transaction priority:

```javascript
// Set compute unit price (micro-lamports per CU)
ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })

// Set compute unit limit
ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
```

Priority fee = CU limit × CU price

### Estimating Fees
```bash
# Simulate to get compute units used
/home/openclaw/.openclaw/skills/solana/scripts/solana-simulate.sh <base64_tx>
```

---

## Recent Blockhash

### Purpose
- Acts as transaction timestamp
- Prevents duplicate transactions
- Expires after ~150 blocks (~1 minute)

### Get Blockhash
```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-blockhash.sh
```

Response:
```json
{
  "blockhash": "EkSnNWid...",
  "lastValidBlockHeight": 123456789
}
```

### Durable Nonces
For offline signing or long-lived transactions:
- Create nonce account with `NonceAccount`
- Use nonce instead of recent blockhash
- Never expires

---

## Instruction Types

### System Program (`11111111111111111111111111111111`)

| Instruction | Description |
|-------------|-------------|
| CreateAccount | Create new account with lamports |
| Transfer | Transfer SOL |
| Assign | Change account owner |
| Allocate | Allocate space |

### Token Program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`)

| Instruction | Description |
|-------------|-------------|
| InitializeMint | Create new token |
| InitializeAccount | Create token account |
| Transfer | Transfer tokens |
| Approve | Approve delegate |
| MintTo | Mint new tokens |
| Burn | Burn tokens |

### Associated Token Account (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`)

| Instruction | Description |
|-------------|-------------|
| Create | Create ATA for owner+mint |

---

## Versioned Transactions

### Legacy Transactions
- Original format
- Max ~35 accounts due to size limit

### V0 Transactions
- Support Address Lookup Tables (ALTs)
- Can reference up to 256 accounts per ALT
- Reduces transaction size

```javascript
// Create V0 transaction
const messageV0 = new TransactionMessage({
  payerKey: payer,
  recentBlockhash: blockhash,
  instructions: [...]
}).compileToV0Message([lookupTable]);
```

---

## Simulation

Always simulate before sending:

```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-simulate.sh <base64_tx>
```

### Response
```json
{
  "err": null,
  "logs": ["Program log: ..."],
  "unitsConsumed": 12345,
  "returnData": null
}
```

### Check for Errors
- `err: null` = success
- `err: {...}` = will fail on-chain

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `BlockhashNotFound` | Blockhash expired | Get fresh blockhash |
| `InsufficientFunds` | Not enough SOL | Add more SOL |
| `AccountNotFound` | Account doesn't exist | Create account first |
| `InvalidSignature` | Wrong signer | Check signing key |
| `AlreadyProcessed` | Duplicate transaction | New blockhash needed |

### Retry Strategy
1. Check if already confirmed
2. If blockhash expired, rebuild with new blockhash
3. Retry with exponential backoff
4. Max 3-5 retries

---

## Batch Transactions

### Multiple Instructions per Transaction
```javascript
const transaction = new Transaction()
  .add(instruction1)
  .add(instruction2)
  .add(instruction3);
```

Benefits:
- Atomic execution
- Single fee
- Faster than separate transactions

Limits:
- 1232 bytes max
- ~35 accounts max (legacy)
- Compute budget limit

### Multiple Transactions
```javascript
// Send in parallel
const signatures = await Promise.all([
  sendTransaction(tx1),
  sendTransaction(tx2),
  sendTransaction(tx3)
]);
```

---

## Offline Signing

For air-gapped systems:

1. **Online machine**: Get blockhash, build unsigned transaction
2. **Offline machine**: Sign transaction
3. **Online machine**: Send signed transaction

Or use durable nonces for longer validity.

---

## Related Scripts

```bash
# Get blockhash
solana-blockhash.sh

# Transfer SOL
solana-transfer.sh <to> <amount>

# Send raw transaction
solana-send.sh <base64_tx>

# Check transaction status
solana-tx.sh <signature>

# Simulate transaction
solana-simulate.sh <base64_tx>
```
