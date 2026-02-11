#!/usr/bin/env node
/**
 * Test buy and sell via PumpPortal Local Transaction API.
 *
 * Usage:
 *   node test-buy-sell.js buy  <mint> <sol_amount>
 *   node test-buy-sell.js sell <mint> <amount|100%>
 */

const crypto = require('crypto');
const https = require('https');

// ── Config ──────────────────────────────────────────────────────────
const WALLET = {
    publicKey:  'FtAfkDrJGLNy1D89Tj9MUk5FsmtjUiEkjagmHz2ZFD6t',
    secretKey:  '5hDzRAJ2mwGWRAva9m1a5vA3Enq5p4jatPwRrkZ8bP4DSauDBApupxQSpsGLkR15Mt7yAaBTMwgwYX6JVEcv9JEG',
};
const RPC_URL = 'https://api.mainnet-beta.solana.com';
const PUMPPORTAL_API = 'https://pumpportal.fun/api';

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
        const idx = B58.indexOf(c); if (idx === -1) throw new Error(`Bad b58: ${c}`);
        let carry = idx;
        for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
        while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (const c of str) { if (c !== '1') break; bytes.push(0); }
    return Buffer.from(bytes.reverse());
}

// ── Crypto ──────────────────────────────────────────────────────────
function signMsg(message, secretKeyBase58) {
    const keyBuf = b58dec(secretKeyBase58);
    const seed = keyBuf.length === 64 ? keyBuf.slice(0, 32) : keyBuf;
    const pk = crypto.createPrivateKey({
        key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
        format: 'der', type: 'pkcs8'
    });
    return crypto.sign(null, Buffer.isBuffer(message) ? message : Buffer.from(message), pk);
}

// ── HTTP ────────────────────────────────────────────────────────────
function httpsReq(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname, port: 443, path: u.pathname + u.search,
            method: opts.method || 'GET',
            headers: { 'Accept': 'application/json', ...opts.headers }
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${buf.toString().substring(0, 300)}`));
                resolve(opts.raw ? buf : (() => { try { return JSON.parse(buf.toString()); } catch { return buf.toString(); } })());
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
        if (opts.body) {
            const data = JSON.stringify(opts.body);
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('Content-Length', Buffer.byteLength(data));
            req.write(data);
        }
        req.end();
    });
}

function rpc(method, params = []) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
        const req = https.request({
            hostname: 'api.mainnet-beta.solana.com', port: 443, path: '/', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                const r = JSON.parse(body);
                if (r.error) reject(new Error(r.error.message));
                else resolve(r.result);
            });
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

// ── Transaction ─────────────────────────────────────────────────────
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
    const firstSigner = b58enc(msg.slice(aco, aco + 32));
    return { buf, sigCount, sigsStart, msg, numReqSigs, firstSigner };
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
    const [action, mint, amount] = process.argv.slice(2);

    if (!action || !mint || !amount) {
        console.log('Usage:');
        console.log('  node test-buy-sell.js buy  <mint> <sol_amount>');
        console.log('  node test-buy-sell.js sell <mint> <amount|100%>');
        process.exit(1);
    }

    const isBuy = action === 'buy';
    console.log(`Action:  ${action.toUpperCase()}`);
    console.log(`Token:   ${mint}`);
    console.log(`Amount:  ${amount}${isBuy ? ' SOL' : ''}`);
    console.log(`Wallet:  ${WALLET.publicKey}`);
    console.log();

    // Check balance
    const bal = await rpc('getBalance', [WALLET.publicKey]);
    console.log(`Balance: ${bal.value / 1e9} SOL`);

    // Get token info
    try {
        const info = await httpsReq(`https://frontend-api-v3.pump.fun/coins/${mint}?sync=true`);
        console.log(`Token:   ${info.name} (${info.symbol}) - MC: $${Math.round(info.usd_market_cap || 0)}`);
    } catch (e) {
        console.log(`Token info: ${e.message}`);
    }
    console.log();

    // Build trade request
    const tradeReq = {
        publicKey: WALLET.publicKey,
        action: action,
        mint: mint,
        denominatedInSol: isBuy ? 'true' : 'false',
        amount: isBuy ? parseFloat(amount) : amount,
        slippage: 50,
        priorityFee: 0.0005,
        pool: 'auto'
    };

    console.log(`Requesting tx from PumpPortal...`);
    console.log(`  ${JSON.stringify(tradeReq)}`);

    const txBytes = await httpsReq(`${PUMPPORTAL_API}/trade-local`, {
        method: 'POST', body: tradeReq, raw: true
    });
    console.log(`Got transaction: ${txBytes.length} bytes`);

    // Deserialize & sign
    const tx = deserializeTx(txBytes);
    console.log(`Sig slots: ${tx.sigCount}, required: ${tx.numReqSigs}, first signer: ${tx.firstSigner}`);

    if (tx.firstSigner !== WALLET.publicKey) {
        console.log(`WARNING: first signer mismatch!`);
    }

    const sig = signMsg(tx.msg, WALLET.secretKey);
    const signedTx = Buffer.concat([
        tx.buf.slice(0, tx.sigsStart),
        sig,
        tx.buf.slice(tx.sigsStart + 64)
    ]);

    // Submit (skip preflight - more reliable for pump.fun txs)
    console.log(`Submitting to Solana (skipPreflight)...`);
    try {
        const txSig = await rpc('sendTransaction', [
            signedTx.toString('base64'),
            { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 3 }
        ]);
        console.log(`\nSuccess!`);
        console.log(`  Tx:       https://solscan.io/tx/${txSig}`);
        console.log(`  Pump.fun: https://pump.fun/coin/${mint}`);
    } catch (err) {
        console.error(`\nFailed: ${err.message}`);
        // Try base58 fallback
        console.log('Retrying with base58...');
        try {
            const txSig = await rpc('sendTransaction', [
                b58enc(signedTx),
                { skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 3 }
            ]);
            console.log(`\nSuccess (base58)!`);
            console.log(`  Tx:       https://solscan.io/tx/${txSig}`);
            console.log(`  Pump.fun: https://pump.fun/coin/${mint}`);
        } catch (err2) {
            console.error(`Base58 retry also failed: ${err2.message}`);
            process.exit(1);
        }
    }

    // Check balance after
    const balAfter = await rpc('getBalance', [WALLET.publicKey]);
    console.log(`\nBalance after: ${balAfter.value / 1e9} SOL`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
