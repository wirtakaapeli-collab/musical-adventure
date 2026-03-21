class EntryEngine {
  evaluate({ pair, candles, market, profile }) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const distanceFromEma50 = Math.abs(last.close - market.ema50) / market.ema50;
    const pullbackExists = market.trendDirection === 'LONG' ? last.close <= market.ema50 * 1.01 : last.close >= market.ema50 * 0.99;
    const trendConfirmed = market.trendDirection === 'LONG' ? market.ema50 > market.ema200 && last.close > market.ema200 : market.ema50 < market.ema200 && last.close < market.ema200;
    const candleConfirmation = market.trendDirection === 'LONG'
      ? last.close > last.open && last.close > prev.high * 0.995
      : last.close < last.open && last.close < prev.low * 1.005;
    const volumeSpike = last.volume > avgVolume * 1.2;
    const volatilityHealthy = market.mode === 'VOLATILE' ? market.atrPct < 0.035 : market.atrPct > 0.003;

    const scoreBreakdown = {
      trend: trendConfirmed ? 30 : 0,
      pullback: pullbackExists && distanceFromEma50 <= 0.018 ? 25 : 0,
      volumeSpike: volumeSpike ? 20 : 8,
      candleConfirmation: candleConfirmation ? 15 : 0,
      volatility: volatilityHealthy ? 10 : 0
    };

    const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);

    return {
      pair,
      direction: market.trendDirection,
      score,
      scoreBreakdown,
      pullbackExists,
      trendConfirmed,
      candleConfirmation,
      volumeSpike,
      shouldEnter: trendConfirmed && pullbackExists && candleConfirmation && score >= profile.threshold,
      reason: `score=${score} threshold=${profile.threshold} trend=${trendConfirmed} pullback=${pullbackExists} candle=${candleConfirmation}`,
      context: {
        distanceFromEma50,
        avgVolume
      }
    };
  }
}

module.exports = { EntryEngine };
