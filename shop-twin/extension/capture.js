import { isOpenRO, statusIdOf, RO_STATUS } from './data/normalize.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

let snap = null;
let tabs = [];

async function load() {
  snap = (await chrome.storage.session.get('tm')).tm || null;
  tabs = await chrome.tabs.query({ url: chrome.runtime.getManifest().host_permissions });
  render();
}

function render() {
  const E = snap?.entities || { ros: {}, customers: {}, vehicles: {}, employees: {} };
  const ros = Object.values(E.ros);
  const open = ros.filter(isOpenRO);
  const eps = Object.values(snap?.discovery?.endpoints || {}).sort((a, b) => b.count - a.count);
  const stats = [
    ['Tekmetric tabs open', tabs.length],
    ['Responses seen', snap?.meta?.captures || 0],
    ['Open ROs', open.length],
    ['Customers', Object.keys(E.customers).length],
    ['Vehicles', Object.keys(E.vehicles).length],
    ['Staff', Object.keys(E.employees).length],
    ['RO link learned', snap?.links?.roTemplate ? 'Yes' : 'No'],
    ['Last update', ago(snap?.meta?.updatedAt)],
  ];
  $('#stats').innerHTML = stats.map(([l, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');

  let verdict;
  if (!tabs.length) verdict = '<span class="warn">No Tekmetric tab is open.</span> Open Tekmetric and sign in. If it was already open before you installed Shop Twin, reload that tab once.';
  else if (!eps.length) verdict = '<span class="warn">The Tekmetric tab hasn\'t sent anything yet.</span> Reload the Tekmetric tab, then open the job board.';
  else if (!ros.length) verdict = '<span class="warn">Tekmetric data is coming in, but no repair orders were recognized.</span> Open the job board. If this stays at zero, copy the structure report below and send it over so the field mapping can be fixed.';
  else verdict = `<span class="ok">Working.</span> ${open.length} open repair order${open.length === 1 ? '' : 's'} recognized. Open Shop Twin from the toolbar to see them.${snap?.links?.roTemplate ? '' : ' Open any single RO in Tekmetric so "Open in Tekmetric" can jump to it.'}`;
  $('#verdict').innerHTML = verdict;

  $('#eps').innerHTML = eps.map((e) => `<tr>
      <td class="mono">${esc(e.method)}</td>
      <td class="mono">${esc(e.host + e.pattern)}${e.queryKeys?.length ? `<br><span style="color:var(--muted)">?${esc(e.queryKeys.join('&'))}</span>` : ''}</td>
      <td class="num">${e.count}</td>
      <td class="num ${e.hits.ro ? 'hit' : ''}">${e.hits.ro}</td>
      <td class="num ${e.hits.customer ? 'hit' : ''}">${e.hits.customer}</td>
      <td class="num ${e.hits.vehicle ? 'hit' : ''}">${e.hits.vehicle}</td>
      <td class="num ${e.hits.employee ? 'hit' : ''}">${e.hits.employee}</td>
      <td class="num">${esc(e.lastStatus)}</td></tr>`).join('') || '<tr><td colspan="8" style="color:var(--muted)">Nothing yet.</td></tr>';

  $('#ros').innerHTML = ros.sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0)).slice(0, 200).map((r) => {
    const c = E.customers[r.customerId];
    const v = E.vehicles[r.vehicleId];
    const cust = c ? `${c.firstName || ''} ${c.lastName || ''}` : r.customerName || '—';
    const veh = v ? `${v.year || ''} ${v.make || ''} ${v.model || ''}` : r.vehicleName || '—';
    const st = RO_STATUS[statusIdOf(r)] || r.statusName || '?';
    return `<tr><td class="mono">#${esc(r.number)}</td><td>${esc(st)}${r.gone ? ' (left board)' : ''}</td><td>${esc(cust)}</td><td>${esc(veh)}</td><td class="num">${r.jobs ? r.jobs.length : '—'}</td><td>${esc(ago(r.seenAt))}</td></tr>`;
  }).join('') || '<tr><td colspan="6" style="color:var(--muted)">None yet.</td></tr>';
}

function report() {
  const E = snap?.entities || { ros: {}, customers: {}, vehicles: {}, employees: {} };
  const tpl = snap?.links?.roTemplate || null;
  return {
    kind: 'shop-twin-structure-report',
    version: chrome.runtime.getManifest().version,
    generatedAt: new Date().toISOString(),
    host: snap?.meta?.origin ? new URL(snap.meta.origin).host : null,
    counts: {
      responses: snap?.meta?.captures || 0,
      ros: Object.keys(E.ros).length,
      openRos: Object.values(E.ros).filter(isOpenRO).length,
      customers: Object.keys(E.customers).length,
      vehicles: Object.keys(E.vehicles).length,
      employees: Object.keys(E.employees).length,
    },
    roStatusIdsSeen: [...new Set(Object.values(E.ros).map(statusIdOf))].sort(),
    roFieldsSeen: [...new Set(Object.values(E.ros).flatMap((r) => Object.keys(r)))].sort(),
    roLink: tpl ? { learned: true, key: snap.links.roKey, pattern: new URL(tpl).pathname.replace(/\d+/g, ':n') } : { learned: false },
    endpoints: Object.values(snap?.discovery?.endpoints || {}).sort((a, b) => b.count - a.count).map((e) => ({
      method: e.method, via: e.via, host: e.host, pattern: e.pattern, queryKeys: e.queryKeys,
      calls: e.count, lastStatus: e.lastStatus, recognized: e.hits, structure: e.shape,
    })),
  };
}

$('#copy').onclick = async () => {
  const text = JSON.stringify(report(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $('#msg').textContent = `Copied (${Math.round(text.length / 1024)} KB). Paste it into a message or a file.`;
  } catch {
    $('#msg').textContent = 'Copy was blocked. Use Download instead.';
  }
};
$('#download').onclick = () => {
  const blob = new Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shop-twin-structure-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $('#msg').textContent = 'Report downloaded.';
};
$('#clear').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'clear' });
  $('#msg').textContent = 'Captured data cleared. Shop Twin goes back to demo data until Tekmetric loads again.';
  load();
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.tm) { snap = changes.tm.newValue || null; render(); }
});
load();
setInterval(load, 10000);
