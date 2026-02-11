#!/usr/bin/env node
/**
 * Simple token creation test script.
 * Uses PumpPortal Local Transaction API + pump.fun IPFS.
 *
 * Usage:
 *   node test-create-token.js                          # dry-run (no submit)
 *   node test-create-token.js --submit                 # submit with no dev buy
 *   node test-create-token.js --submit --dev-buy 0.005 # submit with 0.005 SOL dev buy
 */

const crypto = require('crypto');
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');

// ── Config ──────────────────────────────────────────────────────────
const WALLET = {
    publicKey:  'FtAfkDrJGLNy1D89Tj9MUk5FsmtjUiEkjagmHz2ZFD6t',
    secretKey:  '5hDzRAJ2mwGWRAva9m1a5vA3Enq5p4jatPwRrkZ8bP4DSauDBApupxQSpsGLkR15Mt7yAaBTMwgwYX6JVEcv9JEG',
};
const RPC_URL = 'https://api.mainnet-beta.solana.com';
const PUMPPORTAL_API = 'https://pumpportal.fun/api';
const PUMP_IPFS = 'https://pump.fun/api/ipfs';
const SUBMIT = process.argv.includes('--submit');
const DEV_BUY_IDX = process.argv.indexOf('--dev-buy');
const DEV_BUY_SOL = DEV_BUY_IDX !== -1 ? parseFloat(process.argv[DEV_BUY_IDX + 1]) : 0;

// ── Base58 ──────────────────────────────────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58enc(buffer) {
    const bytes = [...buffer]; let result = '', lz = 0;
    for (const b of bytes) { if (b !== 0) break; lz++; }
    const digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
        while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
    }
    result = '1'.repeat(lz);
    for (let i = digits.length - 1; i >= 0; i--) result += B58[digits[i]];
    return result;
}

function b58dec(str) {
    const bytes = [];
    for (const c of str) {
        const idx = B58.indexOf(c);
        if (idx === -1) throw new Error(`Bad base58 char: ${c}`);
        let carry = idx;
        for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
        while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (const c of str) { if (c !== '1') break; bytes.push(0); }
    return Buffer.from(bytes.reverse());
}

// ── Ed25519 helpers ─────────────────────────────────────────────────
function signMsg(message, secretKeyBase58) {
    const keyBuf = b58dec(secretKeyBase58);
    const seed = keyBuf.length === 64 ? keyBuf.slice(0, 32) : keyBuf;
    const pk = crypto.createPrivateKey({
        key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
        format: 'der', type: 'pkcs8'
    });
    return crypto.sign(null, Buffer.isBuffer(message) ? message : Buffer.from(message), pk);
}

function genKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pub = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
    const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32);
    return { publicKey: b58enc(pub), secretKey: b58enc(Buffer.concat([priv, pub])) };
}

