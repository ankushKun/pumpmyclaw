#!/usr/bin/env node
/**
 * Comprehensive market analysis tool for pump.fun tokens
 * WITH AUTO-TUNING and 25+ candlestick patterns
 * 
 * Data Sources:
 * - GeckoTerminal: OHLCV candlestick data (FREE!)
 * - DEXScreener: Price changes, volume, transaction counts
 * - Pump.fun: Token info, community data
 * 
 * Auto-Tuning:
 * - Tracks trade outcomes (wins/losses)
 * - Adjusts pattern weights based on historical performance
 * - Learns which signals work best in current market
 * 
 * Usage:
 *   pumpfun-analyze.js <mint>           - Full analysis with recommendation
 *   pumpfun-analyze.js <mint> --quick   - Quick analysis (skip candles)
 *   pumpfun-analyze.js scan [limit]     - Scan trending tokens for opportunities
 *   pumpfun-analyze.js record <mint> <action> <entryPrice> - Record a trade entry
 *   pumpfun-analyze.js outcome <tradeId> <result> <exitPrice> - Record trade outcome
 *   pumpfun-analyze.js stats            - Show pattern/signal performance stats
 *   pumpfun-analyze.js reset-tuning     - Reset auto-tuning to defaults
 */

const { execSync } = require('child_process');
const https = require('https');
const path = require('path');
const fs = require('fs');

const SCRIPTS_DIR = path.dirname(__filename);
const DATA_DIR = process.env.WORKSPACE_DIR || path.join(SCRIPTS_DIR, '..', '..', 'workspace');
const TUNING_FILE = path.join(DATA_DIR, 'auto-tuning.json');
const TRADES_FILE = path.join(DATA_DIR, 'trades-history.json');

// ============================================================================
// DEFAULT CONFIGURATION (will be overridden by auto-tuning)
// ============================================================================
const DEFAULT_CONFIG = {
  positionSizes: {
    high: 0.004,
    medium: 0.003,
    low: 0.002
  },
  targets: {
    low: { takeProfit: 0.20, stopLoss: 0.10 },
    medium: { takeProfit: 0.35, stopLoss: 0.15 },
    high: { takeProfit: 0.50, stopLoss: 0.20 }
  },
  minMarketCap: 3000,
  maxMarketCap: 65000,
  idealMinMcap: 5000,
  idealMaxMcap: 40000,
  minConfidenceForBuy: 72,
  minConfidenceForWatch: 55
};

// ============================================================================
// DEFAULT PATTERN/SIGNAL WEIGHTS (auto-tuned over time)
// ============================================================================
const DEFAULT_WEIGHTS = {
  // Candlestick patterns (bullish positive, bearish negative)
  patterns: {
    // Single candle patterns
    DOJI: { weight: 3, type: 'neutral', description: 'Indecision - reversal possible' },
    DRAGONFLY_DOJI: { weight: 8, type: 'bullish', description: 'Bullish reversal at bottom' },
    GRAVESTONE_DOJI: { weight: -8, type: 'bearish', description: 'Bearish reversal at top' },
    HAMMER: { weight: 10, type: 'bullish', description: 'Bullish reversal signal' },
    INVERTED_HAMMER: { weight: 6, type: 'bullish', description: 'Potential bullish reversal' },
    HANGING_MAN: { weight: -8, type: 'bearish', description: 'Bearish reversal at top' },
    SHOOTING_STAR: { weight: -10, type: 'bearish', description: 'Strong bearish reversal' },
    SPINNING_TOP: { weight: 2, type: 'neutral', description: 'Indecision in market' },
    MARUBOZU_BULL: { weight: 12, type: 'bullish', description: 'Strong bullish momentum' },
    MARUBOZU_BEAR: { weight: -12, type: 'bearish', description: 'Strong bearish momentum' },
    
    // Two candle patterns
    BULLISH_ENGULFING: { weight: 14, type: 'bullish', description: 'Strong bullish reversal' },
    BEARISH_ENGULFING: { weight: -14, type: 'bearish', description: 'Strong bearish reversal' },
    BULLISH_HARAMI: { weight: 8, type: 'bullish', description: 'Potential bullish reversal' },
    BEARISH_HARAMI: { weight: -8, type: 'bearish', description: 'Potential bearish reversal' },
    PIERCING_LINE: { weight: 10, type: 'bullish', description: 'Bullish reversal pattern' },
    DARK_CLOUD_COVER: { weight: -10, type: 'bearish', description: 'Bearish reversal pattern' },
    TWEEZER_BOTTOM: { weight: 9, type: 'bullish', description: 'Double bottom reversal' },
    TWEEZER_TOP: { weight: -9, type: 'bearish', description: 'Double top reversal' },
    
    // Three candle patterns
    MORNING_STAR: { weight: 15, type: 'bullish', description: 'Strong bullish reversal' },
    EVENING_STAR: { weight: -15, type: 'bearish', description: 'Strong bearish reversal' },
    THREE_WHITE_SOLDIERS: { weight: 16, type: 'bullish', description: 'Strong bullish continuation' },
    THREE_BLACK_CROWS: { weight: -16, type: 'bearish', description: 'Strong bearish continuation' },
    THREE_INSIDE_UP: { weight: 10, type: 'bullish', description: 'Bullish reversal confirmed' },
    THREE_INSIDE_DOWN: { weight: -10, type: 'bearish', description: 'Bearish reversal confirmed' },
    
    // Trend patterns
    HIGHER_HIGHS_LOWS: { weight: 12, type: 'bullish', description: 'Uptrend structure' },
    LOWER_HIGHS_LOWS: { weight: -12, type: 'bearish', description: 'Downtrend structure' },
    DOUBLE_BOTTOM: { weight: 14, type: 'bullish', description: 'Strong support/reversal' },
    DOUBLE_TOP: { weight: -14, type: 'bearish', description: 'Strong resistance/reversal' },
    
    // Volume patterns
    VOLUME_SPIKE: { weight: 5, type: 'neutral', description: 'Increased interest' },
    VOLUME_CLIMAX_UP: { weight: -5, type: 'bearish', description: 'Exhaustion top possible' },
    VOLUME_CLIMAX_DOWN: { weight: 8, type: 'bullish', description: 'Capitulation bottom possible' },
    VOLUME_BREAKOUT: { weight: 10, type: 'bullish', description: 'Volume confirms breakout' },
    
    // Support/Resistance
    NEAR_SUPPORT: { weight: 10, type: 'bullish', description: 'Price at support level' },
    NEAR_RESISTANCE: { weight: -6, type: 'bearish', description: 'Price at resistance' },
    SUPPORT_BOUNCE: { weight: 12, type: 'bullish', description: 'Confirmed support bounce' },
    RESISTANCE_REJECT: { weight: -10, type: 'bearish', description: 'Rejected at resistance' },
    BREAKOUT_ABOVE_RESISTANCE: { weight: 14, type: 'bullish', description: 'Resistance broken' },
    BREAKDOWN_BELOW_SUPPORT: { weight: -14, type: 'bearish', description: 'Support broken' }
  },
  
  // DEXScreener/market signals
  signals: {
    MOMENTUM_BREAKOUT: { weight: 10, type: 'bullish' },
    PULLBACK_ENTRY: { weight: 15, type: 'bullish' },
    SHARP_DIP: { weight: 8, type: 'bullish' },
    ACCUMULATION: { weight: 12, type: 'bullish' },
    VOLUME_SURGE: { weight: 6, type: 'bullish' },
    HIGH_ACTIVITY: { weight: 4, type: 'bullish' },
    OVEREXTENDED: { weight: -12, type: 'bearish' },
    CAPITULATION: { weight: -18, type: 'bearish' },
    DISTRIBUTION: { weight: -12, type: 'bearish' },
    LOW_ACTIVITY: { weight: -10, type: 'bearish' },
    WHALE_BUY: { weight: 12, type: 'bullish' },
    WHALE_SELL: { weight: -15, type: 'bearish' }
  },
  
  // Trend weights from MA analysis
  trends: {
    strong_bullish: 18,
    bullish: 12,
    sideways: 0,
    bearish: -14,
    strong_bearish: -22
  },
  
  // RSI weights
  rsi: {
    oversold: 10,      // RSI < 30
    neutral: 0,        // 30 <= RSI <= 70
    overbought: -10    // RSI > 70
  }
};

