const { MarketFeed } = require('../data/marketFeed');
const { MarketModeDetector } = require('../ai/marketMode');
const { Optimizer } = require('../ai/optimizer');
const { EntryEngine } = require('../engine/entryEngine');
const { ExitEngine } = require('../engine/exitEngine');
const { ReentryEngine } = require('../engine/reentryEngine');
const { TradeLimiter } = require('../engine/tradeLimiter');
const { RiskManager } = require('./riskManager');
const { PositionManager } = require('./positionManager');

class Strategy {
  constructor(config) {
    this.config = config;
    this.running = false;
    this.logs = [];
    this.feed = new MarketFeed(config);
    this.marketMode = new MarketModeDetector(config);
    this.optimizer = new Optimizer();
    this.entryEngine = new EntryEngine();
    this.exitEngine = new ExitEngine();
    this.reentryEngine = new ReentryEngine();
    this.tradeLimiter = new TradeLimiter(config);
    this.riskManager = new RiskManager(config);
    this.positionManager = new PositionManager(config, (message) => this.log(message));
    this.snapshots = {};
    this.lastClosedTrade = new Map();

    this.feed.on('status', ({ message }) => this.log(`FEED ${message}`));
    this.feed.on('candle', (payload) => {
      if (!this.running) return;
      this.onCandle(payload);
    });
  }

  log(message) {
    const line = `[${new Date().toISOString()}] ${message}`;
    this.logs.unshift(line);
    if (this.logs.length > 300) this.logs.pop();
    console.log(line);
  }

  start() {
    this.running = true;
    this.log(`Strategy started in ${this.config.mode.toUpperCase()} mode on ${this.config.exchange}. Live enabled=${this.config.liveEnabled}`);
    this.feed.start();
  }

  stop() {
    this.running = false;
    this.feed.stop();
    this.log('Strategy stopped');
  }

  toggle() {
    if (this.running) this.stop(); else this.start();
    return this.running;
  }

  assertLiveTradeSafe() {
    return this.config.mode === 'live' && this.config.liveEnabled && this.config.api.key && this.config.api.secret;
  }

  onCandle({ pair, candle, candles, source }) {
    const now = Date.now();
    const market = this.marketMode.analyze(candles);
    const profile = this.optimizer.getModeProfile(market.mode, this.config);
    const entry = this.entryEngine.evaluate({ pair, candles, market, profile });
    const riskGate = this.riskManager.canTrade(this.positionManager.balance);

    this.log(`MODE ${pair} ${market.mode} atr=${market.atrPct.toFixed(4)} vol=${market.volatility.toFixed(4)} source=${source || 'UNKNOWN'} riskGate=${riskGate.allowed}`);
    this.log(`SCORE ${pair} total=${entry.score} breakdown=${JSON.stringify(entry.scoreBreakdown)}`);

    const pairPositions = this.positionManager.getPairPositions(pair);
    for (const position of [...pairPositions]) {
      const exit = this.exitEngine.evaluate(position, { candle, market, config: this.config, now });
      this.positionManager.updateTrailing(position, exit.nextTrailing);
      if (exit.action) {
        if (exit.action.type === 'PARTIAL_TP') {
          this.positionManager.closePartial(position, candle.close, exit.action.fraction, exit.action.reason);
        } else {
          const closed = this.positionManager.closePosition(position, candle.close, `${exit.action.reason}; pnlPct=${(exit.pnlPct * 100).toFixed(2)} age=${exit.ageMinutes.toFixed(1)}m`);
          this.lastClosedTrade.set(pair, closed);
          this.reentryEngine.recordClosedTrade(pair, closed);
          if (exit.action.type === 'FLIP') {
            this.tryOpenTrade({ pair, candle, market, profile, entry, now, forceDirection: market.trendDirection, reasonSuffix: 'flip' });
          }
        }
      }
    }

    this.snapshots[pair] = {
      pair,
      price: candle.close,
      marketMode: market.mode,
      riskPct: this.riskManager.getRiskPct(market.mode, profile, this.positionManager.balance),
      reason: entry.reason,
      score: entry.score,
      updatedAt: now,
      source: source || 'UNKNOWN'
    };

    if (!riskGate.allowed) {
      this.log(`RISK BLOCK ${pair} dailyLoss=${riskGate.dailyLossPct.toFixed(2)} drawdown=${riskGate.drawdownPct.toFixed(2)}`);
      return;
    }

    if (entry.shouldEnter) this.tryOpenTrade({ pair, candle, market, profile, entry, now });
  }

