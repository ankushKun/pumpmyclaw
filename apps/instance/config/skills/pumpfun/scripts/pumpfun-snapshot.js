#!/usr/bin/env node
/**
 * Token snapshot tracker - stores time-series data for analysis
 * 
 * Since pump.fun's candlestick and trade history APIs require authentication,
 * we build our own by taking periodic snapshots of token data.
 * 
 * Usage:
 *   pumpfun-snapshot.js take <mint>           - Take a snapshot
 *   pumpfun-snapshot.js history <mint> [hrs]  - Get snapshot history (default 1hr)
 *   pumpfun-snapshot.js analyze <mint>        - Analyze trend from snapshots
 *   pumpfun-snapshot.js clean [hours]         - Clean old snapshots (default 24hr)
 *   pumpfun-snapshot.js list                  - List tracked tokens
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SNAPSHOTS_FILE = path.join(
  process.env.HOME || '/home/openclaw',
  '.openclaw/workspace/SNAPSHOTS.json'
);

const SCRIPTS_DIR = path.dirname(__filename);

// Bonding curve constants for pump.fun
const TOTAL_SUPPLY = 1000000000000000n; // 1 billion tokens * 10^6 decimals
const INITIAL_VIRTUAL_SOL = 30000000000n; // 30 SOL in lamports
const INITIAL_VIRTUAL_TOKENS = 1073000000000000n; // Initial virtual token reserves

function loadSnapshots() {
  try {
    if (fs.existsSync(SNAPSHOTS_FILE)) {
      return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error(`[snapshot] Error loading snapshots: ${e.message}`);
  }
  return { tokens: {} };
}

function saveSnapshots(data) {
  try {
    const dir = path.dirname(SNAPSHOTS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[snapshot] Error saving snapshots: ${e.message}`);
  }
}

function getTokenData(mint) {
  try {
    const cmd = `${path.join(SCRIPTS_DIR, 'pumpfun-trades.sh')} ${mint}`;
    const result = execSync(cmd, { 
      encoding: 'utf8', 
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(result);
  } catch (e) {
    console.error(`[snapshot] Error fetching token data: ${e.message}`);
    return null;
  }
}

// Calculate price from bonding curve reserves
function calculatePrice(virtualSolReserves, virtualTokenReserves) {
  if (!virtualSolReserves || !virtualTokenReserves) return 0;
  // Price = sol_reserves / token_reserves (in SOL per token)
  // Convert to human-readable
  const solReserves = Number(virtualSolReserves) / 1e9; // lamports to SOL
  const tokenReserves = Number(virtualTokenReserves) / 1e6; // to tokens
  return solReserves / tokenReserves;
}

function takeSnapshot(mint) {
  const data = loadSnapshots();
  const tokenData = getTokenData(mint);
  
  if (!tokenData || tokenData.error) {
    return { success: false, error: 'Failed to fetch token data' };
  }
  
  const timestamp = Date.now();
  const price = calculatePrice(tokenData.virtual_sol_reserves, tokenData.virtual_token_reserves);
  
  const snapshot = {
    timestamp,
    price,
    usd_market_cap: tokenData.usd_market_cap || 0,
    virtual_sol_reserves: tokenData.virtual_sol_reserves,
    virtual_token_reserves: tokenData.virtual_token_reserves,
    real_sol_reserves: tokenData.real_sol_reserves,
    reply_count: tokenData.reply_count || 0,
    is_currently_live: tokenData.is_currently_live,
    complete: tokenData.complete
  };
  
  if (!data.tokens[mint]) {
    data.tokens[mint] = {
      name: tokenData.name,
      symbol: tokenData.symbol,
      snapshots: []
    };
  }
  
  data.tokens[mint].snapshots.push(snapshot);
  
  // Keep last 500 snapshots per token (roughly 8 hours at 1/min)
  if (data.tokens[mint].snapshots.length > 500) {
    data.tokens[mint].snapshots = data.tokens[mint].snapshots.slice(-500);
  }
  
  data.tokens[mint].lastUpdate = timestamp;
  saveSnapshots(data);
  
  return {
    success: true,
    mint,
    name: tokenData.name,
    symbol: tokenData.symbol,
    price,
    marketCap: tokenData.usd_market_cap,
    snapshotCount: data.tokens[mint].snapshots.length
  };
}

function getHistory(mint, hours = 1) {
  const data = loadSnapshots();
  const tokenData = data.tokens[mint];
  
  if (!tokenData || !tokenData.snapshots.length) {
    return { error: 'No snapshot history for this token' };
  }
  
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  const recent = tokenData.snapshots.filter(s => s.timestamp > cutoff);
  
  if (recent.length === 0) {
    return { error: 'No recent snapshots in requested timeframe' };
  }
  
  return {
    mint,
    name: tokenData.name,
    symbol: tokenData.symbol,
    timeframeHours: hours,
    snapshotCount: recent.length,
    snapshots: recent.slice(-20), // Last 20 for display
    oldest: recent[0],
    newest: recent[recent.length - 1]
  };
}

function analyzeSnapshots(mint) {
  const data = loadSnapshots();
  const tokenData = data.tokens[mint];
  
  if (!tokenData || tokenData.snapshots.length < 3) {
    return { 
      error: 'Need at least 3 snapshots for analysis',
      recommendation: { action: 'WAIT', confidence: 0, reason: 'Insufficient data' }
    };
  }
  
  const snapshots = tokenData.snapshots;
  const now = Date.now();
  
  // Get snapshots from different timeframes
  const last5min = snapshots.filter(s => s.timestamp > now - 5 * 60 * 1000);
  const last15min = snapshots.filter(s => s.timestamp > now - 15 * 60 * 1000);
  const last1hr = snapshots.filter(s => s.timestamp > now - 60 * 60 * 1000);
  
  const current = snapshots[snapshots.length - 1];
  
  // Calculate price changes
  const calcChange = (older, newer) => {
    if (!older || !newer || older.price === 0) return 0;
    return ((newer.price - older.price) / older.price) * 100;
  };
  
  const change5min = last5min.length > 1 ? calcChange(last5min[0], current) : 0;
  const change15min = last15min.length > 1 ? calcChange(last15min[0], current) : 0;
  const change1hr = last1hr.length > 1 ? calcChange(last1hr[0], current) : 0;
  
  // Calculate volatility (std dev of price changes)
  const priceChanges = [];
  for (let i = 1; i < Math.min(snapshots.length, 20); i++) {
    const change = calcChange(snapshots[snapshots.length - i - 1], snapshots[snapshots.length - i]);
    priceChanges.push(change);
  }
  
  const avgChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length || 0;
  const variance = priceChanges.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) / priceChanges.length || 0;
  const volatility = Math.sqrt(variance);
  
  // Determine trend
  let trend = 'sideways';
  if (change5min > 3 && change15min > 0) trend = 'bullish';
  if (change5min > 8 && change15min > 5) trend = 'strong_bullish';
  if (change5min < -3 && change15min < 0) trend = 'bearish';
  if (change5min < -8 && change15min < -5) trend = 'strong_bearish';
  
  // Determine volatility category
  let volatilityCategory = 'low';
  if (volatility > 5) volatilityCategory = 'high';
  else if (volatility > 2) volatilityCategory = 'medium';
  
  // Calculate momentum score
  const momentumScore = (change5min * 0.5) + (change15min * 0.3) + (change1hr * 0.2);
  
  // Social momentum (reply count growth)
  let socialMomentum = 0;
  if (last1hr.length > 1) {
    const oldReplies = last1hr[0].reply_count || 0;
    const newReplies = current.reply_count || 0;
    socialMomentum = newReplies - oldReplies;
  }
  
  // Generate signals
  const signals = [];
  
  if (change5min > 10 && change15min > 5) {
    signals.push({ type: 'MOMENTUM_BREAKOUT', strength: 'strong' });
  }
  if (change5min < 0 && change5min > -8 && change15min > 5 && change1hr > 0) {
    signals.push({ type: 'PULLBACK_ENTRY', strength: 'strong' });
  }
  if (change5min < -12 && change15min > -5) {
    signals.push({ type: 'SHARP_DIP', strength: 'caution' });
  }
  if (change5min > 15) {
    signals.push({ type: 'OVEREXTENDED', strength: 'caution' });
  }
  if (socialMomentum > 10) {
    signals.push({ type: 'SOCIAL_MOMENTUM', strength: 'medium' });
  }
  
  // Generate recommendation
  let score = 50;
  let reasons = [];
  let warnings = [];
  
  // Instant disqualifiers
  if (current.complete) {
    return {
      analysis: { trend, volatility: volatilityCategory },
      recommendation: { action: 'SKIP', confidence: 100, reasons: ['Token graduated to Raydium'] }
    };
  }
  if (!current.is_currently_live) {
    return {
      analysis: { trend, volatility: volatilityCategory },
      recommendation: { action: 'SKIP', confidence: 90, reasons: ['Token not actively trading'] }
    };
  }
  
  // Market cap check
  const mcap = current.usd_market_cap || 0;
  if (mcap < 3000) {
    score -= 20;
    warnings.push('Very low market cap (risky)');
  } else if (mcap > 60000) {
    score -= 10;
    warnings.push('High market cap (graduation risk)');
  } else if (mcap >= 5000 && mcap <= 40000) {
    score += 10;
    reasons.push('Good market cap range');
  }
  
  // Trend scoring
  if (trend === 'strong_bullish') { score += 20; reasons.push('Strong bullish trend'); }
  else if (trend === 'bullish') { score += 10; reasons.push('Bullish trend'); }
  else if (trend === 'strong_bearish') { score -= 25; warnings.push('Strong bearish trend'); }
  else if (trend === 'bearish') { score -= 15; warnings.push('Bearish trend'); }
  
  // Signal scoring
  signals.forEach(s => {
    if (s.type === 'PULLBACK_ENTRY') { score += 15; reasons.push('Good pullback entry'); }
    if (s.type === 'MOMENTUM_BREAKOUT' && s.strength === 'strong') { score += 10; reasons.push('Momentum breakout'); }
    if (s.type === 'OVEREXTENDED') { score -= 10; warnings.push('Price overextended'); }
    if (s.type === 'SHARP_DIP') { score -= 5; warnings.push('Sharp recent dip'); }
    if (s.type === 'SOCIAL_MOMENTUM') { score += 5; reasons.push('Growing social activity'); }
  });
  
  // Volatility adjustment
  if (volatilityCategory === 'high') {
    warnings.push('High volatility');
  }
  
  // Determine action
  let action = 'WATCH';
  let confidence = Math.min(100, Math.max(0, score));
  
  if (score >= 70) action = 'BUY';
  else if (score >= 55) action = 'WATCH';
  else if (score < 40) action = 'AVOID';
  
  // Position sizing based on confidence
  let positionSize = 0.002;
  if (confidence >= 75) positionSize = 0.005;
  else if (confidence >= 60) positionSize = 0.003;
  
  // Dynamic targets based on volatility
  const targets = {
    low: { takeProfit: 20, stopLoss: 10 },
    medium: { takeProfit: 35, stopLoss: 15 },
    high: { takeProfit: 50, stopLoss: 20 }
  };
  const { takeProfit, stopLoss } = targets[volatilityCategory];
  
  return {
    mint,
    name: tokenData.name,
    symbol: tokenData.symbol,
    currentPrice: current.price,
    marketCap: mcap,
    analysis: {
      trend,
      momentum: Math.round(momentumScore * 10) / 10,
      change5min: Math.round(change5min * 10) / 10,
      change15min: Math.round(change15min * 10) / 10,
      change1hr: Math.round(change1hr * 10) / 10,
      volatility: volatilityCategory,
      volatilityPct: Math.round(volatility * 10) / 10,
      socialMomentum,
      signals: signals.map(s => s.type),
      snapshotsUsed: snapshots.length
    },
    recommendation: {
      action,
      confidence,
      score,
      positionSize,
      takeProfit: `+${takeProfit}%`,
      stopLoss: `-${stopLoss}%`,
      reasons,
      warnings
    }
  };
}

function cleanOldSnapshots(hours = 24) {
  const data = loadSnapshots();
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  let cleaned = 0;
  
  for (const mint of Object.keys(data.tokens)) {
    const before = data.tokens[mint].snapshots.length;
    data.tokens[mint].snapshots = data.tokens[mint].snapshots.filter(s => s.timestamp > cutoff);
    cleaned += before - data.tokens[mint].snapshots.length;
    
    // Remove token entirely if no recent snapshots
    if (data.tokens[mint].snapshots.length === 0) {
      delete data.tokens[mint];
    }
  }
  
  saveSnapshots(data);
  return { cleaned, tokensRemaining: Object.keys(data.tokens).length };
}

function listTracked() {
  const data = loadSnapshots();
  const tokens = [];
  
  for (const [mint, tokenData] of Object.entries(data.tokens)) {
    const latest = tokenData.snapshots[tokenData.snapshots.length - 1];
    tokens.push({
      mint: mint.slice(0, 8) + '...',
      fullMint: mint,
      name: tokenData.name,
      symbol: tokenData.symbol,
      snapshots: tokenData.snapshots.length,
      latestPrice: latest?.price || 0,
      latestMcap: latest?.usd_market_cap || 0,
      lastUpdate: tokenData.lastUpdate ? new Date(tokenData.lastUpdate).toISOString() : 'unknown'
    });
  }
  
  return { count: tokens.length, tokens };
}

// Main
const [,, command, ...args] = process.argv;

let result;
switch (command) {
  case 'take':
    if (!args[0]) {
      console.error('Usage: pumpfun-snapshot.js take <mint>');
      process.exit(1);
    }
    result = takeSnapshot(args[0]);
    break;
  case 'history':
    if (!args[0]) {
      console.error('Usage: pumpfun-snapshot.js history <mint> [hours]');
      process.exit(1);
    }
    result = getHistory(args[0], parseFloat(args[1]) || 1);
    break;
  case 'analyze':
    if (!args[0]) {
      console.error('Usage: pumpfun-snapshot.js analyze <mint>');
      process.exit(1);
    }
    result = analyzeSnapshots(args[0]);
    break;
  case 'clean':
    result = cleanOldSnapshots(parseInt(args[0]) || 24);
    break;
  case 'list':
    result = listTracked();
    break;
  default:
    console.log(`
Token Snapshot Tracker - Build your own time-series data

Usage:
  pumpfun-snapshot.js take <mint>           - Take a snapshot of token state
  pumpfun-snapshot.js history <mint> [hrs]  - Get snapshot history
  pumpfun-snapshot.js analyze <mint>        - Analyze trend from snapshots
  pumpfun-snapshot.js clean [hours]         - Clean old data (default 24hr)
  pumpfun-snapshot.js list                  - List tracked tokens

How it works:
  The heartbeat should call 'take' for tokens of interest.
  After collecting several snapshots, 'analyze' provides trend analysis.
  
Example workflow:
  1. pumpfun-snapshot.js take ABC123...   # Take first snapshot
  2. (wait 5 minutes)
  3. pumpfun-snapshot.js take ABC123...   # Take another
  4. (repeat several times)
  5. pumpfun-snapshot.js analyze ABC123... # Get analysis
`);
    process.exit(0);
}

console.log(JSON.stringify(result, null, 2));
