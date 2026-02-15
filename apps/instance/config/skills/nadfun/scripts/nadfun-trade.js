#!/usr/bin/env node
'use strict';

// Core trading script for nad.fun on Monad
// Usage:
//   nadfun-trade.js buy <token_address> <mon_amount> [slippage_bps]
//   nadfun-trade.js sell <token_address> <amount|100%> [slippage_bps]
//
// Slippage is in basis points (100 = 1%). Default: 200 (2%)
//
// Trading flow:
//   BUY:  Lens.getAmountOut() -> Router.buy() with MON value
//   SELL: Lens.getAmountOut() -> approve Router -> Router.sell()

const path = require('path');
const fs = require('fs');
const {
  viem, MONAD_CONFIG, monadChain,
  getPublicClient, getWalletClient, getAccount,
  lensAbi, routerAbi, erc20Abi, curveAbi,
} = require(path.join(__dirname, '..', '..', 'monad', 'scripts', 'monad-common.js'));

// --- Safety caps ---
const MAX_BUY_MON = 5.0;         // Max MON per buy (~$0.10)
const MAX_BUYS_PER_TOKEN = 2;    // Max buys per token
const MIN_BALANCE_MON = 0.5;     // Min balance to trade (~$0.01)
const RESERVE_MON = 1.0;         // Always keep this much for gas (~$0.02)
const DEFAULT_SLIPPAGE_BPS = 200; // 2% slippage
const DEADLINE_SECONDS = 300;     // 5 min deadline

// --- Trade recording is handled by nadfun-track.js ---
// nadfun-trade.js only executes trades; nadfun-track.js manages the ledger.
// This avoids dual writes to MONAD_TRADES.json.

function loadTrades() {
  const TRADES_FILE = path.join(process.env.HOME || '/home/openclaw', '.openclaw', 'workspace', 'MONAD_TRADES.json');
  try {
    if (fs.existsSync(TRADES_FILE)) {
      return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    }
  } catch {}
  return { trades: [], positions: {}, daily: {}, totalProfitMON: 0 };
}

async function executeBuy(tokenAddress, monAmount, slippageBps) {
  const publicClient = getPublicClient();
  const { client: walletClient, account } = getWalletClient();

  // Safety checks
  if (monAmount > MAX_BUY_MON) {
    return { error: `Buy amount ${monAmount} MON exceeds max ${MAX_BUY_MON} MON` };
  }

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  const balanceMon = Number(viem.formatEther(balance));

  if (balanceMon < MIN_BALANCE_MON) {
    return { error: `Balance too low: ${balanceMon.toFixed(4)} MON (min ${MIN_BALANCE_MON})` };
  }

  if (balanceMon - monAmount < RESERVE_MON) {
    return { error: `Would leave balance below reserve. Balance: ${balanceMon.toFixed(4)}, Buy: ${monAmount}, Reserve: ${RESERVE_MON}` };
  }

  // Check buy count
  const trades = loadTrades();
  const pos = trades.positions[tokenAddress];
  if (pos && pos.buyCount >= MAX_BUYS_PER_TOKEN) {
    return { error: `Max buys (${MAX_BUYS_PER_TOKEN}) reached for this token` };
  }

  // Get quote from Lens
  const amountIn = viem.parseEther(monAmount.toString());
  const [router, amountOut] = await publicClient.readContract({
    address: MONAD_CONFIG.LENS,
    abi: lensAbi,
    functionName: 'getAmountOut',
    args: [tokenAddress, amountIn, true],
  });

  if (amountOut === 0n) {
    return { error: 'Quote returned 0 tokens. Token may be graduated, locked, or invalid.' };
  }

  // Calculate slippage
  const amountOutMin = (amountOut * (10000n - BigInt(slippageBps))) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

  // Build buy calldata
  const callData = viem.encodeFunctionData({
    abi: routerAbi,
    functionName: 'buy',
    args: [{ amountOutMin, token: tokenAddress, to: account.address, deadline }],
  });

  // Estimate gas
  let gasEstimate;
  try {
    gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: router,
      data: callData,
      value: amountIn,
    });
  } catch (e) {
    return { error: `Gas estimation failed: ${e.message}` };
  }

  // Send transaction
  const hash = await walletClient.sendTransaction({
    account,
    to: router,
    data: callData,
    value: amountIn,
    gas: gasEstimate + gasEstimate / 10n, // +10% buffer
    chain: monadChain,
  });

  // Wait for receipt (60s timeout to avoid hanging forever)
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  } catch (e) {
    return { error: `Transaction sent but receipt timed out after 60s. Hash: ${hash}. It may still land.`, txHash: hash };
  }

  if (receipt.status !== 'success') {
    return { error: 'Transaction reverted', txHash: hash };
  }

  // Trade recording is handled by nadfun-track.js (called separately by LLM)

  return {
    success: true,
    type: 'buy',
    token: tokenAddress,
    monSpent: monAmount,
    tokensReceived: viem.formatEther(amountOut),
    txHash: hash,
    router: router,
    blockNumber: Number(receipt.blockNumber),
  };
}

