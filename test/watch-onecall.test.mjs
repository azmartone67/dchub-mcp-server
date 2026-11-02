// watch-onecall.test.mjs — watch step 1 (owner 2026-11-02): set_market_alert with `email`
// binds the email (minting a free key on a keyless session) and arms the watch in one call.
// Kill switch DCHUB_WATCH_ONECALL=0 ignores `email`.
//
// Real /mcp handler over HTTP against a stub backend, no network (harness from
// test/retention-email-ask.test.mjs).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'test-internal-key-not-a-real-secret';
const MINTED = 'dch_live_watchonecallminted00001';
const HELD = 'dch_live_watchonecall_heldkey0001';
let claims = [];
let identifies = [];
let subs = [];
let identifyResponse = null;

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

let S, PORT, httpServer, stub, prevBase, prevSecret;
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const p = url.pathname;
      if (p === '/api/v1/keys/claim') {
        const b = await readBody(req);
        claims.push(b);
        res.end(JSON.stringify({ ok: true, api_key: MINTED, tier: 'identified',
          email_captured: !!b.email, email: b.email || null, free_tier_summary: { daily_calls: 10 } }));
        return;
      }
      if (p === '/api/v1/keys/identify') {
        const b = await readBody(req);
        identifies.push({ body: b, key: req.headers['x-api-key'] || null });
        res.end(JSON.stringify(identifyResponse || { ok: true, identified: true, email: b.email }));
        return;
      }
      if (p === '/api/v1/alerts/subscribe') {
        const b = await readBody(req);
        subs.push({ body: b, key: req.headers['x-api-key'] || null });
        res.end(JSON.stringify({ ok: true, subscription_id: 7, market: b.market, channel: b.channel,
          message: 'subscribed to market-movement alerts' }));
        return;
      }
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify((key === MINTED || key === HELD) ? { valid: true, tier: 'free' } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [], items: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterEach(() => {
  delete process.env.DCHUB_WATCH_ONECALL;
  claims = []; identifies = []; subs = []; identifyResponse = null;
});

afterAll(async () => {
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function post(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}

let ipN = 10;
let rpcId = 10;
async function session(key) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post('/mcp', h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post('/mcp', h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    async call(name, args) {
      const { body } = await post('/mcp', h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
      const result = JSON.parse(body).result || {};
      const text = (result.content || []).map((c) => c.text || '').join('\n');
      let json = null;
      try { json = JSON.parse(((result.content || [])[0] || {}).text || ''); } catch (_) { json = null; }
      return { result, text, json };
    },
    async list() {
      const { body } = await post('/mcp', h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/list', params: {} });
      return (JSON.parse(body).result || {}).tools || [];
    },
  };
}

describe('set_market_alert with email: one call', () => {
  it('keyless: mints a key with the email bound, subscribes on THAT key, tags the row, returns the key', async () => {
    const s = await session(null);
    const r = await s.call('set_market_alert', { market: 'phoenix', channel: 'email', email: 'jane@firm.com' });
    expect(claims.length).toBe(1);
    expect(claims[0].email).toBe('jane@firm.com');
    expect(subs.length).toBe(1);
    expect(subs[0].body.api_key).toBe(MINTED);
    expect(subs[0].body.source).toBe('mcp_watch');
    expect(subs[0].body.channel).toBe('email');
    expect(r.json.ok).toBe(true);
    expect(r.json.watch.one_call).toBe(true);
    expect(r.json.watch.key_minted).toBe(true);
    expect(r.json.watch.api_key).toBe(MINTED);
    expect(r.json.watch.email).toBe('j•••@firm.com');
    expect(r.text).not.toContain('jane@firm.com');
  });

  it('keyed: binds the email to the held key and subscribes with the header key, no mint', async () => {
    const s = await session(HELD);
    const r = await s.call('set_market_alert', { market: 'phoenix', channel: 'email', email: 'jane@firm.com' });
    expect(claims.length).toBe(0);
    expect(identifies.length).toBe(1);
    expect(identifies[0].body.email).toBe('jane@firm.com');
    expect(identifies[0].key).toBe(HELD);
    expect(subs.length).toBe(1);
    expect(subs[0].key).toBe(HELD);
    expect(subs[0].body.api_key).toBeUndefined();
    expect(subs[0].body.source).toBe('mcp_watch');
    expect(r.json.watch.key_minted).toBe(false);
    expect(r.json.watch.api_key).toBeUndefined();
  });

  it('a refused email sets no watch and says so', async () => {
    identifyResponse = { ok: false, message: 'placeholder addresses are rejected' };
    const s = await session(HELD);
    const r = await s.call('set_market_alert', { market: 'phoenix', channel: 'email', email: 'owner@example.com' });
    expect(subs.length).toBe(0);
    expect(r.json.ok).toBe(false);
    expect(r.json.error).toBe('email_not_bound');
    expect(r.json.message).toContain('placeholder addresses are rejected');
  });

  it('without email: unchanged (no bind, no mint, no tag)', async () => {
    const s = await session(HELD);
    const r = await s.call('set_market_alert', { market: 'phoenix', channel: 'email' });
    expect(claims.length + identifies.length).toBe(0);
    expect(subs.length).toBe(1);
    expect(subs[0].body.source).toBeUndefined();
    expect(r.json.watch).toBeUndefined();
  });

  it('webhook channel ignores email', async () => {
    const s = await session(HELD);
    await s.call('set_market_alert', { market: 'phoenix', channel: 'webhook', destination: 'https://hooks.example.com/x', email: 'jane@firm.com' });
    expect(claims.length + identifies.length).toBe(0);
    expect(subs[0].body.source).toBeUndefined();
  });

  it('DCHUB_WATCH_ONECALL=0 ignores email', async () => {
    process.env.DCHUB_WATCH_ONECALL = '0';
    const s = await session(null);
    const r = await s.call('set_market_alert', { market: 'phoenix', channel: 'email', email: 'jane@firm.com' });
    expect(claims.length + identifies.length).toBe(0);
    expect(subs.length).toBe(1);
    expect(subs[0].body.api_key).toBeUndefined();
    expect(r.json.watch).toBeUndefined();
  });

  it('tools/list advertises the email param on /mcp', async () => {
    const s = await session(null);
    const tools = await s.list();
    const t = tools.find((x) => x.name === 'set_market_alert');
    expect(t).toBeTruthy();
    expect(Object.keys(t.inputSchema.properties)).toContain('email');
    expect(t.inputSchema.required || []).not.toContain('email');
  });
});
