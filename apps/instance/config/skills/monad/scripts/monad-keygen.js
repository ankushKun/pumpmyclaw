#!/usr/bin/env node
'use strict';

// Generate a new EVM wallet for Monad
// Usage: monad-keygen.js
// Output: JSON { address, privateKey }

const path = require('path');
const viem = require(path.join(__dirname, 'viem-bundle.js'));

const privateKey = viem.generatePrivateKey();
const account = viem.privateKeyToAccount(privateKey);

console.log(JSON.stringify({
  address: account.address,
  privateKey: privateKey,
}, null, 2));
