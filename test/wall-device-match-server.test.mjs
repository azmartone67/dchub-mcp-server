// Wall identity v2, device match (owner relay 2026-11-20, item 3), the real-server half: the hooks in server.mjs
// (top and end of _sourceLineCb, claim_free_key's fresh mint, _trackAuthChannel) against a stub backend.
//   * flags off (or only DCHUB_WALL_IDENTITY_V2): no lookup, no record, the keyless call is unchanged;
//   * both on: the first keyless call from a recorded pair is served keyless and starts the read; the next one
//     reaches the backend with the matched key, says WELCOME_BACK_LINE once, never shows the key, logs ONE return
//     (method device_match) and its track row's auth_channel is device_match;
//   * claim_free_key records the pair only for a walled caller, with the /24 prefix, never the raw IP;
//   * ChatGPT surfaces, generic client names and QA callers get none of it.
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
const MATCHED = 'dch_live_devicematch00000000000000000001';
const MINTED = 'dch_live_devicematchminted0000000000000002';
const reqs = [];            // every stub request: { path, key, body }
const MATCHES = new Map();  // 'ip_prefix|client_name' -> key
let S, PORT, httpServer, stub, prevBase, prevSecret;

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      const p = url.pathname;
      const body = req.method === 'POST' ? await readBody(req) : {};
      reqs.push({ path: p, key: req.headers['x-api-key'] || null, internal: req.headers['x-internal-key'] || null, body });
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/mcp/wall-device/lookup') {
        const k = MATCHES.get(body.ip_prefix + '|' + body.client_name);
        res.end(JSON.stringify(k ? { ok: true, match: true, api_key: k } : { ok: true, match: false }));
        return;
      }
      if (p === '/api/v1/mcp/wall-device/record' || p === '/api/v1/mcp/wall-device/return') { res.end('{"ok":true}'); return; }
      if (p === '/api/v1/keys/claim') { res.end(JSON.stringify({ ok: true, api_key: MINTED, tier: 'free' })); return; }
      if (p === '/api/v1/keys/validate') {
        const key = body.api_key || '';
        res.end(JSON.stringify(key === MINTED || key === MATCHED ? { valid: true, tier: 'free' } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      if (p === '/api/v1/keys/standing') { res.end(JSON.stringify({ found: true, age_days: 3, has_alert: false })); return; }
      res.end(JSON.stringify({ success: true, count: 1, data: [{ title: 'Data center news', url: 'https://example.com/a',
        echo_key: req.headers['x-api-key'] || null }], results: [], items: [] }));
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
  delete process.env.DCHUB_WALL_IDENTITY_V2;
  delete process.env.DCHUB_WALL_IDENTITY_V2_DEVICE_MATCH;
  S._setDeviceMatchLookupForTest(null);
  MATCHES.clear();
  reqs.length = 0;
});

afterAll(async () => {
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

const bothOn = () => { process.env.DCHUB_WALL_IDENTITY_V2 = '1'; process.env.DCHUB_WALL_IDENTITY_V2_DEVICE_MATCH = '1'; };
const settle = () => new Promise((r) => setTimeout(r, 60));

async function post(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}
let rpcId = 100;
async function session(clientName, ip, { path = '/mcp', extra = {} } = {}) {
  const h0 = { 'x-forwarded-for': ip, ...extra };
  const init = await post(path, h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    sid,
    async call(name, args) {
      const { body } = await post(path, h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
      const result = JSON.parse(body).result || {};
      return { body, result, text: (result.content || []).map((c) => c.text || '').join('\n') };
    },
  };
}
const lookups = () => reqs.filter((r) => r.path === '/api/v1/mcp/wall-device/lookup');
const dataCalls = () => reqs.filter((r) => !r.path.startsWith('/api/v1/mcp/') && !r.path.startsWith('/api/v1/keys/'));
const countLine = (t) => t.split(S.__WD_LINE || 'Welcome back. Add DCHUB_API_KEY to keep this permanent.').length - 1;

describe('flags off', () => {
  it('neither flag, or V2 alone: no lookup, no key on the backend call, no welcome line', async () => {
    MATCHES.set('198.51.100.0/24|Claude Code', MATCHED);
    for (const v2 of [false, true]) {
      if (v2) process.env.DCHUB_WALL_IDENTITY_V2 = '1';
      const s = await session('Claude Code', '198.51.100.31');
      await s.call('get_news', {}); await settle();
      const r = await s.call('get_news', {});
      expect(lookups()).toEqual([]);
      expect(dataCalls().every((d) => d.key === null)).toBe(true);
      expect(countLine(r.text)).toBe(0);
    }
  });
});

describe('both flags on: a recorded pair comes back keyless', () => {
  it('first call keyless + background read; next call served as the key, one welcome line, key never shown', async () => {
    bothOn();
    MATCHES.set('198.51.100.0/24|Claude Code', MATCHED);
    const s = await session('Claude Code', '198.51.100.32');
    const first = await s.call('get_news', {});
    expect(countLine(first.text)).toBe(0);
    await settle();
    expect(lookups().length).toBe(1);
    expect(lookups()[0].body).toEqual({ client_name: 'Claude Code', ip_prefix: '198.51.100.0/24' });   // never the raw IP
    expect(lookups()[0].internal).toBe(SECRET);
    expect(dataCalls().filter((d) => d.key !== null)).toEqual([]);   // the miss was served keyless
    reqs.length = 0;
    const second = await s.call('get_news', {});
    expect(dataCalls().length).toBeGreaterThan(0);
    expect(dataCalls().every((d) => d.key === MATCHED)).toBe(true);   // free-key allowance: metered against the key
    expect(countLine(second.text)).toBe(1);
    expect(second.body).not.toContain('dch_live_');
    expect(second.body).not.toContain(MATCHED.slice(9));
    const third = await s.call('get_news', {});
    expect(countLine(third.text)).toBe(0);                          // once per session
    expect(third.body).not.toContain('dch_live_');
    await settle();
    const rets = reqs.filter((r) => r.path === '/api/v1/mcp/wall-device/return');
    expect(rets.length).toBe(1);                                     // once per pair per UTC day
    expect(rets[0].body).toMatchObject({ api_key: MATCHED, client_name: 'Claude Code', ip_prefix: '198.51.100.0/24',
      tool: 'get_news', method: 'device_match' });
    const tracks = reqs.filter((r) => r.path === '/api/v1/mcp/track' && r.body && r.body.tool === 'get_news');
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks.some((t) => t.body.auth_channel === 'device_match')).toBe(true);
  });

  it('exact pair only: another client name from the same /24 stays keyless', async () => {
    bothOn();
    MATCHES.set('198.51.100.0/24|Claude Code', MATCHED);
    const s = await session('Claude Desktop', '198.51.100.33');
    await s.call('get_news', {}); await settle();
    reqs.length = 0;
    const r = await s.call('get_news', {});
    expect(dataCalls().every((d) => d.key === null)).toBe(true);
    expect(countLine(r.text)).toBe(0);
  });

  it('generic and QA client names never start a lookup', async () => {
    bothOn();
    for (const [name, extra] of [['curl/8.4.0', {}], ['python-requests/2.31', {}], ['Claude Code', { 'x-dchub-qa': '1' }],
                                 ['dchub-qa-readonly/1', {}]]) {
      MATCHES.set('198.51.100.0/24|' + name, MATCHED);
      const s = await session(name, '198.51.100.34', { extra });
      await s.call('get_news', {}); await settle();
      await s.call('get_news', {});
    }
    expect(lookups()).toEqual([]);
  });

  it('the ChatGPT surfaces get none of it (clean platform via the context)', async () => {
    bothOn();
    S._setDeviceMatchLookupForTest(async () => MATCHED);
    for (const c of [{ platform: 'chatgpt' }, { profile: 'chatgpt_directory' }, { loopback_step: true }, { platform: 'openai-mcp' }]) {
      const ctx = { client_name_raw: 'Claude Code', client_ip: '198.51.100.35', ...c };
      await S._ctxALS.run(ctx, async () => {
        expect(S._deviceMatchEnter(ctx, 'get_news')).toBe(false); await settle();
        expect(S._deviceMatchEnter(ctx, 'get_news')).toBe(false);
      });
      expect(ctx.api_key).toBeUndefined();
    }
    const ok = { client_name_raw: 'Claude Code', client_ip: '198.51.100.35', platform: 'claude-code' };
    await S._ctxALS.run(ok, async () => { S._deviceMatchEnter(ok, 'get_news'); await settle(); expect(S._deviceMatchEnter(ok, 'get_news')).toBe(true); });
    expect(ok.api_key).toBe(MATCHED);
    expect(ok.device_match).toBe(true);
  });
});

describe('recording a wall mint (claim_free_key)', () => {
  it('a walled session records its pair (prefix, never the raw IP); an unwalled one does not; flags off records nothing', async () => {
    const run = async (walled) => {
      const s = await session('Claude Code', '203.0.113.41');
      if (walled) S._noteWallViaForTest(s.sid, 'grid');
      await s.call('claim_free_key', { client_name: 'device-match-test' });
      await settle();
      return reqs.filter((r) => r.path === '/api/v1/mcp/wall-device/record');
    };
    expect(await run(true)).toEqual([]);                // flags off
    reqs.length = 0;
    process.env.DCHUB_WALL_IDENTITY_V2 = '1';
    expect(await run(true)).toEqual([]);                // V2 alone does not record
    reqs.length = 0;
    bothOn();
    expect(await run(false)).toEqual([]);               // no wall seen
    reqs.length = 0;
    const rec = await run(true);
    expect(rec.length).toBe(1);
    expect(rec[0].body).toEqual({ api_key: MINTED, client_name: 'Claude Code', ip_prefix: '203.0.113.0/24' });
    expect(JSON.stringify(rec[0].body)).not.toContain('203.0.113.41');
    expect(rec[0].internal).toBe(SECRET);
  });

  it('a hosted client that walls in one transport session and claims in another is recorded by the pair', async () => {
    bothOn();
    const c1 = { client_name_raw: 'grok', client_ip: '203.0.113.50', session_id: 'sess-a' };
    S._deviceMatchExit({ content: [{ type: 'text', text: 'held back' }], structuredContent: { _wall: true } }, 'get_grid_intelligence', c1);
    const c2 = { client_name_raw: 'grok', client_ip: '203.0.113.51', session_id: 'sess-b' };
    expect(S._deviceMatchRecord(c2, MINTED)).toBe(true);
    const c3 = { client_name_raw: 'grok', client_ip: '203.0.114.51', session_id: 'sess-c' };   // other /24: no wall
    expect(S._deviceMatchRecord(c3, MINTED)).toBe(false);
    await settle();
    const rec = reqs.filter((r) => r.path === '/api/v1/mcp/wall-device/record');
    expect(rec.map((r) => r.body.ip_prefix)).toEqual(['203.0.113.0/24']);
  });
});
