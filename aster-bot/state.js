import fs from 'node:fs';
import path from 'node:path';

export class BotState {
  constructor(config) {
    this.config = config;
    this.position = null;
    this.tradeHistory = [];
    this.equity = 10_000;
    this.startOfDayEquity = this.equity;
    this.lastTradeAt = 0;
    this.lastSignalSide = null;
    this.consecutiveLosses = 0;
    this.cooldownUntil = 0;
  }

  setEquity(value) {
    if (Number.isFinite(value) && value > 0) {
      this.equity = value;
      if (!this.startOfDayEquity) {
        this.startOfDayEquity = value;
      }
    }
  }

  openPosition(plan) {
    this.position = {
      ...plan,
      openedAt: Date.now(),
      peakPrice: plan.entryPrice,
      troughPrice: plan.entryPrice,
    };
    this.lastTradeAt = Date.now();
    this.lastSignalSide = plan.side;
  }

  updatePositionMarket(price) {
    if (!this.position) return;
    this.position.peakPrice = Math.max(this.position.peakPrice, price);
    this.position.troughPrice = Math.min(this.position.troughPrice, price);
  }

  closePosition({ exitPrice, reason, feeRate }) {
    if (!this.position) return null;
    const { side, entryPrice, quantity, openedAt } = this.position;
    const grossPnl = side === 'LONG'
      ? (exitPrice - entryPrice) * quantity
      : (entryPrice - exitPrice) * quantity;
    const fees = (entryPrice + exitPrice) * quantity * feeRate;
    const netPnl = grossPnl - fees;
    const trade = {
      ...this.position,
      exitPrice,
      reason,
      grossPnl,
      netPnl,
      fees,
      closedAt: Date.now(),
      durationMs: Date.now() - openedAt,
    };

    this.tradeHistory.push(trade);
    this.position = null;
    this.equity += netPnl;
    this.consecutiveLosses = netPnl < 0 ? this.consecutiveLosses + 1 : 0;
    if (this.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      this.cooldownUntil = Date.now() + this.config.cooldownAfterLossStreakMs;
    }
    this.persist();
    return trade;
  }

  getStats() {
    const totalTrades = this.tradeHistory.length;
    const wins = this.tradeHistory.filter((trade) => trade.netPnl > 0).length;
    const pnl = this.tradeHistory.reduce((sum, trade) => sum + trade.netPnl, 0);
    return {
      totalTrades,
      wins,
      losses: totalTrades - wins,
      winRate: totalTrades ? wins / totalTrades : 0,
      pnl,
      equity: this.equity,
      consecutiveLosses: this.consecutiveLosses,
    };
  }

  getAdaptiveConfidence(baseThreshold) {
    const recentTrades = this.tradeHistory.slice(-this.config.adaptiveWindow);
    if (recentTrades.length < 5) {
      return baseThreshold;
    }
    const wins = recentTrades.filter((trade) => trade.netPnl > 0).length;
    const winRate = wins / recentTrades.length;
    if (winRate < 0.4) {
      return Math.min(90, baseThreshold + this.config.adaptiveThresholdStep);
    }
    if (winRate > 0.65) {
      return Math.max(60, baseThreshold - this.config.adaptiveThresholdStep);
    }
    return baseThreshold;
  }

  persist() {
    const exportPath = path.resolve(this.config.exportPath);
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    fs.writeFileSync(exportPath, JSON.stringify({ stats: this.getStats(), trades: this.tradeHistory }, null, 2));
  }
}
