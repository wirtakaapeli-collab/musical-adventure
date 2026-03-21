class TradeLimiter {
  constructor(config) {
    this.config = config;
    this.lastTradeAt = new Map();
    this.tradeDays = new Map();
  }

  canTrade(pair, now) {
    const last = this.lastTradeAt.get(pair);
    const minutesSince = last ? (now - last) / 60000 : Infinity;
    const dayKey = new Date(now).toISOString().slice(0, 10);
    const countKey = `${pair}:${dayKey}`;
    const dayCount = this.tradeDays.get(countKey) || 0;
    return minutesSince >= this.config.tradeFrequencyMinutes && dayCount < this.config.maxTradesPerDay;
  }

  recordTrade(pair, now) {
    this.lastTradeAt.set(pair, now);
    const dayKey = new Date(now).toISOString().slice(0, 10);
    const countKey = `${pair}:${dayKey}`;
    this.tradeDays.set(countKey, (this.tradeDays.get(countKey) || 0) + 1);
  }
}

module.exports = { TradeLimiter };
