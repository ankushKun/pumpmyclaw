#!/usr/bin/env node
'use strict';

// Auto-generate a nad.fun API key using the bot's EVM wallet
// Usage: nadfun-auth.js
// 
// Flow:
// 1. POST /auth/nonce with wallet address -> get nonce
// 2. Sign nonce with wallet private key
// 3. POST /auth/session with signature -> get session cookie
// 4. POST /api-key with session -> get API key
// 5. Store API key in .nadfun-config.json
//
// The API key gives 100 req/min vs 10 req/min without.

const path = require('path');
const fs = require('fs');
const https = require('https');
const { getAccount, MONAD_CONFIG, monadChain, viem } = require(path.join(__dirname, '..', '..', 'monad', 'scripts', 'monad-common.js'));

const CONFIG_FILE = path.join(process.env.HOME || '/home/openclaw', '.openclaw', '.nadfun-config.json');

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 15000,
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: JSON.parse(data),
          });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function main() {
  // Check if we already have a valid API key
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (config.apiKey) {
        console.log(JSON.stringify({
          success: true,
          message: 'API key already exists',
          apiKey: config.apiKey,
          keyPrefix: config.keyPrefix || 'unknown',
        }));
        return;
      }
    } catch {}
  }

  const account = getAccount();
  const apiUrl = MONAD_CONFIG.apiUrl;

  try {
    // Step 1: Request nonce
    const nonceRes = await httpsRequest(`${apiUrl}/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: account.address }),
    });

    if (nonceRes.status !== 200 || !nonceRes.data.nonce) {
      console.log(JSON.stringify({
        error: 'Failed to get nonce',
        status: nonceRes.status,
        response: nonceRes.data,
      }));
      process.exit(1);
    }

    const nonce = nonceRes.data.nonce;

    // Step 2: Sign nonce
    const signature = await account.signMessage({ message: nonce });

    // Step 3: Create session
    const sessionRes = await httpsRequest(`${apiUrl}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature,
        nonce,
        chain_id: MONAD_CONFIG.chainId,
      }),
    });

    if (sessionRes.status !== 200) {
      console.log(JSON.stringify({
        error: 'Failed to create session',
        status: sessionRes.status,
        response: sessionRes.data,
      }));
      process.exit(1);
    }

    // Extract session cookie
    const setCookieHeader = sessionRes.headers['set-cookie'];
    if (!setCookieHeader) {
      console.log(JSON.stringify({ error: 'No session cookie received' }));
      process.exit(1);
    }

    // Parse cookies — could be string or array
    let cookies;
    if (Array.isArray(setCookieHeader)) {
      cookies = setCookieHeader.map(c => c.split(';')[0]).join('; ');
    } else {
      cookies = setCookieHeader.split(';')[0];
    }

    // Step 4: Create API key
    const keyRes = await httpsRequest(`${apiUrl}/api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
      },
      body: JSON.stringify({
        name: 'PumpMyClaw Bot',
        description: 'Auto-generated API key for PMC trading bot',
        expires_in_days: 365,
      }),
    });

    if (keyRes.status !== 200 && keyRes.status !== 201) {
      console.log(JSON.stringify({
        error: 'Failed to create API key',
        status: keyRes.status,
        response: keyRes.data,
      }));
      process.exit(1);
    }

    const apiKey = keyRes.data.api_key;
    const keyPrefix = keyRes.data.key_prefix;

    if (!apiKey) {
      console.log(JSON.stringify({ error: 'No API key in response', response: keyRes.data }));
      process.exit(1);
    }

    // Step 5: Save to config file
    const config = {
      apiKey,
      keyPrefix,
      address: account.address,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    fs.chmodSync(CONFIG_FILE, 0o600);

    console.log(JSON.stringify({
      success: true,
      message: 'API key created and saved',
      apiKey,
      keyPrefix,
      configFile: CONFIG_FILE,
    }));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  }
}

main();
