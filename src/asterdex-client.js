const crypto = require('crypto');

class AsterDexClient {
  constructor({ apiKey, apiSecret, baseUrl = 'https://fapi.asterdex.com' }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = baseUrl;
  }

  createSignature(queryString) {
    return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
  }

  async request(path, params = {}, { method = 'GET', signed = false } = {}) {
    const url = new URL(path, this.baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });

    if (signed) {
      url.searchParams.set('timestamp', Date.now().toString());
      const signature = this.createSignature(url.searchParams.toString());
      url.searchParams.set('signature', signature);
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'X-MBX-APIKEY': this.apiKey } : {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AsterDex request failed (${response.status}): ${text}`);
    }

    return response.json();
  }

  async getCandles(symbol, interval, limit = 200) {
    const data = await this.request('/fapi/v1/klines', { symbol, interval, limit });
    return data.map((item) => ({
      openTime: Number(item[0]),
      open: Number(item[1]),
      high: Number(item[2]),
      low: Number(item[3]),
      close: Number(item[4]),
      volume: Number(item[5]),
    }));
  }

  async getTicker(symbol) {
    return this.request('/fapi/v1/ticker/price', { symbol });
  }

  async get24hTicker(symbol) {
    return this.request('/fapi/v1/ticker/24hr', { symbol });
  }

  async getBalance() {
    return this.request('/fapi/v2/balance', {}, { signed: true });
  }

  async placeOrder({ symbol, side, quantity }) {
    return this.request('/fapi/v1/order', {
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity,
    }, {
      method: 'POST',
      signed: true,
    });
  }
}

module.exports = {
  AsterDexClient,
};
