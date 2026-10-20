// fresh-key-bearer-829.test.mjs — mcp#829 (owner-approved 2026-10-20).
// A fresh key sent as `Authorization: Bearer` got 401 at initialize for ~3 minutes
// after claim_free_key, while X-API-Key with the same key worked at once. The
// invalid-bearer gate turned ANY valid:false into a 401, including a backend
// timeout and a cached pre-row rejection. Pinned over the REAL /mcp handler with a
// local backend stub (no network):
//   - a key whose FIRST validate said valid:false (row lag) and is now visible: 200
//   - a key whose validate times out / 5xx's (indeterminate): 200, not 401
//   - a key this replica just minted: 200 even while the backend still says no
//   - a junk Bearer the backend rejects twice: still 401 invalid_token
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

// ★HARD GATE, NO NETWORK (same gate as challenge-carries-human-line): every
// non-loopback connect is refused and recorded; the last test fails if one was tried.
const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};


const LAG = 'dch_live_829aaaaaaaaaaaaaaaaaaaaaaaaaaaaa';     // first read: no row yet
const BLIP = 'dch_live_829bbbbbbbbbbbbbbbbbbbbbbbbbbbbb';    // backend 503 on validate
const MINTED = 'dch_live_829ccccccccccccccccccccccccccccc';  // minted on this replica, backend lagging
const JUNK = 'dch_live_829ddddddddddddddddddddddddddddd';    // never a key
const OPAQUE_BLIP = 'opaque-token-829-blip';           // not DC Hub-shaped, backend 503
const seen = new Map();

let S, PORT, httpServer, stub, prevBase, prevWorkos;
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/validate') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const k = (JSON.parse(body || '{}').api_key) || '';
          const n = (seen.get(k) || 0) + 1; seen.set(k, n);
          if (k === BLIP || k === OPAQUE_BLIP) { res.statusCode = 503; res.end('{}'); return; }
          const valid = k === LAG ? n > 1 : false;
          res.end(JSON.stringify(valid ? { valid: true, tier: 'free' } : { valid: false, tier: 'free' }));
        });
        return;
      }
      if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      if (url.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevWorkos = process.env.DCHUB_WORKOS_OAUTH_ENABLED;
  process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});
afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevWorkos === undefined) delete process.env.DCHUB_WORKOS_OAUTH_ENABLED; else process.env.DCHUB_WORKOS_OAUTH_ENABLED = prevWorkos;
  net.Socket.prototype.connect = realConnect;
});

async function init(key) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               authorization: 'Bearer ' + key },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa-829', version: '1' } } }),
  });
  return { status: res.status, www: res.headers.get('www-authenticate') };
}

describe('#829 a fresh key on the Bearer channel is not 401d', () => {
  it('row-lag: the first read said valid:false and is cached; a fresh read sees the key -> 200', async () => {
    // Prime the 5-minute negative cache exactly as the pre-row read did.
    const v = await S.validateKey(LAG);
    expect(v.valid).toBe(false);
    expect(S.keyCache.get(LAG).valid).toBe(false);
    const r = await init(LAG);
    expect(r.status).toBe(200);
  });

  it('backend 503 on validate (indeterminate) -> 200, never a 401 for our outage', async () => {
    const r = await init(BLIP);
    expect(r.status).toBe(200);
    // also for a token that is not DC Hub-shaped (no second read happens for it)
    expect(await S._bearerProvenInvalid(OPAQUE_BLIP)).toBe(false);
  });

  it('a key this replica minted moments ago -> 200 while the backend still says no', async () => {
    S._noteMintedKey(MINTED);
    expect(S._recentlyMinted(MINTED)).toBe(true);
    const r = await init(MINTED);
    expect(r.status).toBe(200);
  });

  it('a junk Bearer the backend rejects on a fresh read is still 401 invalid_token', async () => {
    const r = await init(JUNK);
    expect(r.status).toBe(401);
    expect(r.www).toContain('error="invalid_token"');
    expect(await S._bearerProvenInvalid('not-a-dchub-shape-token')).toBe(true);
  });

  it('no socket left loopback', () => { expect(foreign).toEqual([]); });
});
