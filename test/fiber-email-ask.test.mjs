// fiber-email-ask.test.mjs (harness copied from depth-wall-digest-ask.test.mjs): owner 2026-11-08, "fix it all".
// Live 11-08 (QA probes, 7-day wall table): two first walls still carried no ask of any kind.
//  * get_fiber_intel: a keyless seat gets the 3-route preview on every call and no email ask, although an
//    email-bound free key gets the full answer. It now takes the ai_capacity_index step with its own clause
//    (lib/paid-sell-line.fiberEmailClause), kill switch DCHUB_FIBER_EMAIL_ASK=0. The last describe block
//    measures the claim on the real handler: email-bound key full, unbound free key 2 full then the preview.
//  * get_dchub_recommendation (Pro-only, below Land & Power): an email opens nothing there, so it takes the
//    weekly-digest offer like every other depth wall. Land & Power stays out (an email unlocks part of
//    analyze_site).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { digestAskLine } from '../lib/depth-digest-ask.mjs';
import { fiberEmailClause, RANK_EMAIL_ASK_LEAD, AICAP_EMAIL_LINE_HEAD } from '../lib/paid-sell-line.mjs';

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
const AICAP = JSON.parse(readFileSync(new URL('./fixtures/ai-capacity-index-90.json', import.meta.url), 'utf8'));
const SHORT_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
const HUMAN = '→ **For your human:**';
const CAP = 10;
const ROUTES = 40, POINTS = 30;   // the stub's fiber answer: 40 routes of 30 points each   // IDENTIFIED_DAILY_FULL_CAP's default (DCHUB_IDENTIFIED_TOOL_DAILY_FULL is cleared below)
const ENV = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_INTERNAL_KEY: SECRET };
const CLEAR = ['DCHUB_FIBER_EMAIL_ASK', 'DCHUB_DEPTH_DIGEST_ASK', 'DCHUB_AICAP_EMAIL_ASK', 'DCHUB_LEAN_RESPONSES', 'DCHUB_IDENTIFIED_TOOL_DAILY_FULL', 'DCHUB_TRIAL_TOOL_DAILY_FULL'];

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

let S, PORT, httpServer, stub, shortN = 0;
const events = [];   // quota_wall_hit bodies the server posted
const prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const p = url.pathname;
      if (p === '/api/v1/deals') {
        const deals = Array.from({ length: 12 }, (_, i) => ({ buyer: 'Buyer ' + i, seller: 'Seller ' + i,
          value_usd_m: 100 + i, date: '2026-10-' + String(10 + i).padStart(2, '0'), market: 'dallas' }));
        res.end(JSON.stringify({ success: true, count: 12, total_count: 12, total_value: 1266, total_value_unit: 'usd_m', transactions: deals }));
        return;
      }
      if (p === '/api/v1/ai-capacity-index') {
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        const markets = AICAP.markets.slice(0, limit);
        res.end(JSON.stringify({ ...AICAP, markets, result_count: markets.length }));
        return;
      }
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(key.startsWith('dch_free_bound') ? { valid: true, tier: 'free', developer_id: 'dev_' + key, email: 'user@example.com' }
          : key.startsWith('dch_free_nobind') ? { valid: true, tier: 'free', developer_id: 'dev_' + key, email: null } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/mcp/full-cap/peek') { res.end(JSON.stringify({ ok: true, n: 0 })); return; }
      if (p === '/api/v1/fiber/routes') {
        const features = Array.from({ length: ROUTES }, (_, i) => ({ type: 'Feature',
          geometry: { type: 'LineString', coordinates: Array.from({ length: POINTS }, (_, j) => [-97 - j * 0.01, 32 + i * 0.01]) },
          properties: { carrier: 'Carrier ' + i, name: 'Route ' + i, route_type: 'long_haul', distance_km: 100 + i } }));
        res.end(JSON.stringify({ type: 'FeatureCollection', total: ROUTES, features }));
        return;
      }
      if (p === '/api/v1/relay/short') {
        await readBody(req);
        let n = ++shortN, code = '';
        for (let i = 0; i < 6; i++) { code += SHORT_ALPHA[n % SHORT_ALPHA.length]; n = Math.floor(n / SHORT_ALPHA.length); }
        res.end(JSON.stringify({ ok: true, url: 'https://dchub.cloud/u/' + code }));
        return;
      }
      if (p === '/api/v1/mcp/funnel-event') {
        const b = await readBody(req);
        if (b && b.event === 'quota_wall_hit') events.push(b);
        res.end('{"ok":true}');
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [], items: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of [...Object.keys(ENV), ...CLEAR, 'DCHUB_API_BASE']) prev[k] = process.env[k];
  for (const k of CLEAR) delete process.env[k];
  Object.assign(process.env, ENV, { DCHUB_API_BASE: `http://127.0.0.1:${stub.address().port}` });
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}
let ipN = 40, rpcId = 10;
// The after-merge QA call's shape: initialize, then tools/call, UA dchub-qa-readonly, X-DCHub-QA: 1.
async function session(clientName = 'Claude Code', tool = 'list_transactions') {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, 'user-agent': 'dchub-qa-readonly', 'x-dchub-qa': '1' };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return async (args = {}) => {
    const before = events.length;
    const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: tool, arguments: args } });
    const result = JSON.parse(body).result || {};
    // The wall-hit event leaves from _wallOuterStep (fire and forget): wait for this call's.
    for (let i = 0; i < 50 && events.length === before; i++) await new Promise((r) => setTimeout(r, 20));
    const ev = events.slice(before).find((e) => e.tool === tool) || null;
    const texts = (result.content || []).map((c) => c.text || '');
    return { sid, result, texts, text: texts.join('\n'), sc: result.structuredContent || {}, ev };
  };
}
const withEnv = async (k, v, fn) => {
  const was = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { if (was === undefined) delete process.env[k]; else process.env[k] = was; }
};
const count = (t, s) => t.split(s).length - 1;


