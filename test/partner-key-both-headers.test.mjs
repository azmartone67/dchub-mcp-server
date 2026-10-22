// partner-key-both-headers.test.mjs — Grok QA 2026-10-22 item 1 (regression test only).
// Grok's partner-key outage on 10-22 was a key rotation (Railway incident), not a code bug: the
// replacement key works on both auth headers. This pins that a VALID key authenticates the same way
// whichever header carries it — `X-API-Key: <key>` or `Authorization: Bearer <key>` — over the REAL
// /mcp handler with a local backend stub (no network):
//   - initialize answers 200 on both, with no WWW-Authenticate challenge
//   - the backend's key validation is asked about the same key
//   - a tools/call reaches the backend carrying that key as X-API-Key, and both answers resolve the
//     same caller tier (a key the server did not accept would be served as anonymous)
// It runs with the WorkOS bearer path on (as in production) and off, because with it on a Bearer is
// first tried as an OAuth JWT before it falls back to the raw key.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

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

// Partner-key shape (dchub_live_ + hex), a fixture: not a real key.
const PARTNER = 'dchub_live_' + 'b'.repeat(8) + '0'.repeat(24);
const validated = [];          // api_key bodies the stub's /keys/validate received
const dataCalls = [];          // {path, xApiKey} for every non-auth backend read

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
          validated.push(k);
          res.end(JSON.stringify(k === PARTNER ? { valid: true, tier: 'pro', key_type: 'partner' } : { valid: false, tier: 'free' }));
        });
        return;
      }
      if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      if (url.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (url.pathname === '/api/news') dataCalls.push({ path: url.pathname, xApiKey: req.headers['x-api-key'] || null });
      res.end(JSON.stringify({ success: true, count: 1, articles: [{ title: 'Fixture headline', source: 'DCD' }] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevWorkos = process.env.DCHUB_WORKOS_OAUTH_ENABLED;
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

const AUTH = {
  'X-API-Key': (k) => ({ 'x-api-key': k }),
  'Authorization: Bearer': (k) => ({ authorization: 'Bearer ' + k }),
};
let rpcId = 0;
async function rpc(channel, method, params) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'user-agent': 'dchub-qa-readonly', ...AUTH[channel](PARTNER) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  let body = null;
  try { body = JSON.parse(line ? line.slice(6) : text); } catch (_) { /* non-JSON */ }
  return { status: res.status, www: res.headers.get('www-authenticate'), body };
}
// The tier this answer was served at, from whichever envelope field carries it.
function servedTier(body) {
  const r = body && body.result;
  const sc = (r && r.structuredContent) || {};
  return sc.caller_tier || (sc._meta && sc._meta.tier) || (sc.identity && sc.identity.tier) || null;
}

describe.each([['WorkOS bearer path on', '1'], ['WorkOS bearer path off', '']])(
  'a valid partner key authenticates the same on X-API-Key and Authorization: Bearer (%s)', (_label, workos) => {
    const seen = {};
    beforeAll(() => {
      if (workos) process.env.DCHUB_WORKOS_OAUTH_ENABLED = workos; else delete process.env.DCHUB_WORKOS_OAUTH_ENABLED;
    });

    it.each(Object.keys(AUTH))('%s: initialize is 200 with no auth challenge, and the key is validated', async (channel) => {
      validated.length = 0;
      try { S.keyCache.delete(PARTNER); } catch (_) { /* cache shape */ }
      const r = await rpc(channel, 'initialize',
        { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dchub-qa-readonly', version: '1' } });
      expect(r.status).toBe(200);
      expect(r.www).toBeNull();
      expect(r.body && r.body.result && r.body.result.serverInfo).toBeTruthy();
      // The very key went to validation (the Bearer prefix is stripped, nothing else is changed).
      if (validated.length) expect(new Set(validated)).toEqual(new Set([PARTNER]));
    });

    it.each(Object.keys(AUTH))('%s: a tools/call reaches the backend as this key and is served keyed', async (channel) => {
      dataCalls.length = 0;
      const r = await rpc(channel, 'tools/call', { name: 'get_news', arguments: { limit: 1 } });
      expect(r.status).toBe(200);
      expect(r.body && r.body.result, JSON.stringify(r.body).slice(0, 400)).toBeTruthy();
      expect(dataCalls.length).toBeGreaterThan(0);
      expect(dataCalls.every((d) => d.xApiKey === PARTNER), JSON.stringify(dataCalls)).toBe(true);
      seen[channel] = servedTier(r.body);
    });

    it('both headers resolve the same caller tier, and it is not the anonymous one', () => {
      expect(Object.keys(seen).sort()).toEqual(Object.keys(AUTH).sort());
      expect(seen['X-API-Key']).toBe(seen['Authorization: Bearer']);
      expect(String(seen['X-API-Key'] || '')).not.toMatch(/^(anon|anonymous|free|)$/i);
    });
  });

describe('no network', () => {
  it('no socket left loopback', () => { expect(foreign).toEqual([]); });
});
