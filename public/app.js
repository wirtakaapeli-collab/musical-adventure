const tokenKey = 'asterdex-token';
let token = localStorage.getItem(tokenKey) || '';
let poller = null;

const loginCard = document.getElementById('loginCard');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const settingsForm = document.getElementById('settingsForm');

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }

  return response.json();
}

function money(value) {
  return new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function signed(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function fillSettings(settings) {
  Object.entries(settings).forEach(([key, value]) => {
    if (key === 'apiKey' || key === 'apiSecret' || key === 'hasApiKey' || key === 'hasApiSecret') return;
    const input = settingsForm.elements.namedItem(key);
    if (!input) return;
    input.value = String(value);
  });
}

function renderTrades(trades) {
  const node = document.getElementById('trades');
  if (!trades.length) {
    node.innerHTML = '<div class="log-item">Ei vielä suljettuja tradeja.</div>';
    return;
  }
  node.innerHTML = trades.map((trade) => `
    <div class="table-row">
      <div><small>Suunta</small><div>${trade.side}</div></div>
      <div><small>Entry → Exit</small><div>${trade.entryPrice.toFixed(2)} → ${trade.exitPrice.toFixed(2)}</div></div>
      <div><small>PnL</small><div class="${trade.realizedPnl >= 0 ? 'positive' : 'negative'}">${signed(trade.realizedPnl)}</div></div>
      <div><small>Syy</small><div>${trade.closeReason}</div></div>
      <div><small>Aika</small><div>${new Date(trade.closedAt).toLocaleString('fi-FI')}</div></div>
    </div>
  `).join('');
}

function renderLogs(logs) {
  const node = document.getElementById('logs');
  node.innerHTML = logs.map((entry) => `
    <div class="log-item">
      <strong>${entry.level.toUpperCase()}</strong>
      <div>${entry.message}</div>
      <small>${new Date(entry.timestamp).toLocaleString('fi-FI')}</small>
    </div>
  `).join('');
}

function renderState(state) {
  loginCard.classList.add('hidden');
  dashboard.classList.remove('hidden');
  fillSettings(state.settings);

  document.getElementById('balance').textContent = money(state.wallet.balance);
  document.getElementById('equity').textContent = money(state.wallet.equity);
  document.getElementById('livePnl').textContent = signed(state.wallet.unrealizedPnl);
  document.getElementById('livePnl').className = state.wallet.unrealizedPnl >= 0 ? 'positive' : 'negative';
  document.getElementById('realizedPnl').textContent = signed(state.wallet.realizedPnl);
  document.getElementById('realizedPnl').className = state.wallet.realizedPnl >= 0 ? 'positive' : 'negative';
  document.getElementById('exposure').textContent = money(state.wallet.exposure);
  document.getElementById('winRate').textContent = `${state.metrics.winRate}%`;
  document.getElementById('statusBadge').textContent = state.controls.running ? 'RUNNING' : 'STOPPED';
  document.getElementById('modeBadge').textContent = state.settings.paperTrading ? 'PAPER' : 'LIVE';
  document.getElementById('symbolText').textContent = state.settings.symbol;
  document.getElementById('marketPrice').textContent = state.market.price ? money(state.market.price) : '-';
  document.getElementById('marketChange').textContent = `${Number(state.market.changePct || 0).toFixed(2)}%`;
  document.getElementById('lastSignal').textContent = state.metrics.lastSignal;
  document.getElementById('strategyScore').textContent = String(state.metrics.strategyScore);
  document.getElementById('positionSummary').textContent = state.position
    ? `${state.position.side} ${state.position.quantity} @ ${state.position.entryPrice.toFixed(2)}`
    : 'Ei avointa positiota';

  const apiKeyInput = settingsForm.elements.namedItem('apiKey');
  const apiSecretInput = settingsForm.elements.namedItem('apiSecret');
  apiKeyInput.placeholder = state.settings.hasApiKey ? 'API key tallennettu' : 'AsterDex API key';
  apiSecretInput.placeholder = state.settings.hasApiSecret ? 'API secret tallennettu' : 'AsterDex API secret';

  renderTrades(state.trades);
  renderLogs(state.logs.slice(0, 20));
}

async function refresh() {
  try {
    const state = await api('/api/state');
    renderState(state);
  } catch (error) {
    console.error(error);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const formData = new FormData(loginForm);
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: formData.get('username'),
        pin: formData.get('pin'),
      }),
    });
    token = data.token;
    localStorage.setItem(tokenKey, token);
    renderState(data.state);
    if (!poller) poller = setInterval(refresh, 3000);
  } catch (error) {
    loginError.textContent = error.message;
  }
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(settingsForm);
  const payload = Object.fromEntries(formData.entries());
  payload.paperTrading = payload.paperTrading === 'true';
  try {
    const state = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderState(state);
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('startBtn').addEventListener('click', async () => {
  const state = await api('/api/control/start', { method: 'POST' });
  renderState(state);
});

document.getElementById('stopBtn').addEventListener('click', async () => {
  const state = await api('/api/control/stop', { method: 'POST' });
  renderState(state);
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  const state = await api('/api/reset', { method: 'POST' });
  renderState(state);
});

if (token) {
  refresh();
  poller = setInterval(refresh, 3000);
}
