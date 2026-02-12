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
  let data;
  try {
    if (fs.existsSync(TRADES_FILE)) {
      data = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error(`[track] Error loading trades: ${e.message}`);
  }
  if (!data) {
    return { trades: [], buyCountByMint: {}, totalProfitSOL: 0, positions: {} };
  }

  // --- Data migration: backfill missing fields from older versions ---
  if (!data.positions) data.positions = {};
  if (!data.trades) data.trades = [];
  if (!data.buyCountByMint) data.buyCountByMint = {};
  if (typeof data.totalProfitSOL !== 'number') data.totalProfitSOL = 0;

  let needsSave = false;
  for (const [mint, pos] of Object.entries(data.positions)) {
    // Old positions may lack boughtAt — estimate from trade history or use now
    if (!pos.boughtAt) {
      const lastBuy = [...data.trades].reverse().find(
        t => t.mint === mint && t.action === 'buy' && t.timestamp
      );
      pos.boughtAt = lastBuy ? lastBuy.timestamp : new Date().toISOString();
      needsSave = true;
    }
    // Backfill firstBoughtAt from earliest buy trade for this mint
    if (!pos.firstBoughtAt) {
      const firstBuy = data.trades.find(
        t => t.mint === mint && t.action === 'buy' && t.timestamp
      );
      pos.firstBoughtAt = firstBuy ? firstBuy.timestamp : pos.boughtAt;
      needsSave = true;
    }
    // Ensure all expected numeric fields exist
    if (typeof pos.totalCostSOL !== 'number') { pos.totalCostSOL = 0; needsSave = true; }
    if (typeof pos.totalTokens !== 'number') { pos.totalTokens = 0; needsSave = true; }
    if (typeof pos.buyCount !== 'number') { pos.buyCount = 1; needsSave = true; }
  }

  if (needsSave) {
    try {
      fs.writeFileSync(TRADES_FILE, JSON.stringify(data, null, 2));
      console.error('[track] Migrated TRADES.json to new format');
    } catch (e) {
      console.error(`[track] Migration save failed: ${e.message}`);
    }
  }

  return data;
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
      data.positions[mint] = { totalCostSOL: 0, totalTokens: 0, buyCount: 0, firstBoughtAt: timestamp, boughtAt: timestamp };
    }
    data.positions[mint].totalCostSOL += sol;
    data.positions[mint].buyCount += 1;
    // boughtAt tracks latest buy; firstBoughtAt tracks entry time (never updated)
    data.positions[mint].boughtAt = timestamp;
    if (!data.positions[mint].firstBoughtAt) {
      data.positions[mint].firstBoughtAt = timestamp;
    }
    if (tokenAmount) {
      data.positions[mint].totalTokens += parseFloat(tokenAmount);
    }
  } else if (action === 'sell') {
    // Calculate profit if we have position data
    if (data.positions && data.positions[mint]) {
      const pos = data.positions[mint];
      // Simple P/L: sell proceeds - total cost
      if (pos.totalCostSOL > 0) {
        const profit = sol - pos.totalCostSOL;
        data.totalProfitSOL = (data.totalProfitSOL || 0) + profit;
        trade.profitSOL = profit;
      }
      // Clear position
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
  const recentTrades = (data.trades || []).slice(-10);
  const now = Date.now();
  
  // Get list of currently held positions (tokens with totalTokens > 0)
  const heldPositions = {};
  for (const [mint, pos] of Object.entries(data.positions || {})) {
    // Defensive: skip entries that are not objects
    if (!pos || typeof pos !== 'object') continue;
    const totalTokens = typeof pos.totalTokens === 'number' ? pos.totalTokens : 0;
    if (totalTokens > 0) {
      // Calculate age in minutes since first buy — safe fallback to boughtAt or 0
      let ageMinutes = 0;
      const entryTime = pos.firstBoughtAt || pos.boughtAt;
      if (entryTime) {
        const boughtTime = new Date(entryTime).getTime();
        if (!isNaN(boughtTime)) {
          ageMinutes = Math.max(0, Math.round((now - boughtTime) / 60000));
        }
      }
      const totalCostSOL = typeof pos.totalCostSOL === 'number' ? pos.totalCostSOL : 0;
      const buyCount = typeof pos.buyCount === 'number' && pos.buyCount > 0 ? pos.buyCount : 1;
      heldPositions[mint] = {
        totalCostSOL,
        totalTokens,
        buyCount,
        boughtAt: pos.boughtAt || null,
        ageMinutes,
        avgCostSOL: +(totalCostSOL / buyCount).toFixed(6)
      };
    }
  }
  
  return {
    totalTrades: (data.trades || []).length,
    recentTrades,
    buyCountByMint: data.buyCountByMint || {},
    totalProfitSOL: data.totalProfitSOL || 0,
    activePositions: Object.keys(heldPositions).length,
    positions: heldPositions,
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
