// Twin-side data source: turns the captured Tekmetric snapshot into twin repair orders,
// persists the twin's own layout (spot + planned move per RO), and asks the service worker to
// open an RO in the Tekmetric tab. Tekmetric stays the source of record; the twin only adds
// "where is the car" and "where is it going next".
import { isOpenRO, statusIdOf } from './normalize.js';

export const IN_EXTENSION = !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);

export async function readSnapshot() {
  if (!IN_EXTENSION) return null;
  const r = await chrome.storage.session.get('tm');
  return r.tm || null;
}
export function onSnapshot(cb) {
  if (!IN_EXTENSION) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.tm) cb(changes.tm.newValue || null);
  });
}

// ---------- layout persistence (ids and spot names only, no customer data) ----------

export const layoutKey = (snap) => `layout:${snap?.meta?.origin || 'unknown'}:${(snap?.meta?.shopIds || []).join(',') || 'shop'}`;
export async function loadLayout(key) {
  const empty = { spots: {}, plans: [] };
  try {
    if (IN_EXTENSION) return { ...empty, ...((await chrome.storage.local.get(key))[key] || {}) };
    return { ...empty, ...JSON.parse(localStorage.getItem(key) || '{}') };
  } catch {
    return empty;
  }
}
export async function saveLayout(key, layout) {
  try {
    if (IN_EXTENSION) await chrome.storage.local.set({ [key]: layout });
    else localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    /* storage unavailable: layout lives for this page only */
  }
}

