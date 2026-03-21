class ReentryEngine {
  constructor() {
    this.stats = new Map();
  }

  recordClosedTrade(pair, trade) {
    const current = this.stats.get(pair) || { profitableTrendTrades: 0, reentries: 0 };
    if (trade.realizedPnl > 0) current.profitableTrendTrades += 1;
    this.stats.set(pair, current);
  }

  canReenter(pair, profile, config, closedTrade) {
    const state = this.stats.get(pair) || { profitableTrendTrades: 0, reentries: 0 };
    if (!config.reentry.enabled || !profile.allowReentry || !closedTrade) return false;
    const rMultiple = closedTrade.initialRisk ? closedTrade.realizedPnl / closedTrade.initialRisk : 0;
    return closedTrade.realizedPnl > 0
      && rMultiple >= config.reentry.minPreviousRMultiple
      && state.reentries < config.reentry.maxPerTrend;
  }

  markReentry(pair) {
    const state = this.stats.get(pair) || { profitableTrendTrades: 0, reentries: 0 };
    state.reentries += 1;
    this.stats.set(pair, state);
  }

  resetTrend(pair) {
    this.stats.set(pair, { profitableTrendTrades: 0, reentries: 0 });
  }
}

module.exports = { ReentryEngine };
