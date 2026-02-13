#!/usr/bin/env node
'use strict';

// Market analysis for nad.fun tokens
// Usage:
//   nadfun-analyze.js <token_address>     - Full analysis of a specific token
//   nadfun-analyze.js scan [limit]         - Scan for trading opportunities
//
// Data sources:
//   - nad.fun Agent API: chart, metrics, market data, swap history
//   - On-chain: bonding curve state, graduation status

const path = require('path');
const https = require('https');
const {
  MONAD_CONFIG, getPublicClient, lensAbi, curveAbi, viem,
} = require(path.join(__dirname, '..', '..', 'monad', 'scripts', 'monad-common.js'));

const API_URL = MONAD_CONFIG.apiUrl;
const API_KEY = process.env.NAD_API_KEY || '';

// --- HTTP helper ---
function apiGet(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_URL);
    const headers = {};
    if (API_KEY) headers['X-API-Key'] = API_KEY;

    https.get(url.toString(), { headers, timeout: 12000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null))
      .on('timeout', function() { this.destroy(); resolve(null); });
  });
}

// --- Analysis helpers ---

function analyzeCandles(candles) {
  if (!candles || !candles.t || candles.t.length < 5) {
    return { trend: 'unknown', strength: 0, patterns: [], rsi: 50 };
  }

  const closes = candles.c;
  const highs = candles.h;
  const lows = candles.l;
  const volumes = candles.v;
  const len = closes.length;

  // Trend detection
  let upMoves = 0, downMoves = 0;
  for (let i = Math.max(0, len - 10); i < len - 1; i++) {
    if (closes[i + 1] > closes[i]) upMoves++;
    else downMoves++;
  }
  const trend = upMoves > downMoves + 2 ? 'bullish' : downMoves > upMoves + 2 ? 'bearish' : 'neutral';
  const strength = Math.abs(upMoves - downMoves) * 10;

  // Simple RSI (14 period or available)
  const period = Math.min(14, len - 1);
  let gains = 0, losses = 0;
  for (let i = len - period; i < len; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  // Price change
  const priceNow = closes[len - 1];
  const price5 = len >= 5 ? closes[len - 5] : priceNow;
  const price10 = len >= 10 ? closes[len - 10] : priceNow;
  const change5 = price5 > 0 ? ((priceNow - price5) / price5 * 100) : 0;
  const change10 = price10 > 0 ? ((priceNow - price10) / price10 * 100) : 0;

  // Volume trend
  const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const olderVol = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-10, -5).length);
  const volumeTrend = olderVol > 0 ? recentVol / olderVol : 1;

  // Patterns
  const patterns = [];
  if (len >= 3) {
    const c0 = closes[len - 1], c1 = closes[len - 2], c2 = closes[len - 3];
    const o0 = candles.o[len - 1], o1 = candles.o[len - 2];
    const h0 = highs[len - 1], l0 = lows[len - 1];
    const body0 = Math.abs(c0 - o0);
    const range0 = h0 - l0;

    // Doji
    if (range0 > 0 && body0 / range0 < 0.1) patterns.push('DOJI');
    // Hammer
    if (c0 > o0 && (o0 - l0) > body0 * 2 && (h0 - c0) < body0 * 0.3) patterns.push('HAMMER');
    // Bullish engulfing
    if (c1 < o1 && c0 > o0 && c0 > o1 && o0 < c1) patterns.push('BULLISH_ENGULFING');
    // Bearish engulfing
    if (c1 > o1 && c0 < o0 && c0 < o1 && o0 > c1) patterns.push('BEARISH_ENGULFING');
    // Higher highs and lows
    if (c0 > c1 && c1 > c2 && lows[len-1] > lows[len-2]) patterns.push('HIGHER_HIGHS_LOWS');
    // Lower highs and lows
    if (c0 < c1 && c1 < c2 && highs[len-1] < highs[len-2]) patterns.push('LOWER_HIGHS_LOWS');
  }

  // Volume patterns
  if (volumeTrend > 2) patterns.push('VOLUME_SPIKE');
  if (volumeTrend > 3 && trend === 'bullish') patterns.push('VOLUME_BREAKOUT');

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

