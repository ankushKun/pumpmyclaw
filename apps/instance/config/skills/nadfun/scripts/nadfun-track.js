#!/usr/bin/env node
'use strict';

// Position tracking and P/L management for nad.fun trades
//
// Usage:
//   nadfun-track.js record <buy|sell> <token_address> <mon_amount>
//   nadfun-track.js check <token_address>
//   nadfun-track.js status
//   nadfun-track.js daily
//   nadfun-track.js reset
//
// Auto-tuning bridge:
//   On BUY:  automatically records entry patterns via nadfun-analyze.js
//   On SELL: automatically records outcome via nadfun-analyze.js
//   No extra tool calls needed — the learning system is always fed.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const WORKSPACE_DIR = path.join(process.env.HOME || '/home/openclaw', '.openclaw', 'workspace');
const TRADES_FILE = path.join(WORKSPACE_DIR, 'MONAD_TRADES.json');
const SCRIPTS_DIR = path.dirname(__filename);

// Maximum trades to keep in the active trades array.
// Older trades are rotated to an archive file to preserve history.
const MAX_ACTIVE_TRADES = 500;
const ARCHIVE_FILE = path.join(WORKSPACE_DIR, 'MONAD_TRADES_ARCHIVE.json');

// Safety caps (must match nadfun-trade.js and AGENTS.md)
const MAX_BUY_MON = 5.0;
const MAX_SELL_MON = 50.0; // generous cap for sells (multi-buy positions)

