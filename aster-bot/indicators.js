function toNumber(value) {
  return Number.parseFloat(value);
}

export function ema(values, period) {
  if (values.length < period) {
    return [];
  }
  const multiplier = 2 / (period + 1);
  const result = [];
  let prev = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = (values[i] - prev) * multiplier + prev;
    result[i] = prev;
  }
  return result;
}

export function rsi(values, period = 14) {
  if (values.length <= period) {
    return [];
  }
  const result = [];
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = ((avgGain * (period - 1)) + Math.max(change, 0)) / period;
    avgLoss = ((avgLoss * (period - 1)) + Math.max(-change, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return result;
}

export function atr(candles, period = 14) {
  if (candles.length <= period) {
    return [];
  }
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) {
      return candle.high - candle.low;
    }
    const prevClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose),
    );
  });

  const result = [];
  let prevAtr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = prevAtr;

  for (let i = period; i < trueRanges.length; i += 1) {
    prevAtr = ((prevAtr * (period - 1)) + trueRanges[i]) / period;
    result[i] = prevAtr;
  }
  return result;
}

export function sma(values, period) {
  if (values.length < period) {
    return [];
  }
  const result = [];
  let sum = values.slice(0, period).reduce((acc, value) => acc + value, 0);
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i += 1) {
    sum += values[i] - values[i - period];
    result[i] = sum / period;
  }
  return result;
}

export function normalizeKlines(klines) {
  return klines.map((item) => ({
    openTime: Number(item[0]),
    open: toNumber(item[1]),
    high: toNumber(item[2]),
    low: toNumber(item[3]),
    close: toNumber(item[4]),
    volume: toNumber(item[5]),
    closeTime: Number(item[6]),
  }));
}