function calculateConfidence(technical, market, metrics) {
  let score = 50; // Base

  // Trend
  if (technical.trend === 'bullish') score += 10;
  if (technical.trend === 'bearish') score -= 15;

  // RSI
  if (technical.rsi > 30 && technical.rsi < 65) score += 5; // Healthy range
  if (technical.rsi < 30) score += 8; // Oversold = opportunity
  if (technical.rsi > 70) score -= 10; // Overbought

  // Momentum
  if (technical.priceChange5 > 0 && technical.priceChange5 < 20) score += 8;
  if (technical.priceChange5 > 20) score -= 5; // Overextended
  if (technical.priceChange5 < -10) score -= 8;

  // Volume
  if (technical.volumeTrend > 1.5) score += 5;
  if (technical.volumeTrend > 3) score += 5;

  // Patterns
  const bullishPatterns = ['HAMMER', 'BULLISH_ENGULFING', 'HIGHER_HIGHS_LOWS', 'VOLUME_BREAKOUT'];
  const bearishPatterns = ['BEARISH_ENGULFING', 'LOWER_HIGHS_LOWS'];
  for (const p of technical.patterns) {
    if (bullishPatterns.includes(p)) score += 5;
    if (bearishPatterns.includes(p)) score -= 5;
  }

  // Market data
  if (market) {
    // Holder count (more holders = more stable)
    if (market.holder_count > 50) score += 3;
    if (market.holder_count > 200) score += 3;
    // Volume
    if (market.volume && parseFloat(market.volume) > 100) score += 3;
  }

  // Metrics
  if (metrics && metrics.length > 0) {
    const m1h = metrics.find(m => m.timeframe === '60' || m.timeframe === 60);
    if (m1h) {
      if (m1h.transactions > 20) score += 5;
      if (m1h.percent > 5) score += 3;
      if (m1h.percent < -10) score -= 5;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function generateRecommendation(confidence, technical) {
  let action;
  if (confidence >= 72) action = 'BUY';
  else if (confidence >= 55) action = 'WATCH';
  else if (confidence >= 40) action = 'AVOID';
  else action = 'SKIP';

  // Override for strong bearish
  if (technical.trend === 'bearish' && technical.rsi > 70) action = 'AVOID';

  let positionSize = 0;
  if (action === 'BUY') {
    positionSize = confidence >= 75 ? 0.1 : 0.07;
  }

  return {
    action,
    confidence,
    positionSize,
    takeProfit: '+15%',
    stopLoss: '-10%',
    signals: technical.patterns,
  };
}

// --- Main analysis ---

async function analyzeToken(tokenAddress) {
  // Fetch data in parallel
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3600; // Last hour

  const [chartData, marketData, metricsData, swapData] = await Promise.all([
    apiGet(`/agent/chart/${tokenAddress}?resolution=5&from=${from}&to=${now}`),
    apiGet(`/agent/market/${tokenAddress}`),
    apiGet(`/agent/metrics/${tokenAddress}?timeframes=5,60,1D`),
    apiGet(`/agent/swap-history/${tokenAddress}?limit=20`),
  ]);

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
  } catch {}

  // Skip graduated or locked tokens
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

  // Analyze chart data
  const technical = analyzeCandles(chartData);

  // Market info
  const market = marketData?.market_info || null;
  const metrics = metricsData?.metrics || [];

  // Swap analysis
  let buyPressure = 50;
  if (swapData?.swaps && swapData.swaps.length > 0) {
    const buys = swapData.swaps.filter(s => s.swap_info?.event_type === 'BUY').length;
    const sells = swapData.swaps.filter(s => s.swap_info?.event_type === 'SELL').length;
    const total = buys + sells;
    buyPressure = total > 0 ? Math.round(buys / total * 100) : 50;
  }

  // Calculate confidence
  const confidence = calculateConfidence(technical, market, metrics);
  const recommendation = generateRecommendation(confidence, technical);

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

async function scanTokens(limit = 15) {
  // Fetch trending/recent tokens from nad.fun
  // Use the swap history to find recently active tokens
  const recentTokens = new Set();

  // Strategy: get recent swap history across the platform
  // We'll look at multiple approaches to find active tokens

  // Approach 1: Check for recently created tokens via the API
  // nad.fun doesn't have a direct "trending" endpoint like pump.fun,
  // so we query the indexer for recent CurveCreate events
  const publicClient = getPublicClient();

  let tokenAddresses = [];

  try {
    const latestBlock = await publicClient.getBlockNumber();
    // Look back ~30 minutes (~1800 blocks at 1 block/sec)
    const fromBlock = latestBlock - 1800n;

    const creates = await publicClient.getContractEvents({
      address: MONAD_CONFIG.CURVE,
      abi: curveAbi,
      eventName: 'CurveCreate',
      fromBlock,
      toBlock: latestBlock,
    });

    // Get token addresses from recent creates
    for (const event of creates.slice(-limit * 2)) {
      if (event.args && event.args.token) {
        recentTokens.add(event.args.token);
      }
    }

    // Also look for recently traded tokens via CurveBuy events
    const buys = await publicClient.getContractEvents({
      address: MONAD_CONFIG.CURVE,
      abi: curveAbi,
      eventName: 'CurveBuy',
      fromBlock: latestBlock - 600n, // Last ~10 min
      toBlock: latestBlock,
    });

    for (const event of buys) {
      if (event.args && event.args.token) {
        recentTokens.add(event.args.token);
      }
    }
  } catch (e) {
    console.error(`[nadfun-analyze] Error fetching on-chain events: ${e.message}`);
  }

  tokenAddresses = [...recentTokens].slice(0, limit);

  if (tokenAddresses.length === 0) {
    console.log(JSON.stringify({
      scan: true,
      tokens: [],
      message: 'No recently active tokens found',
    }));
    return;
  }

  // Analyze each token
  const results = [];
  for (const addr of tokenAddresses) {
    try {
      const analysis = await analyzeToken(addr);
      if (analysis.recommendation.action !== 'SKIP') {
        // Enrich with token info
        const tokenInfo = await apiGet(`/agent/token/${addr}`);
        if (tokenInfo?.token_info) {
          analysis.name = tokenInfo.token_info.name;
          analysis.symbol = tokenInfo.token_info.symbol;
        }
        results.push(analysis);
      }
    } catch {}
  }

  // Sort by confidence (highest first)
  results.sort((a, b) => b.recommendation.confidence - a.recommendation.confidence);

  console.log(JSON.stringify({
    scan: true,
    count: results.length,
    tokens: results.slice(0, limit),
  }, null, 2));
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(JSON.stringify({
      error: 'Usage: nadfun-analyze.js <token_address> | scan [limit]',
    }));
    process.exit(1);
  }

  try {
    if (args[0] === 'scan') {
      const limit = parseInt(args[1]) || 15;
      await scanTokens(limit);
    } else {
      const tokenAddress = args[0];
      if (!tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        console.log(JSON.stringify({ error: 'Invalid token address' }));
        process.exit(1);
      }

      // Enrich with token info
      const [analysis, tokenInfo] = await Promise.all([
        analyzeToken(tokenAddress),
        apiGet(`/agent/token/${tokenAddress}`),
      ]);

      if (tokenInfo?.token_info) {
        analysis.name = tokenInfo.token_info.name;
        analysis.symbol = tokenInfo.token_info.symbol;
        analysis.description = tokenInfo.token_info.description;
      }

      console.log(JSON.stringify(analysis, null, 2));
    }
  } catch (err) {
    console.log(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  }
}

main();
