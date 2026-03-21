const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

async function fetchState() {
  const response = await fetch('/api/state');
  return response.json();
}

async function toggleBot() {
  await fetch('/api/toggle', { method: 'POST' });
  await refresh();
}

function getSelectedSymbol() {
  return document.getElementById('symbolSelect').value || 'ALL';
}

function renderSymbolOptions(market) {
  const select = document.getElementById('symbolSelect');
  const symbols = ['ALL', ...Object.keys(market)];
  const current = select.value || 'ALL';
  select.innerHTML = symbols.map((symbol) => `<option value="${symbol}">${symbol}</option>`).join('');
  if (symbols.includes(current)) select.value = current;
}

function renderMarket(market) {
  const selected = getSelectedSymbol();
  return Object.values(market).filter((item) => selected === 'ALL' || item.pair === selected).map((item) => `
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
  const selected = getSelectedSymbol();
  const filtered = positions.filter((position) => selected === 'ALL' || position.pair === selected);
  if (!filtered.length) return '<p>No open positions.</p>';
  return filtered.map((position) => `
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
  const selected = getSelectedSymbol();
  const filtered = trades.filter((trade) => selected === 'ALL' || trade.pair === selected);
  if (!filtered.length) return '<p>No closed trades yet.</p>';
  return filtered.map((trade) => `
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
  renderSymbolOptions(state.market);
  document.getElementById('marketCards').innerHTML = renderMarket(state.market);
  document.getElementById('positions').innerHTML = renderPositions(state.openPositions);
  document.getElementById('trades').innerHTML = renderTrades(state.recentTrades);
  document.getElementById('logs').textContent = state.logs.join('\n');
}

document.getElementById('toggleButton').addEventListener('click', toggleBot);
setInterval(refresh, 2000);
refresh();


document.getElementById('symbolSelect').addEventListener('change', refresh);
