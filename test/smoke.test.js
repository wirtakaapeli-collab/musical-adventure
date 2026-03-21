const test = require('node:test');
const assert = require('node:assert');
const config = require('../config.json');
const { Strategy } = require('../core/strategy');
const {
  REST_BASE_URL,
  WS_MARKET_BASE_URL,
  normalizePrice,
  normalizeCandle,
  toStreamSymbol,
  MarketFeed
} = require('../data/marketFeed');

test('paper mode is the safe default', () => {
  assert.equal(config.mode, 'paper');
  assert.equal(config.liveEnabled, false);
});

test('strategy reports paper mode without live safety conditions', () => {
  const strategy = new Strategy(config);
  const state = strategy.getState();
  assert.equal(state.mode, 'PAPER');
});

test('asterdex endpoints and lowercase ASTER stream names are correct', () => {
  assert.equal(REST_BASE_URL, 'https://fapi.asterdex.com');
  assert.equal(WS_MARKET_BASE_URL, 'wss://fstream.asterdex.com');
  assert.equal(toStreamSymbol('ASTERUSDT'), 'asterusdt');
});

test('ASTERUSDT values are parsed as floats without scaling errors', () => {
  assert.equal(normalizePrice('ASTERUSDT', '2.34560000'), 2.3456);
  const candle = normalizeCandle('ASTERUSDT', ['1', '2.10000000', '2.40000000', '2.05000000', '2.30000000', '1200.5', '2']);
  assert.deepEqual(candle, {
    open: 2.1,
    high: 2.4,
    low: 2.05,
    close: 2.3,
    volume: 1200.5,
    timestamp: 2
  });
});

test('paper REST polling emits selected-pair candle updates compatible with strategy pipeline', async () => {
  const paperConfig = {
    ...config,
    mode: 'paper',
    pairs: ['ASTERUSDT'],
    pairsSeed: { ASTERUSDT: 2.25 }
  };
  const feed = new MarketFeed(paperConfig);
  feed.fetchJson = async () => ({ symbol: 'ASTERUSDT', price: '2.50000000' });

  const event = await new Promise((resolve) => {
    feed.once('candle', resolve);
    feed.pollSelectedPairsViaRest();
  });

  assert.equal(event.pair, 'ASTERUSDT');
  assert.equal(event.source, 'ASTERDEX_REST');
  assert.equal(event.candle.open, 2.25);
  assert.equal(event.candle.high, 2.25);
  assert.equal(event.candle.low, 2.25);
  assert.equal(event.candle.close, 2.5);
  assert.equal(event.candle.volume, 0);
  assert.equal(event.candles.at(-1).close, 2.5);
  assert.ok(event.candles.length <= 500);
});

test('paper REST polling is skipped in live mode', () => {
  const liveFeed = new MarketFeed({ ...config, mode: 'live' });
  let status = '';
  liveFeed.on('status', ({ message }) => {
    status = message;
  });
  liveFeed.startPaperRestPolling();
  assert.equal(status, 'Skipping REST paper polling because bot is in LIVE mode');
  assert.equal(liveFeed.restPollInterval, null);
});
