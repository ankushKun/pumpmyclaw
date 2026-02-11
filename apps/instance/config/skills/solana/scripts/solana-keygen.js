#!/usr/bin/env node
/**
 * Solana Keypair Generator
 * 
 * Usage:
 *   node solana-keygen.js                    # Generate random keypair
 *   node solana-keygen.js --vanity ABC       # Generate vanity address
 *   node solana-keygen.js --from-seed <seed> # Derive from 32-byte seed
 */

const crypto = require('crypto');

// Base58 alphabet
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer) {
    const bytes = [...buffer];
    let result = '';
    
    let leadingZeros = 0;
    for (const b of bytes) {
        if (b !== 0) break;
        leadingZeros++;
    }
    
    const digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let i = 0; i < digits.length; i++) {
            carry += digits[i] << 8;
            digits[i] = carry % 58;
            carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }
    
    result = '1'.repeat(leadingZeros);
    for (let i = digits.length - 1; i >= 0; i--) {
        result += BASE58_ALPHABET[digits[i]];
    }
    
    return result;
}

function base58Decode(str) {
    const bytes = [];
    for (const c of str) {
        const index = BASE58_ALPHABET.indexOf(c);
        if (index === -1) throw new Error(`Invalid base58 character: ${c}`);
        
        let carry = index;
        for (let i = 0; i < bytes.length; i++) {
            carry += bytes[i] * 58;
            bytes[i] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    
    for (const c of str) {
        if (c !== '1') break;
        bytes.push(0);
    }
    
    return Buffer.from(bytes.reverse());
}

function generateKeypair(seed = null) {
    // Generate or use provided seed
    const seedBuffer = seed ? 
        (typeof seed === 'string' ? base58Decode(seed) : seed) :
        crypto.randomBytes(32);
    
    if (seedBuffer.length !== 32) {
        throw new Error('Seed must be 32 bytes');
    }
    
    // Create Ed25519 private key from seed
    const privateKey = crypto.createPrivateKey({
        key: Buffer.concat([
            Buffer.from('302e020100300506032b657004220420', 'hex'),
            seedBuffer
        ]),
        format: 'der',
        type: 'pkcs8'
    });
    
    // Get public key
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
    const publicKeyRaw = publicKeyDer.slice(-32);
    
    // Create full keypair (64 bytes: seed + public key)
    const keypair = Buffer.concat([seedBuffer, publicKeyRaw]);
    
    return {
        publicKey: base58Encode(publicKeyRaw),
        privateKey: base58Encode(keypair),
        seed: base58Encode(seedBuffer)
    };
}

function generateVanityKeypair(prefix, maxAttempts = 1000000) {
    const prefixLower = prefix.toLowerCase();
    let attempts = 0;
    
    while (attempts < maxAttempts) {
        const keypair = generateKeypair();
        if (keypair.publicKey.toLowerCase().startsWith(prefixLower)) {
            return { ...keypair, attempts };
        }
        attempts++;
        
        if (attempts % 10000 === 0) {
            process.stderr.write(`Attempts: ${attempts}\r`);
        }
    }
    
    throw new Error(`Could not find vanity address starting with "${prefix}" after ${maxAttempts} attempts`);
}

// Main
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    console.log(`Solana Keypair Generator

Usage:
  node solana-keygen.js                    Generate random keypair
  node solana-keygen.js --vanity <prefix>  Generate vanity address
  node solana-keygen.js --from-seed <seed> Derive from base58 seed

Output: JSON with publicKey, privateKey, and seed
`);
    process.exit(0);
}

try {
    let result;
    
    if (args.includes('--vanity')) {
        const prefixIndex = args.indexOf('--vanity') + 1;
        const prefix = args[prefixIndex];
        if (!prefix) {
            throw new Error('--vanity requires a prefix argument');
        }
        console.error(`Generating vanity address starting with "${prefix}"...`);
        result = generateVanityKeypair(prefix);
        console.error(`Found after ${result.attempts} attempts`);
        delete result.attempts;
    } else if (args.includes('--from-seed')) {
        const seedIndex = args.indexOf('--from-seed') + 1;
        const seed = args[seedIndex];
        if (!seed) {
            throw new Error('--from-seed requires a seed argument');
        }
        result = generateKeypair(seed);
    } else {
        result = generateKeypair();
    }
    
    console.log(JSON.stringify(result, null, 2));
    
} catch (error) {
    console.log(JSON.stringify({ error: error.message }));
    process.exit(1);
}
