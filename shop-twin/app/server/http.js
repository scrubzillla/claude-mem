// HTTP layer: static files, passcode login, JSON actions and a Server-Sent Events stream so every
// screen at the shop shows the same twin within a second of any change.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionError } from './twin.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const COOKIE = 'st_session';
const SESSION_DAYS = 30;

function sign(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}
function sessionCookie(secret) {
  const exp = String(Date.now() + SESSION_DAYS * 86400e3);
  return `${exp}.${sign(secret, exp)}`;
}
function validSession(secret, raw) {
  if (!raw) return false;
  const [exp, mac] = raw.split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const want = Buffer.from(sign(secret, exp));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
function sameText(a, b) {
  const x = Buffer.from(sign('cmp', String(a)));
  const y = Buffer.from(sign('cmp', String(b)));
  return timingSafeEqual(x, y);
}

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string';
  res.writeHead(status, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new ActionError('Send JSON.');
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 16 * 1024) throw new ActionError('Request too large.');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ActionError('Invalid JSON.');
  }
}

export function createApp({ twin, cfg, mock = null, log = console.log }) {
  const clients = new Set();
  const authOn = !!cfg.passcode;
  const broadcast = () => {
    const data = `event: state\ndata: ${JSON.stringify(twin.snapshot())}\n\n`;
    for (const res of clients) res.write(data);
  };
  twin.on('change', broadcast);
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

  const authed = (req) => !authOn || validSession(cfg.sessionSecret, readCookie(req, COOKIE));

  async function serveStatic(req, res, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB)) return send(res, 403, 'Forbidden');
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': /^(vendor|fonts)\//.test(rel) ? 'public, max-age=86400' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    } catch {
      send(res, 404, 'Not found');
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/healthz') return send(res, 200, { ok: true, updatedAt: twin.updatedAt, error: twin.error });

      // Login
      if (p === '/login.html' || p === '/twin.css' || p.startsWith('/icons/') || p.startsWith('/fonts/')) return serveStatic(req, res, p);
      if (p === '/api/login' && req.method === 'POST') {
        const { passcode } = await readJson(req);
        if (!authOn) return send(res, 200, { ok: true });
        if (!sameText(passcode || '', cfg.passcode)) return send(res, 401, { error: 'Wrong passcode.' });
        return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${sessionCookie(cfg.sessionSecret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}` });
      }
      if (p === '/api/logout' && req.method === 'POST') {
        return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
      }

      if (!authed(req)) {
        if (p.startsWith('/api/')) return send(res, 401, { error: 'Sign in first.' });
        res.writeHead(302, { Location: '/login.html' });
        return res.end();
      }

      if (p === '/api/state' && req.method === 'GET') return send(res, 200, twin.snapshot());
      if (p === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`retry: 3000\nevent: state\ndata: ${JSON.stringify(twin.snapshot())}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      if (req.method === 'POST' && p.startsWith('/api/')) {
        // CSRF: same-origin only (JSON content type is also required by readJson).
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Cross-site request refused.' });
        const body = await readJson(req);
        switch (p) {
          case '/api/move': twin.move(String(body.roId), String(body.spotId)); break;
          case '/api/plan': twin.plan(String(body.roId), String(body.spotId)); break;
          case '/api/unplan': twin.unplan(String(body.roId)); break;
          case '/api/autoplan': return send(res, 200, { ok: true, planned: twin.autoplan() });
          case '/api/assign-tech': await twin.assignTech(String(body.roId), Number(body.technicianId)); break;
          case '/api/refresh': await twin.sync(); break;
          case '/api/mock/advance':
            if (!mock) return send(res, 404, { error: 'Only available with the mock Tekmetric API.' });
            mock.advance();
            await twin.sync();
            break;
          default: return send(res, 404, { error: 'Unknown action.' });
        }
        return send(res, 200, { ok: true });
      }

      if (req.method === 'GET') return serveStatic(req, res, p);
      return send(res, 405, 'Method not allowed');
    } catch (e) {
      if (e instanceof ActionError) return send(res, 400, { error: e.message });
      if (e.name === 'TekmetricError') return send(res, 502, { error: e.message });
      log(`[http] ${req.method} ${p}: ${e.stack || e.message}`);
      return send(res, 500, { error: 'Something went wrong on the Shop Twin server.' });
    }
  });
  server.on('close', () => clearInterval(heartbeat));
  return server;
}
