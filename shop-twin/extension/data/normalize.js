// Shape-based recognition of Tekmetric records inside any JSON the Tekmetric web app loads.
//
// We don't depend on endpoint paths (they are internal and can change). Instead we walk every
// captured JSON payload and pick out objects that look like repair orders, customers, vehicles
// and employees. Field names follow Tekmetric's published data model (repairOrderNumber,
// repairOrderStatus, customerId, vehicleId, jobs[].authorized, ...), with aliases for the
// flattened shapes web apps often use. Adjust FIELD handling here once a real capture is in.

export const RO_STATUS = {
  1: 'Estimate', 2: 'Work-in-Progress', 3: 'Complete', 4: 'Saved for Later',
  5: 'Posted', 6: 'Accounts Receivable', 7: 'Deleted',
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, ...keys) => keys.every((k) => k in o);
const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
const idOf = (v) => (isObj(v) ? v.id : v);
const join = (...parts) => parts.filter((p) => p !== undefined && p !== null && p !== '').join(' ') || undefined;
const clean = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

function nameOf(p) {
  if (!isObj(p)) return undefined;
  return join(p.firstName, p.lastName) || pick(p.name, p.fullName);
}
function vehicleDesc(v) {
  if (!isObj(v)) return undefined;
  return join(v.year, v.make, v.model, v.subModel);
}
function primaryPhone(phone) {
  if (Array.isArray(phone)) {
    const p = phone.find((x) => isObj(x) && x.primary) || phone[0];
    return isObj(p) ? p.number : p;
  }
  return isObj(phone) ? phone.number : phone;
}

function asJob(j) {
  return clean({
    id: j.id,
    name: pick(j.name, j.title),
    authorized: j.authorized,
    archived: j.archived,
    subtotal: pick(j.subtotal, j.total),
    laborHours: j.laborHours,
    technicianId: pick(j.technicianId, idOf(j.technician)),
    category: j.jobCategoryName,
  });
}

function asRO(o) {
  if (!has(o, 'id', 'repairOrderNumber')) return null;
  // Payments and similar records also carry repairOrderNumber; require a status-ish field.
  if (!('repairOrderStatus' in o || 'repairOrderStatusId' in o || 'statusId' in o)) return null;
  const st = o.repairOrderStatus;
  return clean({
    id: o.id,
    number: o.repairOrderNumber,
    shopId: pick(o.shopId, idOf(o.shop)),
    statusId: pick(isObj(st) ? st.id : undefined, typeof st === 'number' ? st : undefined, o.repairOrderStatusId, o.statusId),
    statusName: pick(isObj(st) ? st.name : undefined, typeof st === 'string' ? st : undefined, o.statusName),
    label: pick(o.repairOrderLabel?.name, o.repairOrderCustomLabel?.name, o.labelName),
    customerId: pick(o.customerId, idOf(o.customer)),
    vehicleId: pick(o.vehicleId, idOf(o.vehicle)),
    technicianId: pick(o.technicianId, idOf(o.technician)),
    serviceWriterId: pick(o.serviceWriterId, idOf(o.serviceWriter)),
    customerName: pick(nameOf(o.customer), o.customerName, join(o.customerFirstName, o.customerLastName)),
    vehicleName: pick(vehicleDesc(o.vehicle), o.vehicleDescription, o.vehicleName, join(o.vehicleYear, o.vehicleMake, o.vehicleModel)),
    milesIn: o.milesIn,
    keytag: o.keytag,
    color: o.color,
    appointmentStartTime: o.appointmentStartTime,
    promisedTime: pick(o.promisedTime, o.promiseTime, o.promisedDate),
    createdDate: o.createdDate,
    updatedDate: o.updatedDate,
    completedDate: o.completedDate,
    postedDate: o.postedDate,
    deletedDate: o.deletedDate,
    totalSales: o.totalSales,
    jobs: Array.isArray(o.jobs) ? o.jobs.filter(isObj).map(asJob) : undefined,
    concerns: Array.isArray(o.customerConcerns)
      ? o.customerConcerns.map((c) => (isObj(c) ? c.concern : c)).filter(Boolean)
      : undefined,
  });
}

function asEmployee(o) {
  if (!has(o, 'id', 'firstName', 'lastName')) return null;
  if (!('employeeRole' in o || 'canPerformWork' in o)) return null;
  return clean({ id: o.id, firstName: o.firstName, lastName: o.lastName, role: o.employeeRole?.name });
}

function asCustomer(o) {
  if (!has(o, 'id', 'firstName', 'lastName')) return null;
  if ('employeeRole' in o || 'canPerformWork' in o || 'repairOrderNumber' in o) return null;
  if (!('phone' in o || 'email' in o || 'customerType' in o || 'address' in o)) return null;
  return clean({
    id: o.id, firstName: o.firstName, lastName: o.lastName,
    phone: primaryPhone(o.phone), business: o.customerType?.name,
  });
}

function asVehicle(o) {
  if (!has(o, 'id', 'make', 'model')) return null;
  if (!('year' in o || 'vin' in o)) return null;
  return clean({
    id: o.id, customerId: o.customerId, year: o.year, make: o.make, model: o.model, subModel: o.subModel,
    vin: o.vin, color: o.color, mileage: pick(o.mileage, o.miles), unitNumber: o.unitNumber,
  });
}

