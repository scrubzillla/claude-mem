// Shop Twin server entry point.
//   TEKMETRIC_ENV=mock       → starts a simulated Tekmetric API (no keys needed)
//   TEKMETRIC_ENV=sandbox    → https://sandbox.tekmetric.com with your client ID/secret
//   TEKMETRIC_ENV=production → https://shop.tekmetric.com
import { loadConfig } from './config.js';
import { createApp } from './http.js';
import { startMockTekmetric } from './mock-tekmetric.js';
import { JsonStore } from './store.js';
import { TekmetricClient } from './tekmetric.js';
import { ShopTwin } from './twin.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const cfg = loadConfig();
  let mock = null;
  if (cfg.mode === 'mock') {
    mock = await startMockTekmetric({ port: cfg.mockPort, tickSeconds: cfg.mockTickSeconds });
    cfg.baseUrl = mock.url;
    cfg.clientId = mock.clientId;
    cfg.clientSecret = mock.clientSecret;
    log(`Mock Tekmetric API on ${mock.url} (simulated shop day; ${cfg.mockTickSeconds > 0 ? `a new event every ${cfg.mockTickSeconds}s` : 'use Advance shop day to move it along'})`);
  }

  const client = new TekmetricClient({
    baseUrl: cfg.baseUrl, clientId: cfg.clientId, clientSecret: cfg.clientSecret,
    // Stay well under Tekmetric's limits: production 600/min, sandbox 300/min.
    maxPerSecond: cfg.mode === 'production' ? 6 : cfg.mode === 'sandbox' ? 3 : 50, log,
  });
  const shopIds = await client.authenticate();
  if (!shopIds.length) throw new Error('These Tekmetric credentials are not connected to any shop yet. The shop owner must grant access first.');
  const shopId = cfg.shopId ?? shopIds[0];
  if (!shopIds.includes(shopId)) throw new Error(`TEKMETRIC_SHOP_ID ${shopId} is not in this token's scope (${shopIds.join(', ')}).`);
  log(`Authenticated with Tekmetric ${cfg.mode}; shops in scope: ${shopIds.join(', ')}; showing shop ${shopId}`);

  const webBase = cfg.mode === 'mock' ? null : cfg.baseUrl;
  const twin = new ShopTwin({
    client, shopId, store: new JsonStore(cfg.dataDir, shopId), writes: cfg.writes, log,
    meta: { mode: cfg.mode },
    roUrl: (r) => (webBase ? cfg.roUrlTemplate.replace('{base}', webBase).replace('{shopId}', shopId).replace('{roId}', r.tmId).replace('{roNumber}', r.number) : null),
  });
  await twin.load();

  // Open the page right away; the first pull (every customer and vehicle) can take a few seconds.
  const server = createApp({ twin, cfg, mock, log });
  server.listen(cfg.port, cfg.host, () => {
    log(`Shop Twin: http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}  (polling every ${cfg.pollSeconds}s, writes ${cfg.writes ? 'on' : 'off'}${cfg.passcode ? ', passcode on' : ''})`);
  });
  await twin.sync();
  log(twin.error ? `First sync failed: ${twin.error}` : `First sync done: ${twin.ros.size} open repair orders`);
  setInterval(() => twin.sync(), cfg.pollSeconds * 1000);
  const stop = async () => {
    await twin.store.flush();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(`Shop Twin could not start: ${e.message}`);
  process.exit(1);
});
