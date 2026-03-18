const express = require('express');
const path = require('path');
const { buildToken, verifyLogin } = require('./auth');
const { loadState, saveState } = require('./store');
const { TradingBot } = require('./bot');

const app = express();
const port = process.env.PORT || 3000;

const store = {
  load: loadState,
  save: saveState,
};
const bot = new TradingBot(store);

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

function sanitizeState(state) {
  return {
    ...state,
    settings: {
      ...state.settings,
      apiKey: '',
      apiSecret: '',
      hasApiKey: Boolean(state.settings.apiKey),
      hasApiSecret: Boolean(state.settings.apiSecret),
    },
  };
}

function requireAuth(req, res, next) {
  const state = loadState();
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== state.auth.token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

app.post('/api/login', (req, res) => {
  const { username, pin } = req.body || {};
  if (!verifyLogin(username, pin)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const state = loadState();
  const token = buildToken(username);
  state.auth = { token, user: username };
  saveState(state);
  return res.json({ token, user: username, state: sanitizeState(state) });
});

app.get('/api/state', requireAuth, (req, res) => {
  res.json(sanitizeState(loadState()));
});

app.post('/api/settings', requireAuth, (req, res) => {
  const state = loadState();
  const incoming = req.body || {};
  state.settings = {
    ...state.settings,
    ...incoming,
    apiKey: incoming.apiKey ? incoming.apiKey : state.settings.apiKey,
    apiSecret: incoming.apiSecret ? incoming.apiSecret : state.settings.apiSecret,
    maxCapitalPerTrade: Number(incoming.maxCapitalPerTrade ?? state.settings.maxCapitalPerTrade),
    leverage: Number(incoming.leverage ?? state.settings.leverage),
    riskPerTradePct: Number(incoming.riskPerTradePct ?? state.settings.riskPerTradePct),
    takeProfitAtr: Number(incoming.takeProfitAtr ?? state.settings.takeProfitAtr),
    stopLossAtr: Number(incoming.stopLossAtr ?? state.settings.stopLossAtr),
    trailingStopAtr: Number(incoming.trailingStopAtr ?? state.settings.trailingStopAtr),
    pollIntervalMs: Number(incoming.pollIntervalMs ?? state.settings.pollIntervalMs),
  };
  saveState(state);

  if (state.controls.running) {
    bot.stop();
    bot.start();
  }

  res.json(sanitizeState(state));
});

app.post('/api/control/start', requireAuth, (req, res) => {
  const state = bot.start();
  res.json(sanitizeState(state));
});

app.post('/api/control/stop', requireAuth, (req, res) => {
  const state = bot.stop();
  res.json(sanitizeState(state));
});

app.post('/api/reset', requireAuth, (req, res) => {
  bot.stop();
  const state = loadState();
  state.wallet = {
    ...state.wallet,
    balance: state.wallet.startingBalance,
    equity: state.wallet.startingBalance,
    realizedPnl: 0,
    unrealizedPnl: 0,
    exposure: 0,
  };
  state.position = null;
  state.trades = [];
  state.metrics = {
    ...state.metrics,
    winRate: 0,
    totalTrades: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    lastSignal: 'WAIT',
    strategyScore: 0,
  };
  state.logs.unshift({
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'Session reset.',
  });
  saveState(state);
  res.json(sanitizeState(state));
});

app.listen(port, () => {
  console.log(`AsterDex bot dashboard running on http://localhost:${port}`);
});
