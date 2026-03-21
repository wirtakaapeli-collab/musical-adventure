const test = require('node:test');
const assert = require('node:assert');
const config = require('../config.json');
const { Strategy } = require('../core/strategy');

test('paper mode is the safe default', () => {
  assert.equal(config.mode, 'paper');
  assert.equal(config.liveEnabled, false);
});

test('strategy reports paper mode without live safety conditions', () => {
  const strategy = new Strategy(config);
  const state = strategy.getState();
  assert.equal(state.mode, 'PAPER');
});