// ============================================================================
// AUTO-TUNING SYSTEM
// ============================================================================
function loadTuningData() {
  try {
    if (fs.existsSync(TUNING_FILE)) {
      const data = JSON.parse(fs.readFileSync(TUNING_FILE, 'utf8'));
      return {
        weights: deepMerge(JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)), data.weights || {}),
        config: deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), data.config || {}),
        stats: data.stats || { patterns: {}, signals: {}, totalTrades: 0, wins: 0, losses: 0 },
        lastUpdate: data.lastUpdate || null
      };
    }
  } catch (e) {
    console.error(`[tuning] Error loading tuning data: ${e.message}`);
  }
  return {
    weights: JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)),
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    stats: { patterns: {}, signals: {}, totalTrades: 0, wins: 0, losses: 0 },
    lastUpdate: null
  };
}

function saveTuningData(tuning) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    tuning.lastUpdate = new Date().toISOString();
    fs.writeFileSync(TUNING_FILE, JSON.stringify(tuning, null, 2));
  } catch (e) {
    console.error(`[tuning] Error saving tuning data: ${e.message}`);
  }
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = target[key] || {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function loadTrades() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error(`[trades] Error loading trades: ${e.message}`);
  }
  return { trades: [], nextId: 1 };
}

function saveTrades(tradesData) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TRADES_FILE, JSON.stringify(tradesData, null, 2));
  } catch (e) {
    console.error(`[trades] Error saving trades: ${e.message}`);
  }
}

// Record a new trade entry
function recordTradeEntry(mint, action, entryPrice, analysis) {
  const tradesData = loadTrades();
  const tradeId = tradesData.nextId++;
  
  const trade = {
    id: tradeId,
    mint,
    action,
    entryPrice: parseFloat(entryPrice),
    entryTime: new Date().toISOString(),
    patterns: analysis?.technical?.patterns || [],
    signals: analysis?.analysis?.signals || [],
    confidence: analysis?.recommendation?.confidence || 0,
    trend: analysis?.technical?.trend || 'unknown',
    rsiRange: getRsiRange(analysis?.technical?.rsi),
    outcome: null, // pending
    exitPrice: null,
    exitTime: null,
    pnlPercent: null
  };
  
  tradesData.trades.push(trade);
  saveTrades(tradesData);
  
  return { tradeId, message: `Trade #${tradeId} recorded. Use 'outcome ${tradeId} win|loss <exitPrice>' when trade closes.` };
}

function getRsiRange(rsi) {
  if (!rsi) return 'unknown';
  if (rsi < 30) return 'oversold';
  if (rsi > 70) return 'overbought';
  return 'neutral';
}

// Record trade outcome and update tuning
function recordTradeOutcome(tradeId, result, exitPrice) {
  const tradesData = loadTrades();
  const trade = tradesData.trades.find(t => t.id === parseInt(tradeId));
  
  if (!trade) {
    return { error: `Trade #${tradeId} not found` };
  }
  
  if (trade.outcome) {
    return { error: `Trade #${tradeId} already has outcome: ${trade.outcome}` };
  }
  
  trade.outcome = result.toLowerCase() === 'win' ? 'win' : 'loss';
  trade.exitPrice = parseFloat(exitPrice);
  trade.exitTime = new Date().toISOString();
  trade.pnlPercent = ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  
  saveTrades(tradesData);
  
  // Update tuning based on outcome
  updateTuningFromTrade(trade);
  
  return { 
    trade,
    message: `Trade #${tradeId} closed as ${trade.outcome} (${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%). Tuning updated.`
  };
}

// Core auto-tuning: adjust weights based on trade outcomes
function updateTuningFromTrade(trade) {
  const tuning = loadTuningData();
  const isWin = trade.outcome === 'win';
  const adjustment = isWin ? 1 : -1;
  const adjustmentAmount = Math.min(Math.abs(trade.pnlPercent) / 10, 2); // Scale by PnL, max 2 per trade
  
  // Update global stats
  tuning.stats.totalTrades++;
  if (isWin) tuning.stats.wins++;
  else tuning.stats.losses++;
  
  // Update pattern weights
  for (const pattern of trade.patterns) {
    if (!tuning.stats.patterns[pattern]) {
      tuning.stats.patterns[pattern] = { wins: 0, losses: 0, totalPnl: 0 };
    }
    const ps = tuning.stats.patterns[pattern];
    if (isWin) ps.wins++;
    else ps.losses++;
    ps.totalPnl += trade.pnlPercent;
    
    // Adjust weight based on performance
    if (tuning.weights.patterns[pattern]) {
      const currentWeight = tuning.weights.patterns[pattern].weight;
      const defaultWeight = DEFAULT_WEIGHTS.patterns[pattern]?.weight || 0;
      const winRate = ps.wins / (ps.wins + ps.losses);
      
      // Only adjust if we have enough data (5+ trades with this pattern)
      if (ps.wins + ps.losses >= 5) {
        // Adjust toward the direction performance suggests
        // If win rate > 60%, increase weight; if < 40%, decrease
        let newWeight = currentWeight;
        if (winRate > 0.6) {
          newWeight = Math.min(currentWeight + adjustmentAmount * adjustment, defaultWeight * 2);
        } else if (winRate < 0.4) {
          newWeight = Math.max(currentWeight - adjustmentAmount, defaultWeight * 0.5);
        }
        tuning.weights.patterns[pattern].weight = Math.round(newWeight * 10) / 10;
      }
    }
  }
  
  // Update signal weights
  for (const signal of trade.signals) {
    if (!tuning.stats.signals[signal]) {
      tuning.stats.signals[signal] = { wins: 0, losses: 0, totalPnl: 0 };
    }
    const ss = tuning.stats.signals[signal];
    if (isWin) ss.wins++;
    else ss.losses++;
    ss.totalPnl += trade.pnlPercent;
    
    // Adjust weight
    if (tuning.weights.signals[signal]) {
      const currentWeight = tuning.weights.signals[signal].weight;
      const defaultWeight = DEFAULT_WEIGHTS.signals[signal]?.weight || 0;
      const winRate = ss.wins / (ss.wins + ss.losses);
      
      if (ss.wins + ss.losses >= 5) {
        let newWeight = currentWeight;
        if (winRate > 0.6) {
          newWeight = Math.min(currentWeight + adjustmentAmount * adjustment, defaultWeight * 2);
        } else if (winRate < 0.4) {
          newWeight = Math.max(currentWeight - adjustmentAmount, defaultWeight * 0.5);
        }
        tuning.weights.signals[signal].weight = Math.round(newWeight * 10) / 10;
      }
    }
  }
  
  // Adjust confidence thresholds based on overall win rate
  if (tuning.stats.totalTrades >= 10) {
    const overallWinRate = tuning.stats.wins / tuning.stats.totalTrades;
    if (overallWinRate < 0.45) {
      // Too many losses, increase confidence threshold
      tuning.config.minConfidenceForBuy = Math.min(tuning.config.minConfidenceForBuy + 1, 85);
    } else if (overallWinRate > 0.65) {
      // Very good, can slightly lower threshold
      tuning.config.minConfidenceForBuy = Math.max(tuning.config.minConfidenceForBuy - 1, 65);
    }
  }
  
  saveTuningData(tuning);
}

