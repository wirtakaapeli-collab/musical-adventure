import fs from 'node:fs';
import path from 'node:path';

const LOG_DIR = path.resolve('logs');
const LOG_FILE = path.join(LOG_DIR, 'aster-bot.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function write(level, message, context = undefined) {
  ensureLogDir();
  const timestamp = new Date().toISOString();
  const payload = context ? ` ${JSON.stringify(context)}` : '';
  const line = `[${timestamp}] [${level}] ${message}${payload}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
}

export const logger = {
  info(message, context) {
    write('INFO', message, context);
  },
  warn(message, context) {
    write('WARN', message, context);
  },
  error(message, context) {
    write('ERROR', message, context);
  },
  decision(message, context) {
    write('DECISION', message, context);
  },
  trade(message, context) {
    write('TRADE', message, context);
  },
};
