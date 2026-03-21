const express = require('express');
const path = require('path');

class DashboardServer {
  constructor(strategy, config) {
    this.strategy = strategy;
    this.config = config;
    this.app = express();
    this.server = null;

    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '..', 'public')));

    this.app.get('/api/state', (_req, res) => {
      res.json(this.strategy.getState());
    });

    this.app.post('/api/toggle', (_req, res) => {
      const running = this.strategy.toggle();
      res.json({ running });
    });
  }

  start() {
    const port = process.env.PORT || 3000;
    this.server = this.app.listen(port, () => {
      console.log(`Dashboard listening on http://localhost:${port}`);
    });
  }

  stop(callback) {
    if (!this.server) return callback?.();
    this.server.close(callback);
  }
}

module.exports = { DashboardServer };
