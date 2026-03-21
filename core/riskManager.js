class RiskManager {
  constructor(config) {
    this.config = config;
    this.startBalance = config.startingBalance;
    this.dayStartBalance = config.startingBalance;
    this.currentDay = new Date().toISOString().slice(0, 10);
  }

  refreshDay(balance) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dayStartBalance = balance;
    }
  }

  canTrade(balance) {
    this.refreshDay(balance);
    const dailyLossPct = ((this.dayStartBalance - balance) / this.dayStartBalance) * 100;
    const drawdownPct = ((this.startBalance - balance) / this.startBalance) * 100;
    return {
      allowed: dailyLossPct < this.config.dailyLossLimitPct && drawdownPct < this.config.globalDrawdownKillSwitchPct,
      dailyLossPct,
      drawdownPct
    };
  }

  getRiskPct(marketMode, profile, balance) {
    const base = this.config.risk.minPct + ((this.config.risk.maxPct - this.config.risk.minPct) * Math.min(1, Math.max(0, balance / this.startBalance - 0.5)));
    let adjusted = base * profile.riskMultiplier;
    if (marketMode === 'SIDEWAYS') adjusted *= 0.5;
    return Math.min(this.config.risk.maxPct, Math.max(this.config.risk.minPct * 0.5, adjusted));
  }

  calculatePositionSize({ balance, riskPct, entryPrice, stopPrice }) {
    const capitalAtRisk = balance * riskPct;
    const riskPerUnit = Math.max(Math.abs(entryPrice - stopPrice), entryPrice * 0.001);
    const quantity = capitalAtRisk / riskPerUnit;
    return { quantity, capitalAtRisk, riskPerUnit };
  }
}

module.exports = { RiskManager };
