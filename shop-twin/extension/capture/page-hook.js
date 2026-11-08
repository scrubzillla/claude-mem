// Runs in the Tekmetric page's own JavaScript world (manifest: "world": "MAIN", document_start).
// Observes JSON responses the Tekmetric app already receives and hands a copy to bridge.js.
// It never changes requests or responses, never reads request headers, and skips non-JSON.
(() => {
  if (window.__shopTwinHook) return;
  window.__shopTwinHook = true;

  const MAX_CHARS = 4_000_000;
  const post = (kind, url, method, status, body) => {
    try {
      window.postMessage({ __shopTwin: 1, kind, url, method, status, body }, location.origin);
    } catch {
      /* body not cloneable: ignore */
    }
  };
  const wanted = (raw) => {
    try {
      const u = new URL(raw, location.href);
      return u.hostname === location.hostname || /(^|\.)tekmetric\.com$/i.test(u.hostname);
    } catch {
      return false;
    }
  };

  // fetch
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
        const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (url && wanted(url)) {
          p.then((res) => {
            const type = res.headers.get('content-type') || '';
            const len = Number(res.headers.get('content-length') || 0);
            if (!type.includes('json') || len > MAX_CHARS) return;
            res.clone().text().then((text) => {
              if (text.length > MAX_CHARS) return;
              let body;
              try { body = JSON.parse(text); } catch { return; }
              post('fetch', res.url || url, method, res.status, body);
            }).catch(() => {});
          }).catch(() => {});
        }
      } catch {
        /* never break the app */
      }
      return p;
    };
  }

  // XMLHttpRequest
  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const open = XHR.open;
    const send = XHR.send;
    XHR.open = function (method, url) {
      this.__shopTwin = { method: String(method || 'GET').toUpperCase(), url: String(url) };
      return open.apply(this, arguments);
    };
    XHR.send = function () {
      const meta = this.__shopTwin;
      if (meta && wanted(meta.url)) {
        this.addEventListener('load', () => {
          try {
            const type = this.getResponseHeader('content-type') || '';
            if (!type.includes('json')) return;
            let body;
            if (this.responseType === 'json') body = this.response;
            else if (this.responseType === '' || this.responseType === 'text') {
              if (this.responseText.length > MAX_CHARS) return;
              body = JSON.parse(this.responseText);
            } else return;
            post('xhr', this.responseURL || meta.url, meta.method, this.status, body);
          } catch {
            /* ignore */
          }
        });
      }
      return send.apply(this, arguments);
    };
  }

  // WebSocket messages (live board updates, if Tekmetric pushes them)
  const WS = window.WebSocket;
  if (WS) {
    window.WebSocket = new Proxy(WS, {
      construct(target, args, newTarget) {
        const ws = Reflect.construct(target, args, newTarget);
        try {
          const url = String(args[0]);
          if (wanted(url.replace(/^ws/, 'http'))) {
            ws.addEventListener('message', (ev) => {
              if (typeof ev.data !== 'string' || ev.data.length > MAX_CHARS) return;
              const i = ev.data.search(/[[{]/);
              if (i < 0) return;
              try { post('ws', url, 'WS', 0, JSON.parse(ev.data.slice(i))); } catch { /* not JSON */ }
            });
          }
        } catch {
          /* ignore */
        }
        return ws;
      },
    });
  }
})();
