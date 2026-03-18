const { AsterDexClient } = require('./asterdex-client');
const { evaluateStrategy, buildRiskPlan } = require('./strategy');

class TradingBot {
  constructor(store) {
    this.store = store;
    this.timer = null;
  }

  get state() {
    return this.store.load();
  }

  save(state) {
    this.store.save(state);
  }

  log(state, level, message) {
    state.logs.unshift({
      timestamp: new Date().toISOString(),
      level,
      message,
    });
    state.logs = state.logs.slice(0, 100);
  }

  getClient(settings) {
    return new AsterDexClient({
      apiKey: settings.apiKey,
      apiSecret: settings.apiSecret,
    });
  }

  async tick() {
    const state = this.state;
    const { settings, wallet, position } = state;
    const client = this.getClient(settings);

    try {
      const [candles, ticker24] = await Promise.all([
        client.getCandles(settings.symbol, settings.timeframe, 220),
        client.get24hTicker(settings.symbol),
      ]);

      const signal = evaluateStrategy(candles, settings);
      const currentPrice = Number(ticker24.lastPrice || candles[candles.length - 1].close);
      state.market = {
        price: currentPrice,
        changePct: Number(ticker24.priceChangePercent || 0),
        trend: signal.action === 'BUY' ? 'bullish' : signal.action === 'SELL' ? 'bearish' : 'sideways',
        volatility: signal.indicators.atr && signal.indicators.price
          ? ((signal.indicators.atr / signal.indicators.price) > 0.004 ? 'high' : 'normal')
          : 'normal',
        lastUpdate: new Date().toISOString(),
      };
      state.metrics.lastSignal = signal.action;
      state.metrics.strategyScore = signal.score;

      if (position) {
        this.updateOpenPosition(state, currentPrice);
      }

      if (!state.position && signal.action !== 'WAIT') {
        const riskPlan = buildRiskPlan(signal, signal.indicators, wallet, settings);
        if (riskPlan && riskPlan.quantity > 0) {
          await this.openTrade(state, riskPlan, currentPrice);
        }
      }

      this.recalculateMetrics(state);
      this.save(state);
    } catch (error) {
      this.log(state, 'error', error.message);
      this.save(state);
    }
  }

  async openTrade(state, riskPlan, marketPrice) {
    const { settings } = state;

    if (!settings.paperTrading && (!settings.apiKey || !settings.apiSecret)) {
      this.log(state, 'error', 'Live trading blocked: API keys missing.');
      return;
    }

    if (!settings.paperTrading) {
      const client = this.getClient(settings);
      await client.placeOrder({
        symbol: settings.symbol,
        side: riskPlan.side === 'long' ? 'BUY' : 'SELL',
        quantity: riskPlan.quantity,
      });
    }

    state.position = {
      ...riskPlan,
      openedAt: new Date().toISOString(),
      markPrice: marketPrice,
      unrealizedPnl: 0,
    };
    state.wallet.exposure = riskPlan.allocatedCapital;
    this.log(
      state,
      'info',
      `${settings.paperTrading ? 'Paper' : 'Live'} ${riskPlan.side.toUpperCase()} opened on ${settings.symbol} at ${marketPrice.toFixed(2)}.`,
    );
  }

  updateOpenPosition(state, currentPrice) {
    const { position } = state;
    const direction = position.side === 'long' ? 1 : -1;
    const pnl = (currentPrice - position.entryPrice) * position.quantity * direction;
    position.markPrice = currentPrice;
    position.unrealizedPnl = Number(pnl.toFixed(2));
    state.wallet.unrealizedPnl = position.unrealizedPnl;
    state.wallet.equity = Number((state.wallet.balance + position.unrealizedPnl).toFixed(2));

    const hitTp = position.side === 'long' ? currentPrice >= position.takeProfit : currentPrice <= position.takeProfit;
    const hitSl = position.side === 'long' ? currentPrice <= position.stopLoss : currentPrice >= position.stopLoss;

    if (position.side === 'long') {
      position.trailingStop = Math.max(position.trailingStop, currentPrice - ((position.takeProfit - position.entryPrice) / 2.5));
    } else {
      position.trailingStop = Math.min(position.trailingStop, currentPrice + ((position.entryPrice - position.takeProfit) / 2.5));
    }

    const hitTrail = position.side === 'long' ? currentPrice <= position.trailingStop : currentPrice >= position.trailingStop;

    if (hitTp || hitSl || hitTrail) {
      const reason = hitTp ? 'take-profit' : hitSl ? 'stop-loss' : 'trailing-stop';
      this.closeTrade(state, currentPrice, reason);
    }
  }

  closeTrade(state, exitPrice, reason) {
    const position = state.position;
    if (!position) return;

    const direction = position.side === 'long' ? 1 : -1;
    const realized = Number((((exitPrice - position.entryPrice) * position.quantity) * direction).toFixed(2));
    const closedTrade = {
      ...position,
      exitPrice,
      closedAt: new Date().toISOString(),
      realizedPnl: realized,
      closeReason: reason,
    };

    state.trades.unshift(closedTrade);
    state.trades = state.trades.slice(0, 200);
    state.wallet.balance = Number((state.wallet.balance + realized).toFixed(2));
    state.wallet.realizedPnl = Number((state.wallet.realizedPnl + realized).toFixed(2));
    state.wallet.unrealizedPnl = 0;
    state.wallet.equity = state.wallet.balance;
    state.wallet.exposure = 0;
    state.position = null;
    this.log(state, 'info', `Position closed via ${reason} with PnL ${realized.toFixed(2)}.`);
  }

  recalculateMetrics(state) {
    const trades = state.trades;
    const wins = trades.filter((trade) => trade.realizedPnl > 0);
    const losses = trades.filter((trade) => trade.realizedPnl < 0);
    const grossProfit = wins.reduce((sum, trade) => sum + trade.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.realizedPnl, 0));
    let peak = state.wallet.startingBalance;
    let troughDrawdown = 0;
    let equity = state.wallet.startingBalance;

    trades.slice().reverse().forEach((trade) => {
      equity += trade.realizedPnl;
      if (equity > peak) peak = equity;
      const drawdown = peak - equity;
      if (drawdown > troughDrawdown) troughDrawdown = drawdown;
    });

    state.metrics.totalTrades = trades.length;
    state.metrics.winRate = trades.length ? Number(((wins.length / trades.length) * 100).toFixed(1)) : 0;
    state.metrics.profitFactor = grossLoss ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit ? 99 : 0;
    state.metrics.maxDrawdown = Number(troughDrawdown.toFixed(2));
  }

  start() {
    const state = this.state;
    if (this.timer) return state;
    state.controls.running = true;
    this.log(state, 'info', 'Bot started.');
    this.save(state);
    this.tick();
    this.timer = setInterval(() => this.tick(), state.settings.pollIntervalMs);
    return this.state;
  }

  stop() {
    const state = this.state;
    state.controls.running = false;
    this.log(state, 'info', 'Bot stopped.');
    this.save(state);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.state;
  }
}

module.exports = {
  TradingBot,
};