function loadTrades() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
      // Ensure all expected fields exist
      if (!data.trades) data.trades = [];
      if (!data.positions) data.positions = {};
      if (!data.daily) data.daily = {};
      if (typeof data.totalProfitMON !== 'number') data.totalProfitMON = 0;
      return data;
    }
  } catch {}
  return { trades: [], positions: {}, daily: {}, totalProfitMON: 0 };
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
// Calls nadfun-analyze.js to record entries/outcomes so the learning system
// is always fed without requiring extra tool calls from the LLM.
// ============================================================================
function bridgeToAutoTuning(action, token, monAmount, profitMON) {
  try {
    const analyzeScript = path.join(SCRIPTS_DIR, 'nadfun-analyze.js');
    if (!fs.existsSync(analyzeScript)) return;

    if (action === 'buy') {
      // Record entry: captures current patterns/signals at time of buy
      execSync(
        `node "${analyzeScript}" record "${token}" BUY "${monAmount}"`,
        { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.error(`[track] Auto-tuning: recorded BUY entry for ${token}`);
    } else if (action === 'sell') {
      // Find the most recent open trade in analyze's trades-history.json
      // and close it with the outcome
      const tradesHistoryFile = path.join(WORKSPACE_DIR, 'monad-trades-history.json');
      if (!fs.existsSync(tradesHistoryFile)) return;

      const tradesHistory = JSON.parse(fs.readFileSync(tradesHistoryFile, 'utf8'));
      // Find latest open trade for this token
      const openTrade = [...(tradesHistory.trades || [])].reverse().find(
        t => t.token === token && !t.outcome
      );

      if (openTrade) {
        const outcome = profitMON >= 0 ? 'win' : 'loss';
        execSync(
          `node "${analyzeScript}" outcome "${openTrade.id}" "${outcome}" "${monAmount}"`,
          { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        console.error(`[track] Auto-tuning: recorded ${outcome} for trade #${openTrade.id} (${token})`);
      }
    }
  } catch (e) {
    // Never let auto-tuning errors break trade recording
    console.error(`[track] Auto-tuning bridge error (non-fatal): ${e.message}`);
  }
}

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function cmdRecord(args) {
  if (args.length < 3) {
    console.log(JSON.stringify({ error: 'Usage: nadfun-track.js record <buy|sell> <token> <mon_amount>' }));
    process.exit(1);
  }

  const type = args[0].toLowerCase();
  const token = args[1];
  let monAmount = parseFloat(args[2]);

  if (type !== 'buy' && type !== 'sell') {
    console.log(JSON.stringify({ error: 'Type must be "buy" or "sell"' }));
    process.exit(1);
  }

  if (isNaN(monAmount) || monAmount <= 0) {
    console.log(JSON.stringify({ error: 'Invalid MON amount' }));
    process.exit(1);
  }

  // Safety caps — reject obviously wrong amounts
  if (type === 'buy' && monAmount > MAX_BUY_MON) {
    console.log(JSON.stringify({
      error: `Buy amount ${monAmount} MON exceeds safety cap ${MAX_BUY_MON} MON`,
      capped: true,
    }));
    process.exit(1);
  }
  if (type === 'sell' && monAmount > MAX_SELL_MON) {
    console.log(JSON.stringify({
      error: `Sell amount ${monAmount} MON exceeds safety cap ${MAX_SELL_MON} MON`,
      capped: true,
    }));
    process.exit(1);
  }

  const data = loadTrades();
  const today = todayKey();

  // Duplicate protection: reject if same token+type was recorded in the last 60 seconds
  const now = Date.now();
  const recentDupe = data.trades.slice(-20).find(t => {
    if (t.token !== token || t.type !== type) return false;
    const tTime = new Date(t.timestamp).getTime();
    return (now - tTime) < 60000;
  });
  if (recentDupe) {
    console.log(JSON.stringify({
      success: true,
      recorded: type,
      token,
      duplicate: true,
      note: 'Trade already recorded within the last 60 seconds',
    }));
    return;
  }

  if (!data.daily[today]) {
    data.daily[today] = { profit: 0, trades: 0, wins: 0, losses: 0 };
  }

  const trade = {
    type,
    chain: 'monad',
    token,
    mon: monAmount,
    timestamp: new Date().toISOString(),
  };

  data.trades.push(trade);
  data.daily[today].trades++;

  if (type === 'buy') {
    if (!data.positions[token]) {
      data.positions[token] = { totalCost: 0, buyCount: 0, firstBuy: Date.now() };
    }
    data.positions[token].totalCost += monAmount;
    data.positions[token].buyCount++;

    saveTrades(data);

    // Bridge to auto-tuning (non-blocking, errors swallowed)
    bridgeToAutoTuning('buy', token, monAmount, 0);

    console.log(JSON.stringify({
      success: true,
      recorded: 'buy',
      token,
      mon: monAmount,
      totalCost: data.positions[token].totalCost,
      buyCount: data.positions[token].buyCount,
    }));
  } else {
    // Sell — support partial sells (don't delete position unless fully sold)
    const pos = data.positions[token];
    let profit = 0;
    if (pos) {
      // Estimate what fraction of the position was sold
      // If monReceived >= totalCost, treat as full sell
      // Otherwise, proportionally reduce the position
      if (monAmount >= pos.totalCost * 0.9) {
        // Full sell (or close to it)
        profit = monAmount - pos.totalCost;
        trade.profit = profit;
        data.totalProfitMON += profit;
        data.daily[today].profit += profit;
        if (profit > 0) data.daily[today].wins++;
        else data.daily[today].losses++;
        delete data.positions[token];
      } else {
        // Partial sell — proportionally reduce cost basis
        const sellRatio = pos.totalCost > 0 ? monAmount / pos.totalCost : 1;
        const costPortion = pos.totalCost * Math.min(sellRatio, 1);
        profit = monAmount - costPortion;
        trade.profit = profit;
        data.totalProfitMON += profit;
        data.daily[today].profit += profit;
        if (profit > 0) data.daily[today].wins++;
        else data.daily[today].losses++;
        // Reduce remaining position
        pos.totalCost = Math.max(0, pos.totalCost - costPortion);
        pos.buyCount = Math.max(1, pos.buyCount - 1);
      }
    } else {
      // Unknown position - count all as profit
      profit = monAmount;
      data.totalProfitMON += monAmount;
      data.daily[today].profit += monAmount;
      data.daily[today].wins++;
    }

    saveTrades(data);

    // Bridge to auto-tuning (non-blocking, errors swallowed)
    bridgeToAutoTuning('sell', token, monAmount, profit);

    console.log(JSON.stringify({
      success: true,
      recorded: 'sell',
      token,
      mon: monAmount,
      profit: profit.toFixed(6),
      totalProfitMON: data.totalProfitMON.toFixed(6),
    }));
  }
}

function cmdCheck(args) {
  if (args.length < 1) {
    console.log(JSON.stringify({ error: 'Usage: nadfun-track.js check <token>' }));
    process.exit(1);
  }

  const token = args[0];
  const data = loadTrades();
  const pos = data.positions[token];

  if (!pos) {
    console.log(JSON.stringify({ canBuy: true, buyCount: 0, maxBuys: 2 }));
  } else {
    console.log(JSON.stringify({
      canBuy: pos.buyCount < 2,
      buyCount: pos.buyCount,
      maxBuys: 2,
      totalCost: pos.totalCost,
      firstBuyAge: Math.floor((Date.now() - pos.firstBuy) / 60000),
    }));
  }
}

function cmdStatus() {
  const data = loadTrades();
  const positions = Object.entries(data.positions).map(([token, pos]) => ({
    token,
    totalCost: pos.totalCost,
    buyCount: pos.buyCount,
    ageMinutes: Math.floor((Date.now() - pos.firstBuy) / 60000),
  }));

  // Calculate all-time win rate
  let totalWins = 0, totalLosses = 0;
  for (const day of Object.values(data.daily)) {
    totalWins += day.wins || 0;
    totalLosses += day.losses || 0;
  }
  const totalTrades = totalWins + totalLosses;

  console.log(JSON.stringify({
    positions,
    positionCount: positions.length,
    totalProfitMON: (data.totalProfitMON || 0).toFixed(6),
    allTimeWinRate: totalTrades > 0 ? Math.round(totalWins / totalTrades * 100) : 0,
    totalTrades,
  }));
}

function cmdDaily() {
  const data = loadTrades();
  const today = todayKey();
  const d = data.daily[today] || { profit: 0, trades: 0, wins: 0, losses: 0 };

  const winRate = d.trades > 0 ? Math.round(d.wins / (d.wins + d.losses) * 100) : 0;

  console.log(JSON.stringify({
    date: today,
    profit_mon: d.profit.toFixed(6),
    trades: d.trades,
    wins: d.wins,
    losses: d.losses,
    win_rate: winRate,
  }));
}

function cmdReset() {
  saveTrades({ trades: [], positions: {}, daily: {}, totalProfitMON: 0 });
  console.log(JSON.stringify({ success: true, message: 'Trade history reset' }));
}

// Main
const args = process.argv.slice(2);
const cmd = args[0] || 'status';

switch (cmd) {
  case 'record': cmdRecord(args.slice(1)); break;
  case 'check': cmdCheck(args.slice(1)); break;
  case 'status': cmdStatus(); break;
  case 'daily': cmdDaily(); break;
  case 'reset': cmdReset(); break;
  default:
    console.log(JSON.stringify({
      error: `Unknown command: ${cmd}`,
      commands: ['record', 'check', 'status', 'daily', 'reset'],
    }));
    process.exit(1);
}
