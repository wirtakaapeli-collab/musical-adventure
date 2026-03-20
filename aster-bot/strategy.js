import { atr, ema, rsi, sma } from './indicators.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function analyzeMarket(candles, config, adaptiveMinConfidence) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const ema8 = ema(closes, 8);
  const ema21 = ema(closes, 21);
  const ema48 = ema(closes, 48);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const volumeSma = sma(volumes, 20);

  const idx = candles.length - 1;
  const price = closes[idx];
  const latest = {
    ema8: ema8[idx],
    ema21: ema21[idx],
    ema48: ema48[idx],
    rsi: rsi14[idx],
    atr: atr14[idx],
    volumeAvg: volumeSma[idx],
    price,
  };

  if (Object.values(latest).some((value) => value === undefined || Number.isNaN(value))) {
    return { action: 'HOLD', confidence: 0, reasons: ['Not enough market data'], filters: { pass: false } };
  }

  const trendUp = latest.ema8 > latest.ema21 && latest.ema21 > latest.ema48;
  const trendDown = latest.ema8 < latest.ema21 && latest.ema21 < latest.ema48;
  const emaSpread = Math.abs(latest.ema8 - latest.ema48) / price;
  const atrPct = latest.atr / price;
  const volumeRatio = latest.volumeAvg > 0 ? candles[idx].volume / latest.volumeAvg : 0;
  const momentumLong = latest.rsi >= 52 && latest.rsi <= 68;
  const momentumShort = latest.rsi <= 48 && latest.rsi >= 32;
  const rsiExtreme = latest.rsi >= 74 || latest.rsi <= 26;
  const sideways = atrPct < config.sidewaysAtrThreshold || emaSpread < 0.0015;

  const direction = trendUp ? 'LONG' : trendDown ? 'SHORT' : 'HOLD';
  const trendScore = trendUp || trendDown ? clamp((emaSpread / 0.01) * 35, 0, 35) : 0;
  const momentumScore = direction === 'LONG'
    ? (momentumLong ? clamp((latest.rsi - 50) * 1.6, 0, 25) : 0)
    : direction === 'SHORT'
      ? (momentumShort ? clamp((50 - latest.rsi) * 1.6, 0, 25) : 0)
      : 0;
  const volumeScore = clamp(volumeRatio * 20, 0, 20);
  const volatilityScore = atrPct > config.sidewaysAtrThreshold && atrPct < 0.03 ? 20 : atrPct >= 0.03 ? 5 : 0;

  const confidence = Math.round(trendScore + momentumScore + volumeScore + volatilityScore);
  const reasons = [];

  reasons.push(`Trend ${direction} | EMA spread ${(emaSpread * 100).toFixed(2)}%`);
  reasons.push(`RSI ${latest.rsi.toFixed(2)} | ${direction === 'LONG' ? 'long' : 'short'} momentum ${direction === 'LONG' ? momentumLong : momentumShort}`);
  reasons.push(`Volume ratio ${volumeRatio.toFixed(2)}x`);
  reasons.push(`ATR ${(atrPct * 100).toFixed(2)}% of price`);

  const filters = {
    pass: true,
    minimumConfidence: confidence >= adaptiveMinConfidence,
    notSideways: !sideways,
    notExtremeRsi: !rsiExtreme,
    strongVolume: volumeRatio >= 0.9,
    hasDirection: direction !== 'HOLD',
  };

  if (!filters.minimumConfidence) reasons.push(`Rejected: confidence ${confidence} < threshold ${adaptiveMinConfidence}`);
  if (!filters.notSideways) reasons.push('Rejected: sideways / weak trend conditions');
  if (!filters.notExtremeRsi) reasons.push('Rejected: RSI extreme, likely late entry');
  if (!filters.strongVolume) reasons.push('Rejected: weak volume confirmation');
  if (!filters.hasDirection) reasons.push('Rejected: no clear directional bias');

  filters.pass = Object.values(filters).every((value) => value === true);

  return {
    action: filters.pass ? direction : 'HOLD',
    confidence,
    reasons,
    filters,
    metrics: {
      ...latest,
      emaSpread,
      atrPct,
      volumeRatio,
      sideways,
      direction,
    },
  };
}
