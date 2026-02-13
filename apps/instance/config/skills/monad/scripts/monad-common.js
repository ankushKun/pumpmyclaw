#!/usr/bin/env node
'use strict';

// Shared Monad chain constants and client factories
// Used by all monad/nadfun scripts

const path = require('path');

// Load the pre-bundled viem
const VIEM_BUNDLE_PATH = path.join(__dirname, 'viem-bundle.js');
let viem;
try {
  viem = require(VIEM_BUNDLE_PATH);
} catch (e) {
  console.error('[monad-common] Failed to load viem bundle from', VIEM_BUNDLE_PATH);
  console.error('[monad-common] Error:', e.message);
  process.exit(1);
}

// --- Monad Network Configuration ---
// Set MONAD_TESTNET=true to use testnet. Defaults to mainnet.
const IS_TESTNET = process.env.MONAD_TESTNET === 'true';

const MONAD_MAINNET = {
  chainId: 143,
  rpcUrl: 'https://monad-mainnet.drpc.org',
  apiUrl: 'https://api.nadapp.net',
  explorerUrl: 'https://monadexplorer.com',
  DEX_ROUTER: '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137',
  BONDING_CURVE_ROUTER: '0x6F6B8F1a20703309951a5127c45B49b1CD981A22',
  LENS: '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea',
  CURVE: '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE',
  WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
  V3_FACTORY: '0x6B5F564339DbAD6b780249827f2198a841FEB7F3',
  CREATOR_TREASURY: '0x42e75B4B96d7000E7Da1e0c729Cec8d2049B9731',
};

const MONAD_TESTNET = {
  chainId: 10143,
  rpcUrl: 'https://monad-testnet.drpc.org',
  apiUrl: 'https://dev-api.nad.fun',
  explorerUrl: 'https://testnet.monadscan.com',
  DEX_ROUTER: '0x5D4a4f430cA3B1b2dB86B9cFE48a5316800F5fb2',
  BONDING_CURVE_ROUTER: '0x865054F0F6A288adaAc30261731361EA7E908003',
  LENS: '0xB056d79CA5257589692699a46623F901a3BB76f1',
  CURVE: '0x1228b0dc9481C11D3071E7A924B794CfB038994e',
  WMON: '0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd',
  V3_FACTORY: '0xd0a37cf728CE2902eB8d4F6f2afc776854048253b',
  CREATOR_TREASURY: '0x24dFf9B68fA36f8400302e2babC3e049eA19459E',
};

const defaults = IS_TESTNET ? MONAD_TESTNET : MONAD_MAINNET;
const MONAD_CONFIG = {
  ...defaults,
  isTestnet: IS_TESTNET,
  // MONAD_RPC_URL env override takes precedence over the default for the selected network
  rpcUrl: process.env.MONAD_RPC_URL || defaults.rpcUrl,
};

// --- Chain definition for viem ---
const monadChain = {
  id: MONAD_CONFIG.chainId,
  name: IS_TESTNET ? 'Monad Testnet' : 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_CONFIG.rpcUrl] } },
};

// --- Client factories ---

function getPublicClient() {
  return viem.createPublicClient({
    chain: monadChain,
    transport: viem.http(MONAD_CONFIG.rpcUrl),
  });
}

function getWalletClient(privateKey) {
  const key = privateKey || process.env.MONAD_PRIVATE_KEY;
  if (!key) {
    console.error('[monad-common] No private key provided. Set MONAD_PRIVATE_KEY env var.');
    process.exit(1);
  }
  const account = viem.privateKeyToAccount(key);
  return {
    client: viem.createWalletClient({
      account,
      chain: monadChain,
      transport: viem.http(MONAD_CONFIG.rpcUrl),
    }),
    account,
  };
}

function getAccount(privateKey) {
  const key = privateKey || process.env.MONAD_PRIVATE_KEY;
  if (!key) {
    console.error('[monad-common] No private key provided. Set MONAD_PRIVATE_KEY env var.');
    process.exit(1);
  }
  return viem.privateKeyToAccount(key);
}

// --- ABI definitions ---