async function keyed(key, tool, args) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, 'user-agent': 'dchub-qa-readonly', 'x-dchub-qa': '1', 'x-api-key': key };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return async () => {
    const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: tool, arguments: args } });
    const result = JSON.parse(body).result || {};
    const text = (result.content || []).map((c) => c.text || '').join('\n');
    let data = null;
    try { data = JSON.parse((result.content || [])[0].text); } catch (_) { data = result.structuredContent || null; }
    const feats = (data && Array.isArray(data.features)) ? data.features : [];
    return { text, routes: feats.length, points: feats.length ? feats[0].geometry.coordinates.length : 0 };
  };
}
const line = AICAP_EMAIL_LINE_HEAD + fiberEmailClause({ perDay: CAP });

describe('fiberEmailClause (pure)', () => {
  it('asks for the email with bind_email, names the routes, their complete paths and the cap; no plan or price', () => {
    const c = fiberEmailClause({ perDay: CAP });
    expect(c.startsWith(RANK_EMAIL_ASK_LEAD)).toBe(true);           // the lead the lean step keeps
    expect(c).toContain('`bind_email`');
    expect(c).toContain('complete paths');
    expect(c).toContain('up to ' + CAP + ' full answers a day');
    expect(c).not.toMatch(/\bPro\b|\bDeveloper\b|\$\d/);
  });
  it('unknown cap: null', () => {
    expect(fiberEmailClause({ perDay: 0 })).toBe(null);
    expect(fiberEmailClause({})).toBe(null);
  });
});

describe('keyless get_fiber_intel wall on /mcp, production transport', () => {
  it('first wall: the clause once, in its own paragraph directly above the human line; tagged line', async () => {
    const r = await (await session('Claude Code', 'get_fiber_intel'))({ market: 'dallas' });
    expect(r.sc.preview_is_partial || r.sc.trial_preview).toBe(true);
    expect(() => JSON.parse(r.texts[0])).not.toThrow();                // block 0 stays JSON
    const k = r.texts.findIndex((t) => t.startsWith(HUMAN));
    expect(k).toBeGreaterThan(0);
    expect(r.texts[k - 1].split('\n\n').at(-1)).toBe(line);
    expect(count(r.text, RANK_EMAIL_ASK_LEAD)).toBe(1);
    expect(r.text).not.toContain('`subscribe_digest`');                // the unlock ask, not the digest offer
    expect(r.ev && r.ev.email_ask).toBe('line');
  });
  it('a repeat wall in the same session (no human line): no ask, not tagged', async () => {
    const call = await session('Claude Code', 'get_fiber_intel');
    await call({ market: 'dallas' });
    const r = await call({ market: 'dallas' });
    expect(r.text).not.toContain(RANK_EMAIL_ASK_LEAD);
    expect(r.ev && r.ev.email_ask).toBeUndefined();
  });
  it('DCHUB_FIBER_EMAIL_ASK=0: no ask, not tagged', async () => {
    const r = await withEnv('DCHUB_FIBER_EMAIL_ASK', '0', async () => (await session('Claude Code', 'get_fiber_intel'))({ market: 'dallas' }));
    expect(r.text).not.toContain(RANK_EMAIL_ASK_LEAD);
    expect(r.ev && r.ev.email_ask).toBeUndefined();
  });
  it('DCHUB_AICAP_EMAIL_ASK=0 leaves the fiber ask on (each switch is its own)', async () => {
    const r = await withEnv('DCHUB_AICAP_EMAIL_ASK', '0', async () => (await session('Claude Code', 'get_fiber_intel'))({ market: 'dallas' }));
    expect(count(r.text, RANK_EMAIL_ASK_LEAD)).toBe(1);
  });
});

describe('what the fiber ask promises, on the real handler', () => {
  it('an email-bound free key gets every route with its complete path', async () => {
    const call = await keyed('dch_free_bound_1', 'get_fiber_intel', { market: 'dallas' });
    for (let i = 0; i < 3; i++) {
      const r = await call();
      expect(r.routes).toBe(ROUTES);
      expect(r.points).toBe(POINTS);
    }
  });
  it('control: a free key with no email gets 2 full answers, then the preview', async () => {
    const call = await keyed('dch_free_nobind_1', 'get_fiber_intel', { market: 'dallas' });
    const got = [];
    for (let i = 0; i < 3; i++) got.push((await call()).routes);
    expect(got.slice(0, 2)).toEqual([ROUTES, ROUTES]);
    expect(got[2]).toBeLessThan(ROUTES);
  });
});

describe('keyless get_dchub_recommendation wall (Pro-only) on /mcp', () => {
  it('first wall: the digest line once, directly above the human line; tagged digest_line; no unlock ask', async () => {
    const r = await (await session('Claude Code', 'get_dchub_recommendation'))({ context: 'site-selection' });
    expect(r.sc.preview_is_partial || r.sc.trial_preview).toBe(true);
    const k = r.texts.findIndex((t) => t.startsWith(HUMAN));
    expect(k).toBeGreaterThan(0);
    expect(r.texts[k - 1].split('\n\n').at(-1)).toBe(digestAskLine('get_dchub_recommendation'));
    expect(count(r.text, '`subscribe_digest`')).toBe(1);
    expect(r.text).not.toContain('bind_email');
    expect(r.ev && r.ev.email_ask).toBe('digest_line');
  });
});
