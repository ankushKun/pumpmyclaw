/**
 * Common utilities for Solana scripts
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

function getPublicKeyFromPrivate(privateKeyInput) {
    let keyBuffer;
    
    if (typeof privateKeyInput === 'string') {
        // Try to parse as JSON array first (Solana CLI format)
        try {
            const arr = JSON.parse(privateKeyInput);
            if (Array.isArray(arr)) {
                keyBuffer = Buffer.from(arr);
            }
        } catch {
            // Base58 encoded
            keyBuffer = base58Decode(privateKeyInput);
        }
    } else {
        keyBuffer = privateKeyInput;
    }
    
    // If 64 bytes, public key is last 32
    if (keyBuffer.length === 64) {
        return keyBuffer.slice(32);
    }
    
    // If 32 bytes, derive public key
    const seed = keyBuffer.slice(0, 32);
    const privateKey = crypto.createPrivateKey({
        key: Buffer.concat([
            Buffer.from('302e020100300506032b657004220420', 'hex'),
            seed
        ]),
        format: 'der',
        type: 'pkcs8'
    });
    
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
    return publicKeyDer.slice(-32);
}

function signMessage(message, privateKeyInput) {
    let keyBuffer;
    
    if (typeof privateKeyInput === 'string') {
        try {
            const arr = JSON.parse(privateKeyInput);
            if (Array.isArray(arr)) {
                keyBuffer = Buffer.from(arr);
            }
        } catch {
            keyBuffer = base58Decode(privateKeyInput);
        }
    } else {
        keyBuffer = privateKeyInput;
    }
    
    const seed = keyBuffer.length === 64 ? keyBuffer.slice(0, 32) : keyBuffer;
    
    const privateKey = crypto.createPrivateKey({
        key: Buffer.concat([
            Buffer.from('302e020100300506032b657004220420', 'hex'),
            seed
        ]),
        format: 'der',
        type: 'pkcs8'
    });
    
    const messageBuffer = typeof message === 'string' ? Buffer.from(message) : message;
    return crypto.sign(null, messageBuffer, privateKey);
}

function verifySignature(message, signature, publicKeyInput) {
    const publicKeyBuffer = typeof publicKeyInput === 'string' ? 
        base58Decode(publicKeyInput) : publicKeyInput;
    
    const signatureBuffer = typeof signature === 'string' ?
        base58Decode(signature) : signature;
    
    const publicKey = crypto.createPublicKey({
        key: Buffer.concat([
            Buffer.from('302a300506032b6570032100', 'hex'),
            publicKeyBuffer
        ]),
        format: 'der',
        type: 'spki'
    });
    
    const messageBuffer = typeof message === 'string' ? Buffer.from(message) : message;
    return crypto.verify(null, messageBuffer, publicKey, signatureBuffer);
}

function loadConfig() {
    const scriptDir = __dirname;
    const skillDir = path.dirname(scriptDir);
    const configPath = path.join(skillDir, 'config.json');
    
    let config = {
        rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
        commitment: 'confirmed'
    };
    
    // Try to load config file
    if (fs.existsSync(configPath)) {
        try {
            const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config = { ...config, ...fileConfig };
        } catch (e) {
            // Ignore parse errors
        }
    }
    
    // Environment overrides
    if (process.env.SOLANA_PRIVATE_KEY) {
        config.privateKey = process.env.SOLANA_PRIVATE_KEY;
    }
    if (process.env.SOLANA_KEYPAIR_PATH) {
        try {
            const keypairContent = fs.readFileSync(process.env.SOLANA_KEYPAIR_PATH, 'utf8');
            config.privateKey = keypairContent.trim();
        } catch (e) {
            // Ignore file read errors
        }
    }
    
    return config;
}

function rpcRequest(rpcUrl, method, params = []) {
    return new Promise((resolve, reject) => {
        const url = new URL(rpcUrl);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        const data = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params
        });
        
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        
        const req = httpModule.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (response.error) {
                        reject(new Error(response.error.message || JSON.stringify(response.error)));
                    } else {
                        resolve(response.result);
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${body}`));
                }
            });
        });
        
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

module.exports = {
    base58Encode,
    base58Decode,
    getPublicKeyFromPrivate,
    signMessage,
    verifySignature,
    loadConfig,
    rpcRequest
};
