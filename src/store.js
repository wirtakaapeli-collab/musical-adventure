const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'bot-state.json');

const defaultState = {
  auth: {
    token: null,
    user: null,
  },
  settings: {
    paperTrading: true,
    symbol: 'BTCUSDT',
    timeframe: '15m',
    leverage: 2,
    maxCapitalPerTrade: 150,
    riskPerTradePct: 1,
    takeProfitAtr: 2.8,
    stopLossAtr: 1.4,
    trailingStopAtr: 1.1,
    pollIntervalMs: 15000,
    strategyName: 'Trend + momentum + volatility regime filter',
    apiKey: '',
    apiSecret: '',
  },
  controls: {
    running: false,
  },
  wallet: {
    startingBalance: 10000,
    balance: 10000,
    equity: 10000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    exposure: 0,
  },
  position: null,
  trades: [],
  logs: [
    {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Bot initialized in paper trading mode.',
    },
  ],
  metrics: {
    winRate: 0,
    totalTrades: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    lastSignal: 'WAIT',
    strategyScore: 0,
  },
  market: {
    price: null,
    changePct: 0,
    trend: 'neutral',
    volatility: 'normal',
    lastUpdate: null,
  },
};

function ensureFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState, null, 2));
  }
}

function loadState() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    ...defaultState,
    ...parsed,
    settings: { ...defaultState.settings, ...(parsed.settings || {}) },
    controls: { ...defaultState.controls, ...(parsed.controls || {}) },
    wallet: { ...defaultState.wallet, ...(parsed.wallet || {}) },
    metrics: { ...defaultState.metrics, ...(parsed.metrics || {}) },
    market: { ...defaultState.market, ...(parsed.market || {}) },
  };
}

function saveState(nextState) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(nextState, null, 2));
}

module.exports = {
  DATA_FILE,
  defaultState,
  loadState,
  saveState,
};