async function executeSell(tokenAddress, amountOrPercent, slippageBps) {
  const publicClient = getPublicClient();
  const { client: walletClient, account } = getWalletClient();

  // Get token balance
  const tokenBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (tokenBalance === 0n) {
    return { error: 'No token balance to sell' };
  }

  // Calculate sell amount
  let sellAmount;
  if (amountOrPercent === '100%' || amountOrPercent === 'all') {
    sellAmount = tokenBalance;
  } else {
    const pct = parseFloat(amountOrPercent);
    if (amountOrPercent.endsWith('%') && !isNaN(pct)) {
      sellAmount = (tokenBalance * BigInt(Math.round(pct * 100))) / 10000n;
    } else {
      sellAmount = viem.parseEther(amountOrPercent);
      if (sellAmount > tokenBalance) sellAmount = tokenBalance;
    }
  }

  if (sellAmount === 0n) {
    return { error: 'Sell amount is 0' };
  }

  // Snapshot MON balance before sell to calculate received
  const monBefore = await publicClient.getBalance({ address: account.address });

  // Get quote from Lens
  const [router, amountOut] = await publicClient.readContract({
    address: MONAD_CONFIG.LENS,
    abi: lensAbi,
    functionName: 'getAmountOut',
    args: [tokenAddress, sellAmount, false],
  });

  if (amountOut === 0n) {
    return { error: 'Quote returned 0 MON. Token may be locked or invalid.' };
  }

  // Calculate slippage
  const amountOutMin = (amountOut * (10000n - BigInt(slippageBps))) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

  // Approve router to spend tokens
  const currentAllowance = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, router],
  });

  // Get current nonce for sequential approve+sell
  let nonce = await publicClient.getTransactionCount({ address: account.address });

  if (currentAllowance < sellAmount) {
    const approveHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [router, sellAmount],
      account,
      chain: monadChain,
      nonce,
    });

    // Wait for approve receipt and verify it succeeded
    let approveReceipt;
    try {
      approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 30_000 });
    } catch (e) {
      return { error: `Approve tx sent but receipt timed out. Hash: ${approveHash}. Cannot proceed with sell.`, txHash: approveHash };
    }

    if (approveReceipt.status !== 'success') {
      return { error: `Approve transaction reverted. Cannot sell without approval.`, txHash: approveHash };
    }

    // Increment nonce for the sell transaction
    nonce++;
  }

  // Build sell calldata
  const callData = viem.encodeFunctionData({
    abi: routerAbi,
    functionName: 'sell',
    args: [{ amountIn: sellAmount, amountOutMin, token: tokenAddress, to: account.address, deadline }],
  });

  // Estimate gas
  let gasEstimate;
  try {
    gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: router,
      data: callData,
    });
  } catch (e) {
    return { error: `Gas estimation failed: ${e.message}` };
  }

  // Send sell transaction with explicit nonce to avoid collision with approve
  const hash = await walletClient.sendTransaction({
    account,
    to: router,
    data: callData,
    gas: gasEstimate + gasEstimate / 10n,
    chain: monadChain,
    nonce,
  });

  // Wait for receipt (60s timeout to avoid hanging forever)
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  } catch (e) {
    return { error: `Sell transaction sent but receipt timed out after 60s. Hash: ${hash}. It may still land.`, txHash: hash };
  }

  if (receipt.status !== 'success') {
    return { error: 'Transaction reverted', txHash: hash };
  }

  // Calculate MON received by checking balance difference
  const monAfter = await publicClient.getBalance({ address: account.address });
  const monReceived = monAfter - monBefore;
  const monReceivedFloat = parseFloat(viem.formatEther(monReceived > 0n ? monReceived : amountOut));

  // Trade recording is handled by nadfun-track.js (called separately by LLM)

  return {
    success: true,
    type: 'sell',
    token: tokenAddress,
    tokensSold: viem.formatEther(sellAmount),
    monReceived: monReceivedFloat.toFixed(6),
    txHash: hash,
    router: router,
    blockNumber: Number(receipt.blockNumber),
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log(JSON.stringify({
      error: 'Usage: nadfun-trade.js <buy|sell> <token_address> <amount> [slippage_bps]',
      examples: [
        'nadfun-trade.js buy 0x1234... 0.1',
        'nadfun-trade.js buy 0x1234... 0.1 200',
        'nadfun-trade.js sell 0x1234... 100%',
        'nadfun-trade.js sell 0x1234... 50%',
      ],
    }));
    process.exit(1);
  }

  const action = args[0].toLowerCase();
  const tokenAddress = args[1];
  const amount = args[2];
  const slippageBps = parseInt(args[3]) || DEFAULT_SLIPPAGE_BPS;

  if (!tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
    console.log(JSON.stringify({ error: 'Invalid token address. Must be 0x + 40 hex chars.' }));
    process.exit(1);
  }

  try {
    let result;
    if (action === 'buy') {
      const monAmount = parseFloat(amount);
      if (isNaN(monAmount) || monAmount <= 0) {
        console.log(JSON.stringify({ error: 'Invalid buy amount' }));
        process.exit(1);
      }
      result = await executeBuy(tokenAddress, monAmount, slippageBps);
    } else if (action === 'sell') {
      result = await executeSell(tokenAddress, amount, slippageBps);
    } else {
      console.log(JSON.stringify({ error: `Unknown action: ${action}. Use "buy" or "sell"` }));
      process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
    if (result.error) process.exit(1);
  } catch (err) {
    console.log(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  }
}

main();
