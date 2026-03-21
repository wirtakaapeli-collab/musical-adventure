class PositionManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.balance = config.startingBalance;
    this.openPositions = [];
    this.closedTrades = [];
  }

  applyExecutionPrice(price, side, mode) {
    const slip = this.config.slippage;
    if (mode === 'paper') return side === 'LONG' ? price * (1 + slip) : price * (1 - slip);
    return price;
  }

  openPosition({ pair, side, quantity, entryPrice, stopLoss, tp1, trailingStop, riskPct, reason, mode }) {
    const executed = this.applyExecutionPrice(entryPrice, side, mode);
    const fee = executed * quantity * this.config.fees.taker;
    this.balance -= fee;
    const position = {
      id: `${pair}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      pair,
      side,
      quantity,
      initialQuantity: quantity,
      entryPrice: executed,
      stopLoss,
      tp1,
      trailingStop,
      riskPct,
      openedAt: Date.now(),
      reason,
      tp1Hit: false,
      realizedPnl: 0,
      fees: fee,
      mode
    };
    this.openPositions.push(position);
    this.logger(`ENTRY ${pair} ${side} qty=${quantity.toFixed(6)} entry=${executed.toFixed(4)} risk=${(riskPct * 100).toFixed(2)}% reason=${reason}`);
    return position;
  }

  closePartial(position, price, fraction, reason) {
    const quantity = position.quantity * fraction;
    const pnl = this.realizePnl(position, quantity, price);
    position.quantity -= quantity;
    position.realizedPnl += pnl;
    position.tp1Hit = true;
    this.logger(`EXIT ${position.pair} partial qty=${quantity.toFixed(6)} pnl=${pnl.toFixed(2)} reason=${reason}`);
    return pnl;
  }

  closePosition(position, price, reason) {
    const pnl = this.realizePnl(position, position.quantity, price);
    position.realizedPnl += pnl;
    const index = this.openPositions.findIndex((p) => p.id === position.id);
    if (index >= 0) this.openPositions.splice(index, 1);
    const closed = {
      ...position,
      closedAt: Date.now(),
      exitPrice: price,
      realizedPnl: position.realizedPnl,
      reason,
      initialRisk: Math.abs(position.entryPrice - position.stopLoss) * position.initialQuantity
    };
    this.closedTrades.unshift(closed);
    if (this.closedTrades.length > 100) this.closedTrades.pop();
    this.logger(`EXIT ${position.pair} full pnl=${position.realizedPnl.toFixed(2)} reason=${reason} balance=${this.balance.toFixed(2)}`);
    return closed;
  }

  realizePnl(position, quantity, exitPrice) {
    const executed = this.applyExecutionPrice(exitPrice, position.side === 'LONG' ? 'SHORT' : 'LONG', position.mode);
    const gross = position.side === 'LONG'
      ? (executed - position.entryPrice) * quantity
      : (position.entryPrice - executed) * quantity;
    const fee = executed * quantity * this.config.fees.taker;
    const net = gross - fee;
    this.balance += net;
    position.fees += fee;
    return net;
  }

  updateTrailing(position, trailingStop) {
    position.trailingStop = trailingStop;
  }

  getPairPositions(pair) {
    return this.openPositions.filter((position) => position.pair === pair);
  }
}

module.exports = { PositionManager };
