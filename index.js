const fs = require('fs');
const path = require('path');
const { Strategy } = require('./core/strategy');
const { DashboardServer } = require('./ui/dashboardServer');

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

const config = loadConfig();
const strategy = new Strategy(config);
const dashboard = new DashboardServer(strategy, config);

dashboard.start();
strategy.start();

process.on('SIGINT', () => {
  strategy.stop();
  dashboard.stop(() => process.exit(0));
});

process.on('SIGTERM', () => {
  strategy.stop();
  dashboard.stop(() => process.exit(0));
});
