const EventEmitter = require('events');
const WebSocket = require('ws');

const REST_BASE_URL = 'https://fapi.asterdex.com';
const WS_MARKET_BASE_URL = 'wss://fstream.asterdex.com';

function safeParseNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function toStreamSymbol(symbol) {
  return normalizeSymbol(symbol).toLowerCase();
}

function normalizePrice(symbol, value, fallback = 0) {
  const parsed = safeParseNumber(value, fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (normalizeSymbol(symbol) === 'ASTERUSDT') return Number(parsed.toFixed(8));
  return parsed;
}

function normalizeCandle(symbol, raw, fallbackTimestamp = Date.now()) {
  if (!raw) return null;
  const candidate = Array.isArray(raw)
    ? { openTime: raw[0], open: raw[1], high: raw[2], low: raw[3], close: raw[4], volume: raw[5], closeTime: raw[6] }
    : raw;

  const open = normalizePrice(symbol, candidate.open, 0);
  const high = normalizePrice(symbol, candidate.high, open);
  const low = normalizePrice(symbol, candidate.low, open);
  const close = normalizePrice(symbol, candidate.close, open);
  const volume = safeParseNumber(candidate.volume, 0);
  const timestamp = safeParseNumber(candidate.closeTime || candidate.openTime || candidate.t || candidate.T, fallbackTimestamp);

  if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) return null;
  return { open, high, low, close, volume, timestamp };
}

