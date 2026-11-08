// Content script (isolated world) on Tekmetric pages.
// Relays captured JSON from page-hook.js to the service worker, reports navigation so the
// extension can learn Tekmetric's repair-order link format, and shows a small launcher button.
(() => {
  const send = (msg) => {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null); // extension was reloaded; this tab needs a refresh
    }
  };

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__shopTwin !== 1) return;
    const { kind, url, method, status, body } = ev.data;
    send({ type: 'capture', kind, url, method, status, body });
  });

  let lastHref = '';
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      send({ type: 'location', href: lastHref });
    }
  }, 1000);

  // Launcher button (shadow DOM so Tekmetric's styles and ours never mix).
  function mountLauncher() {
    if (document.getElementById('shop-twin-launcher')) return;
    const host = document.createElement('div');
    host.id = 'shop-twin-launcher';
    host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .wrap { display:flex; align-items:center; gap:2px; font:600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif; }
        button { all:unset; cursor:pointer; background:#1c2220; color:#fafaf6; padding:9px 12px; border-radius:999px;
                 box-shadow:0 4px 16px rgba(0,0,0,.25); display:flex; align-items:center; gap:8px; }
        button:focus-visible { outline:2px solid #f2b705; outline-offset:2px; }
        .dot { width:8px; height:8px; border-radius:50%; background:#6b7570; }
        .dot.on { background:#4cc583; }
        .count { color:#f2b705; font-variant-numeric:tabular-nums; }
        .x { padding:9px 8px; background:transparent; color:#1c2220; box-shadow:none; font-size:14px; opacity:.55; }
        .x:hover { opacity:1; }
      </style>
      <div class="wrap">
        <button class="open" type="button" title="Open Shop Twin"><span class="dot"></span>Shop Twin <span class="count"></span></button>
        <button class="x" type="button" title="Hide for this tab" aria-label="Hide Shop Twin button">×</button>
      </div>`;
    root.querySelector('.open').addEventListener('click', () => send({ type: 'openTwin' }));
    root.querySelector('.x').addEventListener('click', () => host.remove());
    document.documentElement.appendChild(host);
    const dot = root.querySelector('.dot');
    const count = root.querySelector('.count');
    const poll = async () => {
      const r = await send({ type: 'status' });
      if (!r) return;
      const live = r.ros > 0;
      dot.classList.toggle('on', live);
      count.textContent = live ? `· ${r.ros} RO${r.ros === 1 ? '' : 's'}` : '';
    };
    poll();
    setInterval(poll, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountLauncher, { once: true });
  else mountLauncher();
})();
