const EventEmitter = require('events');

class MarketFeed extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.interval = null;
    this.state = new Map();
    for (const pair of config.pairs) {
      const seed = config.pairsSeed[pair] || 100;
      const candles = this.bootstrapCandles(seed);
      this.state.set(pair, {
        pair,
        price: seed,
        candles,
        drift: Math.random() * 0.006 - 0.003,
        volatility: 0.004 + Math.random() * 0.018,
        volumeBase: 1000 + Math.random() * 3000,
        tick: 0
      });
    }
  }

  bootstrapCandles(seed) {
    const candles = [];
    let price = seed;
    for (let i = 0; i < 260; i += 1) {
      const drift = Math.sin(i / 15) * 0.001;
      const move = drift + (Math.random() - 0.5) * 0.01;
      const open = price;
      const close = Math.max(0.0001, price * (1 + move));
      const range = Math.abs(close - open) + price * (0.002 + Math.random() * 0.005);
      const high = Math.max(open, close) + range * 0.45;
      const low = Math.min(open, close) - range * 0.45;
      candles.push({
        open,
        high,
        low,
        close,
        volume: 900 + Math.random() * 2400,
        timestamp: Date.now() - (260 - i) * this.config.candleIntervalMs
      });
      price = close;
    }
    return candles;
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.generate(), this.config.candleIntervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  generate() {
    for (const pair of this.config.pairs) {
      const state = this.state.get(pair);
      state.tick += 1;
      if (state.tick % 30 === 0) {
        state.drift = Math.random() * 0.01 - 0.005;
        state.volatility = 0.004 + Math.random() * 0.022;
      }
      const prev = state.candles[state.candles.length - 1].close;
      const shock = (Math.random() - 0.5) * state.volatility;
      const trendPulse = Math.sin(state.tick / 12) * 0.0025 + state.drift;
      const close = Math.max(0.0001, prev * (1 + trendPulse + shock));
      const open = prev;
      const intrabar = prev * (0.001 + Math.random() * state.volatility * 1.4);
      const high = Math.max(open, close) + intrabar;
      const low = Math.min(open, close) - intrabar;
      const volumeSpike = Math.random() > 0.88 ? 2.1 : 1;
      const candle = {
        open,
        high,
        low,
        close,
        volume: state.volumeBase * (0.8 + Math.random() * 0.6) * volumeSpike,
        timestamp: Date.now()
      };
      state.price = close;
      state.candles.push(candle);
      if (state.candles.length > 500) state.candles.shift();
      this.emit('candle', { pair, candle, candles: [...state.candles] });
    }
  }
}

module.exports = { MarketFeed };