// ── HTTP helpers ────────────────────────────────────────────────────
function httpsPost(url, body, raw = false) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        const req = https.request({
            hostname: u.hostname, port: 443, path: u.pathname + u.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${buf.toString().substring(0, 300)}`));
                resolve(raw ? buf : JSON.parse(buf.toString()));
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
        req.write(data);
        req.end();
    });
}

function rpc(method, params = []) {
    return httpsPost(RPC_URL, { jsonrpc: '2.0', id: 1, method, params }).then(r => {
        if (r.error) throw new Error(r.error.message);
        return r.result;
    });
}

// ── Transaction deserialization ─────────────────────────────────────
function deserializeTx(data) {
    const buf = Buffer.from(data);
    let off = 0, sigCount = 0, shift = 0;
    while (true) { const b = buf[off++]; sigCount |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; }
    const sigsStart = off;
    off += sigCount * 64;
    const msg = buf.slice(off);

    const isV = (msg[0] & 0x80) !== 0;
    let ho = isV ? 1 : 0;
    const numReqSigs = msg[ho];

    let aco = ho + 3, ac = 0, as2 = 0;
    while (true) { const b = msg[aco++]; ac |= (b & 0x7f) << as2; if (!(b & 0x80)) break; as2 += 7; }

    const signerKeys = [];
    for (let i = 0; i < Math.min(ac, numReqSigs); i++) {
        signerKeys.push(b58enc(msg.slice(aco + i * 32, aco + i * 32 + 32)));
    }
    return { buf, sigCount, sigsStart, msgOff: off, msg, numReqSigs, signerKeys };
}

// ── IPFS upload via curl ────────────────────────────────────────────
function uploadIPFS(name, symbol, description, imgPath) {
    const cmd = `curl -sf --max-time 30 "${PUMP_IPFS}" ` +
        `-F "file=@${imgPath};type=image/png" ` +
        `-F "name=${name.replace(/"/g, '\\"')}" ` +
        `-F "symbol=${symbol.replace(/"/g, '\\"')}" ` +
        `-F "description=${description.replace(/"/g, '\\"')}" ` +
        `-F "showName=true"`;
    return JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 60000 }));
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
    const name = 'PumpMyClaw';
    const symbol = 'PMC';
    const description = 'PumpMyClaw test token - autonomous AI trading agent platform';

    console.log(`Mode: ${SUBMIT ? 'LIVE (will submit tx!)' : 'DRY-RUN (won\'t submit)'}`);
    console.log(`Wallet: ${WALLET.publicKey}`);
    console.log(`Dev buy: ${DEV_BUY_SOL > 0 ? DEV_BUY_SOL + ' SOL' : 'none'}`);
    console.log();

    // 1. Check balance
    console.log('Step 1: Checking wallet balance...');
    const balResult = await rpc('getBalance', [WALLET.publicKey]);
    const solBalance = balResult.value / 1e9;
    console.log(`  Balance: ${solBalance} SOL`);
    const minRequired = 0.008 + DEV_BUY_SOL; // ~0.008 for create+fees + dev buy amount
    if (solBalance < minRequired) {
        console.log(`  Not enough SOL. Need at least ~${minRequired.toFixed(4)} SOL (create + ${DEV_BUY_SOL} dev buy).`);
        console.log(`  Please fund: ${WALLET.publicKey}`);
        if (SUBMIT) { process.exit(1); }
        else { console.log('  (continuing in dry-run mode)\n'); }
    }

    // 2. Use token.png from project root
    console.log('Step 2: Loading token image...');
    const imgPath = require('path').join(__dirname, '..', 'token.png');
    if (!fs.existsSync(imgPath)) {
        console.error('  ERROR: token.png not found in project root');
        process.exit(1);
    }
    const imgData = fs.readFileSync(imgPath);
    console.log(`  Image: ${imgPath} (${imgData.length} bytes)`);

    // 3. Upload to IPFS
    console.log('Step 3: Uploading metadata to pump.fun IPFS...');
    const ipfs = uploadIPFS(name, symbol, description, imgPath);
    console.log(`  Metadata URI: ${ipfs.metadataUri}`);

    // 4. Generate mint keypair
    console.log('Step 4: Generating mint keypair...');
    const mint = genKeypair();
    console.log(`  Mint address: ${mint.publicKey}`);

    // 5. Get create transaction from PumpPortal
    console.log('Step 5: Requesting create transaction from PumpPortal...');
    const txBytes = await httpsPost(`${PUMPPORTAL_API}/trade-local`, {
        publicKey: WALLET.publicKey,
        action: 'create',
        tokenMetadata: { name, symbol, uri: ipfs.metadataUri },
        mint: mint.publicKey,
        denominatedInSol: 'true',
        amount: DEV_BUY_SOL, // SOL to spend on initial dev buy (0 = none)
        slippage: 10,
        priorityFee: 0.0005,
        pool: 'pump'
    }, true);
    console.log(`  Transaction: ${txBytes.length} bytes`);

    // 6. Deserialize & sign
    console.log('Step 6: Signing transaction...');
    const tx = deserializeTx(txBytes);
    console.log(`  Sig slots: ${tx.sigCount}, required: ${tx.numReqSigs}`);
    console.log(`  Signer order: [${tx.signerKeys.join(', ')}]`);

    const walletSig = signMsg(tx.msg, WALLET.secretKey);
    const mintSig = signMsg(tx.msg, mint.secretKey);

    // Dynamic signer ordering
    const sigs = [];
    for (const key of tx.signerKeys) {
        if (key === WALLET.publicKey) sigs.push(walletSig);
        else if (key === mint.publicKey) sigs.push(mintSig);
        else { console.log(`  WARNING: unknown signer ${key}`); sigs.push(Buffer.alloc(64)); }
    }

    const signedTx = Buffer.concat([
        tx.buf.slice(0, tx.sigsStart),
        ...sigs,
        tx.buf.slice(tx.sigsStart + tx.sigCount * 64)
    ]);
    console.log(`  Signed tx: ${signedTx.length} bytes`);

    // 7. Submit or dry-run
    if (!SUBMIT) {
        console.log('\nDRY-RUN complete. Transaction was NOT submitted.');
        console.log('Run with --submit to actually create the token.');
        console.log(`\nToken would be: https://pump.fun/coin/${mint.publicKey}`);
        return;
    }

    console.log('Step 7: Submitting transaction to Solana...');
    try {
        const sig = await rpc('sendTransaction', [
            signedTx.toString('base64'),
            { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 3 }
        ]);
        console.log('\nToken created successfully!');
        console.log(`  Mint:      ${mint.publicKey}`);
        console.log(`  Tx:        https://solscan.io/tx/${sig}`);
        console.log(`  Pump.fun:  https://pump.fun/coin/${mint.publicKey}`);
    } catch (err) {
        console.error(`\nSubmission failed: ${err.message}`);
        // Retry with base58
        console.log('Retrying with base58 encoding...');
        try {
            const sig = await rpc('sendTransaction', [
                b58enc(signedTx),
                { skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 3 }
            ]);
            console.log('\nToken created successfully (base58 retry)!');
            console.log(`  Mint:      ${mint.publicKey}`);
            console.log(`  Tx:        https://solscan.io/tx/${sig}`);
            console.log(`  Pump.fun:  https://pump.fun/coin/${mint.publicKey}`);
        } catch (err2) {
            console.error(`Retry also failed: ${err2.message}`);
            process.exit(1);
        }
    }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
