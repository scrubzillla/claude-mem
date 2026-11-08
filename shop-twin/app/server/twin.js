// The shop twin for one shop: pulls open repair orders from Tekmetric, keeps the twin's own
// state (spots, planned moves, activity) and is the single source every screen renders.
import { EventEmitter } from 'node:events';
import { SPOT_DEFS } from '../web/layout.js';
import { OPEN_STATUS, columnTotals, shortName, toTwinRO } from './mapping.js';

const SPOT = Object.fromEntries(SPOT_DEFS.map((s) => [s.id, s]));
const ACTIVITY_MAX = 60;
const HOUR = 3600e3;

export class ActionError extends Error {}
const fail = (msg) => { throw new ActionError(msg); };
const vehName = (r) => [r.vehicle.year, r.vehicle.make, r.vehicle.model].filter(Boolean).join(' ');
const sameDay = (iso, now) => !!iso && new Date(iso).toDateString() === new Date(now).toDateString();
const ymd = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export class ShopTwin extends EventEmitter {
  constructor({ client, shopId, store, writes = false, roUrl = () => null, now = () => Date.now(), log = console.log, meta = {} }) {
    super();
    Object.assign(this, { client, shopId, store, writes, roUrl, now, log, meta });
    this.shop = { id: shopId, name: `Shop ${shopId}` };
    this.ros = new Map(); // twin id → RO from Tekmetric (mapped)
    this.spots = {}; // twin id → spot id
    this.plans = new Map(); // twin id → spot id
    this.activity = [];
    this.appointments = [];
    this.customers = new Map();
    this.vehicles = new Map();
    this.employees = new Map();
    this.fetchedAt = { shop: 0, employees: 0, appointments: 0 };
    this.updatedAt = 0;
    this.error = null;
    this.syncing = null;
    this.synced = false;
  }

  async load() {
    const saved = await this.store.load();
    this.spots = saved.spots || {};
    this.plans = new Map(saved.plans || []);
    this.activity = saved.activity || [];
  }

  note(msg) {
    this.activity.unshift({ at: new Date(this.now()).toISOString(), msg });
    if (this.activity.length > ACTIVITY_MAX) this.activity.length = ACTIVITY_MAX;
  }

  changed() {
    this.store.save({ spots: this.spots, plans: [...this.plans], activity: this.activity });
    this.emit('change');
  }

  // ---------------- sync from Tekmetric ----------------

  sync() {
    if (!this.syncing) this.syncing = this.#sync().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  async #sync() {
    const now = this.now();
    try {
      if (now - this.fetchedAt.shop > HOUR) {
        const shop = await this.client.request('GET', `/api/v1/shops/${this.shopId}`);
        if (shop?.name) this.shop = { id: shop.id, name: shop.name };
        this.fetchedAt.shop = now;
      }
      if (now - this.fetchedAt.employees > 30 * 60e3) {
        const emps = await this.client.employees(this.shopId);
        this.employees = new Map(emps.filter((e) => !e.deletedDate).map((e) => [e.id, e]));
        this.fetchedAt.employees = now;
      }
      const open = (await this.client.openRepairOrders(this.shopId))
        .filter((r) => !r.deletedDate && OPEN_STATUS.has(r.repairOrderStatus?.id));
      await this.#lookup(open);
      const arrivals = open.some((r) => !this.ros.has(`tm${r.id}`));
      if (arrivals || now - this.fetchedAt.appointments > 2 * 60e3) {
        await this.#syncAppointments(now);
        this.fetchedAt.appointments = now;
      }
      this.#reconcile(open.map((r) => toTwinRO(r, this)));
      this.updatedAt = now;
      this.error = null;
    } catch (e) {
      this.error = e.message;
      this.log(`[sync] ${e.message}`);
    }
    this.changed();
  }

  async #want(map, id, fetchOne) {
    if (id === null || id === undefined) return;
    const hit = map.get(id);
    if (hit && this.now() - hit.__at < 6 * HOUR) return;
    try {
      const rec = await fetchOne(id);
      map.set(id, { ...rec, __at: this.now() });
    } catch (e) {
      if (e.status === 404 || e.status === 403) map.set(id, { id, __at: this.now() });
      else throw e;
    }
  }

  async #lookup(records) {
    for (const r of records) {
      await this.#want(this.customers, r.customerId, (id) => this.client.customer(id));
      await this.#want(this.vehicles, r.vehicleId, (id) => this.client.vehicle(id));
    }
  }

  async #syncAppointments(now) {
    const list = await this.client.appointments(this.shopId, ymd(now), ymd(now + 24 * HOUR));
    const due = list.filter((a) => !a.deletedDate && !a.arrived && a.appointmentStatus !== 'ARRIVED' && sameDay(a.startTime, now));
    await this.#lookup(due);
    this.appointments = due.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))).map((a) => {
      const c = this.customers.get(a.customerId);
      const v = this.vehicles.get(a.vehicleId);
      return {
        id: a.id,
        at: a.startTime,
        dropoffAt: a.dropoffTime || null,
        customer: c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : `Customer #${a.customerId}`,
        vehicle: v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : '',
        description: a.description || '',
      };
    });
  }

  #reconcile(list) {
    const first = !this.synced;
    this.synced = true;
    const next = new Map(list.map((r) => [r.id, r]));
    const place = [];
    for (const [id, old] of this.ros) {
      if (!next.has(id)) this.note(`RO #${old.number} left the board in Tekmetric (posted or closed)`);
    }
    for (const [id, r] of next) {
      const old = this.ros.get(id);
      if (!old) place.push({ r, isNew: !first });
      else if (old.tmStatusId !== r.tmStatusId) {
        this.note(`RO #${r.number} is now ${r.tmStatusName} in Tekmetric`);
        if (!this.spots[id] && r.tmStatusId !== 1) place.push({ r, isNew: false }); // approved before check-in: it's here now
      }
    }
    this.ros = next;
    // Forget spots and plans that point at closed ROs, unknown spots, or double-booked spots.
    const taken = new Set();
    for (const id of Object.keys(this.spots)) {
      const s = this.spots[id];
      if (!next.has(id) || !SPOT[s] || taken.has(s)) delete this.spots[id];
      else taken.add(s);
    }
    for (const id of [...this.plans.keys()]) if (!next.has(id) || !SPOT[this.plans.get(id)]) this.plans.delete(id);

    const rank = ({ r }) => (r.tmStatusId === 2 ? (r.technicianId ? 0 : 1) : r.tmStatusId === 3 ? 2 : 3);
    for (const { r, isNew } of place.sort((a, b) => rank(a) - rank(b))) {
      if (this.spots[r.id]) continue;
      const s = this.#autoSpot(r);
      if (s) this.spots[r.id] = s.id;
      if (isNew) this.note(`New RO #${r.number} · ${vehName(r)}${s ? ` → ${s.label}` : ' · not checked in yet'}`);
      else if (s && !first) this.note(`RO #${r.number} checked in → ${s.label}`);
    }
    if (first) this.note(`Connected to Tekmetric · ${next.size} open repair order${next.size === 1 ? '' : 's'}`);
  }

  // Which open ROs are physically here? WIP and Complete are; an Estimate only if it was opened today.
  #autoSpot(r) {
    if (r.tmStatusId === 2) return this.#free('bay', 'side', 'lot');
    if (r.tmStatusId === 3) return this.#free('lot', 'side');
    if (r.tmStatusId === 1 && sameDay(r.createdDate, this.now())) return this.#free('drop', 'lot', 'side');
    return null;
  }

  occupantOf(spotId) {
    for (const [id, s] of Object.entries(this.spots)) if (s === spotId) return id;
    return null;
  }
  plannedBy(spotId) {
    for (const [id, s] of this.plans) if (s === spotId) return id;
    return null;
  }
  #free(...types) {
    for (const t of types) {
      const s = SPOT_DEFS.find((d) => d.type === t && !this.occupantOf(d.id) && !this.plannedBy(d.id));
      if (s) return s;
    }
    return null;
  }

  statusOf(r) {
    if (r.tmStatusId === 1) return 'estimate';
    if (r.tmStatusId === 3) return 'ready';
    if (/part/i.test(`${r.label || ''} ${r.customLabel || ''}`)) return 'parts';
    return SPOT[this.spots[r.id]]?.type === 'bay' ? 'wip' : 'approved';
  }

  // ---------------- actions from any screen ----------------

  #ro(roId) {
    return this.ros.get(roId) || fail('That repair order is no longer open in Tekmetric.');
  }
  #spot(spotId) {
    return SPOT[spotId] || fail('Unknown spot.');
  }

  move(roId, spotId) {
    const r = this.#ro(roId);
    const s = this.#spot(spotId);
    const occ = this.occupantOf(spotId);
    if (occ && occ !== roId) fail(`${s.label} has RO #${this.ros.get(occ)?.number} in it.`);
    const planner = this.plannedBy(spotId);
    if (planner && planner !== roId) fail(`${s.label} is reserved for RO #${this.ros.get(planner)?.number}.`);
    const from = SPOT[this.spots[roId]];
    this.spots[roId] = spotId;
    this.plans.delete(roId);
    this.note(from ? `RO #${r.number} moved ${from.label} → ${s.label}` : `RO #${r.number} checked in → ${s.label}`);
    this.changed();
  }

  plan(roId, spotId) {
    const r = this.#ro(roId);
    const s = this.#spot(spotId);
    if (this.spots[roId] === spotId) fail('That car is already there.');
    const planner = this.plannedBy(spotId);
    if (planner && planner !== roId) fail(`${s.label} is already reserved for RO #${this.ros.get(planner)?.number}.`);
    const occ = this.occupantOf(spotId);
    if (occ && s.type !== 'bay') fail(`${s.label} is taken. Only busy bays can be queued.`);
    this.plans.set(roId, spotId);
    this.note(`Planned RO #${r.number} → ${s.label}${occ ? ` after #${this.ros.get(occ)?.number}` : ''}`);
    this.changed();
  }

  unplan(roId) {
    const r = this.#ro(roId);
    if (!this.plans.delete(roId)) return;
    this.note(`Plan cleared for RO #${r.number}`);
    this.changed();
  }

  autoplan() {
    const order = { ready: 0, estimate: 1, wip: 2, approved: 3, parts: 4 };
    const waiting = [...this.ros.values()]
      .filter((r) => this.statusOf(r) === 'approved' && !this.plans.has(r.id))
      .sort((a, b) => a.number - b.number);
    const bays = SPOT_DEFS.filter((s) => s.type === 'bay' && !this.plannedBy(s.id)).sort((a, b) => {
      const oa = this.occupantOf(a.id), ob = this.occupantOf(b.id);
      const wa = oa ? 1 + order[this.statusOf(this.ros.get(oa))] : 0;
      const wb = ob ? 1 + order[this.statusOf(this.ros.get(ob))] : 0;
      return wa - wb || a.bay - b.bay;
    });
    if (!waiting.length) fail('No approved vehicles are waiting for a bay.');
    const n = Math.min(waiting.length, bays.length);
    for (let i = 0; i < n; i++) this.plans.set(waiting[i].id, bays[i].id);
    this.note(`Auto-planned ${n} vehicle${n === 1 ? '' : 's'} into bays`);
    this.changed();
    return n;
  }

  /** Write-back: set the RO's technician in Tekmetric (PATCH /api/v1/repair-orders/{id}). */
  async assignTech(roId, technicianId) {
    if (!this.writes) fail('Sending changes to Tekmetric is turned off (TEKMETRIC_WRITES=off).');
    const r = this.#ro(roId);
    const emp = this.employees.get(Number(technicianId)) || fail('Unknown technician.');
    await this.client.updateRepairOrder(r.tmId, { technicianId: emp.id });
    r.technicianId = emp.id;
    r.tech = shortName(emp);
    this.note(`RO #${r.number}: technician set to ${r.tech} in Tekmetric`);
    this.changed();
  }

  // ---------------- what every screen renders ----------------

  snapshot() {
    return {
      meta: {
        ...this.meta,
        shop: this.shop,
        updatedAt: this.updatedAt,
        error: this.error,
        writes: this.writes,
        techs: [...this.employees.values()].filter((e) => e.canPerformWork).map((e) => ({ id: e.id, name: shortName(e) })),
      },
      ros: [...this.ros.values()].map((r) => ({
        ...r,
        location: this.spots[r.id] || null,
        status: this.statusOf(r),
        tekmetricUrl: this.roUrl(r),
      })),
      columns: columnTotals([...this.ros.values()]),
      plans: [...this.plans],
      appointments: this.appointments,
      activity: this.activity,
    };
  }
}
