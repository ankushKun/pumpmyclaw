# Trading Reference

This file contains detailed trading patterns and playbooks. Read it when you want deeper analysis guidance.

## Position Sizing

| Confidence | Size |
|------------|------|
| 75%+ | 0.005 SOL |
| 65-74% | 0.003 SOL |
| Below 65% | Do not trade |

## Speed Trading Targets

I am a speed trader. I take profits early and cut losses fast.

| Volatility | Take Profit | Stop Loss | Max Hold Time |
|------------|-------------|-----------|---------------|
| Low | +15% | -10% | 10 min |
| Medium | +20% | -10% | 8 min |
| High | +30% | -15% | 5 min |

If held longer than max hold time with no profit, SELL.

## Bullish Patterns (Buy Signals)

HAMMER, BULLISH_ENGULFING, MORNING_STAR, THREE_WHITE_SOLDIERS, DRAGONFLY_DOJI, PIERCING_LINE, TWEEZER_BOTTOM, DOUBLE_BOTTOM, SUPPORT_BOUNCE, BREAKOUT_ABOVE_RESISTANCE, VOLUME_BREAKOUT

## Bearish Patterns (Sell/Avoid Signals)

SHOOTING_STAR, BEARISH_ENGULFING, EVENING_STAR, THREE_BLACK_CROWS, HANGING_MAN, DARK_CLOUD_COVER, TWEEZER_TOP, DOUBLE_TOP, RESISTANCE_REJECT, BREAKDOWN_BELOW_SUPPORT, VOLUME_CLIMAX_UP

## Neutral Patterns (Wait for Confirmation)

DOJI, SPINNING_TOP, NEAR_SUPPORT, NEAR_RESISTANCE, BOLLINGER_SQUEEZE

## Trading Playbooks

### Reversal Entry (Highest Win Rate)
- Token in downtrend at support
- Patterns: HAMMER, BULLISH_ENGULFING, MORNING_STAR
- Signals: NEAR_SUPPORT, PULLBACK_ENTRY, RSI < 35
- Action: Buy with confidence-based position

### Continuation Entry
- Token in uptrend, consolidating
- Patterns: THREE_WHITE_SOLDIERS, HIGHER_HIGHS_LOWS
- Signals: ACCUMULATION (65%+ buy pressure), VOLUME_BREAKOUT
- Action: Medium position

### Volume Breakout
- Price breaking resistance with volume
- Patterns: BREAKOUT_ABOVE_RESISTANCE, VOLUME_BREAKOUT
- Signals: MOMENTUM_BREAKOUT, HIGH_ACTIVITY
- Action: Quick scalp

### Support Bounce
- Price at established support with bullish reaction
- Patterns: SUPPORT_BOUNCE, TWEEZER_BOTTOM, DOUBLE_BOTTOM
- Signals: RSI oversold + bullish candle
- Action: Buy at support, tight stop

## What to Avoid

1. OVEREXTENDED signal = chasing a pump, wait for pullback
2. RSI > 70 = overbought
3. CAPITULATION = panic selling, only enter if reversal pattern forms
4. LOW_ACTIVITY = no liquidity, cannot exit
5. complete: true = graduated to Raydium, cannot trade on pump.fun
6. Market cap > $60k = graduation risk
7. LOWER_HIGHS_LOWS = downtrend, do not fight it
8. Never hold more than 3 positions
9. Never revenge trade after a loss
