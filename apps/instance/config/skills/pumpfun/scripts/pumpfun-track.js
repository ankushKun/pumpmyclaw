#!/usr/bin/env node
/**
 * Trade tracking script - manages TRADES.json for buy limits and P/L tracking
 * 
 * Usage:
 *   pumpfun-track.js record <buy|sell> <mint> <sol_amount> [token_amount]
 *   pumpfun-track.js check <mint>         - returns buy count for mint
 *   pumpfun-track.js status               - returns full trade status
 *   pumpfun-track.js reset                - clears all trade history
 */

const fs = require('fs');
const path = require('path');

const TRADES_FILE = path.join(
  process.env.HOME || '/home/openclaw',
  '.openclaw/workspace/TRADES.json'
);

function loadTrades() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error(`[track] Error loading trades: ${e.message}`);
  }
  return { trades: [], buyCountByMint: {}, totalProfitSOL: 0, positions: {} };
}

function saveTrades(data) {
  try {
    const dir = path.dirname(TRADES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TRADES_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[track] Error saving trades: ${e.message}`);
  }
}

function recordTrade(action, mint, solAmount, tokenAmount = null) {
  const data = loadTrades();
  const timestamp = new Date().toISOString();
  const sol = parseFloat(solAmount) || 0;
  
  const trade = {
    timestamp,
    action,
    mint,
    solAmount: sol,
    tokenAmount: tokenAmount ? parseFloat(tokenAmount) : null
  };
  
  data.trades.push(trade);
  
  // Keep last 100 trades only
  if (data.trades.length > 100) {
    data.trades = data.trades.slice(-100);
  }
  
  if (action === 'buy') {
    // Increment buy count
    data.buyCountByMint[mint] = (data.buyCountByMint[mint] || 0) + 1;
    
    // Track position for P/L
    if (!data.positions) data.positions = {};
    if (!data.positions[mint]) {
      data.positions[mint] = { totalCostSOL: 0, totalTokens: 0, buyCount: 0 };
    }
    data.positions[mint].totalCostSOL += sol;
    data.positions[mint].buyCount += 1;
    if (tokenAmount) {
      data.positions[mint].totalTokens += parseFloat(tokenAmount);
    }
  } else if (action === 'sell') {
    // Calculate profit if we have position data
    if (data.positions && data.positions[mint]) {
      const pos = data.positions[mint];
      // Simple P/L: sell proceeds - average cost
      if (pos.totalCostSOL > 0) {
        const avgCost = pos.totalCostSOL / pos.buyCount;
        const profit = sol - avgCost;
        data.totalProfitSOL = (data.totalProfitSOL || 0) + profit;
        trade.profitSOL = profit;
      }
      // Clear or reduce position
      delete data.positions[mint];
    }
  }
  
  saveTrades(data);
  
  return {
    success: true,
    action,
    mint,
    buyCount: data.buyCountByMint[mint] || 0,
    totalProfitSOL: data.totalProfitSOL || 0
  };
}

function checkMint(mint) {
  const data = loadTrades();
  const buyCount = data.buyCountByMint[mint] || 0;
  const position = data.positions?.[mint] || null;
  const alreadyOwned = position && position.totalTokens > 0;
  
  return {
    mint,
    buyCount,
    maxBuys: 2,
    canBuy: buyCount < 2,
    alreadyOwned,  // true if I currently hold this token
    currentPosition: position,
    message: alreadyOwned 
      ? `Already own this token (${buyCount} buys, cost: ${position.totalCostSOL.toFixed(4)} SOL)`
      : buyCount >= 2 
        ? `Max buys reached for this token (${buyCount}/2)`
        : `Can buy (${buyCount}/2 buys used)`
  };
}

function getStatus() {
  const data = loadTrades();
  const recentTrades = data.trades.slice(-10);
  
  // Get list of currently held positions (tokens with totalTokens > 0)
  const heldPositions = {};
  for (const [mint, pos] of Object.entries(data.positions || {})) {
    if (pos.totalTokens > 0) {
      heldPositions[mint] = pos;
    }
  }
  
  return {
    totalTrades: data.trades.length,
    recentTrades,
    buyCountByMint: data.buyCountByMint,
    totalProfitSOL: data.totalProfitSOL || 0,
    activePositions: Object.keys(heldPositions).length,
    positions: heldPositions,  // Only show positions I still hold
    message: Object.keys(heldPositions).length > 0
      ? `Currently holding ${Object.keys(heldPositions).length} token(s)`
      : 'No open positions'
  };
}

function reset() {
  const data = { trades: [], buyCountByMint: {}, totalProfitSOL: 0, positions: {} };
  saveTrades(data);
  return { success: true, message: 'Trade history cleared' };
}

// Main
const [,, command, ...args] = process.argv;

let result;
switch (command) {
  case 'record':
    if (args.length < 3) {
      console.error('Usage: pumpfun-track.js record <buy|sell> <mint> <sol_amount> [token_amount]');
      process.exit(1);
    }
    result = recordTrade(args[0], args[1], args[2], args[3]);
    break;
  case 'check':
    if (!args[0]) {
      console.error('Usage: pumpfun-track.js check <mint>');
      process.exit(1);
    }
    result = checkMint(args[0]);
    break;
  case 'status':
    result = getStatus();
    break;
  case 'reset':
    result = reset();
    break;
  default:
    console.error('Usage: pumpfun-track.js <record|check|status|reset> [args]');
    process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
