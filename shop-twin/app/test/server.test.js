import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/http.js';
import { startMockTekmetric } from '../server/mock-tekmetric.js';
import { MemoryStore } from '../server/store.js';
import { TekmetricClient, TekmetricError } from '../server/tekmetric.js';
import { ActionError, ShopTwin } from '../server/twin.js';

async function setup(t, { store = new MemoryStore(), mock: mockOpts = {} } = {}) {
  const mock = await startMockTekmetric({ tickSeconds: 0, ...mockOpts });
  t.after(() => mock.close());
  const client = new TekmetricClient({ baseUrl: mock.url, clientId: mock.clientId, clientSecret: mock.clientSecret, maxPerSecond: 500 });
  const twin = new ShopTwin({ client, shopId: 1, store, writes: true, log: () => {} });
  await twin.load();
  await twin.sync();
  return { mock, client, twin, store };
}
const ro = (snap, number) => snap.ros.find((r) => r.number === number);
const at = (snap, number) => ro(snap, number)?.location ?? null;

test('bad client credentials are rejected with a clear error', async (t) => {
  const mock = await startMockTekmetric({ tickSeconds: 0 });
  t.after(() => mock.close());
  const client = new TekmetricClient({ baseUrl: mock.url, clientId: mock.clientId, clientSecret: 'wrong' });
  await assert.rejects(client.authenticate(), (e) => e instanceof TekmetricError && e.status === 401);
});

test('client pages through results and backs off on 429', async (t) => {
  let calls = 0;
  const pages = [{ content: [1, 2], last: false }, { content: [3], last: true }];
  const fetchImpl = async (url) => {
    calls += 1;
    const u = new URL(url);
    if (u.pathname.endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 't', scope: '1' }), { status: 200 });
    if (calls === 2) return new Response('', { status: 429 }); // first data call is rate limited
    return new Response(JSON.stringify(pages[Number(u.searchParams.get('page'))]), { status: 200 });
  };
  const client = new TekmetricClient({ baseUrl: 'https://example.test', clientId: 'a', clientSecret: 'b', fetchImpl, maxPerSecond: 500 });
  const t0 = Date.now();
  const all = await client.pages('/api/v1/repair-orders', { shop: 1 });
  assert.deepEqual(all, [1, 2, 3]);
  assert.ok(Date.now() - t0 >= 1900, 'waited about 2 seconds after the 429');
});

test('first sync lays out the shop the way the morning looks', async (t) => {
  const { twin, mock } = await setup(t);
  const s = twin.snapshot();
  assert.equal(s.ros.length, 10);
  assert.deepEqual([10421, 10422, 10423, 10428, 10427].map((n) => at(s, n)), ['B1', 'B2', 'B3', 'B4', 'B5'], 'WIP with a tech fill bays first');
  assert.equal(at(s, 10430), 'S1', 'sixth WIP waits on the side lot');
  assert.equal(ro(s, 10430).status, 'approved');
  assert.equal(ro(s, 10422).status, 'parts', 'Waiting on Parts label');
  assert.deepEqual([at(s, 10425), at(s, 10429)], ['P1', 'P2'], 'completed cars in the front lot');
  assert.equal(at(s, 10424), 'D1', "today's estimate at drop-off");
  assert.equal(at(s, 10426), null, 'older estimate is not checked in');
  assert.equal(ro(s, 10421).jobs[0].total, 489.12, 'cents converted to dollars');
  assert.equal(ro(s, 10421).customer.name, 'Dana Whitfield');
  assert.equal(ro(s, 10421).vehicle.body, 'sedan');
  assert.equal(ro(s, 10422).vehicle.body, 'truck');
  assert.equal(ro(s, 10428).vehicle.body, 'van');
  assert.equal(s.appointments.length, 3);
  assert.equal(s.meta.shop.name, 'Test Shop Auto Repair');
});

test('moves and plans are validated', async (t) => {
  const { twin, mock } = await setup(t);
  assert.throws(() => twin.move('tm5010', 'B1'), ActionError, 'bay 1 is occupied');
  twin.move('tm5010', 'P3');
  assert.equal(at(twin.snapshot(), 10430), 'P3');
  twin.plan('tm5010', 'B1');
  assert.throws(() => twin.plan('tm5006', 'B1'), /reserved/);
  assert.throws(() => twin.plan('tm5006', 'P1'), /Only busy bays/);
  assert.throws(() => twin.move('tm5006', 'B9'), /Unknown spot/);
  twin.unplan('tm5010');
  assert.equal(twin.snapshot().plans.length, 0);
});

