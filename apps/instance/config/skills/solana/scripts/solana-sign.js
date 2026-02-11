#!/usr/bin/env node
/**
 * Sign a message with Solana keypair
 * Usage: node solana-sign.js "message to sign"
 */

const { base58Encode, signMessage, getPublicKeyFromPrivate, loadConfig } = require('./solana-common.js');

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help')) {
        console.log(`Sign a message with Solana keypair

Usage:
  node solana-sign.js "message to sign"
  node solana-sign.js --key <private_key> "message"

Options:
  --key <key>  Use specific private key (otherwise uses config/env)

Output: JSON with signature, message, and signer address
`);
        process.exit(0);
    }
    
    try {
        let privateKey;
        let message;
        
        const keyIndex = args.indexOf('--key');
        if (keyIndex !== -1) {
            privateKey = args[keyIndex + 1];
            message = args.filter((_, i) => i !== keyIndex && i !== keyIndex + 1).join(' ');
        } else {
            const config = loadConfig();
            privateKey = config.privateKey;
            message = args.join(' ');
        }
        
        if (!privateKey) {
            throw new Error('No private key provided. Use --key or set in config.json/SOLANA_PRIVATE_KEY');
        }
        
        if (!message) {
            throw new Error('No message provided');
        }
        
        // Sign the message
        const signature = signMessage(message, privateKey);
        const publicKey = getPublicKeyFromPrivate(privateKey);
        
        console.log(JSON.stringify({
            success: true,
            signature: base58Encode(signature),
            message: message,
            signer: base58Encode(publicKey)
        }, null, 2));
        
    } catch (error) {
        console.log(JSON.stringify({
            success: false,
            error: error.message
        }));
        process.exit(1);
    }
}

main();
