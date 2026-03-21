const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

async function fetchState() {
  const response = await fetch('/api/state');
  return response.json();
}

async function toggleBot() {
  await fetch('/api/toggle', { method: 'POST' });
  await refresh();
}

function renderMarket(market) {
  return Object.values(market).map((item) => `
    <div class="market-item">
      <div><strong>${item.pair}</strong></div>
      <div>Price: ${fmt.format(item.price)}</div>
      <div>Mode: <span class="tag">${item.marketMode}</span></div>
      <div>AI Risk: ${(item.riskPct * 100).toFixed(2)}%</div>
      <div>Reason: ${item.reason}</div>
    </div>
  `).join('');
}

function renderPositions(positions) {
  if (!positions.length) return '<p>No open positions.</p>';
  return positions.map((position) => `
    <div class="position-item">
      <div><strong>${position.pair}</strong> ${position.side}</div>
      <div>Entry: ${fmt.format(position.entryPrice)}</div>
      <div>Current: ${fmt.format(position.currentPrice)}</div>
      <div>PnL: ${fmt.format(position.pnl + position.realizedPnl)}</div>
      <div>Time in trade: ${position.timeInTradeMinutes} min</div>
      <div>Trade reason: ${position.reason}</div>
    </div>
  `).join('');
}

function renderTrades(trades) {
  if (!trades.length) return '<p>No closed trades yet.</p>';
  return trades.map((trade) => `
    <div class="trade-item">
      <div><strong>${trade.pair}</strong> ${trade.side}</div>
      <div>Realized PnL: ${fmt.format(trade.realizedPnl)}</div>
      <div>Exit reason: ${trade.reason}</div>
    </div>
  `).join('');
}

async function refresh() {
  const state = await fetchState();
  document.getElementById('modePill').textContent = state.mode;
  document.getElementById('modePill').className = `pill ${state.mode.toLowerCase()}`;
  document.getElementById('toggleButton').textContent = state.running ? 'Stop' : 'Start';
  document.getElementById('balance').textContent = fmt.format(state.balance);
  document.getElementById('pnl').textContent = fmt.format(state.pnl);
  document.getElementById('exchange').textContent = state.exchange;
  document.getElementById('openCount').textContent = state.openPositions.length;
  document.getElementById('marketCards').innerHTML = renderMarket(state.market);
  document.getElementById('positions').innerHTML = renderPositions(state.openPositions);
  document.getElementById('trades').innerHTML = renderTrades(state.recentTrades);
  document.getElementById('logs').textContent = state.logs.join('\n');
}

document.getElementById('toggleButton').addEventListener('click', toggleBot);
setInterval(refresh, 2000);
refresh();
