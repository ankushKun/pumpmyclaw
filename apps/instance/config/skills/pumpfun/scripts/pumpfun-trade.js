#!/usr/bin/env node
/**
 * Pump.fun Trading Script via PumpPortal Local Transaction API
 *
 * No JWT needed - builds transaction via PumpPortal, signs locally, submits to RPC.
 *
 * Verified on mainnet 2025-02-11.
 *
 * Usage:
 *   node pumpfun-trade.js buy  <mint> <sol_amount>  [slippage_pct]
 *   node pumpfun-trade.js sell <mint> <token_amount|100%> [slippage_pct]
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Constants ───────────────────────────────────────────────────────
const PUMPPORTAL_API = 'https://pumpportal.fun/api';
const PUMP_API = 'https://frontend-api-v3.pump.fun';

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

// ── HTTP ────────────────────────────────────────────────────────────
function httpsReq(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const reqOpts = {
            hostname: u.hostname, port: 443, path: u.pathname + u.search,
            method: opts.method || 'GET',
            headers: { 'Accept': 'application/json', ...opts.headers }
        };
        const req = https.request(reqOpts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${buf.toString().substring(0, 300)}`));
                resolve(opts.raw ? buf : (() => { try { return JSON.parse(buf.toString()); } catch { return buf.toString(); } })());
            });
        });
        req.on('error', reject);
        req.setTimeout(opts.timeout || 30000, () => { req.destroy(); reject(new Error('timeout')); });
        if (opts.body) {
            const data = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('Content-Length', Buffer.byteLength(data));
            req.write(data);
        }
        req.end();
    });
}

function rpc(rpcUrl, method, params = []) {
    return httpsReq(rpcUrl, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method, params } }).then(r => {
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

    const isV = (msg[0] & 0x80) !== 0;
    let ho = isV ? 1 : 0;
    const numReqSigs = msg[ho];
    let aco = ho + 3, ac = 0, as2 = 0;
    while (true) { const b = msg[aco++]; ac |= (b & 0x7f) << as2; if (!(b & 0x80)) break; as2 += 7; }
    const firstSigner = ac > 0 ? b58enc(msg.slice(aco, aco + 32)) : null;

    return { buf, sigCount, sigsStart, msg, numReqSigs, firstSigner };
}

// ── Token info (optional, for display) ──────────────────────────────
async function getTokenInfo(mint) {
    try {
        return await httpsReq(`${PUMP_API}/coins/${mint}?sync=true`, { timeout: 10000 });
    } catch (_) {
        return { name: 'Unknown', symbol: '???', usd_market_cap: null };
    }
}

// ── Balance check ───────────────────────────────────────────────────
async function checkWalletBalance(config) {
    const { privateKey, publicKey, rpcUrl } = config;
    const pubKeyBuffer = publicKey ? b58dec(publicKey) : getPublicKeyFromPrivate(privateKey);
    const walletAddress = b58enc(pubKeyBuffer);
    
    const result = await rpc(rpcUrl, 'getBalance', [walletAddress]);
    const lamports = result.value || 0;
    return { sol: lamports / 1e9, lamports, address: walletAddress };
}

// ── Trade execution ─────────────────────────────────────────────────
async function executeTrade(action, mint, amount, slippagePct, config) {
    const { privateKey, publicKey, rpcUrl } = config;
    if (!privateKey) throw new Error('Private key not configured');

    const pubKeyBuffer = publicKey ? b58dec(publicKey) : getPublicKeyFromPrivate(privateKey);
    const walletAddress = b58enc(pubKeyBuffer);

    const isBuy = action === 'buy';
    const isPercentSell = !isBuy && typeof amount === 'string' && amount.endsWith('%');

    // Get token info for context
    const tokenInfo = await getTokenInfo(mint);

    // Build PumpPortal request — must use pool: 'auto' (pool: 'pump' returns 400 for trades)
    const tradeReq = {
        publicKey: walletAddress,
        action: action,
        mint: mint,
        denominatedInSol: isBuy ? 'true' : 'false',
        amount: isPercentSell ? amount : parseFloat(amount),
        slippage: slippagePct,
        priorityFee: 0.0005,
        pool: 'auto'
    };

    const txBytes = await httpsReq(`${PUMPPORTAL_API}/trade-local`, {
        method: 'POST', body: tradeReq, raw: true
    });

    if (!Buffer.isBuffer(txBytes) || txBytes.length < 100) {
        throw new Error(`PumpPortal error: ${txBytes.toString().substring(0, 300)}`);
    }

    // Deserialize & sign
    const tx = deserializeTx(txBytes);

    const walletSig = signMsg(tx.msg, privateKey);
    const signedTx = Buffer.concat([
        tx.buf.slice(0, tx.sigsStart),
        walletSig,
        tx.buf.slice(tx.sigsStart + 64) // replace first sig slot, keep rest + message
    ]);

    // Submit — use skipPreflight (preflight can spuriously reject pump.fun txs)
    let txSignature;
    try {
        txSignature = await rpc(rpcUrl, 'sendTransaction', [
            signedTx.toString('base64'),
            { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 3 }
        ]);
    } catch (e) {
        // Retry with base58 encoding
        txSignature = await rpc(rpcUrl, 'sendTransaction', [
            b58enc(signedTx),
            { skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 3 }
        ]);
    }

    // Confirm transaction landed on-chain (poll for up to 60 seconds)
    let confirmed = false;
    let txStatus = 'unknown';
    const confirmStart = Date.now();
    const CONFIRM_TIMEOUT_MS = 60000;
    while (Date.now() - confirmStart < CONFIRM_TIMEOUT_MS) {
        try {
            const statusResult = await rpc(rpcUrl, 'getSignatureStatuses', [[txSignature], { searchTransactionHistory: false }]);
            const status = statusResult?.value?.[0];
            if (status) {
                if (status.err) {
                    txStatus = 'failed';
                    return {
                        success: false,
                        action: action,
                        error: `Transaction confirmed but FAILED on-chain`,
                        signature: txSignature,
                        explorer: `https://orb.helius.dev/tx/${txSignature}`,
                    };
                }
                if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
                    confirmed = true;
                    txStatus = status.confirmationStatus;
                    break;
                }
            }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 2000));
    }

    if (!confirmed) {
        return {
            success: false,
            action: action,
            error: `Transaction sent but NOT confirmed after ${CONFIRM_TIMEOUT_MS / 1000}s. It may still land — check explorer.`,
            signature: txSignature,
            explorer: `https://orb.helius.dev/tx/${txSignature}`,
        };
    }

    return {
        success: true,
        action: action,
        token: { mint, name: tokenInfo.name, symbol: tokenInfo.symbol },
        amount: isBuy ? `${amount} SOL` : `${amount}${isPercentSell ? '' : ' tokens'}`,
        signature: txSignature,
        confirmed: txStatus,
        explorer: `https://orb.helius.dev/tx/${txSignature}`,
        pumpfun: `https://pump.fun/coin/${mint}`
    };
}

// ── Trade Recording & Limits ────────────────────────────────────────
const TRADES_FILE = path.join(
    process.env.HOME || '/home/openclaw',
    '.openclaw/workspace/TRADES.json'
);

const MAX_BUYS_PER_TOKEN = 2;
const MIN_BALANCE_FOR_TRADING = 0.01; // Must have at least this much SOL to buy
const MAX_BUY_AMOUNT = 0.004; // Hard cap on buy amount

function loadTrades() {
    try {
        if (fs.existsSync(TRADES_FILE)) {
            const data = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
            // Ensure dailyPL exists
            if (!data.dailyPL) data.dailyPL = {};
            return data;
        }
    } catch (e) {}
    return { trades: [], buyCountByMint: {}, totalProfitSOL: 0, positions: {}, dailyPL: {} };
}

function saveTrades(data) {
    try {
        const dir = path.dirname(TRADES_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(TRADES_FILE, JSON.stringify(data, null, 2));
    } catch (e) {}
}

function canBuyToken(mint) {
    const data = loadTrades();
    const buyCount = data.buyCountByMint[mint] || 0;
    return buyCount < MAX_BUYS_PER_TOKEN;
}

function getBuyCount(mint) {
    const data = loadTrades();
    return data.buyCountByMint[mint] || 0;
}

function recordTrade(action, mint, solAmount) {
    const data = loadTrades();
    let sol = parseFloat(solAmount) || 0;
    
    // Sanity check: reject obviously bogus SOL amounts
    // Values like 100 (from "100%" parsed) are clearly wrong for micro-trading
    if (action === 'buy' && sol > 0.1) {
        console.error(`[trade] WARNING: buy amount ${sol} SOL exceeds safety cap, clamping to 0.1`);
        sol = 0.1;
    } else if (action === 'sell' && sol > 0.5) {
        console.error(`[trade] WARNING: sell amount ${sol} SOL seems bogus, setting to 0`);
        sol = 0;
    }
    
    data.trades.push({
        timestamp: new Date().toISOString(),
        action,
        mint,
        solAmount: sol
    });
    
    // Rotate to archive instead of discarding (consistent with pumpfun-track.js)
    if (data.trades.length > 500) data.trades = data.trades.slice(-500);
    
    if (action === 'buy') {
        data.buyCountByMint[mint] = (data.buyCountByMint[mint] || 0) + 1;
        if (!data.positions) data.positions = {};
        const ts = new Date().toISOString();
        if (!data.positions[mint]) {
            data.positions[mint] = { totalCostSOL: 0, totalTokens: 0, buyCount: 0, firstBoughtAt: ts, boughtAt: ts };
        }
        data.positions[mint].totalCostSOL += sol;
        data.positions[mint].buyCount += 1;
        data.positions[mint].boughtAt = ts;
        if (!data.positions[mint].firstBoughtAt) {
            data.positions[mint].firstBoughtAt = ts;
        }
    } else if (action === 'sell') {
        // Compute profit from position data BEFORE deleting the position
        if (data.positions && data.positions[mint]) {
            const pos = data.positions[mint];
            const costBasisSOL = pos.totalCostSOL || 0;
            if (costBasisSOL > 0 && sol > 0) {
                const profitSOL = sol - costBasisSOL;
                data.totalProfitSOL = (data.totalProfitSOL || 0) + profitSOL;
                
                // Update the trade record with profit data
                const lastTrade = data.trades[data.trades.length - 1];
                if (lastTrade) {
                    lastTrade.profitSOL = profitSOL;
                    lastTrade.costBasisSOL = costBasisSOL;
                }
                
                // Update daily P/L
                if (!data.dailyPL) data.dailyPL = {};
                const today = new Date().toISOString().slice(0, 10);
                if (!data.dailyPL[today]) {
                    data.dailyPL[today] = { profit: 0, trades: 0, wins: 0, losses: 0 };
                }
                data.dailyPL[today].profit += profitSOL;
                data.dailyPL[today].trades += 1;
                if (profitSOL >= 0) {
                    data.dailyPL[today].wins += 1;
                } else {
                    data.dailyPL[today].losses += 1;
                }
            }
            // Clear position after computing profit
            delete data.positions[mint];
        }
        // Reset buy count to allow re-entry later
        if (data.buyCountByMint && data.buyCountByMint[mint]) {
            delete data.buyCountByMint[mint];
        }
    }
    
    saveTrades(data);
    return data.buyCountByMint[mint] || 0;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.error('Usage: node pumpfun-trade.js <buy|sell> <mint> <amount> [slippage_pct]');
        console.error('  buy:  amount is SOL to spend');
        console.error('  sell: amount is tokens to sell, or "100%" for all');
        process.exit(1);
    }

    const [action, mint, amount, slippagePct = '10'] = args;

    if (!['buy', 'sell'].includes(action.toLowerCase())) {
        console.error('Action must be "buy" or "sell"');
        process.exit(1);
    }

    try {
        const config = loadConfig();
        if (!config.privateKey) {
            console.log(JSON.stringify({ error: 'No private key configured' }));
            process.exit(1);
        }

        const isBuy = action.toLowerCase() === 'buy';
        
        if (isBuy) {
            // HARD BLOCK 1: Check buy count limit
            const currentBuyCount = getBuyCount(mint);
            if (currentBuyCount >= MAX_BUYS_PER_TOKEN) {
                console.log(JSON.stringify({
                    success: false,
                    blocked: true,
                    reason: 'MAX_BUYS_REACHED',
                    error: `BLOCKED: Already bought this token ${currentBuyCount} times (max ${MAX_BUYS_PER_TOKEN}). Sell first before buying more.`,
                    mint,
                    buyCount: currentBuyCount,
                    maxBuys: MAX_BUYS_PER_TOKEN
                }));
                process.exit(0);
            }
            
            // HARD BLOCK 2: Cap buy amount for safety
            const buyAmount = parseFloat(amount);
            if (buyAmount > MAX_BUY_AMOUNT) {
                console.log(JSON.stringify({
                    success: false,
                    blocked: true,
                    reason: 'AMOUNT_TOO_LARGE',
                    error: `BLOCKED: Buy amount ${buyAmount} SOL exceeds max allowed ${MAX_BUY_AMOUNT} SOL. Use smaller positions to survive.`,
                    requested: buyAmount,
                    maxAllowed: MAX_BUY_AMOUNT
                }));
                process.exit(0);
            }
            
            // HARD BLOCK 3: Check wallet balance before buying
            try {
                const balanceCheck = await checkWalletBalance(config);
                if (balanceCheck.sol < MIN_BALANCE_FOR_TRADING) {
                    console.log(JSON.stringify({
                        success: false,
                        blocked: true,
                        reason: 'LOW_BALANCE',
                        error: `BLOCKED: Balance too low (${balanceCheck.sol.toFixed(4)} SOL). Need at least ${MIN_BALANCE_FOR_TRADING} SOL to trade. Ask owner for funds.`,
                        currentBalance: balanceCheck.sol,
                        minRequired: MIN_BALANCE_FOR_TRADING
                    }));
                    process.exit(0);
                }
                
                // Also check if buy would leave us with less than min balance
                const balanceAfterBuy = balanceCheck.sol - buyAmount - 0.001; // account for fees
                if (balanceAfterBuy < 0.008) {
                    console.log(JSON.stringify({
                        success: false,
                        blocked: true,
                        reason: 'WOULD_DRAIN_BALANCE',
                        error: `BLOCKED: This buy would leave only ${balanceAfterBuy.toFixed(4)} SOL. Need to keep reserve for gas. Buy less or add funds.`,
                        currentBalance: balanceCheck.sol,
                        buyAmount: buyAmount,
                        balanceAfterBuy: balanceAfterBuy
                    }));
                    process.exit(0);
                }
            } catch (e) {
                // If balance check fails, proceed cautiously
                console.error(`[trade] Warning: Could not verify balance: ${e.message}`);
            }
        }

        // For sells, snapshot SOL balance before trade to calculate actual SOL received
        let preTradeBalance = null;
        if (!isBuy) {
            try {
                const balBefore = await checkWalletBalance(config);
                preTradeBalance = balBefore.sol;
            } catch (e) {
                console.error(`[trade] Warning: Could not snapshot pre-sell balance: ${e.message}`);
            }
        }

        const result = await executeTrade(action.toLowerCase(), mint, amount, parseInt(slippagePct), config);
        
        // For sells, determine actual SOL received by checking balance change
        let solAmount;
        if (isBuy) {
            solAmount = parseFloat(amount);
        } else {
            solAmount = 0;
            if (preTradeBalance !== null) {
                // Retry balance check a few times with increasing delays
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        // Wait for balance to update on-chain (longer wait each retry)
                        await new Promise(r => setTimeout(r, 2000 + attempt * 1500));
                        const balAfter = await checkWalletBalance(config);
                        const received = balAfter.sol - preTradeBalance;
                        if (received > 0) {
                            solAmount = Math.round(received * 1e6) / 1e6; // 6 decimal places
                            result.solReceived = solAmount;
                            break; // Success, stop retrying
                        } else if (attempt < 2) {
                            console.error(`[trade] Balance unchanged after sell (attempt ${attempt + 1}), retrying...`);
                        }
                    } catch (e) {
                        console.error(`[trade] Warning: Balance check attempt ${attempt + 1} failed: ${e.message}`);
                    }
                }
                if (solAmount === 0) {
                    console.error(`[trade] Warning: Could not determine SOL received after 3 attempts`);
                }
            }
        }

        // Auto-record trade to TRADES.json
        const buyCount = recordTrade(action.toLowerCase(), mint, solAmount);
        result.recorded = true;
        result.buyCount = buyCount;
        if (isBuy) {
            result.buysRemaining = MAX_BUYS_PER_TOKEN - buyCount;
        }
        
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(`[trade] ERROR: ${error.message}`);
        console.log(JSON.stringify({ success: false, error: error.message }));
        process.exit(1);
    }
}

main();
