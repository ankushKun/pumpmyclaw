#!/usr/bin/env node
/**
 * Pump.fun Authentication - Get JWT token for authenticated API access
 * 
 * Usage:
 *   pumpfun-auth.js login              - Login and get JWT token
 *   pumpfun-auth.js token              - Get stored token (if valid)
 *   pumpfun-auth.js test               - Test if current token works
 *   pumpfun-auth.js logout             - Clear stored token
 * 
 * The JWT token enables access to:
 *   - /candlesticks/{mint} - OHLCV chart data
 *   - /trades/all/{mint} - Trade history
 *   - /coins/top-holders-and-sol-balance/{mint} - Holder data
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Import solana common utilities for wallet operations
const SOLANA_COMMON_PATH = path.join(__dirname, '..', '..', 'solana', 'scripts', 'solana-common.js');
let solanaCommon;
try {
  solanaCommon = require(SOLANA_COMMON_PATH);
} catch (e) {
  console.error(`[auth] Warning: Could not load solana-common.js: ${e.message}`);
  solanaCommon = null;
}

const AUTH_FILE = path.join(
  process.env.HOME || '/home/openclaw',
  '.openclaw/workspace/PUMPFUN_AUTH.json'
);

const API_URL = 'https://frontend-api-v3.pump.fun';

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function saveAuth(data) {
  try {
    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[auth] Error saving auth: ${e.message}`);
  }
}

function clearAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
  } catch (e) {}
}

function httpRequest(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL + urlPath);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Accept': 'application/json',
        'Origin': 'https://pump.fun',
        'Referer': 'https://pump.fun/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...headers
      }
    };
    
    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const cookies = res.headers['set-cookie'] || [];
        let parsedData = null;
        try {
          if (data) parsedData = JSON.parse(data);
        } catch (e) {
          // Keep raw data if not JSON
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          cookies: cookies,
          data: parsedData,
          raw: data
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function getWalletCredentials() {
  // Method 1: Use solana-common.js loadConfig
  if (solanaCommon && solanaCommon.loadConfig) {
    try {
      const config = solanaCommon.loadConfig();
      if (config.privateKey) {
        const publicKey = solanaCommon.getPublicKeyFromPrivate(config.privateKey);
        return {
          privateKey: config.privateKey,
          publicKey: solanaCommon.base58Encode(publicKey)
        };
      }
    } catch (e) {
      console.error(`[auth] loadConfig failed: ${e.message}`);
    }
  }
  
  // Method 2: Environment variables
  if (process.env.SOLANA_PRIVATE_KEY && process.env.SOLANA_PUBLIC_KEY) {
    return {
      privateKey: process.env.SOLANA_PRIVATE_KEY,
      publicKey: process.env.SOLANA_PUBLIC_KEY
    };
  }
  
  // Method 3: Pumpfun skill config.json
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.privateKey && config.publicKey) {
        return {
          privateKey: config.privateKey,
          publicKey: config.publicKey
        };
      }
    }
  } catch (e) {}
  
  // Method 4: Openclaw wallet file
  try {
    const walletPath = path.join(process.env.HOME || '/home/openclaw', '.openclaw/.wallet.json');
    if (fs.existsSync(walletPath)) {
      const wallet = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
      if (wallet.privateKey && wallet.publicKey) {
        return wallet;
      }
    }
  } catch (e) {}
  
  return null;
}

function signMessageWithWallet(message, privateKey) {
  if (!solanaCommon) {
    throw new Error('solana-common.js not available for signing');
  }
  
  const signature = solanaCommon.signMessage(message, privateKey);
  return solanaCommon.base58Encode(signature);
}

async function login() {
  console.error('[auth] Starting pump.fun authentication...');
  
  // Get wallet credentials
  const wallet = getWalletCredentials();
  if (!wallet) {
    return { 
      success: false, 
      error: 'Could not get wallet credentials. Make sure SOLANA_PRIVATE_KEY and SOLANA_PUBLIC_KEY are set.' 
    };
  }
  console.error(`[auth] Using wallet: ${wallet.publicKey}`);
  
  if (!solanaCommon) {
    return { 
      success: false, 
      error: 'Cannot sign messages - solana-common.js not loaded' 
    };
  }
  
  // Try different authentication message formats
  const timestamp = Date.now();
  const messageFormats = [
    // Format 1: Simple sign-in (most common)
    `Sign in to pump.fun`,
    // Format 2: With nonce/timestamp
    `Sign in to pump.fun\nTimestamp: ${timestamp}`,
    // Format 3: With address
    `Sign this message to verify you own this wallet.\n\nWallet: ${wallet.publicKey}`,
  ];
  
  for (let msgIdx = 0; msgIdx < messageFormats.length; msgIdx++) {
    const message = messageFormats[msgIdx];
    console.error(`[auth] Trying message format ${msgIdx + 1}: "${message.split('\n')[0]}..."`);
    
    let signature;
    try {
      signature = signMessageWithWallet(message, wallet.privateKey);
    } catch (e) {
      console.error(`[auth] Signing failed: ${e.message}`);
      continue;
    }
    
    // Try different request body formats
    const bodyFormats = [
      { address: wallet.publicKey, signature, message },
      { publicKey: wallet.publicKey, signature, message },
      { wallet: wallet.publicKey, signature, message, timestamp },
      { address: wallet.publicKey, signature, signedMessage: Buffer.from(message).toString('base64') },
    ];
    
    for (let bodyIdx = 0; bodyIdx < bodyFormats.length; bodyIdx++) {
      const body = bodyFormats[bodyIdx];
      
      try {
        const response = await httpRequest('POST', '/auth/login', {}, body);
        
        if (response.status === 200 || response.status === 201) {
          // Look for token in various places
          const token = response.data?.token || 
                       response.data?.jwt || 
                       response.data?.accessToken ||
                       response.data?.access_token;
          
          if (token) {
            const authData = {
              token: token,
              address: wallet.publicKey,
              loginTime: new Date().toISOString()
            };
            saveAuth(authData);
            
            return {
              success: true,
              token: token.substring(0, 20) + '...', // Don't expose full token
              address: wallet.publicKey,
              message: 'Authentication successful!'
            };
          }
          
          // Check cookies for token
          const authCookie = response.cookies.find(c => 
            c.toLowerCase().includes('token') || 
            c.toLowerCase().includes('jwt') || 
            c.toLowerCase().includes('auth')
          );
          if (authCookie) {
            const tokenMatch = authCookie.match(/=([^;]+)/);
            if (tokenMatch) {
              const authData = {
                token: tokenMatch[1],
                address: wallet.publicKey,
                loginTime: new Date().toISOString(),
                isCookie: true
              };
              saveAuth(authData);
              return {
                success: true,
                token: tokenMatch[1].substring(0, 20) + '...',
                address: wallet.publicKey,
                message: 'Authentication successful (cookie)'
              };
            }
          }
          
          // Log what we got for debugging
          console.error(`[auth] Status 200/201 but no token found. Response: ${JSON.stringify(response.data)}`);
        }
        
        if (response.status >= 400) {
          console.error(`[auth] Format ${msgIdx + 1}.${bodyIdx + 1} failed: ${response.status} - ${response.raw}`);
        }
        
      } catch (e) {
        console.error(`[auth] Request error: ${e.message}`);
      }
    }
  }
  
  return {
    success: false,
    error: 'Authentication failed. The pump.fun API may require a specific login flow.',
    hint: 'Try capturing the login request from pump.fun website using browser dev tools to see the exact format.',
    wallet: wallet.publicKey
  };
}

async function getToken() {
  const auth = loadAuth();
  if (!auth || !auth.token) {
    return { success: false, error: 'No stored token. Run: pumpfun-auth.js login' };
  }
  
  return {
    success: true,
    token: auth.token,
    address: auth.address,
    loginTime: auth.loginTime
  };
}

async function testToken() {
  const auth = loadAuth();
  if (!auth || !auth.token) {
    return { success: false, error: 'No stored token. Run: pumpfun-auth.js login' };
  }
  
  console.error('[auth] Testing token...');
  
  try {
    // Test with my-profile endpoint
    const response = await httpRequest('GET', '/auth/my-profile', {
      'Authorization': `Bearer ${auth.token}`
    });
    
    if (response.status === 200) {
      return {
        success: true,
        message: 'Token is valid',
        profile: response.data
      };
    } else if (response.status === 401) {
      return {
        success: false,
        error: 'Token is invalid or expired',
        hint: 'Run: pumpfun-auth.js login'
      };
    } else {
      return {
        success: false,
        error: `Unexpected response: ${response.status}`,
        raw: response.raw
      };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function logout() {
  clearAuth();
  return { success: true, message: 'Logged out, token cleared' };
}

// Export for use by other scripts
async function getValidToken() {
  const auth = loadAuth();
  if (!auth || !auth.token) {
    return null;
  }
  return auth.token;
}

module.exports = { getValidToken, loadAuth };

// Main
if (require.main === module) {
  const [,, command] = process.argv;

  (async () => {
    let result;
    
    switch (command) {
      case 'login':
        result = await login();
        break;
      case 'token':
        result = await getToken();
        break;
      case 'test':
        result = await testToken();
        break;
      case 'logout':
        result = await logout();
        break;
      default:
        console.log(`
Pump.fun Authentication

Usage:
  pumpfun-auth.js login    - Login and get JWT token
  pumpfun-auth.js token    - Get stored token
  pumpfun-auth.js test     - Test if current token works  
  pumpfun-auth.js logout   - Clear stored token

After successful login, these authenticated endpoints become available:
  - /candlesticks/{mint} - OHLCV chart data
  - /trades/all/{mint} - Full trade history
  - /coins/top-holders-and-sol-balance/{mint} - Holder distribution
`);
        process.exit(0);
    }
    
    console.log(JSON.stringify(result, null, 2));
  })();
}
