# RPC Reference

Solana JSON-RPC API documentation.

## Endpoints

| Cluster | HTTP | WebSocket |
|---------|------|-----------|
| Mainnet | `https://api.mainnet-beta.solana.com` | `wss://api.mainnet-beta.solana.com` |
| Devnet | `https://api.devnet.solana.com` | `wss://api.devnet.solana.com` |
| Testnet | `https://api.testnet.solana.com` | `wss://api.testnet.solana.com` |
| Localhost | `http://localhost:8899` | `ws://localhost:8900` |

## Request Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "<method_name>",
  "params": [<parameters>]
}
```

---

## Account Methods

### getAccountInfo

Get account data, balance, and owner.

```bash
curl -X POST -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getAccountInfo",
  "params": [
    "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg",
    {"encoding": "base64"}
  ]
}' https://api.mainnet-beta.solana.com
```

Response:
```json
{
  "result": {
    "value": {
      "data": ["base64_data", "base64"],
      "executable": false,
      "lamports": 88849814690250,
      "owner": "11111111111111111111111111111111",
      "rentEpoch": 18446744073709551615,
      "space": 0
    }
  }
}
```

### getBalance

Get SOL balance in lamports.

```bash
curl -X POST -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBalance",
  "params": ["83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri"]
}' https://api.mainnet-beta.solana.com
```

Response:
```json
{
  "result": {
    "value": 1000000000
  }
}
```

### getMultipleAccounts

Get multiple accounts in one request.

```json
{
  "method": "getMultipleAccounts",
  "params": [
    ["account1", "account2", "account3"],
    {"encoding": "base64"}
  ]
}
```

### getProgramAccounts

Get all accounts owned by a program.

```json
{
  "method": "getProgramAccounts",
  "params": [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    {
      "encoding": "base64",
      "filters": [
        {"dataSize": 165},
        {"memcmp": {"offset": 32, "bytes": "owner_address"}}
      ]
    }
  ]
}
```

---

## Transaction Methods

### sendTransaction

Submit signed transaction.

```json
{
  "method": "sendTransaction",
  "params": [
    "base64_encoded_transaction",
    {
      "encoding": "base64",
      "skipPreflight": false,
      "preflightCommitment": "confirmed",
      "maxRetries": 3
    }
  ]
}
```

Response:
```json
{
  "result": "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp..."
}
```

### simulateTransaction

Simulate without submitting.

```json
{
  "method": "simulateTransaction",
  "params": [
    "base64_encoded_transaction",
    {
      "encoding": "base64",
      "commitment": "confirmed",
      "sigVerify": true,
      "replaceRecentBlockhash": true
    }
  ]
}
```

Response:
```json
{
  "result": {
    "value": {
      "err": null,
      "logs": ["Program log: ..."],
      "unitsConsumed": 12345
    }
  }
}
```

### getSignatureStatuses

Check transaction status.

```json
{
  "method": "getSignatureStatuses",
  "params": [
    ["signature1", "signature2"],
    {"searchTransactionHistory": true}
  ]
}
```

Response:
```json
{
  "result": {
    "value": [
      {
        "slot": 123456,
        "confirmations": 10,
        "err": null,
        "status": {"Ok": null},
        "confirmationStatus": "confirmed"
      }
    ]
  }
}
```

### getTransaction

Get transaction details.

```json
{
  "method": "getTransaction",
  "params": [
    "signature",
    {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}
  ]
}
```

---

## Block Methods

### getLatestBlockhash

Get recent blockhash for transactions.

```json
{
  "method": "getLatestBlockhash",
  "params": [{"commitment": "finalized"}]
}
```

Response:
```json
{
  "result": {
    "value": {
      "blockhash": "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
      "lastValidBlockHeight": 3090
    }
  }
}
```

### getSlot

Get current slot.

```json
{
  "method": "getSlot",
  "params": []
}
```

### getBlockHeight

Get current block height.

```json
{
  "method": "getBlockHeight",
  "params": []
}
```

### getBlock

Get block details.

```json
{
  "method": "getBlock",
  "params": [
    430,
    {
      "encoding": "jsonParsed",
      "maxSupportedTransactionVersion": 0,
      "transactionDetails": "full"
    }
  ]
}
```

---

## Token Methods

### getTokenAccountBalance

Get token balance.

```json
{
  "method": "getTokenAccountBalance",
  "params": ["token_account_address"]
}
```

Response:
```json
{
  "result": {
    "value": {
      "amount": "1000000",
      "decimals": 6,
      "uiAmount": 1.0,
      "uiAmountString": "1"
    }
  }
}
```

### getTokenAccountsByOwner

Get all token accounts for a wallet.

```json
{
  "method": "getTokenAccountsByOwner",
  "params": [
    "owner_address",
    {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
    {"encoding": "jsonParsed"}
  ]
}
```

### getTokenAccountsByDelegate

Get token accounts by delegate.

```json
{
  "method": "getTokenAccountsByDelegate",
  "params": [
    "delegate_address",
    {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
    {"encoding": "jsonParsed"}
  ]
}
```

### getTokenSupply

Get token total supply.

```json
{
  "method": "getTokenSupply",
  "params": ["mint_address"]
}
```

### getTokenLargestAccounts

Get largest token holders.

```json
{
  "method": "getTokenLargestAccounts",
  "params": ["mint_address"]
}
```

---

## Utility Methods

### requestAirdrop

Get free SOL (devnet/testnet only).

```json
{
  "method": "requestAirdrop",
  "params": ["address", 1000000000]
}
```

### getMinimumBalanceForRentExemption

Get minimum rent for account size.

```json
{
  "method": "getMinimumBalanceForRentExemption",
  "params": [165]
}
```

### getHealth

Check node health.

```json
{
  "method": "getHealth",
  "params": []
}
```

### getVersion

Get node version.

```json
{
  "method": "getVersion",
  "params": []
}
```

---

## WebSocket Subscriptions

### accountSubscribe

Subscribe to account changes.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "accountSubscribe",
  "params": [
    "address",
    {"encoding": "base64", "commitment": "confirmed"}
  ]
}
```

### signatureSubscribe

Subscribe to transaction confirmation.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "signatureSubscribe",
  "params": [
    "signature",
    {"commitment": "confirmed"}
  ]
}
```

### logsSubscribe

Subscribe to program logs.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "logsSubscribe",
  "params": [
    {"mentions": ["program_id"]},
    {"commitment": "confirmed"}
  ]
}
```

### slotSubscribe

Subscribe to slot updates.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "slotSubscribe",
  "params": []
}
```

---

## Commitment Levels

| Level | Description |
|-------|-------------|
| `processed` | Processed by node, may rollback |
| `confirmed` | Voted by supermajority (~400ms) |
| `finalized` | Rooted, 31+ confirmations (~12s) |

Default: `finalized` for most methods

---

## Rate Limits

Public endpoints have rate limits:
- Requests per second varies
- Some methods are heavier (getProgramAccounts)

Headers to check:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

For production, use:
- Private RPC nodes
- RPC providers (Helius, QuickNode, Triton, etc.)

---

## Error Codes

| Code | Message | Description |
|------|---------|-------------|
| -32600 | Invalid Request | Malformed JSON |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Wrong parameters |
| -32603 | Internal error | RPC node error |
| -32004 | Block not available | Block not found |
| -32005 | Node unhealthy | Node is behind |
| -32007 | Slot skipped | Slot was skipped |
| -32009 | Transaction precompile verification failure | Signature verification failed |
| -32010 | Slot not confirmed | Slot not confirmed yet |

---

## cURL Examples

### Get Balance
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["ADDRESS"]}' \
  https://api.mainnet-beta.solana.com
```

### Send Transaction
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"sendTransaction","params":["BASE64_TX",{"encoding":"base64"}]}' \
  https://api.mainnet-beta.solana.com
```

### Get Latest Blockhash
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[]}' \
  https://api.mainnet-beta.solana.com
```
