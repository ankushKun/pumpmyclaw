#!/usr/bin/env node
/**
 * Transfer SOL to another address
 * Usage: node solana-transfer.js <to_address> <amount_sol>
 */

const { 
    base58Encode, 
    base58Decode, 
    getPublicKeyFromPrivate, 
    signMessage,
    loadConfig, 
    rpcRequest 
} = require('./solana-common.js');

// System Program ID (all zeros, 32 bytes)
const SYSTEM_PROGRAM_ID = Buffer.alloc(32, 0);

/**
 * Pad a decoded pubkey buffer to exactly 32 bytes (left-pad with zeros).
 * base58Decode can return < 32 bytes if the key has leading zero bytes.
 */
function toPubkey(input) {
    const raw = typeof input === 'string' ? base58Decode(input) : input;
    if (raw.length === 32) return raw;
    if (raw.length > 32) return raw.slice(raw.length - 32);
    // Left-pad with zeros
    const padded = Buffer.alloc(32, 0);
    raw.copy(padded, 32 - raw.length);
    return padded;
}

/**
 * Build a legacy Solana transaction message for a SOL transfer.
 * 
 * Legacy message format:
 *   [header: 3 bytes]
 *   [num_accounts: compact-u16]
 *   [account_keys: 32 bytes each]
 *   [recent_blockhash: 32 bytes]
 *   [num_instructions: compact-u16]
 *   [instructions...]
 * 
 * For a simple transfer we have 3 accounts:
 *   0: from (signer, writable)
 *   1: to (writable)
 *   2: system_program (readonly)
 * 
 * Header: [1 required_signer, 0 readonly_signed, 1 readonly_unsigned]
 */
function buildTransferMessage(fromPubkey, toPubkey32, lamports, recentBlockhash) {
    const from32 = toPubkey(fromPubkey);
    const to32 = toPubkey(toPubkey32);
    const bh32 = toPubkey(recentBlockhash); // blockhash is also 32 bytes base58

    // Header
    const header = Buffer.from([1, 0, 1]);

    // Accounts compact-u16 (3 accounts, fits in 1 byte)
    const numAccounts = Buffer.from([3]);

    // Transfer instruction data: u32 LE index (2) + u64 LE lamports
    const ixData = Buffer.alloc(12);
    ixData.writeUInt32LE(2, 0);
    ixData.writeBigUInt64LE(BigInt(lamports), 4);

    // Instruction: programIdIndex=2, 2 account indices [0,1], data
    const instruction = Buffer.concat([
        Buffer.from([1]),     // num_instructions = 1
        Buffer.from([2]),     // programIdIndex = 2 (system program)
        Buffer.from([2]),     // num account indices = 2
        Buffer.from([0, 1]), // account indices: from=0, to=1
        Buffer.from([ixData.length]), // data length
        ixData
    ]);

    return Buffer.concat([
        header,
        numAccounts,
        from32,
        to32,
        SYSTEM_PROGRAM_ID,
        bh32,
        instruction
    ]);
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2 || args.includes('--help')) {
        console.log(`Transfer SOL to another address

Usage:
  node solana-transfer.js <to_address> <amount_sol>
  node solana-transfer.js --key <private_key> <to_address> <amount_sol>

Options:
  --key <key>  Use specific private key
  --simulate   Simulate only, don't send

Output: JSON with transaction signature
`);
        process.exit(args.includes('--help') ? 0 : 1);
    }
    
    try {
        const config = loadConfig();
        let privateKey = config.privateKey;
        let toAddress, amountSol;
        const simulate = args.includes('--simulate');
        
        const keyIndex = args.indexOf('--key');
        if (keyIndex !== -1) {
            privateKey = args[keyIndex + 1];
            const remaining = args.filter((_, i) => i !== keyIndex && i !== keyIndex + 1 && args[i] !== '--simulate');
            toAddress = remaining[0];
            amountSol = parseFloat(remaining[1]);
        } else {
            const remaining = args.filter(a => a !== '--simulate');
            toAddress = remaining[0];
            amountSol = parseFloat(remaining[1]);
        }
        
        if (!privateKey) {
            throw new Error('No private key. Use --key or set in config.json/SOLANA_PRIVATE_KEY');
        }
        
        if (!toAddress || isNaN(amountSol)) {
            throw new Error('Invalid arguments. Usage: solana-transfer.js <to_address> <amount_sol>');
        }
        
        const lamports = Math.floor(amountSol * 1_000_000_000);
        if (lamports <= 0) {
            throw new Error('Amount must be positive');
        }
        
        // Get sender public key
        const fromPubkey = getPublicKeyFromPrivate(privateKey);
        const fromAddress = base58Encode(fromPubkey);
        
        console.error(`[solana-transfer] Transferring ${amountSol} SOL (${lamports} lamports)`);
        console.error(`[solana-transfer] From: ${fromAddress}`);
        console.error(`[solana-transfer] To: ${toAddress}`);
        
        // Get recent blockhash
        const blockhashResult = await rpcRequest(config.rpcUrl, 'getLatestBlockhash', [
            { commitment: config.commitment || 'confirmed' }
        ]);
        const recentBlockhash = blockhashResult.value.blockhash;
        
        // Build transaction message
        const message = buildTransferMessage(fromPubkey, toAddress, lamports, recentBlockhash);
        
        // Sign message
        const signature = signMessage(message, privateKey);
        
        // Build signed transaction: [num_sigs(1)][signature(64)][message]
        const transaction = Buffer.concat([
            Buffer.from([1]),
            signature,
            message
        ]);
        
        const txBase64 = transaction.toString('base64');
        
        if (simulate) {
            const simResult = await rpcRequest(config.rpcUrl, 'simulateTransaction', [
                txBase64,
                { encoding: 'base64', commitment: config.commitment || 'confirmed' }
            ]);
            
            console.log(JSON.stringify({
                success: simResult.value.err === null,
                simulation: true,
                error: simResult.value.err,
                logs: simResult.value.logs,
                unitsConsumed: simResult.value.unitsConsumed
            }, null, 2));
        } else {
            const txSignature = await rpcRequest(config.rpcUrl, 'sendTransaction', [
                txBase64,
                { 
                    encoding: 'base64',
                    skipPreflight: false,
                    preflightCommitment: config.commitment || 'confirmed'
                }
            ]);
            
            console.log(JSON.stringify({
                success: true,
                signature: txSignature,
                from: fromAddress,
                to: toAddress,
                amount: amountSol,
                lamports,
                explorer: `https://orb.helius.dev/tx/${txSignature}`
            }, null, 2));
        }
        
    } catch (error) {
        console.error(`[solana-transfer] ERROR: ${error.message}`);
        console.log(JSON.stringify({
            success: false,
            error: error.message
        }));
        process.exit(1);
    }
}

main();
