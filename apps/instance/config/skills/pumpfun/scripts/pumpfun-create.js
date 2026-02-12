#!/usr/bin/env node
/**
 * Pump.fun Token Creation Script
 *
 * Creates a new token on pump.fun via PumpPortal's Local Transaction API.
 * No JWT authentication needed - signs and submits transactions locally.
 *
 * Verified on mainnet 2025-02-11.
 *
 * Flow:
 *   1. Upload image + metadata to pump.fun IPFS (https://pump.fun/api/ipfs)
 *   2. Generate a mint keypair locally
 *   3. Get create transaction from PumpPortal (https://pumpportal.fun/api/trade-local)
 *   4. Sign transaction with wallet keypair + mint keypair (dynamic signer ordering)
 *   5. Submit signed transaction to Solana RPC
 *
 * Usage:
 *   node pumpfun-create.js [name] [symbol] [description] [image_path] [dev_buy_sol]
 *   node pumpfun-create.js --auto   # Auto-generate everything
 *
 * dev_buy_sol: Amount of SOL to spend on initial dev buy (default: 0 = none)
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Constants ───────────────────────────────────────────────────────
const PUMPPORTAL_API = 'https://pumpportal.fun/api';
const PUMP_IPFS_API = 'https://pump.fun/api/ipfs';

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
        if (idx === -1) throw new Error(`Invalid base58 character: ${c}`);
        let carry = idx;
        for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
        while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (const c of str) { if (c !== '1') break; bytes.push(0); }
    return Buffer.from(bytes.reverse());
}

// ── Config ──────────────────────────────────────────────────────────
function loadConfig() {
    const configPath = path.join(path.dirname(__dirname), 'config.json');
    let config = { rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com' };
    if (fs.existsSync(configPath)) {
        try { config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; } catch (_) {}
    }
    if (process.env.SOLANA_PRIVATE_KEY) config.privateKey = process.env.SOLANA_PRIVATE_KEY;
    if (process.env.SOLANA_PUBLIC_KEY) config.publicKey = process.env.SOLANA_PUBLIC_KEY;
    return config;
}

// ── Ed25519 ─────────────────────────────────────────────────────────
function getKeyBuffer(input) {
    if (typeof input === 'string') {
        try { const a = JSON.parse(input); if (Array.isArray(a)) return Buffer.from(a); } catch {}
        return b58dec(input);
    }
    return input;
}

function getPublicKeyFromPrivate(input) {
    const buf = getKeyBuffer(input);
    if (buf.length === 64) return buf.slice(32);
    const pk = crypto.createPrivateKey({
        key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), buf.slice(0, 32)]),
        format: 'der', type: 'pkcs8'
    });
    return crypto.createPublicKey(pk).export({ format: 'der', type: 'spki' }).slice(-32);
}

function signMsg(message, keyInput) {
    const buf = getKeyBuffer(keyInput);
    const seed = buf.length === 64 ? buf.slice(0, 32) : buf;
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

// ── HTTP ────────────────────────────────────────────────────────────
function httpPost(url, body, raw = false) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        const req = https.request({
            hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST',
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
        req.write(data); req.end();
    });
}

function rpc(rpcUrl, method, params = []) {
    return httpPost(rpcUrl, { jsonrpc: '2.0', id: 1, method, params }).then(r => {
        if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
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

    // Parse header to extract signer keys
    const isV = (msg[0] & 0x80) !== 0;
    let ho = isV ? 1 : 0;
    const numReqSigs = msg[ho];

    let aco = ho + 3, ac = 0, as2 = 0;
    while (true) { const b = msg[aco++]; ac |= (b & 0x7f) << as2; if (!(b & 0x80)) break; as2 += 7; }

    const signerKeys = [];
    for (let i = 0; i < Math.min(ac, numReqSigs); i++) {
        signerKeys.push(b58enc(msg.slice(aco + i * 32, aco + i * 32 + 32)));
    }
    return { buf, sigCount, sigsStart, msg, numReqSigs, signerKeys };
}

// ── Placeholder image generation ────────────────────────────────────
function generatePlaceholderImage(name, symbol) {
    const hash = crypto.createHash('md5').update(name + symbol).digest('hex');
    const r = parseInt(hash.substring(0, 2), 16);
    const g = parseInt(hash.substring(2, 4), 16);
    const b = parseInt(hash.substring(4, 6), 16);
    const imgFile = `/tmp/token-placeholder-${Date.now()}.png`;
    const pyFile = `/tmp/token-gen-${Date.now()}.py`;

    const pyScript = [
        'import struct, zlib',
        'W, H = 256, 256',
        'raw = b""',
        'for y in range(H):',
        '    raw += b"\\x00"',
        '    for x in range(W):',
        '        dx, dy = x - W//2, y - H//2',
        '        dist = (dx*dx + dy*dy) ** 0.5',
        '        if dist < 80:',
        `            raw += bytes([min(255,${r}+60), min(255,${g}+60), min(255,${b}+60)])`,
        '        elif dist < 100:',
        `            raw += bytes([min(255,${r}+30), min(255,${g}+30), min(255,${b}+30)])`,
        '        else:',
        `            raw += bytes([${r}, ${g}, ${b}])`,
        'def chunk(ct, d):',
        '    c = ct + d',
        '    return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)',
        `with open("${imgFile}", "wb") as f:`,
        '    f.write(b"\\x89PNG\\r\\n\\x1a\\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))',
    ].join('\n');

    try {
        fs.writeFileSync(pyFile, pyScript);
        execSync(`python3 "${pyFile}"`, { timeout: 10000 });
        const data = fs.readFileSync(imgFile);
        return data;
    } catch (e) {
        console.error(`[create] Warning: image gen failed (${e.message}), using 1x1 fallback`);
        const r2 = r, g2 = g, b2 = b;
        return Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE,
            0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54,
            0x08, 0xD7, 0x63, r2, g2, b2, 0x00, 0x00,
            0x00, 0x04, 0x00, 0x01,
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
            0xAE, 0x42, 0x60, 0x82
        ]);
    } finally {
        try { fs.unlinkSync(pyFile); } catch (_) {}
        try { fs.unlinkSync(imgFile); } catch (_) {}
    }
}

// ── IPFS upload ─────────────────────────────────────────────────────
function uploadToIPFS(name, symbol, description, imagePath) {
    console.error(`[create] Uploading metadata to ${PUMP_IPFS_API}...`);
    const cmd = `curl -sf --max-time 30 "${PUMP_IPFS_API}" ` +
        `-F "file=@${imagePath};type=image/png" ` +
        `-F "name=${name.replace(/"/g, '\\"')}" ` +
        `-F "symbol=${symbol.replace(/"/g, '\\"')}" ` +
        `-F "description=${(description || name + ' - A Pump.fun memecoin').replace(/"/g, '\\"')}" ` +
        `-F "showName=true"`;
    const result = JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 60000 }));
    console.error(`[create] IPFS response: metadataUri=${result.metadataUri}`);
    if (!result.metadataUri) throw new Error(`IPFS upload returned no metadataUri: ${JSON.stringify(result)}`);
    return result;
}

// ── Token creation ──────────────────────────────────────────────────
async function createToken(name, symbol, description, imagePath, config, devBuySol = 0) {
    const { privateKey, publicKey, rpcUrl } = config;
    if (!privateKey) throw new Error('Private key not configured. Set SOLANA_PRIVATE_KEY env var.');

    const pubKeyBuffer = publicKey ? b58dec(publicKey) : getPublicKeyFromPrivate(privateKey);
    const walletAddress = b58enc(pubKeyBuffer);

    console.error(`[create] Creating token: ${name} (${symbol})`);
    console.error(`[create] Wallet: ${walletAddress}`);
    if (devBuySol > 0) console.error(`[create] Dev buy: ${devBuySol} SOL`);

    // 1. Prepare image
    let tmpImage = null;
    if (imagePath && fs.existsSync(imagePath)) {
        console.error(`[create] Using image: ${imagePath}`);
    } else {
        console.error('[create] No image provided, generating placeholder...');
        const imgData = generatePlaceholderImage(name, symbol);
        tmpImage = `/tmp/token-image-${Date.now()}.png`;
        fs.writeFileSync(tmpImage, imgData);
        imagePath = tmpImage;
    }

    try {
        // 2. Upload to IPFS
        const ipfs = uploadToIPFS(name, symbol, description, imagePath);

        // 3. Generate mint keypair
        const mint = genKeypair();
        console.error(`[create] Mint address: ${mint.publicKey}`);

        // 4. Get create transaction from PumpPortal
        console.error('[create] Requesting create transaction from PumpPortal...');
        const createReq = {
            publicKey: walletAddress,
            action: 'create',
            tokenMetadata: { name, symbol, uri: ipfs.metadataUri },
            mint: mint.publicKey,
            denominatedInSol: 'true',
            amount: devBuySol,
            slippage: 10,
            priorityFee: 0.0005,
            pool: 'pump'
        };
        console.error(`[create] Request: ${JSON.stringify(createReq)}`);

        const txBytes = await httpPost(`${PUMPPORTAL_API}/trade-local`, createReq, true);
        if (!Buffer.isBuffer(txBytes) || txBytes.length < 100) {
            throw new Error(`PumpPortal error: ${txBytes.toString().substring(0, 300)}`);
        }
        console.error(`[create] Got transaction (${txBytes.length} bytes)`);

        // 5. Deserialize & sign
        const tx = deserializeTx(txBytes);
        console.error(`[create] Sig slots: ${tx.sigCount}, required: ${tx.numReqSigs}, signers: [${tx.signerKeys.join(', ')}]`);

        const walletSig = signMsg(tx.msg, privateKey);
        const mintSig = signMsg(tx.msg, mint.secretKey);

        // Dynamic signer ordering — match order of account keys in the transaction
        const sigs = [];
        for (const key of tx.signerKeys) {
            if (key === walletAddress) sigs.push(walletSig);
            else if (key === mint.publicKey) sigs.push(mintSig);
            else { console.error(`[create] WARNING: unknown signer ${key}`); sigs.push(Buffer.alloc(64)); }
        }

        const signedTx = Buffer.concat([
            tx.buf.slice(0, tx.sigsStart),
            ...sigs,
            tx.buf.slice(tx.sigsStart + tx.sigCount * 64)
        ]);

        // 6. Submit — use skipPreflight (preflight can spuriously reject pump.fun txs)
        console.error('[create] Submitting to Solana...');
        let txSignature;
        try {
            txSignature = await rpc(rpcUrl, 'sendTransaction', [
                signedTx.toString('base64'),
                { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 3 }
            ]);
        } catch (e) {
            console.error(`[create] Base64 submit failed: ${e.message}, retrying base58...`);
            txSignature = await rpc(rpcUrl, 'sendTransaction', [
                b58enc(signedTx),
                { skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 3 }
            ]);
        }

        console.error(`[create] Token created! Mint: ${mint.publicKey} Tx: ${txSignature}`);
        return {
            success: true,
            token: { name, symbol, mint: mint.publicKey, description: description || `${name} - A Pump.fun memecoin`, metadataUri: ipfs.metadataUri },
            transaction: { signature: txSignature, explorer: `https://orb.helius.dev/tx/${txSignature}` },
            links: { pumpfun: `https://pump.fun/coin/${mint.publicKey}`, dexscreener: `https://dexscreener.com/solana/${mint.publicKey}` }
        };
    } finally {
        if (tmpImage) try { fs.unlinkSync(tmpImage); } catch (_) {}
    }
}

// ── Random name generation ──────────────────────────────────────────
function generateRandomName() {
    const prefixes = ['Moon', 'Doge', 'Pepe', 'Shib', 'Wojak', 'Chad', 'Based', 'Giga', 'Ultra', 'Mega', 'Super', 'Hyper'];
    const suffixes = ['Inu', 'Coin', 'Token', 'Moon', 'Rocket', 'King', 'Lord', 'Master', 'Boss', 'Chief'];
    return prefixes[Math.floor(Math.random() * prefixes.length)] + suffixes[Math.floor(Math.random() * suffixes.length)];
}

function generateSymbol(name) {
    return name.replace(/[^a-zA-Z]/g, '').substring(0, 5).toUpperCase();
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    try {
        const config = loadConfig();
        if (!config.privateKey) {
            console.log(JSON.stringify({ error: 'No private key configured. Set SOLANA_PRIVATE_KEY or add to config.json' }));
            process.exit(1);
        }

        let name, symbol, description, imagePath, devBuySol = 0;
        if (args.length === 0 || args[0] === '--auto') {
            name = generateRandomName();
            symbol = generateSymbol(name);
            description = `${name} - The next big memecoin on Pump.fun!`;
        } else {
            name = args[0] || generateRandomName();
            symbol = args[1] || generateSymbol(name);
            description = args[2] || `${name} - A Pump.fun memecoin`;
            imagePath = args[3] || undefined;
            if (args[4]) devBuySol = parseFloat(args[4]) || 0;
        }

        const result = await createToken(name, symbol, description, imagePath, config, devBuySol);
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(`[create] ERROR: ${error.message}`);
        console.log(JSON.stringify({ success: false, error: error.message }));
        process.exit(1);
    }
}

main();