export async function openInTekmetric(ro) {
  if (!IN_EXTENSION) return { ok: false, reason: 'demo' };
  try {
    return await chrome.runtime.sendMessage({ type: 'openRO', tmId: ro.tmId, number: ro.number });
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}
export function openDataPage() {
  if (IN_EXTENSION) chrome.tabs.create({ url: chrome.runtime.getURL('capture.html') });
}

// ---------- mapping ----------

export const TM_STATUS = { 1: 'Estimate', 2: 'Work-in-Progress', 3: 'Complete' };

/** Open ROs from the snapshot, mapped to the twin's model (location and status are set by the twin). */
export function liveROs(snap) {
  const E = snap?.entities;
  if (!E) return [];
  const open = Object.values(E.ros).filter(isOpenRO);
  const cents = moneyIsCents(open);
  return open.map((r) => toTwin(r, E, cents));
}

// Tekmetric's published API reports money in cents (integers). If any captured amount has a
// fraction, the payloads are in dollars instead.
function moneyIsCents(ros) {
  for (const r of ros) {
    if (typeof r.totalSales === 'number' && !Number.isInteger(r.totalSales)) return false;
    for (const j of r.jobs || []) if (typeof j.subtotal === 'number' && !Number.isInteger(j.subtotal)) return false;
  }
  return true;
}

function toTwin(r, E, cents) {
  const c = E.customers[r.customerId];
  const v = E.vehicles[r.vehicleId];
  const parsed = parseVehicleName(r.vehicleName);
  const make = v?.make || parsed.make || 'Vehicle';
  const model = [v?.model, v?.subModel].filter(Boolean).join(' ') || parsed.model || '';
  const colorName = v?.color || r.color || '';
  const money = (x) => (typeof x === 'number' ? (cents ? x / 100 : x) : 0);
  const jobs = (r.jobs || []).filter((j) => !j.archived).map((j) => ({
    name: j.name || 'Job',
    part: partFor(`${j.name || ''} ${j.category || ''}`),
    hrs: Number(j.laborHours) || 0,
    total: money(j.subtotal),
    auth: !!j.authorized,
  }));
  const tech = E.employees[r.technicianId];
  const opened = r.createdDate ? `Opened ${fmtTime(r.createdDate)}` : null;
  return {
    id: `tm${r.id}`,
    tmId: r.id,
    number: r.number,
    tmStatusId: statusIdOf(r),
    label: r.label || null,
    tech: tech ? `${tech.firstName} ${String(tech.lastName || '').slice(0, 1)}.` : null,
    promised: fmtTime(r.promisedTime || r.appointmentStartTime) || '—',
    promisedLabel: r.promisedTime ? 'Promised' : 'Appointment',
    customer: {
      name: c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : r.customerName || `Customer #${r.customerId ?? '?'}`,
      phone: c?.phone || '—',
    },
    vehicle: {
      year: v?.year || parsed.year || '',
      make,
      model,
      body: bodyFor(make, model),
      color: colorHex(colorName, r.id),
      colorName: colorName || 'Not recorded',
      vin: v?.vin || '—',
      miles: Number(r.milesIn ?? v?.mileage) || 0,
    },
    concern: (r.concerns || []).join(' · ') || 'No concern recorded.',
    jobs,
    notes: [r.keytag ? `Keytag ${r.keytag}` : null, opened].filter(Boolean).join(' · '),
    createdDate: r.createdDate || null,
  };
}

function parseVehicleName(s) {
  const m = String(s || '').match(/^\s*(\d{4})?\s*(\S+)?\s*(.*)$/);
  return m ? { year: m[1] ? Number(m[1]) : '', make: m[2] || '', model: (m[3] || '').trim() } : {};
}

export function fmtTime(d) {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const today = new Date().toDateString() === t.toDateString();
  const time = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return today ? `Today ${time}` : `${t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

const PART_RULES = [
  ['brakes', /brake|rotor|\bpads?\b|caliper/i],
  ['battery', /batter|alternator|starter|charging/i],
  ['cooling', /\ba\/?c\b|air cond|condenser|compressor|radiator|coolant|thermostat|water pump|heater core|evap/i],
  ['suspension', /strut|shock|suspension|control arm|ball joint|tie rod|alignment|sway|bushing|steering/i],
  ['exhaust', /exhaust|muffler|catalytic|\bo2\b|oxygen sensor|heat shield/i],
  ['wheels', /tire|wheel|rotation|balance|tpms|inspection/i],
  ['engine', /oil|engine|spark|coil|filter|timing|belt|diagnos|check engine|\bcel\b|misfire|gasket|fuel|transmission|maintenance|\bpm\b|service/i],
];
export function partFor(text) {
  for (const [part, re] of PART_RULES) if (re.test(text)) return part;
  return 'other';
}

const TRUCKS = /f-?\s?1[05]0|f-?\s?[23]50|silverado|sierra|\bram\b|1500|2500|tacoma|tundra|frontier|titan|colorado|canyon|ranger|ridgeline|gladiator|maverick|santa cruz|cybertruck/i;
const VANS = /transit(?! connect)|express|savana|sprinter|promaster(?! city)|nv\s?\d{4}|econoline|e-?\s?[123]50/i;
const SUVS = /cr-?v|rav-?4|highlander|pilot|explorer|escape|tahoe|suburban|yukon|equinox|traverse|rogue|murano|pathfinder|armada|cherokee|wrangler|4runner|sequoia|expedition|edge|bronco|escalade|\bx[1-7]\b|\bq[3-8]\b|\bgx\b|\brx\b|\bnx\b|\bmdx\b|\brdx\b|cx-?\d|outback|forester|ascent|crosstrek|tucson|santa fe|palisade|sorento|telluride|sportage|durango|enclave|acadia|terrain|blazer|trailblazer|journey|compass|renegade|kona|venza|passport|hr-?v|kicks|xc[469]0|macan|cayenne|range rover|discovery|defender|model [xy]|sienna|odyssey|pacifica|carnival|caravan|transit connect|promaster city/i;
export function bodyFor(make, model) {
  const s = `${make} ${model}`;
  if (VANS.test(s)) return 'van';
  if (TRUCKS.test(s)) return 'truck';
  if (SUVS.test(s)) return 'suv';
  return 'sedan';
}

const COLORS = [
  [/white|pearl|ivory/i, '#ecece8'], [/black|ebony|onyx/i, '#1f2022'], [/silver/i, '#b9bdc1'],
  [/gr[ae]y|graphite|gunmetal|charcoal/i, '#6c7277'], [/maroon|burgundy|wine/i, '#5c1420'], [/red|ruby|crimson/i, '#8e1c24'],
  [/navy/i, '#152340'], [/blue/i, '#1f4b7a'], [/green/i, '#3d5a3c'], [/beige|tan|champagne|sand|cream/i, '#b6a684'],
  [/brown|bronze/i, '#5a4030'], [/gold/i, '#b08d3c'], [/orange/i, '#c46a1b'], [/yellow/i, '#d9b310'], [/purple|violet/i, '#4a2f63'],
];
const FALLBACK = ['#6c7277', '#b9bdc1', '#1f2022', '#ecece8', '#1f4b7a', '#8e1c24', '#3d5a3c'];
export function colorHex(name, seed) {
  for (const [re, hex] of COLORS) if (re.test(name || '')) return hex;
  const n = Math.abs(Number(seed) || String(seed).split('').reduce((a, ch) => a + ch.charCodeAt(0), 0));
  return FALLBACK[n % FALLBACK.length];
}
