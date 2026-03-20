import crypto from 'node:crypto';
import process from 'node:process';
import WebSocket from 'ws';
import { config, validateConfig } from './config.js';
import { normalizeKlines } from './indicators.js';
import { logger } from './logger.js';
import { buildTradePlan, shouldHaltTrading } from './risk.js';
import { BotState } from './state.js';
import { analyzeMarket } from './strategy.js';

class AsterRestClient {
  constructor(botConfig) {
    this.config = botConfig;
  }

  sign(params) {
    const query = new URLSearchParams(params).toString();
    const signature = crypto.createHmac('sha256', this.config.apiSecret).update(query).digest('hex');
    return `${query}&signature=${signature}`;
  }

  async request(path, { method = 'GET', params = {}, signed = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    let url = `${this.config.baseUrl}${path}`;
    let body;
    const requestParams = { ...params };

    if (signed) {
      requestParams.timestamp = Date.now();
      headers['X-MBX-APIKEY'] = this.config.apiKey;
    }

    if (method === 'GET' || method === 'DELETE') {
      const query = signed ? this.sign(requestParams) : new URLSearchParams(requestParams).toString();
      if (query) url += `?${query}`;
    } else {
      body = signed ? this.sign(requestParams) : JSON.stringify(requestParams);
      if (signed) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const response = await fetch(url, { method, headers, body });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`API ${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
    }
    return payload;
  }

  getExchangeInfo() { return this.request('/fapi/v1/exchangeInfo'); }
  getKlines(symbol, interval, limit) { return this.request('/fapi/v1/klines', { params: { symbol, interval, limit } }); }
  getMarkPrice(symbol) { return this.request('/fapi/v1/premiumIndex', { params: { symbol } }); }
  getAccount() { return this.request('/fapi/v2/account', { signed: true }); }
  getPositionRisk(symbol) { return this.request('/fapi/v2/positionRisk', { signed: true, params: { symbol } }); }
  async placeOrder(order) { return this.request('/fapi/v1/order', { method: 'POST', signed: true, params: order }); }
  async setLeverage(symbol, leverage) { return this.request('/fapi/v1/leverage', { method: 'POST', signed: true, params: { symbol, leverage } }); }
  async setMarginType(symbol, marginType) { return this.request('/fapi/v1/marginType', { method: 'POST', signed: true, params: { symbol, marginType } }); }
}

class TradingBot {
  constructor(botConfig) {
    this.config = botConfig;
    this.rest = new AsterRestClient(botConfig);
    this.state = new BotState(botConfig);
    this.symbolMeta = { stepSize: 0.1, minQty: 0.1, tickSize: 0.0001 };
    this.ws = null;
  }

  async init() {
    validateConfig();
    const exchangeInfo = await this.rest.getExchangeInfo();
    const symbol = exchangeInfo.symbols.find((item) => item.symbol === this.config.symbol);
    if (!symbol) throw new Error(`Symbol ${this.config.symbol} not found in exchange info`);
    const lotFilter = symbol.filters.find((filter) => filter.filterType === 'LOT_SIZE');
    const priceFilter = symbol.filters.find((filter) => filter.filterType === 'PRICE_FILTER');
    this.symbolMeta = {
      stepSize: Number(lotFilter?.stepSize ?? 0.1),
      minQty: Number(lotFilter?.minQty ?? 0.1),
      tickSize: Number(priceFilter?.tickSize ?? 0.0001),
    };

    if (!this.config.dryRun) {
      await this.rest.setLeverage(this.config.symbol, this.config.leverage);
      try {
        await this.rest.setMarginType(this.config.symbol, this.config.marginType);
      } catch (error) {
        logger.warn('Margin type setup warning', { message: error.message });
      }
      const account = await this.rest.getAccount();
      this.state.setEquity(Number(account.availableBalance ?? account.totalWalletBalance));
    }
  }

  roundPrice(price) {
    const { tickSize } = this.symbolMeta;
    return Number((Math.round(price / tickSize) * tickSize).toFixed(8));
  }

  async fetchMarketSnapshot() {
    const [rawKlines, markPrice] = await Promise.all([
      this.rest.getKlines(this.config.symbol, this.config.timeframe, this.config.klineLimit),
      this.rest.getMarkPrice(this.config.symbol),
    ]);
    const candles = normalizeKlines(rawKlines);
    return { candles, price: Number(markPrice.markPrice ?? markPrice.price) };
  }

  async maybeTrade() {
    const snapshot = await this.fetchMarketSnapshot();
    const adaptiveThreshold = this.state.getAdaptiveConfidence(this.config.minConfidence);
    const analysis = analyzeMarket(snapshot.candles, this.config, adaptiveThreshold);

    logger.decision('Market evaluation complete', {
      price: snapshot.price,
      confidence: analysis.confidence,
      action: analysis.action,
      adaptiveThreshold,
      reasons: analysis.reasons,
      metrics: analysis.metrics,
    });

    this.state.updatePositionMarket(snapshot.price);
    const halt = shouldHaltTrading({
      equity: this.state.equity,
      startOfDayEquity: this.state.startOfDayEquity,
      consecutiveLosses: this.state.consecutiveLosses,
      config: this.config,
      cooldownUntil: this.state.cooldownUntil,
    });

    if (halt.halt) {
      logger.warn('Trading halted', halt);
      return;
    }

    if (this.state.position) {
      await this.manageOpenPosition(snapshot.price, analysis.metrics.atr);
      return;
    }

    if (analysis.action === 'HOLD') {
      return;
    }

    if (Date.now() - this.state.lastTradeAt < this.config.minTradeIntervalMs) {
      logger.decision('Skipped trade due to minimum trade interval');
      return;
    }

    if (this.state.lastSignalSide === analysis.action && Date.now() - this.state.lastTradeAt < this.config.minTradeIntervalMs * 2) {
      logger.decision('Skipped re-entry in same trend too soon', { lastSignalSide: this.state.lastSignalSide });
      return;
    }

    const plan = buildTradePlan({
      side: analysis.action,
      entryPrice: snapshot.price,
      atrValue: analysis.metrics.atr,
      balance: this.state.equity,
      config: this.config,
      filters: this.symbolMeta,
    });

    if (plan.quantity <= 0) {
      logger.warn('Trade skipped because calculated position size is zero', plan);
      return;
    }

    await this.executeEntry(plan, analysis);
  }

  async executeEntry(plan, analysis) {
    const normalizedPlan = {
      ...plan,
      stopLoss: this.roundPrice(plan.stopLoss),
      takeProfit: this.roundPrice(plan.takeProfit),
    };

    if (this.config.dryRun) {
      this.state.openPosition(normalizedPlan);
      logger.trade('DRY RUN entry opened', { plan: normalizedPlan, confidence: analysis.confidence });
      return;
    }

    const side = plan.side === 'LONG' ? 'BUY' : 'SELL';
    const exitSide = plan.side === 'LONG' ? 'SELL' : 'BUY';
    const clientOrderId = `aster-${Date.now()}`;

    const entryOrder = await this.rest.placeOrder({
      symbol: this.config.symbol,
      side,
      type: 'MARKET',
      quantity: normalizedPlan.quantity,
      newClientOrderId: clientOrderId,
    });

    await this.rest.placeOrder({
      symbol: this.config.symbol,
      side: exitSide,
      type: 'STOP_MARKET',
      stopPrice: normalizedPlan.stopLoss,
      closePosition: 'true',
      workingType: 'MARK_PRICE',
    });

    await this.rest.placeOrder({
      symbol: this.config.symbol,
      side: exitSide,
      type: 'TAKE_PROFIT_MARKET',
      stopPrice: normalizedPlan.takeProfit,
      closePosition: 'true',
      workingType: 'MARK_PRICE',
    });

    this.state.openPosition({ ...normalizedPlan, orderId: entryOrder.orderId });
    logger.trade('LIVE entry opened', { plan: normalizedPlan, orderId: entryOrder.orderId, confidence: analysis.confidence });
  }

  async manageOpenPosition(price, atrValue) {
    const position = this.state.position;
    if (!position) return;

    const trailingStop = position.side === 'LONG'
      ? Math.max(position.stopLoss, this.roundPrice(position.peakPrice - position.trailingOffset))
      : Math.min(position.stopLoss, this.roundPrice(position.troughPrice + position.trailingOffset));

    if (position.side === 'LONG' && trailingStop > position.stopLoss && price > position.entryPrice + atrValue) {
      position.stopLoss = trailingStop;
    }
    if (position.side === 'SHORT' && trailingStop < position.stopLoss && price < position.entryPrice - atrValue) {
      position.stopLoss = trailingStop;
    }

    const hitStop = position.side === 'LONG' ? price <= position.stopLoss : price >= position.stopLoss;
    const hitTarget = position.side === 'LONG' ? price >= position.takeProfit : price <= position.takeProfit;

    if (!hitStop && !hitTarget) {
      logger.decision('Holding current position', { position, marketPrice: price });
      return;
    }

    const exitReason = hitTarget ? 'TAKE_PROFIT' : 'STOP_LOSS';

    if (!this.config.dryRun) {
      const side = position.side === 'LONG' ? 'SELL' : 'BUY';
      await this.rest.placeOrder({
        symbol: this.config.symbol,
        side,
        type: 'MARKET',
        quantity: position.quantity,
        reduceOnly: 'true',
      });
    }

    const trade = this.state.closePosition({ exitPrice: price, reason: exitReason, feeRate: this.config.feeRate });
    logger.trade('Position closed', { trade, stats: this.state.getStats() });
  }

  startDashboard() {
    setInterval(() => {
      logger.info('Live stats', this.state.getStats());
    }, 60_000).unref();
  }

  startWebSocket() {
    const stream = `${this.config.symbol.toLowerCase()}@markPrice@1s`;
    this.ws = new WebSocket(`${this.config.wsUrl}/${stream}`);

    this.ws.on('open', () => logger.info('WebSocket connected', { stream }));
    this.ws.on('message', (buffer) => {
      try {
        const event = JSON.parse(buffer.toString());
        const price = Number(event.p ?? event.markPrice);
        if (Number.isFinite(price) && this.state.position) {
          this.state.updatePositionMarket(price);
        }
      } catch (error) {
        logger.warn('WebSocket message parse failed', { message: error.message });
      }
    });
    this.ws.on('close', () => {
      logger.warn('WebSocket disconnected, reconnecting shortly');
      setTimeout(() => this.startWebSocket(), 5_000).unref();
    });
    this.ws.on('error', (error) => logger.error('WebSocket error', { message: error.message }));
  }

  async runBacktest() {
    const { candles } = await this.fetchMarketSnapshot();
    for (let i = 80; i < candles.length; i += 1) {
      const subset = candles.slice(0, i + 1);
      const price = subset.at(-1).close;
      const adaptiveThreshold = this.state.getAdaptiveConfidence(this.config.minConfidence);
      const analysis = analyzeMarket(subset, this.config, adaptiveThreshold);
      this.state.updatePositionMarket(price);
      if (this.state.position) {
        await this.manageOpenPosition(price, analysis.metrics?.atr ?? 0);
      } else if (analysis.action !== 'HOLD') {
        const plan = buildTradePlan({
          side: analysis.action,
          entryPrice: price,
          atrValue: analysis.metrics.atr,
          balance: this.state.equity,
          config: this.config,
          filters: this.symbolMeta,
        });
        if (plan.quantity > 0) {
          this.state.openPosition(plan);
        }
      }
    }
    logger.info('Backtest complete', this.state.getStats());
  }

  async run() {
    await this.init();
    if (process.argv.includes('--backtest')) {
      await this.runBacktest();
      return;
    }

    this.startDashboard();
    this.startWebSocket();
    await this.maybeTrade();
    setInterval(() => {
      this.maybeTrade().catch((error) => logger.error('Trading loop failure', { message: error.message }));
    }, this.config.pollIntervalMs);
  }
}

const bot = new TradingBot(config);
bot.run().catch((error) => {
  logger.error('Fatal bot error', { message: error.message, stack: error.stack });
  process.exitCode = 1;
});
