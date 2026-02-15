#!/usr/bin/env node
'use strict';

// Market analysis for nad.fun tokens
// WITH AUTO-TUNING and 25+ candlestick patterns
//
// Usage:
//   nadfun-analyze.js <token_address>     - Full analysis of a specific token
//   nadfun-analyze.js <token_address> --quick  - Quick analysis (skip candles)
//   nadfun-analyze.js scan [limit]         - Scan for trading opportunities
//   nadfun-analyze.js record <token> <action> <entryPrice> - Record a trade entry
//   nadfun-analyze.js outcome <tradeId> <result> <exitPrice> - Record trade outcome
//   nadfun-analyze.js stats               - Show pattern/signal performance stats
//   nadfun-analyze.js reset-tuning        - Reset auto-tuning to defaults
//
// Data sources:
//   - nad.fun Agent API: chart, metrics, market data, swap history
//   - On-chain: bonding curve state, graduation status

const path = require('path');
const fs = require('fs');
const https = require('https');
const {
  MONAD_CONFIG, getPublicClient, lensAbi, curveAbi, viem,
} = require(path.join(__dirname, '..', '..', 'monad', 'scripts', 'monad-common.js'));

const API_URL = MONAD_CONFIG.apiUrl;
const API_KEY = process.env.NAD_API_KEY || '';

const SCRIPTS_DIR = path.dirname(__filename);
const DATA_DIR = process.env.WORKSPACE_DIR || path.join(process.env.HOME || '/home/openclaw', '.openclaw', 'workspace');
const TUNING_FILE = path.join(DATA_DIR, 'monad-auto-tuning.json');
const TRADES_FILE = path.join(DATA_DIR, 'monad-trades-history.json');

// ============================================================================
// DEFAULT CONFIGURATION (will be overridden by auto-tuning)
// ============================================================================
const DEFAULT_CONFIG = {
  positionSizes: {
    high: 3.0,
    medium: 2.0,
    low: 1.0
  },
  targets: {
    low: { takeProfit: 0.15, stopLoss: 0.10 },
    medium: { takeProfit: 0.25, stopLoss: 0.12 },
    high: { takeProfit: 0.40, stopLoss: 0.15 }
  },
  minConfidenceForBuy: 65,
  minConfidenceForWatch: 55
};

// ============================================================================
// DEFAULT PATTERN/SIGNAL WEIGHTS (auto-tuned over time)
// ============================================================================
const DEFAULT_WEIGHTS = {
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
  },

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
    WHALE_SELL: { weight: -15, type: 'bearish' },
  },

  trends: {
    strong_bullish: 18,
    bullish: 12,
    sideways: 0,
    bearish: -14,
    strong_bearish: -22
  },

  rsi: {
    oversold: 10,
    neutral: 0,
    overbought: -10
  }
};

// ============================================================================
// AUTO-TUNING SYSTEM
// ============================================================================
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