function getStats() {
  const tuning = loadTuningData();
  const tradesData = loadTrades();
  
  const patternStats = Object.entries(tuning.stats.patterns)
    .map(([name, stats]) => ({
      pattern: name,
      trades: stats.wins + stats.losses,
      winRate: ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1) + '%',
      avgPnl: (stats.totalPnl / (stats.wins + stats.losses)).toFixed(2) + '%',
      currentWeight: tuning.weights.patterns[name]?.weight || 'N/A',
      defaultWeight: DEFAULT_WEIGHTS.patterns[name]?.weight || 'N/A'
    }))
    .filter(p => p.trades >= 3)
    .sort((a, b) => parseFloat(b.avgPnl) - parseFloat(a.avgPnl));
  
  const signalStats = Object.entries(tuning.stats.signals)
    .map(([name, stats]) => ({
      signal: name,
      trades: stats.wins + stats.losses,
      winRate: ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1) + '%',
      avgPnl: (stats.totalPnl / (stats.wins + stats.losses)).toFixed(2) + '%',
      currentWeight: tuning.weights.signals[name]?.weight || 'N/A',
      defaultWeight: DEFAULT_WEIGHTS.signals[name]?.weight || 'N/A'
    }))
    .filter(s => s.trades >= 3)
    .sort((a, b) => parseFloat(b.avgPnl) - parseFloat(a.avgPnl));
  
  const recentTrades = tradesData.trades
    .filter(t => t.outcome)
    .slice(-10)
    .map(t => ({
      id: t.id,
      symbol: t.mint.slice(0, 8) + '...',
      outcome: t.outcome,
      pnl: (t.pnlPercent >= 0 ? '+' : '') + t.pnlPercent.toFixed(2) + '%',
      patterns: t.patterns.slice(0, 3),
      signals: t.signals.slice(0, 3)
    }));
  
  return {
    overall: {
      totalTrades: tuning.stats.totalTrades,
      wins: tuning.stats.wins,
      losses: tuning.stats.losses,
      winRate: tuning.stats.totalTrades > 0 
        ? ((tuning.stats.wins / tuning.stats.totalTrades) * 100).toFixed(1) + '%' 
        : 'N/A'
    },
    currentConfig: {
      minConfidenceForBuy: tuning.config.minConfidenceForBuy,
      minConfidenceForWatch: tuning.config.minConfidenceForWatch
    },
    topPatterns: patternStats.slice(0, 10),
    worstPatterns: patternStats.slice(-5).reverse(),
    topSignals: signalStats.slice(0, 10),
    recentTrades,
    lastUpdate: tuning.lastUpdate
  };
}

function resetTuning() {
  const tuning = {
    weights: JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)),
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    stats: { patterns: {}, signals: {}, totalTrades: 0, wins: 0, losses: 0 },
    lastUpdate: new Date().toISOString()
  };
  saveTuningData(tuning);
  return { message: 'Auto-tuning reset to defaults', tuning };
}

// ============================================================================
// FAST HTTP HELPERS (avoid shell spawn overhead for scan)
// ============================================================================
function httpGet(url, timeoutMs = 5000, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      timeout: timeoutMs,
      headers: { 'Accept': 'application/json', ...headers }
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout')); });
    req.on('error', reject);
  });
}

async function fetchTrendingFast(limit = 15) {
  try {
    const url = `https://frontend-api-v3.pump.fun/coins/currently-live?limit=${limit}&offset=0&includeNsfw=false&sort=usd_market_cap&order=DESC`;
    return await httpGet(url, 5000, { 'Origin': 'https://pump.fun' });
  } catch (e) {
    console.error(`[analyze] Fast trending fetch failed: ${e.message}`);
    return null;
  }
}

async function fetchDexScreenerBatchFast(mints) {
  if (!mints || mints.length === 0) return {};
  try {
    const url = `https://api.dexscreener.com/tokens/v1/solana/${mints.join(',')}`;
    const raw = await httpGet(url, 5000);
    if (!Array.isArray(raw)) return {};
    // Group by base token, pick best pair (prefer pumpfun, then highest liquidity)
    const grouped = {};
    for (const pair of raw) {
      const addr = pair?.baseToken?.address;
      if (!addr) continue;
      if (!grouped[addr]) grouped[addr] = [];
      grouped[addr].push(pair);
    }
    const result = {};
    for (const [addr, pairs] of Object.entries(grouped)) {
      pairs.sort((a, b) => {
        const aDex = a.dexId === 'pumpfun' ? 0 : 1;
        const bDex = b.dexId === 'pumpfun' ? 0 : 1;
        if (aDex !== bDex) return aDex - bDex;
        return (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0);
      });
      const p = pairs[0];
      result[addr] = {
        dex: p.dexId,
        name: p.baseToken?.name,
        symbol: p.baseToken?.symbol,
        mint: p.baseToken?.address,
        pairAddress: p.pairAddress,
        priceUsd: parseFloat(p.priceUsd) || 0,
        priceNative: parseFloat(p.priceNative) || 0,
        priceChange: {
          m5: p.priceChange?.m5 || 0,
          h1: p.priceChange?.h1 || 0,
          h6: p.priceChange?.h6 || 0,
          h24: p.priceChange?.h24 || 0
        },
        txns: {
          m5: p.txns?.m5,
          h1: p.txns?.h1,
          h6: p.txns?.h6,
          h24: p.txns?.h24
        },
        volume: {
          h24: p.volume?.h24 || 0,
          h6: p.volume?.h6 || 0,
          h1: p.volume?.h1 || 0,
          m5: p.volume?.m5 || 0
        },
        liquidity: {
          usd: p.liquidity?.usd || 0,
          base: p.liquidity?.base || 0,
          quote: p.liquidity?.quote || 0
        },
        fdv: p.fdv || 0,
        marketCap: p.marketCap || 0,
        imageUrl: p.info?.imageUrl || null,
        pairCreatedAt: p.pairCreatedAt,
        url: p.url
      };
    }
    return result;
  } catch (e) {
    console.error(`[analyze] Fast DexScreener batch fetch failed: ${e.message}`);
    return {};
  }
}

