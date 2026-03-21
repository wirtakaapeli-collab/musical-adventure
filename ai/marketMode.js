function ema(values, period) {
  const k = 2 / (period + 1);
  let current = values[0];
  for (let i = 1; i < values.length; i += 1) current = values[i] * k + current * (1 - k);
  return current;
}

function atr(candles, period = 14) {
  const sliced = candles.slice(-(period + 1));
  if (sliced.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < sliced.length; i += 1) {
    const candle = sliced[i];
    const prev = sliced[i - 1];
    trs.push(Math.max(candle.high - candle.low, Math.abs(candle.high - prev.close), Math.abs(candle.low - prev.close)));
  }
  return trs.reduce((sum, v) => sum + v, 0) / trs.length;
}

function stdDev(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

class MarketModeDetector {
  constructor(config) {
    this.config = config;
  }

  analyze(candles) {
    const closes = candles.map((c) => c.close);
    const last = closes[closes.length - 1];
    const ema50 = ema(closes.slice(-80), Math.min(50, closes.length));
    const ema200 = ema(closes.slice(-220), Math.min(200, closes.length));
    const currentAtr = atr(candles, 14);
    const returns = closes.slice(-this.config.marketMode.volatilityLookback).map((close, idx, arr) => idx === 0 ? 0 : (close - arr[idx - 1]) / arr[idx - 1]).slice(1);
    const volatility = returns.length ? stdDev(returns) : 0;
    const atrPct = currentAtr / last;
    const emaSpreadPct = Math.abs(ema50 - ema200) / last;

    let mode = 'SIDEWAYS';
    if (atrPct >= this.config.marketMode.atrVolatilePct || volatility >= this.config.marketMode.atrVolatilePct / 2) {
      mode = 'VOLATILE';
    } else if (emaSpreadPct >= this.config.marketMode.emaSpreadTrendingPct && atrPct > this.config.marketMode.atrSidewaysPct) {
      mode = 'TRENDING';
    }

    return {
      mode,
      ema50,
      ema200,
      atr: currentAtr,
      atrPct,
      volatility,
      emaSpreadPct,
      trendDirection: ema50 >= ema200 ? 'LONG' : 'SHORT'
    };
  }
}

module.exports = { MarketModeDetector, ema, atr };