function recordTradeEntry(token, action, entryPrice, analysis) {
  const tradesData = loadTrades();
  const tradeId = tradesData.nextId++;

  const trade = {
    id: tradeId,
    token,
    action,
    entryPrice: parseFloat(entryPrice),
    entryTime: new Date().toISOString(),
    patterns: analysis?.technical?.patterns || [],
    signals: analysis?.analysis?.signals || [],
    confidence: analysis?.recommendation?.confidence || 0,
    trend: analysis?.technical?.trend || 'unknown',
    rsiRange: getRsiRange(analysis?.technical?.rsi),
    outcome: null,
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

function recordTradeOutcome(tradeId, result, exitPrice) {
  const tradesData = loadTrades();
  const trade = tradesData.trades.find(t => t.id === parseInt(tradeId));
  if (!trade) return { error: `Trade #${tradeId} not found` };
  if (trade.outcome) return { error: `Trade #${tradeId} already has outcome: ${trade.outcome}` };

  trade.outcome = result.toLowerCase() === 'win' ? 'win' : 'loss';
  trade.exitPrice = parseFloat(exitPrice);
  trade.exitTime = new Date().toISOString();
  trade.pnlPercent = ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100;

  saveTrades(tradesData);
  updateTuningFromTrade(trade);

  return {
    trade,
    message: `Trade #${tradeId} closed as ${trade.outcome} (${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%). Tuning updated.`
  };
}

function updateTuningFromTrade(trade) {
  const tuning = loadTuningData();
  const isWin = trade.outcome === 'win';
  const adjustment = isWin ? 1 : -1;
  const adjustmentAmount = Math.min(Math.abs(trade.pnlPercent) / 10, 2);

  tuning.stats.totalTrades++;
  if (isWin) tuning.stats.wins++;
  else tuning.stats.losses++;

  for (const pattern of trade.patterns) {
    if (!tuning.stats.patterns[pattern]) {
      tuning.stats.patterns[pattern] = { wins: 0, losses: 0, totalPnl: 0 };
    }
    const ps = tuning.stats.patterns[pattern];
    if (isWin) ps.wins++;
    else ps.losses++;
    ps.totalPnl += trade.pnlPercent;

    if (tuning.weights.patterns[pattern]) {
      const currentWeight = tuning.weights.patterns[pattern].weight;
      const defaultWeight = DEFAULT_WEIGHTS.patterns[pattern]?.weight || 0;
      const winRate = ps.wins / (ps.wins + ps.losses);

      if (ps.wins + ps.losses >= 5) {
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

  for (const signal of trade.signals) {
    if (!tuning.stats.signals[signal]) {
      tuning.stats.signals[signal] = { wins: 0, losses: 0, totalPnl: 0 };
    }
    const ss = tuning.stats.signals[signal];
    if (isWin) ss.wins++;
    else ss.losses++;
    ss.totalPnl += trade.pnlPercent;

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

  if (tuning.stats.totalTrades >= 10) {
    const overallWinRate = tuning.stats.wins / tuning.stats.totalTrades;
    if (overallWinRate < 0.45) {
      tuning.config.minConfidenceForBuy = Math.min(tuning.config.minConfidenceForBuy + 1, 85);
    } else if (overallWinRate > 0.65) {
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

  return {
    chain: 'monad',
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
// HTTP HELPER
// ============================================================================
function apiGet(endpoint, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const url = new URL(endpoint, API_URL);
    const headers = {};
    if (API_KEY) headers['X-API-Key'] = API_KEY;

    https.get(url.toString(), { headers, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null))
      .on('timeout', function () { this.destroy(); resolve(null); });
  });
}

// ============================================================================
// CANDLESTICK PATTERN DETECTION (25+ patterns)
// ============================================================================
function detectPatterns(candles) {
  if (!candles || !candles.t || candles.t.length < 3) return [];

  const patterns = [];
  const len = candles.t.length;
  const o = candles.o, h = candles.h, l = candles.l, c = candles.c, v = candles.v;

  // Helpers
  const bodySize = (i) => Math.abs(c[i] - o[i]);
  const range = (i) => h[i] - l[i];
  const isBullish = (i) => c[i] > o[i];
  const isBearish = (i) => c[i] < o[i];
  const upperShadow = (i) => isBullish(i) ? h[i] - c[i] : h[i] - o[i];
  const lowerShadow = (i) => isBullish(i) ? o[i] - l[i] : c[i] - l[i];

  const i = len - 1; // current candle
  const i1 = len - 2; // previous
  const i2 = len - 3; // two back

  if (range(i) === 0) return patterns;

  const body = bodySize(i);
  const rng = range(i);

  // --- Single candle patterns ---
  // Doji
  if (body / rng < 0.1) {
    patterns.push('DOJI');
    // Dragonfly doji (long lower shadow, no upper)
    if (lowerShadow(i) > rng * 0.6 && upperShadow(i) < rng * 0.1) patterns.push('DRAGONFLY_DOJI');
    // Gravestone doji (long upper shadow, no lower)
    if (upperShadow(i) > rng * 0.6 && lowerShadow(i) < rng * 0.1) patterns.push('GRAVESTONE_DOJI');
  }

  // Hammer
  if (isBullish(i) && lowerShadow(i) > body * 2 && upperShadow(i) < body * 0.3 && body > 0) {
    patterns.push('HAMMER');
  }

  // Inverted Hammer
  if (isBullish(i) && upperShadow(i) > body * 2 && lowerShadow(i) < body * 0.3 && body > 0) {
    patterns.push('INVERTED_HAMMER');
  }

  // Hanging Man (same shape as hammer but in uptrend context)
  if (isBearish(i) && lowerShadow(i) > body * 2 && upperShadow(i) < body * 0.3 && body > 0) {
    if (c[i1] > c[i2]) patterns.push('HANGING_MAN');
  }

  // Shooting Star
  if (isBearish(i) && upperShadow(i) > body * 2 && lowerShadow(i) < body * 0.3 && body > 0) {
    patterns.push('SHOOTING_STAR');
  }

  // Spinning Top
  if (body / rng > 0.1 && body / rng < 0.3 && upperShadow(i) > body && lowerShadow(i) > body) {
    patterns.push('SPINNING_TOP');
  }

  // Marubozu (no shadows)
  if (body / rng > 0.9) {
    if (isBullish(i)) patterns.push('MARUBOZU_BULL');
    else patterns.push('MARUBOZU_BEAR');
  }

  // --- Two candle patterns ---
  if (len >= 2) {
    const body1 = bodySize(i1);

    // Bullish Engulfing
    if (isBearish(i1) && isBullish(i) && c[i] > o[i1] && o[i] < c[i1] && body > body1) {
      patterns.push('BULLISH_ENGULFING');
    }

    // Bearish Engulfing
    if (isBullish(i1) && isBearish(i) && c[i] < o[i1] && o[i] > c[i1] && body > body1) {
      patterns.push('BEARISH_ENGULFING');
    }

    // Bullish Harami
    if (isBearish(i1) && isBullish(i) && body < body1 && c[i] < o[i1] && o[i] > c[i1]) {
      patterns.push('BULLISH_HARAMI');
    }

    // Bearish Harami
    if (isBullish(i1) && isBearish(i) && body < body1 && c[i] > o[i1] && o[i] < c[i1]) {
      patterns.push('BEARISH_HARAMI');
    }

    // Piercing Line
    if (isBearish(i1) && isBullish(i) && o[i] < l[i1] && c[i] > (o[i1] + c[i1]) / 2) {
      patterns.push('PIERCING_LINE');
    }

    // Dark Cloud Cover
    if (isBullish(i1) && isBearish(i) && o[i] > h[i1] && c[i] < (o[i1] + c[i1]) / 2) {
      patterns.push('DARK_CLOUD_COVER');
    }

    // Tweezer Bottom
    if (Math.abs(l[i] - l[i1]) / rng < 0.05 && isBullish(i) && isBearish(i1)) {
      patterns.push('TWEEZER_BOTTOM');
    }

    // Tweezer Top
    if (Math.abs(h[i] - h[i1]) / rng < 0.05 && isBearish(i) && isBullish(i1)) {
      patterns.push('TWEEZER_TOP');
    }
  }

  // --- Three candle patterns ---
  if (len >= 3) {
    const body1 = bodySize(i1);
    const body2 = bodySize(i2);

    // Morning Star
    if (isBearish(i2) && body1 < body2 * 0.3 && isBullish(i) && c[i] > (o[i2] + c[i2]) / 2) {
      patterns.push('MORNING_STAR');
    }

    // Evening Star
    if (isBullish(i2) && body1 < body2 * 0.3 && isBearish(i) && c[i] < (o[i2] + c[i2]) / 2) {
      patterns.push('EVENING_STAR');
    }

    // Three White Soldiers
    if (isBullish(i2) && isBullish(i1) && isBullish(i) && c[i] > c[i1] && c[i1] > c[i2]) {
      patterns.push('THREE_WHITE_SOLDIERS');
    }

    // Three Black Crows
    if (isBearish(i2) && isBearish(i1) && isBearish(i) && c[i] < c[i1] && c[i1] < c[i2]) {
      patterns.push('THREE_BLACK_CROWS');
    }

    // Three Inside Up
    if (isBearish(i2) && isBullish(i1) && body1 < body2 && c[i1] < o[i2] && o[i1] > c[i2] && isBullish(i) && c[i] > o[i2]) {
      patterns.push('THREE_INSIDE_UP');
    }

    // Three Inside Down
    if (isBullish(i2) && isBearish(i1) && body1 < body2 && c[i1] > o[i2] && o[i1] < c[i2] && isBearish(i) && c[i] < o[i2]) {
      patterns.push('THREE_INSIDE_DOWN');
    }

    // Higher highs and lows
    if (c[i] > c[i1] && c[i1] > c[i2] && l[i] > l[i1] && l[i1] > l[i2]) {
      patterns.push('HIGHER_HIGHS_LOWS');
    }

    // Lower highs and lows
    if (c[i] < c[i1] && c[i1] < c[i2] && h[i] < h[i1] && h[i1] < h[i2]) {
      patterns.push('LOWER_HIGHS_LOWS');
    }
  }

  // --- Support/Resistance ---
  if (len >= 10) {
    const recentLows = l.slice(-10);
    const recentHighs = h.slice(-10);
    const minLow = Math.min(...recentLows);
    const maxHigh = Math.max(...recentHighs);
    const priceRange = maxHigh - minLow;

    if (priceRange > 0) {
      const nearSupportThreshold = minLow + priceRange * 0.15;
      const nearResistanceThreshold = maxHigh - priceRange * 0.15;

      if (c[i] <= nearSupportThreshold) {
        patterns.push('NEAR_SUPPORT');
        if (isBullish(i) && c[i] > o[i]) patterns.push('SUPPORT_BOUNCE');
      }
      if (c[i] >= nearResistanceThreshold) {
        patterns.push('NEAR_RESISTANCE');
        if (isBearish(i)) patterns.push('RESISTANCE_REJECT');
      }

      // Double bottom detection
      const lowPoints = [];
      for (let j = 2; j < len - 1; j++) {
        if (l[j] < l[j - 1] && l[j] < l[j + 1]) lowPoints.push({ idx: j, low: l[j] });
      }
      if (lowPoints.length >= 2) {
        const last2 = lowPoints.slice(-2);
        if (Math.abs(last2[0].low - last2[1].low) / priceRange < 0.05) {
          patterns.push('DOUBLE_BOTTOM');
        }
      }

      // Double top detection
      const highPoints = [];
      for (let j = 2; j < len - 1; j++) {
        if (h[j] > h[j - 1] && h[j] > h[j + 1]) highPoints.push({ idx: j, high: h[j] });
      }
      if (highPoints.length >= 2) {
        const last2 = highPoints.slice(-2);
        if (Math.abs(last2[0].high - last2[1].high) / priceRange < 0.05) {
          patterns.push('DOUBLE_TOP');
        }
      }
    }
  }

  // --- Volume patterns ---
  if (v && v.length >= 10) {
    const recentVol = v.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const olderVol = v.slice(-10, -3).reduce((a, b) => a + b, 0) / Math.max(1, v.slice(-10, -3).length);
    const volRatio = olderVol > 0 ? recentVol / olderVol : 1;

    if (volRatio > 2) patterns.push('VOLUME_SPIKE');
    if (volRatio > 3 && isBullish(i)) patterns.push('VOLUME_BREAKOUT');
    if (volRatio > 3 && c[i] > c[i1]) patterns.push('VOLUME_CLIMAX_UP');
    if (volRatio > 3 && c[i] < c[i1]) patterns.push('VOLUME_CLIMAX_DOWN');
  }

  return patterns;
}

// ============================================================================
// TECHNICAL ANALYSIS
// ============================================================================
function analyzeCandles(candles) {
  if (!candles || !candles.t || candles.t.length < 5) {
    return { trend: 'unknown', strength: 0, patterns: [], rsi: 50 };
  }

  const closes = candles.c;
  const len = closes.length;

  // Trend detection
  let upMoves = 0, downMoves = 0;
  for (let i = Math.max(0, len - 10); i < len - 1; i++) {
    if (closes[i + 1] > closes[i]) upMoves++;
    else downMoves++;
  }

  let trend;
  if (upMoves > downMoves + 3) trend = 'strong_bullish';
  else if (upMoves > downMoves + 1) trend = 'bullish';
  else if (downMoves > upMoves + 3) trend = 'strong_bearish';
  else if (downMoves > upMoves + 1) trend = 'bearish';
  else trend = 'sideways';

  const strength = Math.abs(upMoves - downMoves) * 10;

  // RSI with Wilder's smoothing
  const period = Math.min(14, len - 1);
  let avgGain = 0, avgLoss = 0;

  // Initial SMA for first period
  for (let i = len - period; i < len; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  // Apply Wilder's smoothing for remaining data
  for (let i = len - period; i < len; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  // Price changes
  const priceNow = closes[len - 1];
  const price5 = len >= 5 ? closes[len - 5] : priceNow;
  const price10 = len >= 10 ? closes[len - 10] : priceNow;
  const change5 = price5 > 0 ? ((priceNow - price5) / price5 * 100) : 0;
  const change10 = price10 > 0 ? ((priceNow - price10) / price10 * 100) : 0;

  // Volume trend
  const volumes = candles.v || [];
  const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-5).length);
  const olderVol = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-10, -5).length);
  const volumeTrend = olderVol > 0 ? recentVol / olderVol : 1;

  // Detect all patterns
  const patterns = detectPatterns(candles);

  return {
    trend,
    strength: Math.min(100, strength),
    rsi: Math.round(rsi),
    priceChange5: parseFloat(change5.toFixed(2)),
    priceChange10: parseFloat(change10.toFixed(2)),
    volumeTrend: parseFloat(volumeTrend.toFixed(2)),
    patterns,
    currentPrice: priceNow,
  };
}

// ============================================================================
// CONFIDENCE SCORING (with auto-tuned weights)
// ============================================================================
function calculateConfidence(technical, market, metrics, swapData) {
  const tuning = loadTuningData();
  const weights = tuning.weights;
  const config = tuning.config;

  let score = 50; // Base

  // Trend weight
  if (weights.trends[technical.trend] !== undefined) {
    score += weights.trends[technical.trend];
  }

  // RSI weight
  if (technical.rsi < 30) score += weights.rsi.oversold;
  else if (technical.rsi > 70) score += weights.rsi.overbought;
  else score += weights.rsi.neutral;

  // Pattern weights (auto-tuned)
  for (const pattern of technical.patterns) {
    if (weights.patterns[pattern]) {
      score += weights.patterns[pattern].weight;
    }
  }

  // Momentum signals
  const signals = [];
  if (technical.priceChange5 > 5 && technical.priceChange5 < 20 && technical.volumeTrend > 1.5) {
    signals.push('MOMENTUM_BREAKOUT');
  }
  if (technical.priceChange5 > -15 && technical.priceChange5 < -3 && technical.rsi < 40) {
    signals.push('PULLBACK_ENTRY');
  }
  if (technical.priceChange5 < -20 && technical.rsi < 25) {
    signals.push('SHARP_DIP');
  }
  if (technical.priceChange5 > 20) {
    signals.push('OVEREXTENDED');
  }
  if (technical.volumeTrend > 2.5) {
    signals.push('VOLUME_SURGE');
  }
  if (technical.volumeTrend < 0.3) {
    signals.push('LOW_ACTIVITY');
  }

  // Swap-based signals
  if (swapData?.swaps && swapData.swaps.length > 0) {
    const buys = swapData.swaps.filter(s => s.swap_info?.event_type === 'BUY');
    const sells = swapData.swaps.filter(s => s.swap_info?.event_type === 'SELL');
    const total = buys.length + sells.length;
    const buyPressure = total > 0 ? buys.length / total : 0.5;

    if (buyPressure > 0.65) signals.push('ACCUMULATION');
    if (buyPressure < 0.35) signals.push('DISTRIBUTION');

    // Whale detection
    const monAmounts = buys.map(s => parseFloat(s.swap_info?.mon_amount || '0'));
    const maxBuy = Math.max(0, ...monAmounts);
    if (maxBuy > 1.0) signals.push('WHALE_BUY');

    const sellAmounts = sells.map(s => parseFloat(s.swap_info?.mon_amount || '0'));
    const maxSell = Math.max(0, ...sellAmounts);
    if (maxSell > 1.0) signals.push('WHALE_SELL');

    if (total > 20) signals.push('HIGH_ACTIVITY');
  }

  // Apply signal weights
  for (const signal of signals) {
    if (weights.signals[signal]) {
      score += weights.signals[signal].weight;
    }
  }

  // Market data adjustments
  if (market) {
    if (market.holder_count > 50) score += 3;
    if (market.holder_count > 200) score += 3;
    if (market.volume && parseFloat(market.volume) > 100) score += 3;
  }

  // Metrics adjustments
  if (metrics && metrics.length > 0) {
    const m1h = metrics.find(m => m.timeframe === '60' || m.timeframe === 60);
    if (m1h) {
      if (m1h.transactions > 20) score += 5;
      if (m1h.percent > 5) score += 3;
      if (m1h.percent < -10) score -= 5;
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals,
    config
  };
}

function generateRecommendation(confidenceResult, technical) {
  const { score, signals, config } = confidenceResult;

  let action;
  if (score >= config.minConfidenceForBuy) action = 'BUY';
  else if (score >= config.minConfidenceForWatch) action = 'WATCH';
  else if (score >= 40) action = 'AVOID';
  else action = 'SKIP';

  // Override for strong bearish
  if (technical.trend === 'strong_bearish' || (technical.trend === 'bearish' && technical.rsi > 70)) {
    action = 'AVOID';
  }

  let positionSize = 0;
  if (action === 'BUY') {
    positionSize = score >= 75 ? config.positionSizes.high : config.positionSizes.medium;
  }

  return {
    action,
    confidence: score,
    positionSize,
    takeProfit: '+15%',
    stopLoss: '-10%',
    signals: [...technical.patterns, ...signals],
  };
}

// ============================================================================
// TOKEN ANALYSIS
// ============================================================================
async function analyzeToken(tokenAddress, quick = false) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3600;

  // Fetch data in parallel
  const promises = [
    apiGet(`/agent/market/${tokenAddress}`),
    apiGet(`/agent/metrics/${tokenAddress}?timeframes=5,60,1D`),
    apiGet(`/agent/swap-history/${tokenAddress}?limit=20`),
  ];
  if (!quick) {
    promises.push(apiGet(`/agent/chart/${tokenAddress}?resolution=5&from=${from}&to=${now}`));
  }

  const results = await Promise.all(promises);
  const [marketData, metricsData, swapData, chartData] = quick
    ? [...results, null]
    : results;

  // Check on-chain state
  const publicClient = getPublicClient();
  let graduated = false, locked = false, progress = 0;
  try {
    [graduated, locked] = await Promise.all([
      publicClient.readContract({ address: MONAD_CONFIG.CURVE, abi: curveAbi, functionName: 'isGraduated', args: [tokenAddress] }),
      publicClient.readContract({ address: MONAD_CONFIG.CURVE, abi: curveAbi, functionName: 'isLocked', args: [tokenAddress] }),
    ]);
    progress = Number(await publicClient.readContract({
      address: MONAD_CONFIG.LENS, abi: lensAbi, functionName: 'getProgress', args: [tokenAddress],
    })) / 100;
  } catch { }

  if (graduated) {
    return {
      token: tokenAddress,
      recommendation: { action: 'SKIP', confidence: 0, reason: 'Token graduated to DEX' },
      graduated: true,
    };
  }
  if (locked) {
    return {
      token: tokenAddress,
      recommendation: { action: 'SKIP', confidence: 0, reason: 'Bonding curve locked' },
      locked: true,
    };
  }

  // Analyze
  const technical = quick
    ? { trend: 'unknown', strength: 0, patterns: [], rsi: 50, priceChange5: 0, priceChange10: 0, volumeTrend: 1, currentPrice: 0 }
    : analyzeCandles(chartData);

  const market = marketData?.market_info || null;
  const metrics = metricsData?.metrics || [];

  // Confidence scoring
  const confidenceResult = calculateConfidence(technical, market, metrics, swapData);
  const recommendation = generateRecommendation(confidenceResult, technical);

  // Buy pressure
  let buyPressure = 50;
  if (swapData?.swaps && swapData.swaps.length > 0) {
    const buys = swapData.swaps.filter(s => s.swap_info?.event_type === 'BUY').length;
    const total = swapData.swaps.length;
    buyPressure = total > 0 ? Math.round(buys / total * 100) : 50;
  }

  return {
    token: tokenAddress,
    technical: {
      trend: technical.trend,
      strength: technical.strength,
      rsi: technical.rsi,
      priceChange5: technical.priceChange5,
      priceChange10: technical.priceChange10,
      volumeTrend: technical.volumeTrend,
      patterns: technical.patterns,
      currentPrice: technical.currentPrice,
    },
    market: market ? {
      priceUsd: market.price_usd,
      holderCount: market.holder_count,
      volume: market.volume,
      marketType: market.market_type,
    } : null,
    buyPressure,
    progress: progress.toFixed(1) + '%',
    recommendation,
  };
}

// ============================================================================
// SCAN — with retry and reduced block range for reliability
// ============================================================================
async function scanTokens(limit = 15) {
  const recentTokens = new Set();
  const publicClient = getPublicClient();

  // Try progressively smaller block ranges if larger ones fail (public RPC can reject large ranges)
  const blockRanges = [600, 300, 100]; // ~10min, ~5min, ~1.5min

  for (const blockRange of blockRanges) {
    try {
      const latestBlock = await publicClient.getBlockNumber();
      const fromBlock = latestBlock - BigInt(blockRange);

      // Fetch creates and buys in parallel
      const [creates, buys] = await Promise.all([
        publicClient.getContractEvents({
          address: MONAD_CONFIG.CURVE,
          abi: curveAbi,
          eventName: 'CurveCreate',
          fromBlock,
          toBlock: latestBlock,
        }).catch(() => []),
        publicClient.getContractEvents({
          address: MONAD_CONFIG.CURVE,
          abi: curveAbi,
          eventName: 'CurveBuy',
          fromBlock,
          toBlock: latestBlock,
        }).catch(() => []),
      ]);

      for (const event of creates.slice(-limit * 2)) {
        if (event.args?.token) recentTokens.add(event.args.token);
      }
      for (const event of buys) {
        if (event.args?.token) recentTokens.add(event.args.token);
      }

      if (recentTokens.size > 0) break; // Success — stop trying smaller ranges
      console.error(`[nadfun-analyze] No events in last ${blockRange} blocks, trying smaller range...`);
    } catch (e) {
      console.error(`[nadfun-analyze] Block range ${blockRange} failed: ${e.message}`);
    }
  }

  // Fallback: try nad.fun API if on-chain scan found nothing
  if (recentTokens.size === 0) {
    try {
      console.error('[nadfun-analyze] On-chain scan found nothing, trying API fallback...');
      const trending = await apiGet('/agent/trending?limit=20&sort=volume', 10000);
      if (trending?.tokens && Array.isArray(trending.tokens)) {
        for (const t of trending.tokens.slice(0, limit)) {
          if (t.token_info?.token_id) recentTokens.add(t.token_info.token_id);
        }
      }
    } catch (e) {
      console.error(`[nadfun-analyze] API fallback also failed: ${e.message}`);
    }
  }

  const tokenAddresses = [...recentTokens].slice(0, limit);

  if (tokenAddresses.length === 0) {
    console.log(JSON.stringify({
      scan: true,
      tokens: [],
      message: 'No recently active tokens found',
    }));
    return;
  }

  // Analyze tokens in parallel (batches of 5 to avoid overwhelming RPC)
  const results = [];
  const batchSize = 5;
  for (let i = 0; i < tokenAddresses.length; i += batchSize) {
    const batch = tokenAddresses.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (addr) => {
        const analysis = await analyzeToken(addr, false);
        if (analysis.recommendation.action === 'SKIP') return null;

        const tokenInfo = await apiGet(`/agent/token/${addr}`);
        if (tokenInfo?.token_info) {
          analysis.name = tokenInfo.token_info.name;
          analysis.symbol = tokenInfo.token_info.symbol;
        }
        return analysis;
      })
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }

  // Sort by confidence
  results.sort((a, b) => b.recommendation.confidence - a.recommendation.confidence);

  console.log(JSON.stringify({
    scan: true,
    count: results.length,
    tokens: results.slice(0, limit),
  }, null, 2));
}

// ============================================================================
// CLI
// ============================================================================
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(JSON.stringify({
      error: 'Usage: nadfun-analyze.js <token_address> | scan [limit] | record | outcome | stats | reset-tuning',
    }));
    process.exit(1);
  }

  try {
    const command = args[0];

    // Auto-tuning commands
    if (command === 'record') {
      if (args.length < 4) {
        console.log(JSON.stringify({ error: 'Usage: nadfun-analyze.js record <token> <action> <entryPrice>' }));
        process.exit(1);
      }
      const analysis = args.length > 4 ? null : await analyzeToken(args[1], true).catch(() => null);
      console.log(JSON.stringify(recordTradeEntry(args[1], args[2], args[3], analysis)));
      return;
    }

    if (command === 'outcome') {
      if (args.length < 4) {
        console.log(JSON.stringify({ error: 'Usage: nadfun-analyze.js outcome <tradeId> <win|loss> <exitPrice>' }));
        process.exit(1);
      }
      console.log(JSON.stringify(recordTradeOutcome(args[1], args[2], args[3])));
      return;
    }

    if (command === 'stats') {
      console.log(JSON.stringify(getStats(), null, 2));
      return;
    }

    if (command === 'reset-tuning') {
      console.log(JSON.stringify(resetTuning(), null, 2));
      return;
    }

    if (command === 'scan') {
      const limit = parseInt(args[1]) || 15;
      await scanTokens(limit);
      return;
    }

    // Token analysis
    const tokenAddress = command;
    if (!tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
      console.log(JSON.stringify({ error: 'Invalid token address' }));
      process.exit(1);
    }

    const quick = args.includes('--quick');
    const [analysis, tokenInfo] = await Promise.all([
      analyzeToken(tokenAddress, quick),
      apiGet(`/agent/token/${tokenAddress}`),
    ]);

    if (tokenInfo?.token_info) {
      analysis.name = tokenInfo.token_info.name;
      analysis.symbol = tokenInfo.token_info.symbol;
      analysis.description = tokenInfo.token_info.description;
    }

    console.log(JSON.stringify(analysis, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  }
}

main();
