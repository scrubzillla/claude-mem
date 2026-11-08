// Map Tekmetric API records to the twin's repair-order model. Timestamps stay ISO strings so each
// browser formats them in the shop's local time zone.

export const TM_STATUS = { 1: 'Estimate', 2: 'Work-in-Progress', 3: 'Complete', 4: 'Saved for Later', 5: 'Posted', 6: 'Accounts Receivable', 7: 'Deleted' };
export const OPEN_STATUS = new Set([1, 2, 3]);

const cents = (x) => (typeof x === 'number' ? x / 100 : 0);
const personName = (p) => (p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '');
export const shortName = (e) => (e ? `${e.firstName || ''} ${String(e.lastName || '').slice(0, 1)}${e.lastName ? '.' : ''}`.trim() : null);

function primaryPhone(phone) {
  if (!Array.isArray(phone)) return phone || null;
  const p = phone.find((x) => x && x.primary) || phone[0];
  return p ? p.number : null;
}

/**
 * @param ro        Tekmetric repair order (GET /api/v1/repair-orders)
 * @param lookups   { customers: Map, vehicles: Map, employees: Map } keyed by id
 */
export function toTwinRO(ro, { customers, vehicles, employees }) {
  const c = customers.get(ro.customerId);
  const v = vehicles.get(ro.vehicleId);
  const jobs = (ro.jobs || []).filter((j) => !j.archived).map((j) => ({
    id: j.id,
    name: j.name || 'Job',
    part: partFor(`${j.name || ''} ${j.jobCategoryName || ''}`),
    hrs: Number(j.laborHours) || 0,
    total: cents(j.subtotal),
    auth: !!j.authorized,
    techId: j.technicianId ?? null,
    labor: (j.labor || []).map((l) => ({
      name: l.name || j.name || 'Labor',
      hours: Number(l.hours) || 0,
      total: cents(Math.round((Number(l.rate) || 0) * (Number(l.hours) || 0))),
      done: !!l.complete,
    })),
    parts: (j.parts || []).map((x) => ({
      name: x.name || x.description || [x.brand, x.model].filter(Boolean).join(' ') || 'Part',
      brand: x.brand || null,
      number: x.partNumber || null,
      qty: Number(x.quantity) || 1,
      total: cents(Math.round((Number(x.retail) || 0) * (Number(x.quantity) || 1))),
      status: partStatusName(x.partStatus),
    })),
  }));
  const techId = ro.technicianId ?? jobs.find((j) => j.techId)?.techId ?? null;
  const make = v?.make || 'Vehicle';
  const model = [v?.model, v?.subModel].filter(Boolean).join(' ');
  const colorName = v?.color || '';
  return {
    id: `tm${ro.id}`,
    tmId: ro.id,
    number: ro.repairOrderNumber,
    tmStatusId: ro.repairOrderStatus?.id ?? null,
    tmStatusName: TM_STATUS[ro.repairOrderStatus?.id] || ro.repairOrderStatus?.name || 'Open',
    label: ro.repairOrderLabel?.name || null,
    labelColor: ro.repairOrderLabel ? (ro.color || null) : null,
    total: typeof ro.totalSales === 'number' ? cents(ro.totalSales) : jobs.reduce((s, j) => s + j.total, 0),
    customLabel: ro.repairOrderCustomLabel?.name || null,
    technicianId: techId,
    tech: shortName(employees.get(techId)),
    promisedAt: ro.customerTimeOut || ro.appointmentStartTime || null,
    promisedLabel: ro.customerTimeOut ? 'Promised' : 'Appointment',
    createdDate: ro.createdDate || null,
    updatedDate: ro.updatedDate || null,
    keytag: ro.keytag || null,
    customer: {
      name: personName(c) || `Customer #${ro.customerId ?? '?'}`,
      phone: primaryPhone(c?.phone) || '—',
    },
    vehicle: {
      year: v?.year || '',
      make,
      model,
      body: bodyFor(make, model),
      color: colorHex(colorName, ro.vehicleId ?? ro.id),
      colorName: colorName || 'Not recorded',
      vin: v?.vin || '—',
      miles: Number(ro.milesIn ?? v?.mileage) || 0,
    },
    concern: (ro.customerConcerns || []).map((x) => x?.concern).filter(Boolean).join(' · ') || 'No concern recorded.',
    jobs,
  };
}

// partStatus is null in Tekmetric's example; when present it may be an object or a code string.
function partStatusName(st) {
  if (!st) return null;
  if (typeof st === 'string') return st.replace(/_/g, ' ').toLowerCase();
  return String(st.name || st.code || '').replace(/_/g, ' ').toLowerCase() || null;
}

/** Tekmetric's three board columns, with money, car count and label breakdown for each. */
export const COLUMNS = [[1, 'estimate', 'Estimates'], [2, 'wip', 'In progress'], [3, 'complete', 'Completed']];
export function columnTotals(ros) {
  return COLUMNS.map(([statusId, key, name]) => {
    const list = ros.filter((r) => r.tmStatusId === statusId);
    const labels = new Map();
    for (const r of list) {
      const n = r.label || 'No label';
      const e = labels.get(n) || { name: n, color: r.label ? r.labelColor : null, count: 0, total: 0 };
      e.count++; e.total += r.total || 0; labels.set(n, e);
    }
    return {
      key, name, count: list.length,
      total: Math.round(list.reduce((s, r) => s + (r.total || 0), 0) * 100) / 100,
      labels: [...labels.values()].sort((a, b) => (a.name === 'No label') - (b.name === 'No label') || b.count - a.count),
    };
  });
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

const VANS = /transit(?! connect)|express|savana|sprinter|promaster(?! city)|nv\s?\d{4}|econoline|e-?\s?[123]50/i;
const TRUCKS = /f-?\s?1[05]0|f-?\s?[23]50|silverado|sierra|\bram\b|tacoma|tundra|frontier|titan|colorado|canyon|ranger|ridgeline|gladiator|maverick|santa cruz|cybertruck/i;
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
  return FALLBACK[Math.abs(Number(seed) || 0) % FALLBACK.length];
}
