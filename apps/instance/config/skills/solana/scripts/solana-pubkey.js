#!/usr/bin/env node
/**
 * Get public key from private key
 * Usage: node solana-pubkey.js <private_key>
 */

const { base58Encode, getPublicKeyFromPrivate } = require('./solana-common.js');
const fs = require('fs');

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help')) {
    console.log(`Get public key from private key

Usage:
  node solana-pubkey.js <private_key_base58>
  node solana-pubkey.js --file <keypair.json>

Arguments:
  private_key  Base58-encoded private key (32 or 64 bytes)
  --file       Path to Solana CLI keypair JSON file

Output: JSON with public key address
`);
    process.exit(args.includes('--help') ? 0 : 1);
}

try {
    let privateKey;
    
    if (args[0] === '--file') {
        const filePath = args[1];
        if (!filePath) {
            throw new Error('--file requires a path argument');
        }
        privateKey = fs.readFileSync(filePath, 'utf8').trim();
    } else {
        privateKey = args[0];
    }
    
    const publicKey = getPublicKeyFromPrivate(privateKey);
    const address = base58Encode(publicKey);
    
    console.log(JSON.stringify({
        publicKey: address,
        address: address
    }, null, 2));
    
} catch (error) {
    console.log(JSON.stringify({
        error: error.message
    }));
    process.exit(1);
}
