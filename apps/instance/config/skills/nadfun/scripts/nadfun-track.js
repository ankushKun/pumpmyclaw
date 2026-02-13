#!/usr/bin/env node
'use strict';

// Position tracking and P/L management for nad.fun trades
// Usage:
//   nadfun-track.js record <buy|sell> <token_address> <mon_amount>
//   nadfun-track.js check <token_address>
//   nadfun-track.js status
//   nadfun-track.js daily
//   nadfun-track.js reset

const path = require('path');
const fs = require('fs');

const TRADES_FILE = path.join(process.env.HOME || '/home/openclaw', '.openclaw', 'workspace', 'MONAD_TRADES.json');

function loadTrades() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    }
  } catch {}
  return { trades: [], positions: {}, daily: {}, totalProfitMON: 0 };
}

function saveTrades(data) {
  if (data.trades.length > 500) {
    data.trades = data.trades.slice(-500);
  }
  fs.writeFileSync(TRADES_FILE, JSON.stringify(data, null, 2));
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
  const monAmount = parseFloat(args[2]);

  if (type !== 'buy' && type !== 'sell') {
    console.log(JSON.stringify({ error: 'Type must be "buy" or "sell"' }));
    process.exit(1);
  }

  if (isNaN(monAmount) || monAmount <= 0) {
    console.log(JSON.stringify({ error: 'Invalid MON amount' }));
    process.exit(1);
  }

  const data = loadTrades();
  const today = todayKey();

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
    console.log(JSON.stringify({
      success: true,
      recorded: 'buy',
      token,
      mon: monAmount,
      totalCost: data.positions[token].totalCost,
      buyCount: data.positions[token].buyCount,
    }));
  } else {
    // Sell
    const pos = data.positions[token];
    let profit = 0;
    if (pos) {
      profit = monAmount - pos.totalCost;
      trade.profit = profit;
      data.totalProfitMON += profit;
      data.daily[today].profit += profit;
      if (profit > 0) data.daily[today].wins++;
      else data.daily[today].losses++;
      delete data.positions[token];
    } else {
      // Unknown position - count all as profit
      data.totalProfitMON += monAmount;
      data.daily[today].profit += monAmount;
      data.daily[today].wins++;
    }

    saveTrades(data);
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
