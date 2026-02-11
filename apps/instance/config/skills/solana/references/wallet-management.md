# Wallet Management Reference

Generate, manage, and secure Solana keypairs.

## Overview

Solana uses Ed25519 elliptic curve cryptography for keypairs:
- **Private Key**: 32-byte seed (or 64-byte full keypair)
- **Public Key**: 32-byte address derived from private key
- **Address**: Base58-encoded public key

## Keypair Formats

### Base58 Encoded (64 bytes)
Most common format. Contains both seed (32 bytes) and public key (32 bytes).
```
5abc123...xyz789  (88 characters)
```

### JSON Array (Solana CLI)
Used by `solana-keygen` CLI tool:
```json
[1,2,3,4,...,64]  // 64 integers (bytes)
```

### Seed Only (32 bytes)
Just the private seed, public key is derived:
```
3xK7y...  (44 characters base58)
```

---

## Generate Keypair

### Using Script
```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-keygen.sh
```

Output:
```json
{
  "publicKey": "7xKXtg...",
  "privateKey": "5abc123...",
  "mnemonic": null
}
```

### Programmatic (Node.js)
```javascript
const crypto = require('crypto');

// Generate random seed
const seed = crypto.randomBytes(32);

// Create Ed25519 keypair
const privateKey = crypto.createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed
  ]),
  format: 'der',
  type: 'pkcs8'
});

const publicKey = crypto.createPublicKey(privateKey);
const publicKeyRaw = publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
```

---

## Derive Public Key

Get public key from private key:

```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-pubkey.sh <private_key>
```

### From 64-byte keypair
The public key is the last 32 bytes.

### From 32-byte seed
Derive using Ed25519 key generation.

---

## Import/Export Formats

### From Solana CLI Keypair File
```bash
# Read keypair.json
cat ~/.config/solana/id.json
# Output: [1,2,3,...,64]
```

### To Phantom/Solflare
Export as base58 string (64 bytes).

### From Mnemonic (BIP39)
Not natively supported by scripts. Use wallet apps or libraries.

---

## Key Storage

### config.json
```json
{
  "privateKey": "5abc123...",
  "rpcUrl": "https://api.mainnet-beta.solana.com"
}
```

### Environment Variable
```bash
export SOLANA_PRIVATE_KEY="5abc123..."
```

### Solana CLI Keypair File
```bash
export SOLANA_KEYPAIR_PATH="~/.config/solana/id.json"
```

---

## Vanity Addresses

Generate addresses with specific prefixes:

```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-keygen.sh --vanity ABC
```

**Note**: Longer prefixes take exponentially longer to generate.

| Prefix Length | Approximate Time |
|---------------|------------------|
| 1 char | Instant |
| 2 chars | <1 second |
| 3 chars | 1-10 seconds |
| 4 chars | 1-10 minutes |
| 5+ chars | Hours to days |

---

## Program Derived Addresses (PDAs)

PDAs are addresses without private keys, derived from program ID and seeds:

```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-pda.sh <program_id> <seed1> [seed2...]
```

### Characteristics
- Deterministic: Same inputs = same address
- Off-curve: Not valid Ed25519 points (no private key)
- Program-controlled: Only the program can sign

### Finding PDA with Bump
```javascript
// Iterate bump from 255 down until valid PDA found
for (let bump = 255; bump >= 0; bump--) {
  const seeds = [Buffer.from("seed"), Buffer.from([bump])];
  // Check if result is off-curve
}
```

---

## Signing Messages

Sign arbitrary messages for authentication:

```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-sign.sh "message to sign"
```

### Message Format
```
Message: Hello, Solana!
```

### Signature
64-byte Ed25519 signature, base58 encoded.

### Verification
```bash
/home/openclaw/.openclaw/skills/solana/scripts/solana-verify.sh <address> <signature> "message"
```

---

## Security Best Practices

### DO
- Generate keys on secure, offline machines when possible
- Use hardware wallets for large holdings
- Store backups in multiple secure locations
- Use unique wallets for different purposes
- Verify addresses before transactions

### DON'T
- Store private keys in plaintext
- Share private keys ever
- Reuse keys across applications
- Generate keys in browsers (unless necessary)
- Commit keys to version control

### Key Rotation
- Create new keypair
- Transfer all assets
- Update all references
- Securely destroy old key

---

## Multiple Accounts

### HD Wallet Derivation
Not directly supported. Use wallet apps for HD paths.

### Multiple Keypair Files
```bash
# List keypairs
ls ~/.config/solana/*.json

# Use specific keypair
export SOLANA_KEYPAIR_PATH=~/.config/solana/trading.json
```

---

## Common Issues

| Issue | Resolution |
|-------|------------|
| Invalid keypair length | Ensure 64 bytes for full keypair |
| Cannot decode base58 | Check for typos, invalid characters |
| Permission denied | Check file permissions on keypair |
| Key not recognized | Verify format (JSON array vs base58) |

---

## Related Scripts

```bash
# Generate new keypair
solana-keygen.sh

# Get public key from private
solana-pubkey.sh <private_key>

# Sign message
solana-sign.sh "message"

# Verify signature
solana-verify.sh <address> <signature> "message"

# Derive PDA
solana-pda.sh <program_id> <seeds...>
```