  tryOpenTrade({ pair, candle, market, profile, entry, now, forceDirection, reasonSuffix = '' }) {
    const side = forceDirection || entry.direction;
    const existingPositions = this.positionManager.getPairPositions(pair);
    if (existingPositions.length >= this.config.maxPositionsPerPair) return;
    if (!this.tradeLimiter.canTrade(pair, now)) return;

    const closedTrade = this.lastClosedTrade.get(pair);
    const isReentry = existingPositions.length === 0 && this.reentryEngine.canReenter(pair, profile, this.config, closedTrade);
    const scaleIn = existingPositions.length > 0 && profile.allowScaleIn && existingPositions.every((p) => (side === 'LONG' ? candle.close > p.entryPrice : candle.close < p.entryPrice));
    if (existingPositions.length > 0 && !scaleIn) return;
    if (entry && !entry.shouldEnter && !isReentry && !forceDirection) return;

    const riskPct = this.riskManager.getRiskPct(market.mode, profile, this.positionManager.balance);
    const stopLoss = side === 'LONG'
      ? candle.close - market.atr * this.config.atrMultipliers.stopLoss
      : candle.close + market.atr * this.config.atrMultipliers.stopLoss;
    const tp1 = side === 'LONG'
      ? candle.close + market.atr * this.config.atrMultipliers.takeProfit1
      : candle.close - market.atr * this.config.atrMultipliers.takeProfit1;
    const { quantity } = this.riskManager.calculatePositionSize({
      balance: this.positionManager.balance,
      riskPct,
      entryPrice: candle.close,
      stopPrice: stopLoss
    });

    const tradeMode = this.config.mode === 'live' && this.assertLiveTradeSafe() ? 'live' : 'paper';
    if (this.config.mode === 'live' && tradeMode !== 'live') {
      this.log(`SAFETY live mode requested but disabled: liveEnabled=${this.config.liveEnabled} apiKey=${Boolean(this.config.api.key)} apiSecret=${Boolean(this.config.api.secret)}`);
    }

    this.positionManager.openPosition({
      pair,
      side,
      quantity,
      entryPrice: candle.close,
      stopLoss,
      tp1,
      trailingStop: side === 'LONG' ? candle.close - market.atr * this.config.atrMultipliers.trailingBase : candle.close + market.atr * this.config.atrMultipliers.trailingBase,
      riskPct,
      reason: `${entry ? entry.reason : 'forced'}${reasonSuffix ? ` ${reasonSuffix}` : ''}${isReentry ? ' reentry' : ''}${scaleIn ? ' scale-in' : ''}`,
      mode: tradeMode
    });

    if (isReentry) {
      this.reentryEngine.markReentry(pair);
      this.log(`REENTRY ${pair} executed after profitable trade`);
    }
    this.tradeLimiter.recordTrade(pair, now);
  }

  getState() {
    const openPositions = this.positionManager.openPositions.map((position) => ({
      ...position,
      currentPrice: this.snapshots[position.pair]?.price || position.entryPrice,
      pnl: position.side === 'LONG'
        ? ((this.snapshots[position.pair]?.price || position.entryPrice) - position.entryPrice) * position.quantity
        : (position.entryPrice - (this.snapshots[position.pair]?.price || position.entryPrice)) * position.quantity,
      timeInTradeMinutes: ((Date.now() - position.openedAt) / 60000).toFixed(2)
    }));
    const pnl = this.positionManager.balance - this.config.startingBalance;
    return {
      running: this.running,
      mode: this.config.mode === 'live' && this.assertLiveTradeSafe() ? 'LIVE' : 'PAPER',
      exchange: this.config.exchange,
      balance: this.positionManager.balance,
      startingBalance: this.config.startingBalance,
      pnl,
      market: this.snapshots,
      openPositions,
      recentTrades: this.positionManager.closedTrades.slice(0, 12),
      logs: this.logs.slice(0, 80)
    };
  }
}

module.exports = { Strategy };