/** Walk any JSON value and return the Tekmetric-looking records inside it. */
export function extractEntities(root) {
  const found = { ros: [], customers: [], vehicles: [], employees: [] };
  const stack = [[root, 0]];
  let budget = 50000;
  while (stack.length && budget-- > 0) {
    const [node, depth] = stack.pop();
    if (depth > 12 || node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const v of node) if (v && typeof v === 'object') stack.push([v, depth + 1]);
      continue;
    }
    const ro = asRO(node);
    if (ro) found.ros.push(ro);
    else {
      const e = asEmployee(node);
      if (e) found.employees.push(e);
      else {
        const c = asCustomer(node);
        if (c) found.customers.push(c);
        else {
          const v = asVehicle(node);
          if (v) found.vehicles.push(v);
        }
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push([v, depth + 1]);
  }
  return found;
}

const KINDS = ['ros', 'customers', 'vehicles', 'employees'];

/** Upsert found records into the store. Fields missing from a payload keep their old values. */
export function mergeEntities(store, found, now, listKey, listN) {
  for (const kind of KINDS) {
    for (const rec of found[kind]) {
      const prev = store[kind][rec.id] || {};
      const next = { ...prev, ...rec, seenAt: now };
      if (kind === 'ros') {
        next.lists = { ...(prev.lists || {}) };
        if (listKey) next.lists[listKey] = listN;
        delete next.gone;
      }
      store[kind][rec.id] = next;
    }
  }
}

/**
 * Decide which repair orders have left the board: every multi-RO list that used to include the
 * RO has since been refreshed at least `misses` times without it. lists[key] = { n, at } counts
 * refreshes; ro.lists[key] is the refresh number that last included the RO. Single-RO payloads
 * (detail pages) never count as lists.
 */
export function sweepGone(store, lists, misses = 2) {
  for (const ro of Object.values(store.ros)) {
    const keys = Object.keys(ro.lists || {});
    ro.gone = keys.length > 0 && keys.every((k) => lists[k] && lists[k].n - ro.lists[k] >= misses);
  }
}

const OPEN_STATUS = new Set([1, 2, 3]);
export function statusIdOf(ro) {
  if (ro.statusId) return Number(ro.statusId);
  const n = String(ro.statusName || '').toLowerCase();
  if (/estimate/.test(n)) return 1;
  if (/progress|wip/.test(n)) return 2;
  if (/complete/.test(n)) return 3;
  if (/saved/.test(n)) return 4;
  if (/posted/.test(n)) return 5;
  if (/receivable|a\/r/.test(n)) return 6;
  if (/delet/.test(n)) return 7;
  return 0;
}
export const isOpenRO = (ro) => !ro.deletedDate && !ro.postedDate && !ro.gone && OPEN_STATUS.has(statusIdOf(ro));

/** Keep storage small: drop closed ROs after a while and records nothing refers to. */
export function prune(store, now) {
  const keepRO = (ro) => isOpenRO(ro) || now - (ro.seenAt || 0) < 6 * 3600e3;
  for (const [id, ro] of Object.entries(store.ros)) if (!keepRO(ro)) delete store.ros[id];
  const usedC = new Set(Object.values(store.ros).map((r) => String(r.customerId)));
  const usedV = new Set(Object.values(store.ros).map((r) => String(r.vehicleId)));
  for (const [id, c] of Object.entries(store.customers)) if (!usedC.has(id) && now - c.seenAt > 15 * 60e3) delete store.customers[id];
  for (const [id, v] of Object.entries(store.vehicles)) if (!usedV.has(id) && now - v.seenAt > 15 * 60e3) delete store.vehicles[id];
  const emps = Object.entries(store.employees);
  if (emps.length > 400) emps.sort((a, b) => a[1].seenAt - b[1].seenAt).slice(0, emps.length - 400).forEach(([id]) => delete store.employees[id]);
}

// ---------- endpoint discovery (structure only, never values) ----------

const VOLATILE_QUERY = /^(_|t|ts|timestamp|cachebust|nocache|v)$/i;

/** Path pattern with ids collapsed, plus query keys. Used to group endpoints in the report. */
export function endpointPattern(url, base) {
  const u = new URL(url, base);
  const pattern = u.pathname
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? ':id' : /^[0-9a-f-]{16,}$/i.test(seg) ? ':uid' : seg))
    .join('/');
  const queryKeys = [...new Set([...u.searchParams.keys()])].sort();
  return { host: u.host, pattern, queryKeys };
}

/** Exact list identity (real ids and query values) used to tell when a list dropped an RO. */
export function listKeyOf(method, url, base) {
  const u = new URL(url, base);
  const q = [...u.searchParams.entries()].filter(([k]) => !VOLATILE_QUERY.test(k)).sort(([a], [b]) => a.localeCompare(b));
  return `${method} ${u.host}${u.pathname}?${q.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

export function isSensitiveUrl(url) {
  try {
    const p = new URL(url, 'https://x.invalid').pathname;
    return /(auth|login|logout|token|oauth|password|session|sso|mfa|2fa|credential|sign-?in|payment|card)/i.test(p);
  } catch {
    return true;
  }
}

/** Replace every value with its type. Field names survive; customer data does not. */
export function skeleton(value, depth = 0) {
  if (depth > 7) return '…';
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? [skeleton(value[0], depth + 1), `×${value.length}`] : [];
  switch (typeof value) {
    case 'string': return /^\d{4}-\d{2}-\d{2}T/.test(value) ? 'datetime' : 'string';
    case 'number': return Number.isInteger(value) ? 'int' : 'float';
    case 'boolean': return 'bool';
    case 'object': {
      const entries = Object.entries(value);
      if (entries.length > 8 && entries.every(([k]) => /^\d+$/.test(k))) return { ':id': skeleton(entries[0][1], depth + 1) };
      return Object.fromEntries(entries.slice(0, 80).map(([k, v]) => [k, skeleton(v, depth + 1)]));
    }
    default: return typeof value;
  }
}
