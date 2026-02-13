#!/usr/bin/env node
'use strict';

// Transfer MON to an address
// Usage: monad-transfer.js <to_address> <amount_mon>

const path = require('path');
const { getWalletClient, getPublicClient, viem, monadChain } = require(path.join(__dirname, 'monad-common.js'));

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log(JSON.stringify({ error: 'Usage: monad-transfer.js <to_address> <amount_mon>' }));
    process.exit(1);
  }

  const toAddress = args[0];
  const amountMon = args[1];

  if (!toAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
    console.log(JSON.stringify({ error: 'Invalid address format. Must be 0x + 40 hex chars.' }));
    process.exit(1);
  }

  const amountFloat = parseFloat(amountMon);
  if (isNaN(amountFloat) || amountFloat <= 0) {
    console.log(JSON.stringify({ error: 'Invalid amount. Must be a positive number.' }));
    process.exit(1);
  }

  try {
    const { client: walletClient, account } = getWalletClient();
    const publicClient = getPublicClient();

    const value = viem.parseEther(amountMon);

    // Check balance first
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < value) {
      console.log(JSON.stringify({
        error: 'Insufficient balance',
        balance_mon: parseFloat(viem.formatEther(balance)),
        required_mon: amountFloat,
      }));
      process.exit(1);
    }

    // Send transaction
    const hash = await walletClient.sendTransaction({
      account,
      to: toAddress,
      value,
      chain: monadChain,
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(JSON.stringify({
      success: true,
      txHash: hash,
      from: account.address,
      to: toAddress,
      amount_mon: amountFloat,
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
      blockNumber: Number(receipt.blockNumber),
      gasUsed: Number(receipt.gasUsed),
    }));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  }
}

main();