async function fetchRSIFast(poolAddress) {
  // Fetch just enough 5m candles from GeckoTerminal to calculate RSI (need 15+ closes)
  if (!poolAddress) return null;
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/minute?aggregate=5&limit=20`;
    const data = await httpGet(url, 3000);
    const ohlcvList = data?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(ohlcvList) || ohlcvList.length < 15) return null;
    // ohlcv_list is newest-first: [timestamp, open, high, low, close, volume]
    const closes = ohlcvList.map(c => c[4]).reverse(); // reverse to oldest-first
    return calculateRSI(closes, 14);
  } catch (e) {
    console.error(`[analyze] Fast RSI fetch failed for ${poolAddress}: ${e.message}`);
    return null;
  }
}

async function fetchBatchRSIFast(opportunities, dexDataMap) {
  // Fetch RSI for top candidates in parallel (up to 3 to stay fast)
  const topOpps = opportunities.slice(0, 3);
  const results = {};
  const promises = topOpps.map(async (opp) => {
    const dex = dexDataMap[opp.mint];
    const poolAddr = dex?.pairAddress;
    if (!poolAddr) return;
    const rsi = await fetchRSIFast(poolAddr);
    if (rsi !== null) results[opp.mint] = rsi;
  });
  await Promise.all(promises);
  return results;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function runScript(script, args = []) {
  try {
    const cmd = `${path.join(SCRIPTS_DIR, script)} ${args.join(' ')}`;
    const result = execSync(cmd, { 
      encoding: 'utf8', 
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(result);
  } catch (e) {
    return { error: e.message };
  }
}

function getPumpfunData(mint) {
  return runScript('pumpfun-trades.sh', [mint]);
}

function getDexScreenerData(mint) {
  return runScript('pumpfun-dexscreener.sh', [mint]);
}

function getBatchDexScreenerData(mints) {
  // DexScreener supports up to 30 comma-separated mints in a single call
  if (!mints || mints.length === 0) return {};
  const result = runScript('pumpfun-dexscreener.sh', mints);
  if (!result || result.error) return {};
  // If single mint, runScript returns a single object; if multiple, returns array
  const arr = Array.isArray(result) ? result : [result];
  const map = {};
  for (const item of arr) {
    if (item && item.mint) {
      map[item.mint] = item;
    }
  }
  return map;
}

function getCandleData(mint, timeframe = '5m', limit = 50) {
  return runScript('pumpfun-candles.sh', [mint, timeframe, limit.toString()]);
}

// ============================================================================
// COMPREHENSIVE CANDLESTICK PATTERN DETECTION (25+ patterns)
// ============================================================================
function analyzeCandlesticks(candleData) {
  const analysis = {
    trend: 'unknown',
    strength: 0,
    support: 0,
    resistance: 0,
    rsi: 50,
    volatility: 'medium',
    patterns: [],
    macd: null,
    bollingerBands: null
  };
  
  if (!candleData || candleData.error || !candleData.candles || candleData.candles.length < 5) {
    return analysis;
  }
  
  const candles = candleData.candles;
  // Candles are newest first, reverse for calculations
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  
  const closes = sorted.map(c => c.close);
  const opens = sorted.map(c => c.open);
  const highs = sorted.map(c => c.high);
  const lows = sorted.map(c => c.low);
  const volumes = sorted.map(c => c.volume);
  
  // ===== MOVING AVERAGES =====
  const sma5 = calculateSMA(closes, 5);
  const sma10 = calculateSMA(closes, 10);
  const sma20 = calculateSMA(closes, 20);
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  
  const currentPrice = closes[closes.length - 1];
  
  // Trend from MAs
  if (currentPrice > sma5 && sma5 > sma10 && sma10 > sma20) {
    analysis.trend = 'strong_bullish';
    analysis.strength = 80;
  } else if (currentPrice > sma5 && sma5 > sma10) {
    analysis.trend = 'bullish';
    analysis.strength = 60;
  } else if (currentPrice < sma5 && sma5 < sma10 && sma10 < sma20) {
    analysis.trend = 'strong_bearish';
    analysis.strength = -80;
  } else if (currentPrice < sma5 && sma5 < sma10) {
    analysis.trend = 'bearish';
    analysis.strength = -60;
  } else {
    analysis.trend = 'sideways';
    analysis.strength = 0;
  }
  
  // ===== MACD =====
  if (ema12 && ema26) {
    const macdLine = ema12 - ema26;
    analysis.macd = {
      line: macdLine,
      signal: macdLine > 0 ? 'bullish' : 'bearish'
    };
  }
  
  // ===== SUPPORT & RESISTANCE =====
  const recentLows = lows.slice(-15);
  const recentHighs = highs.slice(-15);
  analysis.support = Math.min(...recentLows);
  analysis.resistance = Math.max(...recentHighs);
  
  // Find more precise S/R levels using price clusters
  const supportLevels = findSupportResistanceLevels(sorted, 'support');
  const resistanceLevels = findSupportResistanceLevels(sorted, 'resistance');
  if (supportLevels.length) analysis.support = supportLevels[0];
  if (resistanceLevels.length) analysis.resistance = resistanceLevels[0];
  
  // ===== RSI (14-period) =====
  analysis.rsi = calculateRSI(closes, 14);
  
  // ===== BOLLINGER BANDS =====
  const bb = calculateBollingerBands(closes, 20);
  if (bb) {
    analysis.bollingerBands = bb;
    // Check for squeeze
    const bandWidth = (bb.upper - bb.lower) / bb.middle;
    if (bandWidth < 0.1) analysis.patterns.push('BOLLINGER_SQUEEZE');
  }
  
  // ===== VOLATILITY (ATR-like) =====
  const ranges = sorted.slice(-10).map(c => (c.high - c.low) / c.close * 100);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  if (avgRange > 10) analysis.volatility = 'extreme';
  else if (avgRange > 6) analysis.volatility = 'high';
  else if (avgRange > 3) analysis.volatility = 'medium';
  else analysis.volatility = 'low';
  
  // ============================================================
  // PATTERN DETECTION - 25+ patterns
  // ============================================================
  
  const last = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const prev2 = sorted.length >= 3 ? sorted[sorted.length - 3] : null;
  const prev3 = sorted.length >= 4 ? sorted[sorted.length - 4] : null;
  
  // Helper functions for candle analysis
  const bodySize = (c) => Math.abs(c.close - c.open);
  const candleRange = (c) => c.high - c.low;
  const upperWick = (c) => c.high - Math.max(c.open, c.close);
  const lowerWick = (c) => Math.min(c.open, c.close) - c.low;
  const isBullish = (c) => c.close > c.open;
  const isBearish = (c) => c.close < c.open;
  const avgBody = sorted.slice(-10).reduce((a, c) => a + bodySize(c), 0) / 10;
  
  // ===== SINGLE CANDLE PATTERNS =====
  
  // Doji - very small body
  if (bodySize(last) < candleRange(last) * 0.1 && candleRange(last) > 0) {
    if (lowerWick(last) > upperWick(last) * 2) {
      analysis.patterns.push('DRAGONFLY_DOJI');
    } else if (upperWick(last) > lowerWick(last) * 2) {
      analysis.patterns.push('GRAVESTONE_DOJI');
    } else {
      analysis.patterns.push('DOJI');
    }
  }
  
  // Spinning Top - small body with long wicks on both sides
  if (bodySize(last) < candleRange(last) * 0.3 && 
      upperWick(last) > bodySize(last) && 
      lowerWick(last) > bodySize(last)) {
    analysis.patterns.push('SPINNING_TOP');
  }
  
  // Hammer (bullish reversal) - small body at top, long lower wick
  if (lowerWick(last) > bodySize(last) * 2 && 
      upperWick(last) < bodySize(last) * 0.5 &&
      analysis.trend.includes('bearish')) {
    analysis.patterns.push('HAMMER');
  }
  
  // Inverted Hammer - small body at bottom, long upper wick
  if (upperWick(last) > bodySize(last) * 2 && 
      lowerWick(last) < bodySize(last) * 0.5 &&
      analysis.trend.includes('bearish')) {
    analysis.patterns.push('INVERTED_HAMMER');
  }
  
  // Hanging Man (bearish) - hammer at top of uptrend
  if (lowerWick(last) > bodySize(last) * 2 && 
      upperWick(last) < bodySize(last) * 0.5 &&
      analysis.trend.includes('bullish')) {
    analysis.patterns.push('HANGING_MAN');
  }
  
  // Shooting Star (bearish reversal) - inverted hammer at top
  if (upperWick(last) > bodySize(last) * 2 && 
      lowerWick(last) < bodySize(last) * 0.5 &&
      analysis.trend.includes('bullish')) {
    analysis.patterns.push('SHOOTING_STAR');
  }
  
  // Marubozu - full body candle with almost no wicks
  if (candleRange(last) > 0 && 
      upperWick(last) < candleRange(last) * 0.05 && 
      lowerWick(last) < candleRange(last) * 0.05) {
    if (isBullish(last)) {
      analysis.patterns.push('MARUBOZU_BULL');
    } else {
      analysis.patterns.push('MARUBOZU_BEAR');
    }
  }
  
  // ===== TWO CANDLE PATTERNS =====
  if (prev) {
    // Bullish Engulfing
    if (isBearish(prev) && isBullish(last) && 
        last.close > prev.open && last.open < prev.close &&
        bodySize(last) > bodySize(prev)) {
      analysis.patterns.push('BULLISH_ENGULFING');
    }
    
    // Bearish Engulfing
    if (isBullish(prev) && isBearish(last) && 
        last.close < prev.open && last.open > prev.close &&
        bodySize(last) > bodySize(prev)) {
      analysis.patterns.push('BEARISH_ENGULFING');
    }
    
    // Bullish Harami - small bullish inside previous large bearish
    if (isBearish(prev) && isBullish(last) &&
        last.open > prev.close && last.close < prev.open &&
        bodySize(last) < bodySize(prev) * 0.5) {
      analysis.patterns.push('BULLISH_HARAMI');
    }
    
    // Bearish Harami - small bearish inside previous large bullish
    if (isBullish(prev) && isBearish(last) &&
        last.open < prev.close && last.close > prev.open &&
        bodySize(last) < bodySize(prev) * 0.5) {
      analysis.patterns.push('BEARISH_HARAMI');
    }
    
    // Piercing Line (bullish)
    if (isBearish(prev) && isBullish(last) &&
        last.open < prev.low &&
        last.close > prev.open - (prev.open - prev.close) / 2 &&
        last.close < prev.open) {
      analysis.patterns.push('PIERCING_LINE');
    }
    
    // Dark Cloud Cover (bearish)
    if (isBullish(prev) && isBearish(last) &&
        last.open > prev.high &&
        last.close < prev.close + (prev.close - prev.open) / 2 &&
        last.close > prev.open) {
      analysis.patterns.push('DARK_CLOUD_COVER');
    }
    
    // Tweezer Bottom - two candles with same low
    if (Math.abs(prev.low - last.low) / prev.low < 0.005 &&
        isBearish(prev) && isBullish(last)) {
      analysis.patterns.push('TWEEZER_BOTTOM');
    }
    
    // Tweezer Top - two candles with same high
    if (Math.abs(prev.high - last.high) / prev.high < 0.005 &&
        isBullish(prev) && isBearish(last)) {
      analysis.patterns.push('TWEEZER_TOP');
    }
  }
  
  // ===== THREE CANDLE PATTERNS =====
  if (prev && prev2) {
    // Morning Star (bullish reversal)
    if (isBearish(prev2) && bodySize(prev2) > avgBody &&
        bodySize(prev) < avgBody * 0.3 && // Small middle candle
        isBullish(last) && bodySize(last) > avgBody &&
        last.close > (prev2.open + prev2.close) / 2) {
      analysis.patterns.push('MORNING_STAR');
    }
    
    // Evening Star (bearish reversal)
    if (isBullish(prev2) && bodySize(prev2) > avgBody &&
        bodySize(prev) < avgBody * 0.3 && // Small middle candle
        isBearish(last) && bodySize(last) > avgBody &&
        last.close < (prev2.open + prev2.close) / 2) {
      analysis.patterns.push('EVENING_STAR');
    }
    
    // Three White Soldiers (bullish continuation)
    if (isBullish(prev2) && isBullish(prev) && isBullish(last) &&
        prev.close > prev2.close && last.close > prev.close &&
        prev.open > prev2.open && last.open > prev.open &&
        bodySize(prev2) > avgBody * 0.5 && 
        bodySize(prev) > avgBody * 0.5 && 
        bodySize(last) > avgBody * 0.5) {
      analysis.patterns.push('THREE_WHITE_SOLDIERS');
    }
    
    // Three Black Crows (bearish continuation)
    if (isBearish(prev2) && isBearish(prev) && isBearish(last) &&
        prev.close < prev2.close && last.close < prev.close &&
        prev.open < prev2.open && last.open < prev.open &&
        bodySize(prev2) > avgBody * 0.5 && 
        bodySize(prev) > avgBody * 0.5 && 
        bodySize(last) > avgBody * 0.5) {
      analysis.patterns.push('THREE_BLACK_CROWS');
    }
    
    // Three Inside Up (bullish)
    if (isBearish(prev2) && 
        isBullish(prev) && prev.open > prev2.close && prev.close < prev2.open &&
        isBullish(last) && last.close > prev2.open) {
      analysis.patterns.push('THREE_INSIDE_UP');
    }
    
    // Three Inside Down (bearish)
    if (isBullish(prev2) && 
        isBearish(prev) && prev.open < prev2.close && prev.close > prev2.open &&
        isBearish(last) && last.close < prev2.open) {
      analysis.patterns.push('THREE_INSIDE_DOWN');
    }
  }
  
  // ===== TREND PATTERNS (need more candles) =====
  const last5 = sorted.slice(-5);
  const last10 = sorted.slice(-10);
  
  // Higher highs and higher lows (uptrend confirmation)
  if (last5.length >= 4) {
    const highs5 = last5.map(c => c.high);
    const lows5 = last5.map(c => c.low);
    let higherHighs = true, higherLows = true;
    for (let i = 1; i < highs5.length; i++) {
      if (highs5[i] <= highs5[i-1]) higherHighs = false;
      if (lows5[i] <= lows5[i-1]) higherLows = false;
    }
    if (higherHighs && higherLows) analysis.patterns.push('HIGHER_HIGHS_LOWS');
  }
  
  // Lower highs and lower lows (downtrend confirmation)
  if (last5.length >= 4) {
    const highs5 = last5.map(c => c.high);
    const lows5 = last5.map(c => c.low);
    let lowerHighs = true, lowerLows = true;
    for (let i = 1; i < highs5.length; i++) {
      if (highs5[i] >= highs5[i-1]) lowerHighs = false;
      if (lows5[i] >= lows5[i-1]) lowerLows = false;
    }
    if (lowerHighs && lowerLows) analysis.patterns.push('LOWER_HIGHS_LOWS');
  }
  
  // Double Bottom
  if (last10.length >= 8) {
    const lowPrices = last10.map(c => c.low);
    const minIdx1 = findLocalMinima(lowPrices);
    if (minIdx1.length >= 2) {
      const [i1, i2] = minIdx1.slice(-2);
      if (Math.abs(lowPrices[i1] - lowPrices[i2]) / lowPrices[i1] < 0.02 && // Similar lows
          i2 - i1 >= 3) { // Some distance between
        analysis.patterns.push('DOUBLE_BOTTOM');
      }
    }
  }
  
  // Double Top
  if (last10.length >= 8) {
    const highPrices = last10.map(c => c.high);
    const maxIdx = findLocalMaxima(highPrices);
    if (maxIdx.length >= 2) {
      const [i1, i2] = maxIdx.slice(-2);
      if (Math.abs(highPrices[i1] - highPrices[i2]) / highPrices[i1] < 0.02 && 
          i2 - i1 >= 3) {
        analysis.patterns.push('DOUBLE_TOP');
      }
    }
  }
  
  // ===== VOLUME PATTERNS =====
  if (volumes.length >= 5) {
    const avgVol = volumes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
    const currVol = volumes[volumes.length - 1];
    
    if (currVol > avgVol * 2.5) {
      analysis.patterns.push('VOLUME_SPIKE');
      
      // Volume climax (exhaustion)
      if (isBullish(last) && currVol > avgVol * 4) {
        analysis.patterns.push('VOLUME_CLIMAX_UP');
      } else if (isBearish(last) && currVol > avgVol * 4) {
        analysis.patterns.push('VOLUME_CLIMAX_DOWN');
      }
    }
    
    // Volume breakout - price breaks resistance with volume
    if (currVol > avgVol * 2 && last.close > analysis.resistance * 0.98) {
      analysis.patterns.push('VOLUME_BREAKOUT');
    }
  }
  
  // ===== SUPPORT/RESISTANCE PATTERNS =====
  const distToSupport = (currentPrice - analysis.support) / currentPrice * 100;
  const distToResistance = (analysis.resistance - currentPrice) / currentPrice * 100;
  
  if (distToSupport < 2 && analysis.trend !== 'strong_bearish') {
    analysis.patterns.push('NEAR_SUPPORT');
    // Check for bounce
    if (prev && last.low <= analysis.support * 1.01 && last.close > last.open) {
      analysis.patterns.push('SUPPORT_BOUNCE');
    }
  }
  
  if (distToResistance < 2) {
    analysis.patterns.push('NEAR_RESISTANCE');
    // Check for rejection
    if (prev && last.high >= analysis.resistance * 0.99 && last.close < last.open) {
      analysis.patterns.push('RESISTANCE_REJECT');
    }
  }
  
  // Breakouts
  if (currentPrice > analysis.resistance && prev && prev.close <= analysis.resistance) {
    analysis.patterns.push('BREAKOUT_ABOVE_RESISTANCE');
  }
  if (currentPrice < analysis.support && prev && prev.close >= analysis.support) {
    analysis.patterns.push('BREAKDOWN_BELOW_SUPPORT');
  }
  
  // Store computed values
  analysis.sma5 = sma5;
  analysis.sma10 = sma10;
  analysis.sma20 = sma20;
  analysis.ema12 = ema12;
  analysis.ema26 = ema26;
  analysis.currentPrice = currentPrice;
  analysis.avgRange = Math.round(avgRange * 100) / 100;
  
  return analysis;
}

// ============================================================================
// TECHNICAL INDICATOR CALCULATIONS
// ============================================================================
function calculateSMA(data, period) {
  if (data.length < period) return data.reduce((a, b) => a + b, 0) / data.length;
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

function calculateBollingerBands(data, period = 20) {
  if (data.length < period) return null;
  
  const slice = data.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  return {
    upper: sma + (stdDev * 2),
    middle: sma,
    lower: sma - (stdDev * 2)
  };
}

function findSupportResistanceLevels(candles, type) {
  const prices = type === 'support' 
    ? candles.map(c => c.low) 
    : candles.map(c => c.high);
  
  // Simple clustering approach
  const sorted = [...prices].sort((a, b) => a - b);
  const levels = [];
  let cluster = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] - cluster[cluster.length - 1]) / cluster[0] < 0.02) {
      cluster.push(sorted[i]);
    } else {
      if (cluster.length >= 2) {
        levels.push(cluster.reduce((a, b) => a + b, 0) / cluster.length);
      }
      cluster = [sorted[i]];
    }
  }
  if (cluster.length >= 2) {
    levels.push(cluster.reduce((a, b) => a + b, 0) / cluster.length);
  }
  
  return type === 'support' ? levels.slice(0, 3) : levels.slice(-3).reverse();
}

function findLocalMinima(arr) {
  const minima = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] < arr[i-1] && arr[i] < arr[i+1]) {
      minima.push(i);
    }
  }
  return minima;
}

function findLocalMaxima(arr) {
  const maxima = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > arr[i-1] && arr[i] > arr[i+1]) {
      maxima.push(i);
    }
  }
  return maxima;
}

// ============================================================================
// DEXSCREENER ANALYSIS
// ============================================================================
function analyzeWithDexScreener(dexData, pumpData) {
  const signals = [];
  const analysis = {
    trend: 'unknown',
    momentum: 0,
    volatility: 'unknown',
    buyPressure: 0,
    signals: []
  };
  
  if (!dexData || dexData.error) {
    return analysis;
  }
  
  const pc = dexData.priceChange || {};
  const txns = dexData.txns || {};
  
  const change5m = pc.m5 || 0;
  const change1h = pc.h1 || 0;
  const change6h = pc.h6 || 0;
  const change24h = pc.h24 || 0;
  
  analysis.momentum = (change5m * 0.4) + (change1h * 0.35) + (change6h * 0.15) + (change24h * 0.1);
  analysis.change5m = change5m;
  analysis.change1h = change1h;
  analysis.change6h = change6h;
  analysis.change24h = change24h;
  
  // Buy/sell pressure
  const h1Buys = txns.h1?.buys || 0;
  const h1Sells = txns.h1?.sells || 0;
  const h1Total = h1Buys + h1Sells;
  const h6Buys = txns.h6?.buys || 0;
  const h6Sells = txns.h6?.sells || 0;
  const h6Total = h6Buys + h6Sells;
  
  if (h1Total > 0) {
    analysis.buyPressure = Math.round((h1Buys / h1Total) * 100);
  } else if (h6Total > 0) {
    analysis.buyPressure = Math.round((h6Buys / h6Total) * 100);
  }
  
  analysis.h1Buys = h1Buys;
  analysis.h1Sells = h1Sells;
  analysis.h6Buys = h6Buys;
  analysis.h6Sells = h6Sells;
  
  // Generate signals from DEXScreener data
  if (change5m > 10 && change1h > 5) signals.push('MOMENTUM_BREAKOUT');
  if (change5m < -3 && change5m > -10 && change1h > 5 && change6h > 0) signals.push('PULLBACK_ENTRY');
  if (change5m > 15 || (change5m > 10 && change1h > 15)) signals.push('OVEREXTENDED');
  if (change5m < -15 && change1h < -10) signals.push('CAPITULATION');
  if (change5m < -10 && change1h > 0) signals.push('SHARP_DIP');
  
  if (analysis.buyPressure > 65 && h1Total >= 10) signals.push('ACCUMULATION');
  if (analysis.buyPressure < 35 && h1Total >= 10) signals.push('DISTRIBUTION');
  if (h1Total >= 20) signals.push('HIGH_ACTIVITY');
  if (h1Total < 5 && h6Total < 20) signals.push('LOW_ACTIVITY');
  
  // Whale detection (large single transactions)
  const vol1h = dexData.volume?.h1 || 0;
  const vol6h = dexData.volume?.h6 || 0;
  
  if (vol1h > 0 && h1Total > 0) {
    const avgTxSize = vol1h / h1Total;
    if (avgTxSize > 100) { // Large avg transaction
      if (h1Buys > h1Sells) signals.push('WHALE_BUY');
      else if (h1Sells > h1Buys * 1.5) signals.push('WHALE_SELL');
    }
  }
  
  if (vol1h > vol6h / 3 && vol1h > 500) signals.push('VOLUME_SURGE');
  
  analysis.signals = signals;
  analysis.volume1h = vol1h;
  analysis.volume6h = vol6h;
  analysis.volume24h = dexData.volume?.h24 || 0;
  
  return analysis;
}

// ============================================================================
// RECOMMENDATION GENERATION (with auto-tuned weights)
// ============================================================================
function generateRecommendation(pumpData, dexAnalysis, candleAnalysis) {
  const tuning = loadTuningData();
  const weights = tuning.weights;
  const config = tuning.config;
  
  let score = 50;
  const reasons = [];
  const warnings = [];
  
  const mcap = dexAnalysis.marketCap || pumpData?.usd_market_cap || 0;
  const isComplete = pumpData?.complete || false;
  const isLive = pumpData?.is_currently_live !== false;
  
  // Instant disqualifiers
  if (isComplete) {
    return { action: 'SKIP', confidence: 100, reasons: ['Token graduated to Raydium'], warnings: [] };
  }
  if (!isLive && pumpData) {
    return { action: 'SKIP', confidence: 90, reasons: ['Token not actively trading'], warnings: [] };
  }
  if (mcap > 0 && mcap < config.minMarketCap) {
    return { action: 'SKIP', confidence: 80, reasons: [`Market cap too low ($${mcap.toFixed(0)})`], warnings: [] };
  }
  
  // Market cap scoring
  if (mcap > config.maxMarketCap) {
    score -= 15;
    warnings.push(`High market cap - graduation risk`);
  } else if (mcap >= config.idealMinMcap && mcap <= config.idealMaxMcap) {
    score += 8;
    reasons.push('Good market cap range');
  }
  
  // === CANDLESTICK ANALYSIS SCORING (auto-tuned) ===
  if (candleAnalysis && candleAnalysis.trend !== 'unknown') {
    // Trend scoring
    const trendWeight = weights.trends[candleAnalysis.trend] || 0;
    score += trendWeight;
    if (trendWeight > 10) reasons.push(`${candleAnalysis.trend.replace('_', ' ')} trend`);
    else if (trendWeight < -10) warnings.push(`${candleAnalysis.trend.replace('_', ' ')} trend`);
    
    // RSI scoring
    if (candleAnalysis.rsi < 30) {
      score += weights.rsi.oversold;
      reasons.push(`Oversold (RSI: ${candleAnalysis.rsi})`);
    } else if (candleAnalysis.rsi > 70) {
      score += weights.rsi.overbought;
      warnings.push(`Overbought (RSI: ${candleAnalysis.rsi})`);
    }
    
    // Pattern scoring (auto-tuned weights)
    const patterns = candleAnalysis.patterns || [];
    for (const pattern of patterns) {
      const patternConfig = weights.patterns[pattern];
      if (patternConfig) {
        score += patternConfig.weight;
        if (patternConfig.weight > 5) {
          reasons.push(`${pattern.replace(/_/g, ' ').toLowerCase()}`);
        } else if (patternConfig.weight < -5) {
          warnings.push(`${pattern.replace(/_/g, ' ').toLowerCase()}`);
        }
      }
    }
  }
  
  // === DEXSCREENER SIGNAL SCORING (auto-tuned) ===
  const dexSignals = dexAnalysis.signals || [];
  
  // Momentum base scoring
  const momentum = dexAnalysis.momentum || 0;
  if (momentum > 10) score += 8;
  else if (momentum > 5) score += 4;
  else if (momentum < -10) score -= 8;
  
  // Signal scoring (auto-tuned weights)
  for (const signal of dexSignals) {
    const signalConfig = weights.signals[signal];
    if (signalConfig) {
      score += signalConfig.weight;
      if (signalConfig.weight > 5) {
        if (signal === 'ACCUMULATION') {
          reasons.push(`Accumulation (${dexAnalysis.buyPressure}% buys)`);
        } else {
          reasons.push(signal.replace(/_/g, ' ').toLowerCase());
        }
      } else if (signalConfig.weight < -5) {
        if (signal === 'DISTRIBUTION') {
          warnings.push(`Distribution (${100 - dexAnalysis.buyPressure}% sells)`);
        } else {
          warnings.push(signal.replace(/_/g, ' ').toLowerCase());
        }
      }
    }
  }
  
  // Community scoring
  const replies = pumpData?.reply_count || 0;
  if (replies > 100) { score += 4; reasons.push(`Active community (${replies})`); }
  else if (replies < 10 && pumpData) { warnings.push('Low engagement'); }
  
  // Determine action using auto-tuned thresholds
  let action = 'WATCH';
  let confidence = Math.min(100, Math.max(0, score));
  
  if (score >= config.minConfidenceForBuy) action = 'BUY';
  else if (score >= config.minConfidenceForWatch) action = 'WATCH';
  else if (score < 40) action = 'AVOID';
  
  // Position sizing based on confidence
  const volCategory = candleAnalysis?.volatility || dexAnalysis.volatility || 'medium';
  const targets = config.targets[volCategory] || config.targets.medium;
  
  let positionSize = config.positionSizes.low;
  if (confidence >= 75) positionSize = config.positionSizes.high;
  else if (confidence >= 60) positionSize = config.positionSizes.medium;
  
  return {
    action,
    confidence,
    score,
    positionSize,
    takeProfit: `+${Math.round(targets.takeProfit * 100)}%`,
    stopLoss: `-${Math.round(targets.stopLoss * 100)}%`,
    reasons: reasons.slice(0, 5),
    warnings: warnings.slice(0, 5),
    tuningApplied: tuning.stats.totalTrades > 0
  };
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================
async function analyzeToken(mint, quick = false) {
  console.error(`[analyze] Analyzing ${mint}...`);
  
  // Fetch data from multiple sources
  const pumpData = getPumpfunData(mint);
  const dexData = getDexScreenerData(mint);
  
  // Get candlestick data (unless quick mode)
  let candleData = null;
  let candleAnalysis = null;
  if (!quick) {
    candleData = getCandleData(mint, '5m', 50);
    candleAnalysis = analyzeCandlesticks(candleData);
  }
  
  // Analyze DEXScreener data
  const dexAnalysis = analyzeWithDexScreener(dexData, pumpData);
  dexAnalysis.marketCap = dexData?.marketCap || dexData?.fdv || pumpData?.usd_market_cap || 0;
  
  // Generate recommendation combining all analyses
  const recommendation = generateRecommendation(pumpData, dexAnalysis, candleAnalysis);
  
  const tuning = loadTuningData();
  
  const result = {
    mint,
    name: dexData?.name || pumpData?.name || 'Unknown',
    symbol: dexData?.symbol || pumpData?.symbol || '???',
    marketCap: Math.round(dexAnalysis.marketCap),
    priceUsd: dexData?.priceUsd || 0,
    isLive: pumpData?.is_currently_live !== false,
    complete: pumpData?.complete || false,
    analysis: {
      momentum: Math.round((dexAnalysis.momentum || 0) * 10) / 10,
      priceChange: {
        m5: dexAnalysis.change5m || 0,
        h1: dexAnalysis.change1h || 0,
        h6: dexAnalysis.change6h || 0,
        h24: dexAnalysis.change24h || 0
      },
      buyPressure: dexAnalysis.buyPressure,
      txns: {
        h1: { buys: dexAnalysis.h1Buys, sells: dexAnalysis.h1Sells },
        h6: { buys: dexAnalysis.h6Buys, sells: dexAnalysis.h6Sells }
      },
      volume: {
        h1: Math.round(dexAnalysis.volume1h || 0),
        h6: Math.round(dexAnalysis.volume6h || 0),
        h24: Math.round(dexAnalysis.volume24h || 0)
      },
      signals: dexAnalysis.signals
    },
    recommendation,
    autoTuning: {
      enabled: true,
      tradesRecorded: tuning.stats.totalTrades,
      winRate: tuning.stats.totalTrades > 0 
        ? Math.round((tuning.stats.wins / tuning.stats.totalTrades) * 100) + '%'
        : 'N/A'
    },
    sources: {
      dexscreener: !dexData?.error,
      pumpfun: !pumpData?.error,
      candles: !candleData?.error && candleData?.candles?.length > 0
    }
  };
  
  // Add technical analysis if we have candles
  if (candleAnalysis && candleAnalysis.trend !== 'unknown') {
    result.technical = {
      trend: candleAnalysis.trend,
      strength: candleAnalysis.strength,
      rsi: candleAnalysis.rsi,
      volatility: candleAnalysis.volatility,
      support: candleAnalysis.support,
      resistance: candleAnalysis.resistance,
      patterns: candleAnalysis.patterns,
      sma: {
        sma5: candleAnalysis.sma5,
        sma10: candleAnalysis.sma10,
        sma20: candleAnalysis.sma20
      },
      macd: candleAnalysis.macd,
      bollingerBands: candleAnalysis.bollingerBands
    };
  }
  
  return result;
}

// ============================================================================
// SCANNING FUNCTION
// ============================================================================
async function scanTrending(limit = 15) {
  console.error(`[analyze] Scanning top ${limit} trending tokens...`);
  
  // Use fast native HTTP (no shell spawn) to stay within OpenClaw's tool timeout
  const trending = await fetchTrendingFast(limit);
  if (!trending || !Array.isArray(trending)) {
    // Fallback to shell script if native fetch fails
    console.error(`[analyze] Fast fetch failed, trying shell fallback...`);
    const fallback = runScript('pumpfun-trending.sh', [limit.toString()]);
    if (!fallback || fallback.error || !Array.isArray(fallback)) {
      return { error: 'Failed to fetch trending tokens' };
    }
    return scanTrendingWithData(fallback);
  }
  
  return scanTrendingWithData(trending);
}

async function scanTrendingWithData(trending) {
  const tuning = loadTuningData();
  const config = tuning.config;
  const opportunities = [];
  const analyzed = [];
  
  // Pre-filter tokens before any API calls
  const candidates = trending.filter(token => {
    if (token.complete) return false;
    if (!token.is_currently_live) return false;
    const mcap = token.usd_market_cap || 0;
    if (mcap < config.minMarketCap || mcap > config.maxMarketCap) return false;
    return true;
  });
  
  console.error(`[analyze] ${candidates.length} tokens pass pre-filter, fetching DexScreener data in batch...`);
  
  // Batch fetch ALL DexScreener data in a single native HTTP call (no shell spawn)
  const candidateMints = candidates.map(t => t.mint);
  const dexDataMap = candidateMints.length > 0 ? await fetchDexScreenerBatchFast(candidateMints) : {};
  
  console.error(`[analyze] Got DexScreener data for ${Object.keys(dexDataMap).length} tokens, analyzing...`);
  
  for (const token of candidates) {
    try {
      // Use pre-fetched batch data instead of per-token API calls
      const dexData = dexDataMap[token.mint] || null;
      const dexAnalysis = analyzeWithDexScreener(dexData, token);
      const mcap = token.usd_market_cap || 0;
      dexAnalysis.marketCap = dexData?.marketCap || mcap;
      
      const recommendation = generateRecommendation(token, dexAnalysis, null);
      analyzed.push(token.symbol);
      
      if (recommendation.action === 'BUY' || 
          (recommendation.action === 'WATCH' && recommendation.confidence >= 58)) {
        opportunities.push({
          mint: token.mint,
          name: token.name,
          symbol: token.symbol,
          marketCap: Math.round(mcap),
          priceUsd: dexData?.priceUsd || 0,
          action: recommendation.action,
          confidence: recommendation.confidence,
          momentum: Math.round((dexAnalysis.momentum || 0) * 10) / 10,
          buyPressure: dexAnalysis.buyPressure,
          signals: dexAnalysis.signals.slice(0, 3),
          reasons: recommendation.reasons.slice(0, 2),
          warnings: recommendation.warnings.slice(0, 2),
          priceChange1h: dexAnalysis.change1h || 0
        });
      }
    } catch (e) {
      console.error(`[analyze] Error analyzing ${token.mint}: ${e.message}`);
    }
  }
  
  opportunities.sort((a, b) => b.confidence - a.confidence);
  
  // Fetch RSI in parallel for top candidates (up to 3, ~1-2s total)
  const topOpps = opportunities.slice(0, 5);
  if (topOpps.length > 0) {
    console.error(`[analyze] Fetching RSI for top ${Math.min(topOpps.length, 3)} candidates...`);
    const rsiMap = await fetchBatchRSIFast(topOpps, dexDataMap);
    for (const opp of topOpps) {
      if (rsiMap[opp.mint] !== undefined) {
        opp.rsi = rsiMap[opp.mint];
      }
    }
    console.error(`[analyze] RSI data obtained for ${Object.keys(rsiMap).length} candidates`);
  }
  
  return {
    scanned: candidates.length,
    analyzed: analyzed.length,
    opportunities: topOpps,
    autoTuning: {
      tradesRecorded: tuning.stats.totalTrades,
      buyThreshold: config.minConfidenceForBuy
    },
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// MAIN CLI
// ============================================================================
const [,, command, ...args] = process.argv;

(async () => {
  let result;
  
  if (command === 'scan') {
    result = await scanTrending(parseInt(args[0]) || 15);
  } else if (command === 'record') {
    // Record trade entry: record <mint> <action> <entryPrice>
    const [mint, action, entryPrice] = args;
    if (!mint || !action || !entryPrice) {
      console.log('Usage: pumpfun-analyze.js record <mint> <BUY|SELL> <entryPrice>');
      process.exit(1);
    }
    // Get current analysis to record patterns/signals
    const analysis = await analyzeToken(mint, true);
    result = recordTradeEntry(mint, action, entryPrice, analysis);
  } else if (command === 'outcome') {
    // Record trade outcome: outcome <tradeId> <win|loss> <exitPrice>
    const [tradeId, outcomeResult, exitPrice] = args;
    if (!tradeId || !outcomeResult || !exitPrice) {
      console.log('Usage: pumpfun-analyze.js outcome <tradeId> <win|loss> <exitPrice>');
      process.exit(1);
    }
    result = recordTradeOutcome(tradeId, outcomeResult, exitPrice);
  } else if (command === 'stats') {
    result = getStats();
  } else if (command === 'reset-tuning') {
    result = resetTuning();
  } else if (command && command !== '--help' && !command.startsWith('-')) {
    const mint = command;
    const quick = args.includes('--quick');
    result = await analyzeToken(mint, quick);
  } else {
    console.log(`
Token Analysis Tool with AUTO-TUNING
25+ Candlestick Patterns | GeckoTerminal + DEXScreener + Pump.fun

ANALYSIS:
  pumpfun-analyze.js <mint>           - Full analysis with candlesticks
  pumpfun-analyze.js <mint> --quick   - Quick analysis (no candles)
  pumpfun-analyze.js scan [limit]     - Scan trending for opportunities

AUTO-TUNING (learns from your trades):
  pumpfun-analyze.js record <mint> BUY <price>    - Record trade entry
  pumpfun-analyze.js outcome <id> win|loss <price> - Record trade result
  pumpfun-analyze.js stats                        - View pattern performance
  pumpfun-analyze.js reset-tuning                 - Reset to defaults

PATTERNS DETECTED:
  Single: doji, dragonfly/gravestone doji, hammer, inverted hammer,
          hanging man, shooting star, spinning top, marubozu
  Double: engulfing, harami, piercing line, dark cloud, tweezers
  Triple: morning/evening star, three soldiers/crows, three inside
  Trend:  higher/lower highs & lows, double top/bottom
  Volume: spike, climax, breakout
  S/R:    near support/resistance, bounce, rejection, breakouts

HOW AUTO-TUNING WORKS:
  1. Record each trade when you enter: record <mint> BUY <price>
  2. When trade closes: outcome <tradeId> win|loss <exitPrice>
  3. System adjusts pattern/signal weights based on win rates
  4. Confidence thresholds auto-adjust based on overall performance
  5. View what's working: stats

Example:
  pumpfun-analyze.js Fair6H9PemSWV5V5LxhnN8qNyP66aa8FdJWRqBxcpump
  pumpfun-analyze.js record Fair6H... BUY 0.000025
  pumpfun-analyze.js outcome 1 win 0.000032
`);
    process.exit(0);
  }
  
  console.log(JSON.stringify(result, null, 2));
})();