test('auto-plan queues waiting cars behind the bay closest to free', async (t) => {
  const { twin, mock } = await setup(t);
  assert.equal(twin.autoplan(), 1);
  assert.deepEqual(twin.snapshot().plans, [['tm5010', 'B1']]);
});

test('a shop day flows through: approval, completion, pickup, arrival', async (t) => {
  const { twin, mock } = await setup(t);
  mock.advance(); await twin.sync(); // estimate #10424 approved
  assert.equal(ro(twin.snapshot(), 10424).status, 'approved');
  mock.advance(); await twin.sync(); // #10423 complete
  assert.equal(ro(twin.snapshot(), 10423).status, 'ready');
  assert.equal(at(twin.snapshot(), 10423), 'B3', 'stays in its bay until someone moves it');
  mock.advance(); await twin.sync(); // #10425 posted
  assert.equal(ro(twin.snapshot(), 10425), undefined, 'posted RO leaves');
  mock.advance(); await twin.sync(); // appointment arrives as #10431
  const s = twin.snapshot();
  assert.equal(at(s, 10431), 'D2', 'new estimate parks at the next drop-off');
  assert.equal(s.appointments.length, 2, 'arrived appointment drops off the expected list');
  assert.match(s.activity.map((a) => a.msg).join('\n'), /New RO #10431/);
});

test('assigning a technician writes to Tekmetric', async (t) => {
  const { twin, mock } = await setup(t);
  await twin.assignTech('tm5007', 104);
  assert.equal(mock.db.repairOrders.get(5007).technicianId, 104);
  await twin.sync();
  assert.equal(ro(twin.snapshot(), 10427).tech, 'Jorge S.');
});

test('positions survive a server restart', async (t) => {
  const store = new MemoryStore();
  const a = await setup(t, { store });
  a.twin.move('tm5010', 'P3');
  a.twin.plan('tm5006', 'B2');
  const b = await setup(t, { store });
  assert.equal(at(b.twin.snapshot(), 10430), 'P3');
  assert.deepEqual(b.twin.snapshot().plans, [['tm5006', 'B2']]);
});

// ---------------- HTTP: every screen sees the same shop ----------------

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}
function stream(base, headers = {}) {
  const ctrl = new AbortController();
  const ready = fetch(`${base}/api/events`, { headers, signal: ctrl.signal }).then((r) => r.body.getReader());
  const dec = new TextDecoder();
  let buf = '';
  return {
    close: () => ctrl.abort(),
    async next(pred, ms = 5000) {
      const reader = await ready;
      const until = Date.now() + ms;
      for (;;) {
        const events = buf.split('\n\n');
        buf = events.pop();
        for (const e of events) {
          const line = e.split('\n').find((l) => l.startsWith('data: '));
          if (line) {
            const st = JSON.parse(line.slice(6));
            if (pred(st)) return st;
          }
        }
        if (Date.now() > until) throw new Error('timed out waiting for state');
        const { value, done } = await reader.read();
        if (done) throw new Error('stream closed');
        buf += dec.decode(value, { stream: true });
      }
    },
  };
}

test('two screens see the same move', async (t) => {
  const { twin, mock } = await setup(t);
  const server = createApp({ twin, cfg: { passcode: '', sessionSecret: 'x' }, mock, log: () => {} });
  const base = await listen(server);
  const screenA = stream(base);
  const screenB = stream(base);
  await screenA.next(() => true);
  await screenB.next(() => true);
  const res = await fetch(`${base}/api/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roId: 'tm5010', spotId: 'P4' }) });
  assert.equal(res.status, 200);
  const moved = (st) => st.ros.find((r) => r.id === 'tm5010')?.location === 'P4';
  await screenA.next(moved);
  await screenB.next(moved);
  const bad = await fetch(`${base}/api/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roId: 'tm5006', spotId: 'B1' }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Bay 1 has RO #10421/);
  screenA.close(); screenB.close();
  await new Promise((r) => server.close(r));
});

test('passcode protects the twin and cross-site posts are refused', async (t) => {
  const { twin, mock } = await setup(t);
  const server = createApp({ twin, cfg: { passcode: 'bay5', sessionSecret: 'secret' }, mock, log: () => {} });
  const base = await listen(server);
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  const page = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  const wrong = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"passcode":"nope"}' });
  assert.equal(wrong.status, 401);
  const ok = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"passcode":"bay5"}' });
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  const state = await fetch(`${base}/api/state`, { headers: { cookie } });
  assert.equal(state.status, 200);
  assert.ok(!JSON.stringify(await state.json()).includes('mock-client-secret'), 'no secret in the state');
  const csrf = await fetch(`${base}/api/move`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"roId":"tm5010","spotId":"P5"}' });
  assert.equal(csrf.status, 403);
  await new Promise((r) => server.close(r));
});
