#!/usr/bin/env node
/**
 * Trade tracking script - manages TRADES.json for buy limits, P/L tracking,
 * daily performance aggregation, and auto-tuning bridge.
 * 
 * Usage:
 *   pumpfun-track.js record <buy|sell> <mint> <sol_amount> [token_amount]
 *   pumpfun-track.js check <mint>         - returns buy count for mint
 *   pumpfun-track.js status               - returns full trade status
 *   pumpfun-track.js daily                - returns daily P/L summary + win rate
 *   pumpfun-track.js reset                - clears all trade history
 * 
 * Auto-tuning bridge:
 *   On BUY:  automatically records entry patterns via pumpfun-analyze.js
 *   On SELL: automatically records outcome via pumpfun-analyze.js
 *   No extra tool calls needed — the learning system is always fed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE_DIR = path.join(
  process.env.HOME || '/home/openclaw',
  '.openclaw/workspace'
);
const TRADES_FILE = path.join(WORKSPACE_DIR, 'TRADES.json');
const SCRIPTS_DIR = path.dirname(__filename);

// Maximum trades to keep in the active trades array.
// Older trades are rotated to an archive file to preserve history.
const MAX_ACTIVE_TRADES = 500;
const ARCHIVE_FILE = path.join(WORKSPACE_DIR, 'TRADES_ARCHIVE.json');

// ============================================================================
// LOAD / SAVE
// ============================================================================
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
    return { trades: [], buyCountByMint: {}, totalProfitSOL: 0, positions: {}, dailyPL: {} };
  }

  // --- Data migration: backfill missing fields from older versions ---
  if (!data.positions) data.positions = {};
  if (!data.trades) data.trades = [];
  if (!data.buyCountByMint) data.buyCountByMint = {};
  if (typeof data.totalProfitSOL !== 'number') data.totalProfitSOL = 0;
  if (!data.dailyPL) data.dailyPL = {};

  let needsSave = false;
  for (const [mint, pos] of Object.entries(data.positions)) {
    if (!pos.boughtAt) {
      const lastBuy = [...data.trades].reverse().find(
        t => t.mint === mint && t.action === 'buy' && t.timestamp
      );
      pos.boughtAt = lastBuy ? lastBuy.timestamp : new Date().toISOString();
      needsSave = true;
    }
    if (!pos.firstBoughtAt) {
      const firstBuy = data.trades.find(
        t => t.mint === mint && t.action === 'buy' && t.timestamp
      );
      pos.firstBoughtAt = firstBuy ? firstBuy.timestamp : pos.boughtAt;
      needsSave = true;
    }
    if (typeof pos.totalCostSOL !== 'number') { pos.totalCostSOL = 0; needsSave = true; }
    if (typeof pos.totalTokens !== 'number') { pos.totalTokens = 0; needsSave = true; }
    if (typeof pos.buyCount !== 'number') { pos.buyCount = 1; needsSave = true; }
  }

  // Backfill dailyPL from existing trades that have profitSOL
  if (Object.keys(data.dailyPL).length === 0 && data.trades.length > 0) {
    for (const trade of data.trades) {
      if (trade.action === 'sell' && typeof trade.profitSOL === 'number' && trade.timestamp) {
        const day = trade.timestamp.slice(0, 10); // YYYY-MM-DD
        if (!data.dailyPL[day]) {
          data.dailyPL[day] = { profit: 0, trades: 0, wins: 0, losses: 0 };
        }
        data.dailyPL[day].profit += trade.profitSOL;
        data.dailyPL[day].trades += 1;
        if (trade.profitSOL >= 0) data.dailyPL[day].wins += 1;
        else data.dailyPL[day].losses += 1;
      }
    }
    if (Object.keys(data.dailyPL).length > 0) needsSave = true;
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

    // Rotate old trades to archive instead of discarding them
    if (data.trades.length > MAX_ACTIVE_TRADES) {
      const overflow = data.trades.slice(0, data.trades.length - MAX_ACTIVE_TRADES);
      data.trades = data.trades.slice(-MAX_ACTIVE_TRADES);
      archiveTrades(overflow);
    }

    fs.writeFileSync(TRADES_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[track] Error saving trades: ${e.message}`);
  }
}

function archiveTrades(trades) {
  try {
    let archive = [];
    if (fs.existsSync(ARCHIVE_FILE)) {
      try {
        archive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
        if (!Array.isArray(archive)) archive = [];
      } catch (_) { archive = []; }
    }
    archive.push(...trades);
    // Keep archive to a reasonable size (last 5000 trades)
    if (archive.length > 5000) {
      archive = archive.slice(-5000);
    }
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
  } catch (e) {
    console.error(`[track] Archive error: ${e.message}`);
  }
}

// ============================================================================
// AUTO-TUNING BRIDGE
// Calls pumpfun-analyze.js to record entries/outcomes so the learning system
// is always fed without requiring extra tool calls from the LLM.
// ============================================================================
function bridgeToAutoTuning(action, mint, solAmount, profitSOL) {
  try {
    const analyzeScript = path.join(SCRIPTS_DIR, 'pumpfun-analyze.js');
    if (!fs.existsSync(analyzeScript)) return;

    if (action === 'buy') {
      // Record entry: captures current patterns/signals at time of buy
      // Uses a price proxy from SOL amount (the analyze script fetches live data)
      execSync(
        `node "${analyzeScript}" record "${mint}" BUY "${solAmount}"`,
        { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.error(`[track] Auto-tuning: recorded BUY entry for ${mint}`);
    } else if (action === 'sell') {
      // Find the most recent open trade in analyze's trades-history.json
      // and close it with the outcome
      const tradesHistoryFile = path.join(WORKSPACE_DIR, 'trades-history.json');
      if (!fs.existsSync(tradesHistoryFile)) return;

      const tradesHistory = JSON.parse(fs.readFileSync(tradesHistoryFile, 'utf8'));
      // Find latest open trade for this mint
      const openTrade = [...(tradesHistory.trades || [])].reverse().find(
        t => t.mint === mint && !t.outcome
      );

      if (openTrade) {
        const outcome = profitSOL >= 0 ? 'win' : 'loss';
        execSync(
          `node "${analyzeScript}" outcome "${openTrade.id}" "${outcome}" "${solAmount}"`,
          { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        console.error(`[track] Auto-tuning: recorded ${outcome} for trade #${openTrade.id} (${mint})`);
      }
    }
  } catch (e) {
    // Never let auto-tuning errors break trade recording
    console.error(`[track] Auto-tuning bridge error (non-fatal): ${e.message}`);
  }
}

// ============================================================================
// DAILY P/L TRACKING
// ============================================================================
function updateDailyPL(data, profitSOL, timestamp) {
  const day = timestamp.slice(0, 10); // YYYY-MM-DD
  if (!data.dailyPL) data.dailyPL = {};
  if (!data.dailyPL[day]) {
    data.dailyPL[day] = { profit: 0, trades: 0, wins: 0, losses: 0 };
  }
  data.dailyPL[day].profit = +(data.dailyPL[day].profit + profitSOL).toFixed(9);
  data.dailyPL[day].trades += 1;
  if (profitSOL >= 0) {
    data.dailyPL[day].wins += 1;
  } else {
    data.dailyPL[day].losses += 1;
  }
}

function getDailySummary() {
  const data = loadTrades();
  const dailyPL = data.dailyPL || {};
  const today = new Date().toISOString().slice(0, 10);

  // Compute today's stats
  const todayStats = dailyPL[today] || { profit: 0, trades: 0, wins: 0, losses: 0 };
  const todayWinRate = todayStats.trades > 0
    ? Math.round((todayStats.wins / todayStats.trades) * 100)
    : 0;

  // Last 7 days
  const days = Object.keys(dailyPL).sort().slice(-7);
  const weekStats = { profit: 0, trades: 0, wins: 0, losses: 0 };
  const dailyBreakdown = [];
  for (const day of days) {
    const d = dailyPL[day];
    weekStats.profit += d.profit;
    weekStats.trades += d.trades;
    weekStats.wins += d.wins;
    weekStats.losses += d.losses;
    dailyBreakdown.push({
      date: day,
      profit: +d.profit.toFixed(6),
      trades: d.trades,
      wins: d.wins,
      losses: d.losses,
      winRate: d.trades > 0 ? Math.round((d.wins / d.trades) * 100) : 0
    });
  }
  const weekWinRate = weekStats.trades > 0
    ? Math.round((weekStats.wins / weekStats.trades) * 100)
    : 0;

  // All-time stats from trade history
  const allTrades = data.trades.filter(t => t.action === 'sell' && typeof t.profitSOL === 'number');
  const allTimeWins = allTrades.filter(t => t.profitSOL >= 0).length;
  const allTimeLosses = allTrades.filter(t => t.profitSOL < 0).length;
  const allTimeWinRate = allTrades.length > 0
    ? Math.round((allTimeWins / allTrades.length) * 100)
    : 0;

  return {
    today: {
      date: today,
      profitSOL: +todayStats.profit.toFixed(6),
      trades: todayStats.trades,
      wins: todayStats.wins,
      losses: todayStats.losses,
      winRate: todayWinRate
    },
    week: {
      profitSOL: +weekStats.profit.toFixed(6),
      trades: weekStats.trades,
      wins: weekStats.wins,
      losses: weekStats.losses,
      winRate: weekWinRate,
      days: dailyBreakdown
    },
    allTime: {
      profitSOL: +(data.totalProfitSOL || 0).toFixed(6),
      closedTrades: allTrades.length,
      wins: allTimeWins,
      losses: allTimeLosses,
      winRate: allTimeWinRate
    },
    activePositions: Object.keys(data.positions || {}).length
  };
}

// ============================================================================
// RECORD TRADE
// ============================================================================
function recordTrade(action, mint, solAmount, tokenAmount = null) {
  const data = loadTrades();
  const timestamp = new Date().toISOString();
  const sol = parseFloat(solAmount) || 0;
  
  // Duplicate protection: reject if same mint+action was recorded in the last 60 seconds
  const now = Date.now();
  const recentDupe = data.trades.slice(-20).find(t => {
    if (t.mint !== mint || t.action !== action) return false;
    const tTime = new Date(t.timestamp).getTime();
    return (now - tTime) < 60000; // within 60 seconds
  });
  if (recentDupe) {
    console.error(`[track] Duplicate ${action} for ${mint} within 60s — skipping record, running auto-tuning bridge only`);
    // Even on duplicate, backfill tokenAmount if the existing position is missing it
    // (pumpfun-trade.js auto-records without tokenAmount, then this gets called with it)
    if (action === 'buy' && tokenAmount && data.positions && data.positions[mint]) {
      const pos = data.positions[mint];
      if (!pos.totalTokens || pos.totalTokens === 0) {
        pos.totalTokens = parseFloat(tokenAmount);
        saveTrades(data);
        console.error(`[track] Backfilled totalTokens=${pos.totalTokens} for ${mint}`);
      }
    }
    // Still bridge to auto-tuning even on duplicate (it's idempotent)
    bridgeToAutoTuning(action, mint, sol, 0);
    return {
      success: true,
      action,
      mint,
      duplicate: true,
      note: 'Trade already recorded within the last 60 seconds'
    };
  }
  
  const trade = {
    timestamp,
    action,
    mint,
    solAmount: sol,
    tokenAmount: tokenAmount ? parseFloat(tokenAmount) : null
  };
  
  data.trades.push(trade);
  
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
    data.positions[mint].boughtAt = timestamp;
    if (!data.positions[mint].firstBoughtAt) {
      data.positions[mint].firstBoughtAt = timestamp;
    }
    if (tokenAmount) {
      data.positions[mint].totalTokens += parseFloat(tokenAmount);
    }

    // Bridge to auto-tuning: record entry patterns
    bridgeToAutoTuning('buy', mint, sol, 0);

  } else if (action === 'sell') {
    // Calculate profit if we have position data
    let profitSOL = 0;
    if (data.positions && data.positions[mint]) {
      const pos = data.positions[mint];
      if (pos.totalCostSOL > 0) {
        profitSOL = sol - pos.totalCostSOL;
        data.totalProfitSOL = (data.totalProfitSOL || 0) + profitSOL;
        trade.profitSOL = profitSOL;
      }
      // Clear position
      delete data.positions[mint];
    }

    // Update daily P/L
    updateDailyPL(data, profitSOL, timestamp);

    // Bridge to auto-tuning: record outcome
    // Save first so auto-tuning bridge can read latest state if needed
    saveTrades(data);
    bridgeToAutoTuning('sell', mint, sol, profitSOL);

    // Return early since we already saved
    return {
      success: true,
      action,
      mint,
      profitSOL: +profitSOL.toFixed(6),
      buyCount: data.buyCountByMint[mint] || 0,
      totalProfitSOL: +(data.totalProfitSOL || 0).toFixed(6),
      todayPL: getTodayPL(data)
    };
  }
  
  saveTrades(data);
  
  return {
    success: true,
    action,
    mint,
    buyCount: data.buyCountByMint[mint] || 0,
    totalProfitSOL: +(data.totalProfitSOL || 0).toFixed(6)
  };
}

function getTodayPL(data) {
  const today = new Date().toISOString().slice(0, 10);
  const d = (data.dailyPL || {})[today];
  if (!d) return { profitSOL: 0, trades: 0, winRate: 0 };
  return {
    profitSOL: +d.profit.toFixed(6),
    trades: d.trades,
    winRate: d.trades > 0 ? Math.round((d.wins / d.trades) * 100) : 0
  };
}

// ============================================================================
// CHECK MINT
// ============================================================================
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
    alreadyOwned,
    currentPosition: position,
    message: alreadyOwned 
      ? `Already own this token (${buyCount} buys, cost: ${position.totalCostSOL.toFixed(4)} SOL)`
      : buyCount >= 2 
        ? `Max buys reached for this token (${buyCount}/2)`
        : `Can buy (${buyCount}/2 buys used)`
  };
}

// ============================================================================
// STATUS
// ============================================================================
function getStatus() {
  const data = loadTrades();
  const recentTrades = (data.trades || []).slice(-10);
  const now = Date.now();
  
  const heldPositions = {};
  for (const [mint, pos] of Object.entries(data.positions || {})) {
    if (!pos || typeof pos !== 'object') continue;
    const totalTokens = typeof pos.totalTokens === 'number' ? pos.totalTokens : 0;
    const totalCostSOLCheck = typeof pos.totalCostSOL === 'number' ? pos.totalCostSOL : 0;
    // Include position if it has tokens OR if SOL was spent (pumpfun-trade.js
    // auto-records buys without token amounts, so totalTokens may be 0)
    if (totalTokens > 0 || totalCostSOLCheck > 0) {
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

  // Include today's performance in status
  const todayPL = getTodayPL(data);
  
  return {
    totalTrades: (data.trades || []).length,
    recentTrades,
    buyCountByMint: data.buyCountByMint || {},
    totalProfitSOL: +(data.totalProfitSOL || 0).toFixed(6),
    todayPL,
    activePositions: Object.keys(heldPositions).length,
    positions: heldPositions,
    message: Object.keys(heldPositions).length > 0
      ? `Currently holding ${Object.keys(heldPositions).length} token(s)`
      : 'No open positions'
  };
}

// ============================================================================
// RESET
// ============================================================================
function reset() {
  const data = { trades: [], buyCountByMint: {}, totalProfitSOL: 0, positions: {}, dailyPL: {} };
  saveTrades(data);
  return { success: true, message: 'Trade history cleared' };
}

// ============================================================================
// MAIN
// ============================================================================
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
  case 'daily':
    result = getDailySummary();
    break;
  case 'reset':
    result = reset();
    break;
  default:
    console.error('Usage: pumpfun-track.js <record|check|status|daily|reset> [args]');
    process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
