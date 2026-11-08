// Shop Twin service worker.
// Receives JSON the Tekmetric tab loaded (via capture/bridge.js), keeps a small normalized
// snapshot in chrome.storage.session (memory only, cleared when the browser closes), records
// endpoint structure for the diagnostics report, and handles "open this RO in Tekmetric".
import {
  extractEntities, mergeEntities, sweepGone, prune, isOpenRO,
  endpointPattern, listKeyOf, isSensitiveUrl, skeleton,
} from './data/normalize.js';

const MAX_ENDPOINTS = 150;
const MAX_SHAPE_CHARS = 6000;

const fresh = () => ({
  entities: { ros: {}, customers: {}, vehicles: {}, employees: {} },
  lists: {},
  meta: { origin: null, updatedAt: 0, captures: 0, shopIds: [] },
  discovery: { endpoints: {} },
  links: { roTemplate: null, roKey: null, pending: null },
});

let state = null;
let loading = null;
function getState() {
  if (state) return Promise.resolve(state);
  loading ||= chrome.storage.session.get('tm').then((r) => (state = r.tm || fresh()));
  return loading;
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.session.set({ tm: state }), 300);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // async response
});

async function handle(msg, sender) {
  const s = await getState();
  switch (msg?.type) {
    case 'capture': return onCapture(s, msg, sender);
    case 'location': return onLocation(s, msg);
    case 'status': return { ok: true, ros: Object.values(s.entities.ros).filter(isOpenRO).length, updatedAt: s.meta.updatedAt };
    case 'openTwin': await openTwin(); return { ok: true };
    case 'openRO': return openRO(s, msg);
    case 'clear':
      state = fresh();
      await chrome.storage.session.set({ tm: state });
      return { ok: true };
    default: return { ok: false, error: 'unknown message' };
  }
}

function onCapture(s, msg, sender) {
  if (!msg.url || isSensitiveUrl(msg.url)) return { ok: true, skipped: true };
  const base = sender.origin || sender.url;
  const now = Date.now();
  const found = extractEntities(msg.body);
  const hits = { ro: found.ros.length, customer: found.customers.length, vehicle: found.vehicles.length, employee: found.employees.length };

  // discovery: structure only
  const ep = endpointPattern(msg.url, base);
  const key = `${msg.method} ${ep.host}${ep.pattern}`;
  const eps = s.discovery.endpoints;
  if (!eps[key] && Object.keys(eps).length >= MAX_ENDPOINTS) {
    const oldest = Object.entries(eps).sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
    if (oldest) delete eps[oldest[0]];
  }
  const d = (eps[key] ||= { method: msg.method, via: msg.kind, host: ep.host, pattern: ep.pattern, queryKeys: ep.queryKeys, count: 0, hits: { ro: 0, customer: 0, vehicle: 0, employee: 0 } });
  d.count += 1;
  d.lastStatus = msg.status;
  d.lastAt = now;
  for (const k of Object.keys(hits)) d.hits[k] = Math.max(d.hits[k], hits[k]);
  if (!d.shape || (hits.ro && !d.shapeHasRO)) {
    const sk = skeleton(msg.body);
    const str = JSON.stringify(sk);
    d.shape = str.length <= MAX_SHAPE_CHARS ? sk : `(structure too large to keep: ${str.length} chars)`;
    d.shapeHasRO = hits.ro > 0;
  }

  // entities
  const total = hits.ro + hits.customer + hits.vehicle + hits.employee;
  if (total) {
    const listKey = found.ros.length >= 2 ? listKeyOf(msg.method, msg.url, base) : null;
    let listN = 0;
    if (listKey) {
      const L = (s.lists[listKey] ||= { n: 0, at: 0 });
      L.n += 1;
      L.at = now;
      listN = L.n;
      const keys = Object.keys(s.lists);
      if (keys.length > 200) keys.sort((a, b) => s.lists[a].at - s.lists[b].at).slice(0, keys.length - 200).forEach((k) => delete s.lists[k]);
    }
    mergeEntities(s.entities, found, now, listKey, listN);
    sweepGone(s.entities, s.lists);
    prune(s.entities, now);
    s.meta.updatedAt = now;
    s.meta.origin = new URL(base).origin;
    s.meta.shopIds = [...new Set(Object.values(s.entities.ros).map((r) => r.shopId).filter((x) => x != null))];
    resolvePendingLink(s);
  }
  s.meta.captures += 1;
  persist();
  return { ok: true, hits };
}

// ---------- deep links: learn how Tekmetric addresses an RO from the user's own navigation ----------

const RO_PATH = /\/(repair-?orders?|ro)\/(\d+)/i;
function onLocation(s, msg) {
  let u;
  try { u = new URL(msg.href); } catch { return { ok: false }; }
  const m = u.pathname.match(RO_PATH);
  if (!m) return { ok: true };
  s.links.pending = { origin: u.origin, path: u.pathname, value: m[2], seg: m[0] };
  resolvePendingLink(s);
  persist();
  return { ok: true };
}
function resolvePendingLink(s) {
  const p = s.links.pending;
  if (!p) return;
  const ros = Object.values(s.entities.ros);
  const byId = ros.some((r) => String(r.id) === p.value);
  const byNumber = !byId && ros.some((r) => String(r.number) === p.value);
  if (!byId && !byNumber) return;
  const seg = p.seg.replace(p.value, '{v}');
  s.links.roTemplate = p.origin + p.path.replace(p.seg, seg);
  s.links.roKey = byId ? 'id' : 'number';
  s.links.pending = null;
}

async function tekmetricTabs() {
  const patterns = chrome.runtime.getManifest().host_permissions || [];
  const tabs = await chrome.tabs.query({ url: patterns });
  return tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
}

async function openRO(s, msg) {
  const [tab] = await tekmetricTabs();
  if (!s.links.roTemplate) {
    if (tab) await focusTab(tab);
    return { ok: false, reason: tab ? 'learn' : 'notab' };
  }
  const value = s.links.roKey === 'number' ? msg.number : msg.tmId;
  const url = s.links.roTemplate.replace('{v}', encodeURIComponent(value));
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    await focusTab(tab);
  } else {
    await chrome.tabs.create({ url });
  }
  return { ok: true };
}
async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
}

// ---------- the twin page ----------

async function openTwin() {
  const url = chrome.runtime.getURL('twin.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs[0]) return focusTab(tabs[0]);
  return chrome.tabs.create({ url });
}
chrome.action.onClicked.addListener(() => openTwin());
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install') openTwin();
});
