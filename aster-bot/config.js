function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }
  return parsed;
}

function envBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export const config = {
  dryRun: envBoolean('DRY_RUN', true),
  apiKey: process.env.ASTER_API_KEY ?? '',
  apiSecret: process.env.ASTER_API_SECRET ?? '',
  baseUrl: process.env.ASTER_BASE_URL ?? 'https://fapi.asterdex.com',
  wsUrl: process.env.ASTER_WS_URL ?? 'wss://fstream.asterdex.com/ws',
  symbol: process.env.ASTER_SYMBOL ?? 'ASTERUSDT',
  contractSymbol: process.env.ASTER_CONTRACT_SYMBOL ?? 'ASTERUSDT',
  timeframe: process.env.ASTER_TIMEFRAME ?? '5m',
  klineLimit: envNumber('ASTER_KLINE_LIMIT', 250),
  leverage: envNumber('ASTER_LEVERAGE', 3),
  marginType: process.env.ASTER_MARGIN_TYPE ?? 'ISOLATED',
  riskPerTrade: envNumber('ASTER_RISK_PER_TRADE', 0.01),
  maxRiskPerTrade: envNumber('ASTER_MAX_RISK_PER_TRADE', 0.02),
  maxDailyLoss: envNumber('ASTER_MAX_DAILY_LOSS', 0.05),
  minConfidence: envNumber('ASTER_MIN_CONFIDENCE', 70),
  minTradeIntervalMs: envNumber('ASTER_MIN_TRADE_INTERVAL_MS', 30 * 60 * 1000),
  cooldownAfterLossStreakMs: envNumber('ASTER_COOLDOWN_AFTER_LOSS_STREAK_MS', 2 * 60 * 60 * 1000),
  sidewaysAtrThreshold: envNumber('ASTER_SIDEWAYS_ATR_THRESHOLD', 0.003),
  trailingStopMultiplier: envNumber('ASTER_TRAILING_STOP_MULTIPLIER', 1.2),
  stopAtrMultiplier: envNumber('ASTER_STOP_ATR_MULTIPLIER', 1.6),
  targetRiskReward: envNumber('ASTER_TARGET_RR', 2),
  feeRate: envNumber('ASTER_FEE_RATE', 0.0004),
  exportPath: process.env.ASTER_EXPORT_PATH ?? 'aster-bot/data/trades.json',
  adaptiveThresholdStep: envNumber('ASTER_ADAPTIVE_THRESHOLD_STEP', 3),
  adaptiveWindow: envNumber('ASTER_ADAPTIVE_WINDOW', 12),
  maxConsecutiveLosses: envNumber('ASTER_MAX_CONSECUTIVE_LOSSES', 3),
  pollIntervalMs: envNumber('ASTER_POLL_INTERVAL_MS', 15_000),
};

export function validateConfig() {
  if (!config.dryRun && (!config.apiKey || !config.apiSecret)) {
    throw new Error('ASTER_API_KEY and ASTER_API_SECRET are required when DRY_RUN=false');
  }
  if (config.riskPerTrade <= 0 || config.riskPerTrade > config.maxRiskPerTrade) {
    throw new Error('ASTER_RISK_PER_TRADE must be > 0 and <= ASTER_MAX_RISK_PER_TRADE');
  }
}
