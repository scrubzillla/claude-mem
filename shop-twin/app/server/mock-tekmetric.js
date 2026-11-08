// A stand-in for the Tekmetric API, using the request and response shapes documented at
// https://api.tekmetric.com, so Shop Twin can be built and demoed before real credentials exist.
// It simulates a shop day: estimates get approved, jobs finish, cars get picked up, and
// appointments arrive. All people and vehicles are fictional; phone numbers use 555.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const STATUS = {
  1: ['ESTIMATE', 'Estimate'], 2: ['WORKINPROGRESS', 'Work In Progress'], 3: ['COMPLETE', 'Complete'],
  4: ['SAVEDFORLATER', 'Saved for Later'], 5: ['POSTED', 'Posted'], 6: ['ACCOUNTSRECEIVABLE', 'Accounts Receivable'], 7: ['DELETED', 'Deleted'],
};
const statusObj = (id) => ({ id, code: STATUS[id][0], name: STATUS[id][1] });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const localIso = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};
const todayAt = (now, h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.getTime(); };

function seed(now) {
  const iso = (t) => new Date(t).toISOString();
  const shop = {
    id: 1, name: 'Test Shop Auto Repair', nickname: '', phone: '713-555-0100', email: 'service@testshop.example', website: '',
    address: { id: 1, address1: '1200 Test Blvd', address2: '', city: 'Houston', state: 'TX', country: 'US', zip: '77002', streetAddress: '1200 Test Blvd', fullAddress: '1200 Test Blvd, Houston, TX 77002' },
    roCustomLabelEnabled: true,
  };
  const emp = (id, first, last, role, work) => ({ id, email: `${first.toLowerCase()}@testshop.example`, firstName: first, lastName: last, employeeRole: { id: role === 'Technician' ? 3 : 2, code: String(role === 'Technician' ? 3 : 2), name: role }, canPerformWork: work, shopId: 1, createdDate: iso(now - 400 * 86400e3), updatedDate: iso(now - 30 * 86400e3), deletedDate: null });
  const employees = [emp(101, 'Luis', 'Ramos', 'Technician', true), emp(102, 'Andre', 'Mitchell', 'Technician', true), emp(103, 'Kim', 'Tran', 'Technician', true), emp(104, 'Jorge', 'Salas', 'Technician', true), emp(105, 'Dana', 'Price', 'Service Advisor', false)];

  const people = [
    [201, 'Dana', 'Whitfield'], [202, 'Marcus', 'Bell'], [203, 'Priya', 'Natarajan'], [204, 'Tom', 'Kowalski'], [205, 'Keisha', 'Moore'],
    [206, 'Greg', 'Alvarez'], [207, 'Alicia', 'Tran'], [208, 'Bayou City', 'Plumbing'], [209, 'Robert', 'Nguyen'], [210, 'Wes', 'Hebert'],
    [211, 'Carla', 'Ortiz'], [212, 'Derrick', 'Fontenot'], [213, 'Monique', 'Brooks'], [214, 'Jasmine', 'Lam'],
  ];
  const customers = new Map(people.map(([id, f, l], i) => [id, {
    id, firstName: f, lastName: l, email: `${f.toLowerCase().replace(/\W/g, '')}@mail.test`,
    phone: [{ id: id * 10, number: `713-555-01${String(10 + i).padStart(2, '0')}`, type: 'Cell', primary: true }],
    customerType: id === 208 ? { id: 2, code: 'BUSINESS', name: 'Business' } : { id: 1, code: 'PERSON', name: 'Person' },
    contactFirstName: null, contactLastName: null, address: null, shopId: 1, eligibleForAccountsReceivable: id === 208, creditLimit: 0, okForMarketing: true,
    createdDate: iso(now - 200 * 86400e3), updatedDate: iso(now - 10 * 86400e3), deletedDate: null,
  }]));
  const cars = [
    [301, 201, 2019, 'Toyota', 'Camry', 'SE', 'Red', '4T1B11HK7KU238417', 61204], [302, 202, 2017, 'Ford', 'F-150', 'XLT', 'Blue', '1FTEW1EG3HFA51290', 98410],
    [303, 203, 2021, 'Honda', 'CR-V', 'EX', 'White', '2HKRW2H59MH604772', 59877], [304, 204, 2015, 'Chevrolet', 'Silverado 1500', 'LT', 'Black', '3GCUKREC1FG118843', 141360],
    [305, 205, 2018, 'Nissan', 'Altima', '2.5 S', 'Gray', '1N4AL3AP0JC107734', 88015], [306, 206, 2020, 'Toyota', 'Highlander', 'XLE', 'Green', '5TDGZRBH4LS503318', 47120],
    [307, 207, 2016, 'BMW', '328i', '', 'Navy Blue', 'WBA8E9G51GNT40871', 102233], [308, 208, 2022, 'Ford', 'Transit 250', '', 'White', '1FTBR1C82NKA60215', 38904],
    [309, 209, 2014, 'Honda', 'Accord', 'LX', 'Champagne', '1HGCR2F38EA275509', 156780], [310, 210, 2019, 'Jeep', 'Grand Cherokee', 'Limited', 'Red', '1C4RJFBG5KC712044', 72301],
    [311, 211, 2023, 'Toyota', 'Tacoma', 'TRD', 'Orange', '3TMCZ5AN1PM530219', 12450], [312, 212, 2017, 'Hyundai', 'Elantra', 'SE', 'Blue', '5NPD84LF4HH046180', 91277],
    [313, 213, 2016, 'Chevrolet', 'Express 2500', '', 'White', '1GCWGAFF3G1243377', 133902], [314, 214, 2018, 'Chevrolet', 'Equinox', 'LT', 'Silver', '2GNAXJEV7J6311845', 66010],
  ];
  const vehicles = new Map(cars.map(([id, customerId, year, make, model, subModel, color, vin, mileage]) => [id, {
    id, customerId, year, make, model, subModel, engine: '', transmission: '', driveType: '', licensePlate: '', state: 'TX', unitNumber: '', color, vin, mileage, shopId: 1,
    createdDate: iso(now - 200 * 86400e3), updatedDate: iso(now - 10 * 86400e3), deletedDate: null,
  }]));

  let jobId = 7001;
  const job = (roId, vehicleId, customerId, name, cents, hours, authorized, techId = null) => ({
    id: jobId++, repairOrderId: roId, vehicleId, customerId, name, authorized, authorizedDate: authorized ? iso(now - 3600e3) : null, selected: true,
    technicianId: techId, note: '', cannedJobId: null, jobCategoryName: null, partsTotal: Math.round(cents * 0.55), laborTotal: Math.round(cents * 0.45),
    discountTotal: 0, feeTotal: 0, subtotal: cents, archived: false, createdDate: iso(now - 5 * 3600e3), completedDate: null, updatedDate: iso(now - 3600e3),
    labor: [{ id: jobId * 10, name, rate: 13000, hours, complete: false }], parts: [], fees: [], discounts: [], laborHours: hours, loggedHours: 0, sort: 1,
  });
  const repairOrders = new Map();
  const ro = (id, number, statusId, vehicleId, { tech = null, label = null, created = now - 4 * 3600e3, concern, jobs }) => {
    const v = vehicles.get(vehicleId);
    const list = jobs.map(([name, cents, hours, auth]) => job(id, vehicleId, v.customerId, name, cents, hours, auth, tech));
    const total = list.reduce((s, j) => s + j.subtotal, 0);
    repairOrders.set(id, {
      id, repairOrderNumber: number, shopId: 1, repairOrderStatus: statusObj(statusId),
      repairOrderLabel: label ? { id: 9, code: label.toUpperCase().replace(/\W/g, ''), name: label, status: statusObj(statusId) } : null,
      repairOrderCustomLabel: null, color: '#1786E8', appointmentStartTime: null, customerId: v.customerId, technicianId: tech, serviceWriterId: 105,
      vehicleId, milesIn: v.mileage, milesOut: null, keytag: String(10 + (id % 40)), completedDate: statusId === 3 ? iso(now - 1800e3) : null, postedDate: null,
      laborSales: Math.round(total * 0.45), partsSales: Math.round(total * 0.55), subletSales: 0, discountTotal: 0, feeTotal: 0, taxes: Math.round(total * 0.0825),
      amountPaid: 0, totalSales: Math.round(total * 1.0825), jobs: list, sublets: [], fees: [], discounts: [],
      customerConcerns: concern ? [{ id: id * 3, concern, techComment: null }] : [],
      createdDate: iso(created), updatedDate: iso(now - 600e3), deletedDate: null,
    });
  };
  ro(5001, 10421, 2, 301, { tech: 101, concern: 'Grinding noise from the front when braking.', jobs: [['Front brake pads & rotors', 48912, 1.6, true], ['Brake fluid exchange', 12995, 0.8, false]] });
  ro(5002, 10422, 2, 302, { tech: 102, label: 'Waiting on Parts', concern: 'Check engine light on, rough idle at stops.', jobs: [['Diagnose CEL P0302 (cyl 2 misfire)', 15900, 1.0, true], ['Replace ignition coil, cyl 2', 21240, 0.6, true]] });
  ro(5003, 10423, 2, 303, { tech: 103, concern: '60k service.', jobs: [['Oil & filter change', 8999, 0.5, true], ['Tire rotation & balance', 5999, 0.6, true], ['Engine & cabin air filters', 7450, 0.3, true]] });
  ro(5004, 10424, 1, 304, { created: todayAt(now, 9, 40), concern: 'A/C blowing warm.', jobs: [['A/C performance check', 12900, 1.0, true], ['Replace A/C condenser + recharge', 86830, 2.4, false]] });
  ro(5005, 10425, 3, 305, { tech: 103, concern: 'Battery light on, slow crank in the morning.', jobs: [['Battery & charging system test', 0, 0.3, true], ['Replace battery (H6 AGM)', 21995, 0.4, true]] });
  ro(5006, 10426, 1, 306, { created: now - 2 * 86400e3, concern: 'Clunk from the front end over bumps.', jobs: [['Suspension inspection', 12800, 0.8, true], ['Front struts & mounts (pair)', 134060, 3.2, false]] });
  ro(5007, 10427, 2, 307, { concern: 'Rattle from underneath at idle.', jobs: [['Exhaust inspection', 7950, 0.5, true], ['Replace heat shield clamps', 14220, 0.7, true]] });
  ro(5008, 10428, 2, 308, { tech: 104, concern: 'Fleet PM. Driver reports squeal from rear brakes.', jobs: [['Fleet preventive maintenance', 18900, 1.2, true], ['Rear brake pads', 39840, 1.4, true]] });
  ro(5009, 10429, 3, 309, { tech: 101, concern: 'State inspection.', jobs: [['State safety inspection', 2550, 0.5, true]] });
  ro(5010, 10430, 2, 310, { created: todayAt(now, 8, 5), concern: 'Shudder at highway speed.', jobs: [['Road test & wheel balance', 11900, 1.0, true]] });

  const appt = (id, customerId, vehicleId, h, m, description) => ({
    id, shopId: 1, customerId, vehicleId, startTime: localIso(todayAt(now, h, m)), endTime: localIso(todayAt(now, h, m + 30)), description,
    arrived: null, appointmentStatus: 'NONE', createdDate: iso(now - 86400e3), updatedDate: iso(now - 86400e3), deletedDate: null,
    leadSource: null, rideOption: null, dropoffTime: null, pickupTime: null, appointmentOption: null,
  });
  const appointments = new Map([
    [601, appt(601, 211, 311, 13, 30, 'Oil change and inspection')],
    [602, appt(602, 212, 312, 15, 0, 'Car will not start, clicking')],
    [603, appt(603, 213, 313, 16, 15, 'Exhaust smell in cabin')],
  ]);
  return { shop, employees, customers, vehicles, repairOrders, appointments, nextRo: 5011, nextNumber: 10431, job };
}

