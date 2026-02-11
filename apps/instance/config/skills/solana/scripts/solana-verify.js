#!/usr/bin/env node
/**
 * Verify a signature
 * Usage: node solana-verify.js <address> <signature> "message"
 */

const { verifySignature } = require('./solana-common.js');

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 3 || args.includes('--help')) {
        console.log(`Verify a Solana signature

Usage:
  node solana-verify.js <address> <signature> "message"

Arguments:
  address    Public key of signer (base58)
  signature  Signature to verify (base58)
  message    Original message that was signed

Output: JSON with valid (boolean) and details
`);
        process.exit(args.includes('--help') ? 0 : 1);
    }
    
    try {
        const [address, signature, ...messageParts] = args;
        const message = messageParts.join(' ');
        
        const valid = verifySignature(message, signature, address);
        
        console.log(JSON.stringify({
            valid,
            address,
            signature,
            message
        }, null, 2));
        
    } catch (error) {
        console.log(JSON.stringify({
            valid: false,
            error: error.message
        }));
        process.exit(1);
    }
}

main();
