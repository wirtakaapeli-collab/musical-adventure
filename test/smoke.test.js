const test = require('node:test');
const assert = require('node:assert');
const config = require('../config.json');
const {
  Strategy
} = require('../core/strategy');
const {
  REST_BASE_URL,
  WS_MARKET_BASE_URL,
  normalizePrice,
  normalizeCandle,
  toStreamSymbol
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
