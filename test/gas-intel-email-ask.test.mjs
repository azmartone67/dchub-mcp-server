// gas-intel-email-ask.test.mjs (harness copied from fiber-email-ask.test.mjs). 2026-11-09: the wall-ask guard
// (test/wall-ask-guard.test.mjs) found get_gas_intelligence with no ask. Measured here on the real handler: the
// keyless answer withholds the gas-to-grid $/MWh and the basis and delivered gas prices (_maskGasIntelligenceAnonymous),
// said only "hit DC Hub's free-tier limit", and sent no quota_wall_hit (the mask is not a quota wall). ANY free key gets
// the full brief on every call, with or without an email. The answer now carries the bind_email ask
// (lib/paid-sell-line.gasEmailClause), kill switch DCHUB_GAS_EMAIL_ASK=0, and bind_email on that session opens it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { gasEmailClause, RANK_EMAIL_ASK_LEAD } from '../lib/paid-sell-line.mjs';

const UA = 'Claude-User/1.0 (+https://claude.ai)';   // a real client UA: the QA UA reads as internal and skips option A
const GAS = { success: true, region: 'TX', region_name: 'Texas', henry_hub_usd_mmbtu: 3.1, basis_usd_mmbtu: 0.42,
  delivered_price_usd_mmbtu: 3.52, gas_to_grid_usd_per_mwh: { new_ccgt: 48.1, existing_ccgt: 52.3, peaker: 88.0 },
  headline_behind_meter_vs_grid_delta_usd_mwh: -6.2,
  headline: { delta_usd_mwh: -6.2, gas_to_grid_new_ccgt_usd_mwh: 48.1, interpretation: 'gas cheaper' },
  gas_access: { interstate_pipelines: 12, operators: ['Kinder Morgan', 'Energy Transfer'] },
  live_grid_gas_share_pct: 44.5, dcgi_status: 'live', gas_to_grid_status: 'live', as_of: '2026-11-09T08:00:00Z' };
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
const SHORT_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
const HUMAN = '→ **For your human:**';
const CAP = 10;
const ENV = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_INTERNAL_KEY: SECRET, DCHUB_ANON_DAILY_CAP: '5' };
const CAP_NET = '203.0.113.';   // the anon-usage stub reports these IPs at the daily cap; every other IP at 0
const MINTED_KEY = 'dch_free_bound_gas_minted_0001';
const claims = [];
const CLEAR = ['DCHUB_GAS_EMAIL_ASK', 'DCHUB_FIBER_EMAIL_ASK', 'DCHUB_DEPTH_DIGEST_ASK', 'DCHUB_AICAP_EMAIL_ASK', 'DCHUB_LEAN_RESPONSES', 'DCHUB_IDENTIFIED_TOOL_DAILY_FULL', 'DCHUB_TRIAL_TOOL_DAILY_FULL'];

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
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(key.startsWith('dch_free_bound') ? { valid: true, tier: 'free', developer_id: 'dev_' + key, email: 'user@example.com' }
          : key.startsWith('dch_free_nobind') ? { valid: true, tier: 'free', developer_id: 'dev_' + key, email: null } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/keys/claim') {   // bind_email on a keyless session mints through here
        claims.push(await readBody(req));
        res.end(JSON.stringify({ ok: true, api_key: MINTED_KEY, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/mcp/anon-usage') {
        res.end(JSON.stringify({ count: String(url.searchParams.get('ip') || '').startsWith(CAP_NET) ? 5 : 0 }));
        return;
      }
      if (p === '/api/v1/mcp/full-cap/peek') { res.end(JSON.stringify({ ok: true, n: 0 })); return; }
      if (p.startsWith('/api/v1/gas/intelligence/')) {
        res.end(JSON.stringify(GAS));
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

async function post(headers, body, path = '/mcp') {
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
let ipN = 40, rpcId = 10;
// initialize, then tools/call, with a real client UA (UA above).
async function session(clientName = 'Claude Code', tool = 'list_transactions', net = '198.51.100.') {
  const h0 = { 'x-forwarded-for': `${net}${ipN++}`, 'user-agent': UA };
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
    return { sid, ip: h0['x-forwarded-for'], result, texts, text: texts.join('\n'), sc: result.structuredContent || {}, ev };
  };
}
const withEnv = async (k, v, fn) => {
  const was = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { if (was === undefined) delete process.env[k]; else process.env[k] = was; }
};
const count = (t, s) => t.split(s).length - 1;


async function keyed(key, tool, args) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, 'user-agent': UA, 'x-api-key': key };
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
    return { text, full: !!data && data.basis_usd_mmbtu === 0.42 && data.gas_to_grid_usd_per_mwh && data.gas_to_grid_usd_per_mwh.new_ccgt === 48.1,
      masked: !!data && !!data.tier_masked, preview: !!(result.structuredContent && (result.structuredContent.preview_is_partial || result.structuredContent.trial_preview)) };
  };
}

const ask = gasEmailClause();
const fullGas = (text) => { try { const d = JSON.parse(text.split('\n')[0]); return d.basis_usd_mmbtu === 0.42 && d.gas_to_grid_usd_per_mwh.new_ccgt === 48.1; } catch (_) { return false; } };

describe('gasEmailClause (pure)', () => {
  it('opens with the shared email-ask lead the lean step keeps; names what it opens; no plan or price', () => {
    expect(ask.startsWith(RANK_EMAIL_ASK_LEAD)).toBe(true);
    expect(ask).toContain('gas-to-grid $/MWh');
    expect(ask).toContain('any free DC Hub key');
    expect(ask).not.toMatch(/\bPro\b|\bDeveloper\b|\$\d|subscribe_digest/);
  });
});

describe('keyless get_gas_intelligence on /mcp, production transport, a real client UA', () => {
  it('withholds the prices and asks for the email once; block 0 stays JSON', async () => {
    const r = await (await session('Claude Code', 'get_gas_intelligence'))({ region: 'TX' });
    const d = JSON.parse(r.texts[0]);
    expect(d.basis_usd_mmbtu).toBeNull();
    expect(d.gas_to_grid_usd_per_mwh.new_ccgt).toBeNull();
    expect(count(r.text, ask)).toBe(1);
    expect(count(r.text, '`bind_email`')).toBe(1);
    const human = r.texts.filter((t) => !/^\s*\{/.test(t) && /https:\/\/dchub\.cloud\/u\//.test(t));
    expect(human.length).toBe(1);                                         // the person's link line stays
    expect(human[0]).not.toContain('bind_email');
  });
  it('kill switch DCHUB_GAS_EMAIL_ASK=0: no ask (the 11-09 wire)', async () => {
    const r = await withEnv('DCHUB_GAS_EMAIL_ASK', '0', async () => (await session('Claude Code', 'get_gas_intelligence'))({ region: 'TX' }));
    expect(r.text).not.toContain(RANK_EMAIL_ASK_LEAD);
  });
  it('/mcp/claude carries no ask (directory commerce rules)', async () => {
    const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, 'user-agent': UA };
    const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude', version: '1.0' } } }, '/mcp/claude');
    const sid = init.headers.get('mcp-session-id');
    const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
    const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: 'get_gas_intelligence', arguments: { region: 'TX' } } }, '/mcp/claude');
    expect(body).not.toContain(RANK_EMAIL_ASK_LEAD);
  });
  it('end to end: bind_email on that session mints a key with the email, and the next call is the full brief', async () => {
    claims.length = 0;
    const call = await session('Claude Code', 'get_gas_intelligence');
    const w = await call({ region: 'TX' });
    expect(w.text).toContain(ask);
    expect(fullGas(w.texts[0])).toBe(false);
    const h = { 'x-forwarded-for': w.ip, 'user-agent': UA, 'mcp-session-id': w.sid };
    await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: 'bind_email', arguments: { email: 'jane@firm.com' } } });
    expect(claims.length).toBe(1);
    expect(claims[0].email).toBe('jane@firm.com');
    const r = await call({ region: 'TX' });
    expect(fullGas(r.texts[0])).toBe(true);
    expect(r.text).not.toContain(RANK_EMAIL_ASK_LEAD);
  });
});