export async function startMockTekmetric({
  port = 0, tickSeconds = 30, clientId = 'mock-client-id', clientSecret = 'mock-client-secret',
  rateLimitEvery = 0, seedValue = 7, now = () => Date.now(),
} = {}) {
  const db = seed(now());
  const random = rng(seedValue);
  const token = `mock-${randomUUID()}`;
  let requests = 0;
  const iso = () => new Date(now()).toISOString();

  // ---------------- simulated shop day ----------------
  const touch = (r) => { r.updatedDate = iso(); };
  const setStatus = (r, id) => {
    r.repairOrderStatus = statusObj(id);
    if (r.repairOrderLabel) r.repairOrderLabel = null;
    if (id === 3) r.completedDate = iso();
    if (id === 5) r.postedDate = iso();
    touch(r);
  };
  const approve = (id) => { const r = db.repairOrders.get(id); r.jobs.forEach((j) => { j.authorized = true; j.authorizedDate = iso(); }); setStatus(r, 2); };
  const arrive = (apptId) => {
    const a = db.appointments.get(apptId);
    a.arrived = true;
    a.appointmentStatus = 'ARRIVED';
    a.updatedDate = iso();
    const id = db.nextRo++;
    const v = db.vehicles.get(a.vehicleId);
    db.repairOrders.set(id, {
      ...structuredClone(db.repairOrders.get(5004)), id, repairOrderNumber: db.nextNumber++, repairOrderStatus: statusObj(1), repairOrderLabel: null,
      customerId: a.customerId, vehicleId: a.vehicleId, technicianId: null, milesIn: v.mileage, completedDate: null, postedDate: null,
      jobs: [db.job(id, a.vehicleId, a.customerId, `${a.description} (diagnosis)`, 14900, 1.0, false)],
      customerConcerns: [{ id: id * 3, concern: a.description, techComment: null }], createdDate: iso(), updatedDate: iso(), keytag: String(10 + (id % 40)),
    });
  };
  const script = [
    () => approve(5004),
    () => setStatus(db.repairOrders.get(5003), 3),
    () => setStatus(db.repairOrders.get(5005), 5),
    () => arrive(601),
    () => { const r = db.repairOrders.get(5002); r.repairOrderLabel = null; touch(r); },
    () => setStatus(db.repairOrders.get(5001), 3),
    () => setStatus(db.repairOrders.get(5009), 5),
    () => arrive(602),
    () => approve(5011),
    () => setStatus(db.repairOrders.get(5003), 5),
    () => arrive(603),
  ];
  let step = 0;
  function advance() {
    if (step < script.length) { script[step++](); return; }
    // After the script: random but plausible transitions.
    const open = [...db.repairOrders.values()].filter((r) => [1, 2, 3].includes(r.repairOrderStatus.id));
    if (!open.length) return;
    const r = open[Math.floor(random() * open.length)];
    const s = r.repairOrderStatus.id;
    if (s === 1) approve(r.id);
    else setStatus(r, s + 1 === 4 ? 5 : s + 1);
  }
  const timer = tickSeconds > 0 ? setInterval(advance, tickSeconds * 1000) : null;

  // ---------------- HTTP ----------------
  const page = (items, q) => {
    const size = Math.min(Number(q.get('size') || 10), 100);
    const number = Number(q.get('page') || 0);
    const content = items.slice(number * size, number * size + size);
    const totalPages = Math.max(1, Math.ceil(items.length / size));
    return { content, totalPages, totalElements: items.length, last: number >= totalPages - 1, first: number === 0, size, number, numberOfElements: content.length, empty: content.length === 0 };
  };
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json;charset=UTF-8' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readBody = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const q = url.searchParams;
    const p = url.pathname;
    requests += 1;
    if (rateLimitEvery && requests % rateLimitEvery === 0) return json(res, 429); // empty body, like the real API

    if (p === '/api/v1/oauth/token' && req.method === 'POST') {
      const basic = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
      const body = await readBody(req);
      if (basic !== `${clientId}:${clientSecret}` || !/grant_type=client_credentials/.test(body)) {
        return json(res, 401, { error: 'invalid_client', error_description: 'Bad client credentials' });
      }
      return json(res, 200, { access_token: token, token_type: 'bearer', scope: '1' });
    }
    if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: 'invalid_token', error_description: 'Invalid access token' });

    let m;
    if (p === '/api/v1/shops') return json(res, 200, [db.shop]);
    if ((m = p.match(/^\/api\/v1\/shops\/(\d+)$/))) return Number(m[1]) === 1 ? json(res, 200, db.shop) : json(res, 403, { error: 'insufficient_scope', scope: '1' });
    if (p === '/api/v1/repair-orders' && req.method === 'GET') {
      if (q.get('shop') && q.get('shop') !== '1') return json(res, 403, { error: 'insufficient_scope', scope: '1' });
      const statuses = q.getAll('repairOrderStatusId').map(Number);
      const items = [...db.repairOrders.values()].filter((r) => (statuses.length ? statuses.includes(r.repairOrderStatus.id) : r.repairOrderStatus.id !== 7));
      return json(res, 200, page(items, q));
    }
    if ((m = p.match(/^\/api\/v1\/repair-orders\/(\d+)$/))) {
      const r = db.repairOrders.get(Number(m[1]));
      if (!r) return json(res, 404, { error: 'not_found' });
      if (req.method === 'GET') return json(res, 200, r);
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if ('technicianId' in body) r.technicianId = body.technicianId;
        if ('serviceWriterId' in body) r.serviceWriterId = body.serviceWriterId;
        if ('keyTag' in body) r.keytag = body.keyTag;
        if ('milesIn' in body) r.milesIn = body.milesIn;
        if ('milesOut' in body) r.milesOut = body.milesOut;
        if ('customerTimeOut' in body) r.customerTimeOut = body.customerTimeOut;
        touch(r);
        return json(res, 200, { type: 'SUCCESS', message: 'Repair Order Saved', data: {} });
      }
    }
    if ((m = p.match(/^\/api\/v1\/jobs\/(\d+)$/)) && req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req)) || '{}');
      for (const r of db.repairOrders.values()) {
        const j = r.jobs.find((x) => x.id === Number(m[1]));
        if (j) { Object.assign(j, body); touch(r); return json(res, 200, { type: 'SUCCESS', message: 'Job Saved', data: j }); }
      }
      return json(res, 404, { error: 'not_found' });
    }
    if ((m = p.match(/^\/api\/v1\/customers\/(\d+)$/))) {
      const c = db.customers.get(Number(m[1]));
      return c ? json(res, 200, c) : json(res, 404, { error: 'not_found' });
    }
    if ((m = p.match(/^\/api\/v1\/vehicles\/(\d+)$/))) {
      const v = db.vehicles.get(Number(m[1]));
      return v ? json(res, 200, v) : json(res, 404, { error: 'not_found' });
    }
    if (p === '/api/v1/employees') return json(res, 200, page(db.employees, q));
    if (p === '/api/v1/appointments') {
      const start = q.get('start'), end = q.get('end');
      const items = [...db.appointments.values()].filter((a) => (!start || a.startTime >= start) && (!end || a.startTime < end));
      return json(res, 200, page(items, q));
    }
    return json(res, 404, { error: 'not_found' });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    clientId, clientSecret, db, advance,
    get requests() { return requests; },
    close: () => { if (timer) clearInterval(timer); return new Promise((r) => server.close(r)); },
  };
}
