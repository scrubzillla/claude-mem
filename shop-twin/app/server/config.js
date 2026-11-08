// Configuration from environment variables (see .env.example). Secrets never leave the server.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const TEKMETRIC_HOSTS = {
  sandbox: 'https://sandbox.tekmetric.com',
  production: 'https://shop.tekmetric.com',
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function loadConfig(env = process.env) {
  const mode = String(env.TEKMETRIC_ENV || 'mock').toLowerCase();
  if (!['mock', 'sandbox', 'production'].includes(mode)) {
    throw new Error(`TEKMETRIC_ENV must be mock, sandbox or production (got "${mode}").`);
  }
  const writesDefault = mode === 'production' ? 'off' : 'on';
  const cfg = {
    mode,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8787),
    baseUrl: env.TEKMETRIC_BASE_URL || TEKMETRIC_HOSTS[mode] || null, // mock: filled in at boot
    clientId: env.TEKMETRIC_CLIENT_ID || '',
    clientSecret: env.TEKMETRIC_CLIENT_SECRET || '',
    shopId: env.TEKMETRIC_SHOP_ID ? Number(env.TEKMETRIC_SHOP_ID) : null,
    pollSeconds: Math.max(2, Number(env.POLL_SECONDS || (mode === 'mock' ? 4 : 30))),
    writes: String(env.TEKMETRIC_WRITES || writesDefault).toLowerCase() === 'on',
    passcode: env.SHOP_TWIN_PASSCODE || '',
    sessionSecret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
    dataDir: env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)),
    // Where "Open in Tekmetric" points. Unverified guess at Tekmetric's web URL; override if it's wrong.
    roUrlTemplate: env.TEKMETRIC_RO_URL_TEMPLATE || '{base}/admin/shop/{shopId}/repair-orders/{roId}/estimate',
    mockPort: Number(env.MOCK_PORT || 8788),
    mockTickSeconds: Number(env.MOCK_TICK_SECONDS || 30),
  };
  if (mode !== 'mock' && (!cfg.clientId || !cfg.clientSecret)) {
    throw new Error('Set TEKMETRIC_CLIENT_ID and TEKMETRIC_CLIENT_SECRET (copy .env.example to .env).');
  }
  if (!LOOPBACK.has(cfg.host) && !cfg.passcode) {
    throw new Error('HOST is not localhost, so set SHOP_TWIN_PASSCODE. The twin shows customer names and phone numbers.');
  }
  return cfg;
}
