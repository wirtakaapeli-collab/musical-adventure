function ema(values, period) {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    prev = ((values[i] - prev) * multiplier) + prev;
  }
  return prev;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const ranges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose),
    ));
  }
  const recent = ranges.slice(-period);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function macd(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  if (fast == null || slow == null) return null;
  return fast - slow;
}

function volumeBias(candles, period = 20) {
  if (candles.length < period) return null;
  const recent = candles.slice(-period);
  const avg = recent.reduce((sum, item) => sum + item.volume, 0) / recent.length;
  const last = recent[recent.length - 1].volume;
  return last / avg;
}

function evaluateStrategy(candles, settings) {
  const closes = candles.map((item) => item.close);
  const currentPrice = closes[closes.length - 1];
  const fastEma = ema(closes, 9);
  const mediumEma = ema(closes, 21);
  const slowEma = ema(closes, 55);
  const currentRsi = rsi(closes, 14);
  const currentAtr = atr(candles, 14);
  const currentMacd = macd(closes);
  const currentVolumeBias = volumeBias(candles, 20);

  if ([fastEma, mediumEma, slowEma, currentRsi, currentAtr, currentMacd, currentVolumeBias].some((value) => value == null)) {
    return {
      action: 'WAIT',
      score: 0,
      reasons: ['Not enough candle data for all indicators.'],
      indicators: {},
    };
  }

  const bullishTrend = fastEma > mediumEma && mediumEma > slowEma && currentPrice > fastEma;
  const bearishTrend = fastEma < mediumEma && mediumEma < slowEma && currentPrice < fastEma;
  const momentumLong = currentRsi > 54 && currentRsi < 72 && currentMacd > 0;
  const momentumShort = currentRsi < 46 && currentRsi > 28 && currentMacd < 0;
  const volatilityOkay = (currentAtr / currentPrice) > 0.0025;
  const volumeOkay = currentVolumeBias > 1.05;

  let longScore = 0;
  let shortScore = 0;
  const reasons = [];

  if (bullishTrend) {
    longScore += 40;
    reasons.push('Bullish EMA stack confirmed.');
  }
  if (bearishTrend) {
    shortScore += 40;
    reasons.push('Bearish EMA stack confirmed.');
  }
  if (momentumLong) {
    longScore += 30;
    reasons.push('RSI/MACD momentum supports long continuation.');
  }
  if (momentumShort) {
    shortScore += 30;
    reasons.push('RSI/MACD momentum supports short continuation.');
  }
  if (volatilityOkay) {
    longScore += 15;
    shortScore += 15;
    reasons.push('ATR volatility filter passed.');
  }
  if (volumeOkay) {
    longScore += 15;
    shortScore += 15;
    reasons.push('Volume expansion filter passed.');
  }

  const threshold = 70;
  const action = longScore >= threshold && longScore > shortScore
    ? 'BUY'
    : shortScore >= threshold && shortScore > longScore
      ? 'SELL'
      : 'WAIT';

  return {
    action,
    score: Math.max(longScore, shortScore),
    reasons,
    indicators: {
      price: currentPrice,
      ema9: fastEma,
      ema21: mediumEma,
      ema55: slowEma,
      rsi: currentRsi,
      atr: currentAtr,
      macd: currentMacd,
      volumeBias: currentVolumeBias,
      timeframe: settings.timeframe,
    },
  };
}

function buildRiskPlan(signal, indicators, wallet, settings) {
  if (signal.action === 'WAIT') return null;
  const price = indicators.price;
  const atrValue = indicators.atr;
  const capitalCap = Math.min(wallet.balance, settings.maxCapitalPerTrade);
  const quantity = Number((capitalCap / price).toFixed(6));
  const stopDistance = atrValue * settings.stopLossAtr;
  const takeDistance = atrValue * settings.takeProfitAtr;
  const trailDistance = atrValue * settings.trailingStopAtr;

  return {
    side: signal.action === 'BUY' ? 'long' : 'short',
    entryPrice: price,
    quantity,
    stopLoss: signal.action === 'BUY' ? price - stopDistance : price + stopDistance,
    takeProfit: signal.action === 'BUY' ? price + takeDistance : price - takeDistance,
    trailingStop: signal.action === 'BUY' ? price - trailDistance : price + trailDistance,
    allocatedCapital: Number((quantity * price).toFixed(2)),
  };
}

module.exports = {
  evaluateStrategy,
  buildRiskPlan,
};
