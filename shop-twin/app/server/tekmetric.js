// Tekmetric API client, written against https://api.tekmetric.com (v1).
// - Auth: POST /api/v1/oauth/token, Basic base64(client_id:client_secret), grant_type=client_credentials.
//   The access token stays valid until revoked; scope is a space-separated list of shop ids.
// - Lists are paged: size max 100, page starts at 0, response { content, last, ... }.
// - Rate limit: 600 requests/minute (sandbox 300). 429 → exponential backoff (2s, 4s, 8s ... max 60s).
// - Money fields are integers in cents.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TekmetricError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TekmetricError';
    this.status = status;
  }
}

export class TekmetricClient {
  constructor({ baseUrl, clientId, clientSecret, fetchImpl = globalThis.fetch, maxPerSecond = 4, log = () => {}, maxRetries = 6 }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.gapMs = 1000 / maxPerSecond;
    this.nextSlot = 0;
    this.log = log;
    this.maxRetries = maxRetries;
    this.token = null;
    this.shopIds = [];
  }

  async authenticate() {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this.fetch(`${this.baseUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new TekmetricError(`Tekmetric rejected the client ID or secret (HTTP ${res.status}).`, res.status);
    const body = await res.json();
    this.token = body.access_token;
    this.shopIds = String(body.scope || '').split(/\s+/).filter(Boolean).map(Number);
    return this.shopIds;
  }

  // Spread requests out evenly; the docs warn that repeated bursts can lead to further restrictions.
  async throttle() {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.gapMs;
    if (slot > now) await sleep(slot - now);
  }

  async request(method, path, { query, body } = {}, attempt = 0) {
    if (!this.token) await this.authenticate();
    await this.throttle();
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, v);
    }
    const res = await this.fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 && attempt === 0) {
      this.token = null; // revoked or expired: get a new one once
      return this.request(method, path, { query, body }, attempt + 1);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
      const wait = Math.min(2 ** (attempt + 1) * 1000 + Math.random() * 1000, 60000);
      this.log(`Tekmetric ${res.status} on ${method} ${path}; retrying in ${(wait / 1000).toFixed(1)}s`);
      await sleep(wait);
      return this.request(method, path, { query, body }, attempt + 1);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new TekmetricError(`Tekmetric ${method} ${path} failed with HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, res.status);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async pages(path, query = {}) {
    const all = [];
    for (let page = 0; page < 100; page++) {
      const r = await this.request('GET', path, { query: { ...query, size: 100, page } });
      if (Array.isArray(r)) return all.concat(r);
      const items = r?.content || [];
      all.push(...items);
      if (r?.last !== false || items.length === 0) break;
    }
    return all;
  }

  shops() { return this.request('GET', '/api/v1/shops'); }
  /** Open repair orders: 1 Estimate, 2 Work-in-Progress, 3 Complete. */
  openRepairOrders(shopId) { return this.pages('/api/v1/repair-orders', { shop: shopId, repairOrderStatusId: [1, 2, 3] }); }
  customer(id) { return this.request('GET', `/api/v1/customers/${id}`); }
  vehicle(id) { return this.request('GET', `/api/v1/vehicles/${id}`); }
  employees(shopId) { return this.pages('/api/v1/employees', { shop: shopId }); }
  appointments(shopId, start, end) { return this.pages('/api/v1/appointments', { shop: shopId, start, end, includeDeleted: false }); }
  /** Writable: keyTag, milesIn, milesOut, technicianId, serviceWriterId, customerTimeOut. */
  updateRepairOrder(id, patch) { return this.request('PATCH', `/api/v1/repair-orders/${id}`, { body: patch }); }
}