class MarketFeed extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.interval = null;
    this.ws = null;
    this.usingLiveMarketData = false;
    this.state = new Map();

    for (const pair of config.pairs.map(normalizeSymbol)) {
      const seed = normalizePrice(pair, config.pairsSeed[pair] || 100, 100);
      const candles = this.bootstrapCandles(pair, seed);
      this.state.set(pair, {
        pair,
        price: seed,
        candles,
        drift: Math.random() * 0.006 - 0.003,
        volatility: 0.004 + Math.random() * 0.018,
        volumeBase: 1000 + Math.random() * 3000,
        tick: 0,
        source: 'SIMULATED'
      });
    }
  }

  bootstrapCandles(symbol, seed) {
    const candles = [];
    let price = seed;
    for (let i = 0; i < 260; i += 1) {
      const drift = Math.sin(i / 15) * 0.001;
      const move = drift + (Math.random() - 0.5) * 0.01;
      const open = price;
      const close = normalizePrice(symbol, price * (1 + move), 0.0001);
      const range = Math.abs(close - open) + price * (0.002 + Math.random() * 0.005);
      const high = normalizePrice(symbol, Math.max(open, close) + range * 0.45, close);
      const low = normalizePrice(symbol, Math.min(open, close) - range * 0.45, close);
      candles.push({
        open,
        high,
        low: Math.max(0.00000001, low),
        close,
        volume: 900 + Math.random() * 2400,
        timestamp: Date.now() - (260 - i) * this.config.candleIntervalMs
      });
      price = close;
    }
    return candles;
  }

  async start() {
    if (this.interval || this.ws) return;
    try {
      await this.startLiveFeed();
      this.usingLiveMarketData = true;
      this.emitStatus('Connected to AsterDEX market data feed');
    } catch (error) {
      this.emitStatus(`Falling back to simulator: ${error.message}`);
      this.startSimulation();
    }
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    if (this.ws) this.ws.close();
    this.ws = null;
    this.usingLiveMarketData = false;
  }

  emitStatus(message) {
    this.emit('status', { message, usingLiveMarketData: this.usingLiveMarketData });
  }

  startSimulation() {
    if (this.interval) return;
    this.interval = setInterval(() => this.generateSimulation(), this.config.candleIntervalMs);
  }

  async startLiveFeed() {
    await this.primeMarketData();
    await this.connectCombinedStream();
  }

  async primeMarketData() {
    await Promise.all(this.config.pairs.map(async (pair) => {
      const symbol = normalizeSymbol(pair);
      const [priceData, klineData] = await Promise.all([
        this.fetchJson(`/fapi/v1/ticker/price?symbol=${symbol}`),
        this.fetchJson(`/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=260`)
      ]);

      const price = normalizePrice(symbol, priceData.price, this.state.get(symbol)?.price || 0);
      const candles = Array.isArray(klineData)
        ? klineData.map((entry) => normalizeCandle(symbol, entry)).filter(Boolean)
        : [];
      if (!candles.length) throw new Error(`No kline history returned for ${symbol}`);

      const state = this.state.get(symbol);
      state.price = price;
      state.candles = candles;
      state.source = 'ASTERDEX_REST';

      if (symbol === 'ASTERUSDT') {
        this.emitStatus(`Primed ASTERUSDT using REST price=${price}`);
      }
    }));
  }

  async connectCombinedStream() {
    const streams = [];
    for (const pair of this.config.pairs.map(normalizeSymbol)) {
      const streamSymbol = toStreamSymbol(pair);
      streams.push(`${streamSymbol}@aggTrade`, `${streamSymbol}@depth`, `${streamSymbol}@kline_1m`, `${streamSymbol}@markPrice`);
    }

    const url = `${WS_MARKET_BASE_URL}/stream?streams=${streams.join('/')}`;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let resolved = false;

      ws.once('open', () => {
        this.ws = ws;
        resolved = true;
        resolve();
      });

      ws.once('error', (error) => {
        if (!resolved) reject(error);
        this.emitStatus(`WebSocket error: ${error.message}`);
      });

      ws.on('close', () => {
        this.emitStatus('Market WebSocket disconnected; switching to simulator');
        this.ws = null;
        if (!this.interval) this.startSimulation();
      });

      ws.on('message', (payload) => {
        try {
          const parsed = JSON.parse(payload.toString());
          this.handleStreamMessage(parsed);
        } catch (error) {
          this.emitStatus(`Stream parse error: ${error.message}`);
        }
      });
    });
  }

  handleStreamMessage(message) {
    const stream = message.stream || '';
    const data = message.data || message;
    const [streamSymbol, eventName] = stream.split('@');
    const symbol = normalizeSymbol(data.s || streamSymbol);
    if (!symbol || !this.state.has(symbol)) return;

    const state = this.state.get(symbol);
    state.source = 'ASTERDEX_WS';

    if (eventName?.startsWith('aggTrade') || data.e === 'aggTrade') {
      state.price = normalizePrice(symbol, data.p, state.price);
      this.updateLatestPrice(symbol, state.price);
      return;
    }

    if (eventName?.startsWith('markPrice') || data.e === 'markPriceUpdate') {
      state.price = normalizePrice(symbol, data.p || data.i, state.price);
      this.updateLatestPrice(symbol, state.price);
      return;
    }

    if (eventName?.startsWith('depth') || data.e === 'depthUpdate') {
      const bestBid = normalizePrice(symbol, Array.isArray(data.b) && data.b[0] ? data.b[0][0] : data.bids?.[0]?.[0], state.price);
      const bestAsk = normalizePrice(symbol, Array.isArray(data.a) && data.a[0] ? data.a[0][0] : data.asks?.[0]?.[0], state.price);
      const midpoint = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : state.price;
      state.price = normalizePrice(symbol, midpoint, state.price);
      this.updateLatestPrice(symbol, state.price);
      return;
    }

    if (eventName?.startsWith('kline') || data.e === 'kline') {
      const kline = normalizeCandle(symbol, data.k || data, Date.now());
      if (!kline) return;
      state.price = kline.close;
      const last = state.candles[state.candles.length - 1];
      if (last && last.timestamp === kline.timestamp) {
        state.candles[state.candles.length - 1] = kline;
      } else {
        state.candles.push(kline);
        if (state.candles.length > 500) state.candles.shift();
      }
      this.emit('candle', { pair: symbol, candle: kline, candles: [...state.candles], source: state.source });
    }
  }

  updateLatestPrice(symbol, price) {
    const state = this.state.get(symbol);
    if (!state?.candles.length) return;
    const last = state.candles[state.candles.length - 1];
    last.close = normalizePrice(symbol, price, last.close);
    last.high = Math.max(last.high, last.close);
    last.low = Math.min(last.low, last.close);
  }

  generateSimulation() {
    for (const pair of this.config.pairs.map(normalizeSymbol)) {
      const state = this.state.get(pair);
      state.tick += 1;
      if (state.tick % 30 === 0) {
        state.drift = Math.random() * 0.01 - 0.005;
        state.volatility = 0.004 + Math.random() * 0.022;
      }
      const prev = state.candles[state.candles.length - 1].close;
      const shock = (Math.random() - 0.5) * state.volatility;
      const trendPulse = Math.sin(state.tick / 12) * 0.0025 + state.drift;
      const close = normalizePrice(pair, prev * (1 + trendPulse + shock), prev);
      const open = prev;
      const intrabar = prev * (0.001 + Math.random() * state.volatility * 1.4);
      const high = normalizePrice(pair, Math.max(open, close) + intrabar, close);
      const low = normalizePrice(pair, Math.min(open, close) - intrabar, close);
      const volumeSpike = Math.random() > 0.88 ? 2.1 : 1;
      const candle = {
        open,
        high,
        low: Math.max(0.00000001, low),
        close,
        volume: state.volumeBase * (0.8 + Math.random() * 0.6) * volumeSpike,
        timestamp: Date.now()
      };
      state.price = close;
      state.candles.push(candle);
      if (state.candles.length > 500) state.candles.shift();
      this.emit('candle', { pair, candle, candles: [...state.candles], source: 'SIMULATED' });
    }
  }

  async fetchJson(path) {
    const response = await fetch(`${REST_BASE_URL}${path}`, {
      headers: {
        'content-type': 'application/json'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
    return response.json();
  }
}

module.exports = {
  MarketFeed,
  REST_BASE_URL,
  WS_MARKET_BASE_URL,
  normalizeSymbol,
  toStreamSymbol,
  safeParseNumber,
  normalizePrice,
  normalizeCandle
};