const lensAbi = [
  {
    type: 'function', name: 'getAmountOut',
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_amountIn', type: 'uint256' },
      { name: '_isBuy', type: 'bool' },
    ],
    outputs: [
      { name: 'router', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getAmountIn',
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_amountOut', type: 'uint256' },
      { name: '_isBuy', type: 'bool' },
    ],
    outputs: [
      { name: 'router', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getProgress',
    inputs: [{ name: '_token', type: 'address' }],
    outputs: [{ name: 'progress', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getInitialBuyAmountOut',
    inputs: [{ name: 'amountIn', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
];

const curveAbi = [
  {
    type: 'function', name: 'curves',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'realMonReserve', type: 'uint256' },
      { name: 'realTokenReserve', type: 'uint256' },
      { name: 'virtualMonReserve', type: 'uint256' },
      { name: 'virtualTokenReserve', type: 'uint256' },
      { name: 'k', type: 'uint256' },
      { name: 'targetTokenAmount', type: 'uint256' },
      { name: 'initVirtualMonReserve', type: 'uint256' },
      { name: 'initVirtualTokenReserve', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'feeConfig',
    inputs: [],
    outputs: [
      { name: 'deployFeeAmount', type: 'uint256' },
      { name: 'graduateFeeAmount', type: 'uint256' },
      { name: 'protocolFee', type: 'uint24' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'isGraduated',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'isLocked',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event', name: 'CurveCreate',
    inputs: [
      { name: 'creator', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'tokenURI', type: 'string', indexed: false },
      { name: 'virtualMon', type: 'uint256', indexed: false },
      { name: 'virtualToken', type: 'uint256', indexed: false },
      { name: 'targetTokenAmount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event', name: 'CurveBuy',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event', name: 'CurveSell',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
];

const routerAbi = [
  {
    type: 'function', name: 'buy',
    inputs: [{
      name: 'params', type: 'tuple',
      components: [
        { name: 'amountOutMin', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function', name: 'sell',
    inputs: [{
      name: 'params', type: 'tuple',
      components: [
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMin', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'sellPermit',
    inputs: [{
      name: 'params', type: 'tuple',
      components: [
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMin', type: 'uint256' },
        { name: 'amountAllowance', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'v', type: 'uint8' },
        { name: 'r', type: 'bytes32' },
        { name: 's', type: 'bytes32' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
];

const bondingCurveRouterAbi = [
  {
    type: 'function', name: 'create',
    inputs: [{
      name: 'params', type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
        { name: 'tokenURI', type: 'string' },
        { name: 'amountOut', type: 'uint256' },
        { name: 'salt', type: 'bytes32' },
        { name: 'actionId', type: 'uint8' },
      ],
    }],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'pool', type: 'address' },
    ],
    stateMutability: 'payable',
  },
];

const erc20Abi = [
  {
    type: 'function', name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'totalSupply',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'name',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'nonces',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
];

const creatorTreasuryAbi = [
  {
    type: 'function', name: 'claim',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'merkleProofs', type: 'bytes32[][]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];

// --- HTTP helper for nad.fun Agent API ---
const https = require('https');
const http_mod = require('http');

function nadFunApiRequest(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, MONAD_CONFIG.apiUrl);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http_mod;

    const headers = { ...(options.headers || {}) };

    // Add API key if available
    const apiKey = process.env.NAD_API_KEY;
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers,
      timeout: 15000,
    };

    const req = mod.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (options.body) {
      if (typeof options.body === 'string') {
        req.write(options.body);
      } else if (Buffer.isBuffer(options.body)) {
        req.write(options.body);
      } else {
        req.write(JSON.stringify(options.body));
      }
    }

    req.end();
  });
}

// --- Exports ---
module.exports = {
  viem,
  MONAD_CONFIG,
  monadChain,
  getPublicClient,
  getWalletClient,
  getAccount,
  lensAbi,
  curveAbi,
  routerAbi,
  bondingCurveRouterAbi,
  erc20Abi,
  creatorTreasuryAbi,
  nadFunApiRequest,
};
