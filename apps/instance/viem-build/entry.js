// Re-export the viem functions we need for monad/nadfun integration
// This gets bundled into a single file for use inside Docker containers

// Core client creation
const { createPublicClient, createWalletClient, http, parseEther, formatEther, encodeFunctionData, decodeEventLog, parseGwei } = require('viem');

// Account management
const { privateKeyToAccount, generatePrivateKey } = require('viem/accounts');

module.exports = {
  // Client creation
  createPublicClient,
  createWalletClient,
  http,

  // Value formatting
  parseEther,
  formatEther,
  parseGwei,

  // ABI encoding/decoding
  encodeFunctionData,
  decodeEventLog,

  // Account management
  privateKeyToAccount,
  generatePrivateKey,
};
