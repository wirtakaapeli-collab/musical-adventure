# Smart Bot V3 for AsterDEX

Smart Bot V3 is a modular Node.js crypto trading bot built for **AsterDex** with **paper trading enabled by default** and **live trading hard-gated behind explicit configuration**.

## Safety defaults

- `mode` defaults to `paper`
- `liveEnabled` defaults to `false`
- The strategy downgrades to paper execution unless `mode=live`, `liveEnabled=true`, and API credentials are present
- Logs are shared between paper and live-safe flows for full visibility

## Features

- Market mode engine: `TRENDING`, `SIDEWAYS`, `VOLATILE`
- Weighted entry scoring across trend, pullback, volume, confirmation, volatility
- ATR stop, TP1 partial, dynamic trailing stop, timeout exit, smart invalidation exit, flip handling
- Re-entry and scale-in controls
- Dynamic risk sizing, daily loss limit, drawdown kill switch, and trade throttling
- Paper simulator with fees and slippage
- Web dashboard with start/stop controls, mode indicator, balances, positions, PnL, logs

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Configuration

Edit `config.json` to manage pairs, balances, thresholds, ATR multipliers, risk, and optional live settings.
