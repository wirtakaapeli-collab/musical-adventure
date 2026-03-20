function roundStep(value, step) {
  if (!step || step <= 0) return value;
  return Math.floor(value / step) * step;
}

export function calculatePositionSize({ balance, riskPct, entryPrice, stopPrice, leverage, stepSize = 0.1, minQty = 0.1 }) {
  const riskAmount = balance * riskPct;
  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (stopDistance <= 0) {
    return 0;
  }
  const rawQty = (riskAmount / stopDistance) * leverage;
  const sized = roundStep(rawQty, stepSize);
  return sized >= minQty ? Number(sized.toFixed(8)) : 0;
}

export function buildTradePlan({ side, entryPrice, atrValue, balance, config, filters = {} }) {
  const stopDistance = atrValue * config.stopAtrMultiplier;
  const stopLoss = side === 'LONG' ? entryPrice - stopDistance : entryPrice + stopDistance;
  const takeProfit = side === 'LONG'
    ? entryPrice + (stopDistance * config.targetRiskReward)
    : entryPrice - (stopDistance * config.targetRiskReward);
  const quantity = calculatePositionSize({
    balance,
    riskPct: config.riskPerTrade,
    entryPrice,
    stopPrice: stopLoss,
    leverage: config.leverage,
    stepSize: filters.stepSize,
    minQty: filters.minQty,
  });

  return {
    side,
    entryPrice,
    stopLoss,
    takeProfit,
    quantity,
    riskReward: config.targetRiskReward,
    trailingOffset: atrValue * config.trailingStopMultiplier,
  };
}

export function shouldHaltTrading({ equity, startOfDayEquity, consecutiveLosses, config, cooldownUntil, now = Date.now() }) {
  const dailyDrawdown = startOfDayEquity > 0 ? (startOfDayEquity - equity) / startOfDayEquity : 0;
  if (dailyDrawdown >= config.maxDailyLoss) {
    return { halt: true, reason: `Daily loss limit breached: ${(dailyDrawdown * 100).toFixed(2)}%` };
  }
  if (consecutiveLosses >= config.maxConsecutiveLosses && cooldownUntil && now < cooldownUntil) {
    return { halt: true, reason: `Cooldown active after ${consecutiveLosses} consecutive losses` };
  }
  return { halt: false };
}
