class ExitEngine {
  evaluate(position, context) {
    const { candle, market, config, now } = context;
    const price = candle.close;
    const pnlPct = position.side === 'LONG'
      ? (price - position.entryPrice) / position.entryPrice
      : (position.entryPrice - price) / position.entryPrice;
    const ageMinutes = (now - position.openedAt) / 60000;

    let trailingDistance = market.atr * config.atrMultipliers.trailingBase;
    if (pnlPct > 0.02) trailingDistance = market.atr * config.atrMultipliers.trailingTight;
    if (market.mode === 'VOLATILE') trailingDistance *= 0.8;

    const nextTrailing = position.side === 'LONG'
      ? Math.max(position.trailingStop || -Infinity, price - trailingDistance)
      : Math.min(position.trailingStop || Infinity, price + trailingDistance);

    const smartExit = position.side === 'LONG' ? market.ema50 < market.ema200 : market.ema50 > market.ema200;
    const flipSignal = smartExit && Math.abs(market.ema50 - market.ema200) / candle.close > 0.002;
    const timeExit = ageMinutes >= config.timeExitMinutes && pnlPct < 0.003;

    let action = null;
    if (!position.tp1Hit) {
      const tp1Reached = position.side === 'LONG' ? price >= position.tp1 : price <= position.tp1;
      if (tp1Reached) action = { type: 'PARTIAL_TP', fraction: 0.5, reason: 'TP1 reached' };
    }

    const stopHit = position.side === 'LONG' ? price <= position.stopLoss : price >= position.stopLoss;
    const trailingHit = position.trailingStop && (position.side === 'LONG' ? price <= nextTrailing : price >= nextTrailing);

    if (!action && stopHit) action = { type: 'CLOSE', reason: 'ATR stop loss' };
    if (!action && trailingHit) action = { type: 'CLOSE', reason: 'Trailing stop' };
    if (!action && timeExit) action = { type: 'CLOSE', reason: 'Time-based exit' };
    if (!action && smartExit) action = { type: 'CLOSE', reason: 'Trend invalidation' };
    if (!action && flipSignal) action = { type: 'FLIP', reason: 'Strong opposite signal' };

    return {
      action,
      nextTrailing,
      pnlPct,
      ageMinutes
    };
  }
}

module.exports = { ExitEngine };