describe('what the gas ask promises, on the real handler', () => {
  it('an email-bound free key gets the full brief on every call (past the identified daily cap)', async () => {
    const c = await keyed('dch_free_bound_gas1', 'get_gas_intelligence', { region: 'TX' });
    for (let i = 0; i < CAP + 2; i++) {
      const r = await c();
      expect(r.full, 'call ' + i).toBe(true);
      expect(r.text).not.toContain(RANK_EMAIL_ASK_LEAD);
    }
  });
  it('a free key with no email gets it too: "any free DC Hub key" is literal', async () => {
    const c = await keyed('dch_free_nobind_gas1', 'get_gas_intelligence', { region: 'TX' });
    for (let i = 0; i < 4; i++) expect((await c()).full, 'call ' + i).toBe(true);
  });
});

// Live 11-09 10:05Z (QA probe after mcp#1329): on the anonymous daily-cap wall the claim hand-off line already asks
// for the email ("ask your human for an email, pass it to `claim_free_key`"), and the gas ask made it two. The cap
// wall's structured shape below is the one production sent.
describe('get_gas_intelligence on the anonymous daily cap (real handler)', () => {
  // #1330 tested a hand-built wall and missed the live shape: with a session the cap wall also carries the email
  // unlock link (unlock_kind 'email_cap'), which _wallKindFor reads as a free-key wall, so both asks still showed.
  it('one email ask: the person\'s link line, no gas line beside it', async () => {
    const r = await (await session('Claude Code', 'get_gas_intelligence', CAP_NET))({ region: 'TX' });
    expect(r.sc._upgrade && r.sc._upgrade.tier).toBe('anon_daily_cap');
    expect(r.text).toContain('One email unlocks 50 calls a day');
    expect(r.text).toContain('https://dchub.cloud/u/');
    expect(count(r.text, RANK_EMAIL_ASK_LEAD)).toBe(0);
    expect(count(r.text, '`bind_email`')).toBe(0);
    expect(fullGas(r.text)).toBe(false);
  });
  it('the same caller under the cap still gets the gas ask (the control)', async () => {
    const r = await (await session('Claude Code', 'get_gas_intelligence'))({ region: 'TX' });
    expect(r.sc._upgrade && r.sc._upgrade.tier).not.toBe('anon_daily_cap');
    expect(count(r.text, RANK_EMAIL_ASK_LEAD)).toBe(1);
  });
});
