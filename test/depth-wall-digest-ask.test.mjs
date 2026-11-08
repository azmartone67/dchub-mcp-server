// depth-wall-digest-ask.test.mjs (harness copied from ai-capacity-email-rows-ask.test.mjs): #117703 (Grok 11-05). The keyless ai_capacity_index wall carried
// no email ask on the wire. It now gets the honest rows ask the owner approved for rank_markets
// (mcp#1263, mcp#1273): one agent paragraph directly above the human line, naming every market in the
// index and the email-bound daily cap. Measured live 11-05 (QA): a free key with no email got 2 full
// answers (all 20 markets, every row scored), the 3rd was the 3-row preview; an email-bound key is capped
// at IDENTIFIED_DAILY_FULL_CAP (10) on the same trial_taste path. Kill switch DCHUB_AICAP_EMAIL_ASK=0.
//
// Real /mcp handler over HTTP (production transport: DCHUB_WALL_ISERROR=0, DCHUB_PREVIEW_ISERROR=0, lean
// on) against a stub backend serving a production-shaped /api/v1/ai-capacity-index payload
// (test/fixtures/ai-capacity-index-90.json: the live 2026-11-05 response's keys and markets, numeric
// values filled in). The wall-hit tag is read from the quota_wall_hit event the server posts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { digestAskLine, digestAskApplies, DIGEST_ASK_LEAD } from '../lib/depth-digest-ask.mjs';

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
const CAP = 10;   // IDENTIFIED_DAILY_FULL_CAP's default (DCHUB_IDENTIFIED_TOOL_DAILY_FULL is cleared below)
const ENV = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_INTERNAL_KEY: SECRET };
const CLEAR = ['DCHUB_DEPTH_DIGEST_ASK', 'DCHUB_AICAP_EMAIL_ASK', 'DCHUB_LEAN_RESPONSES', 'DCHUB_IDENTIFIED_TOOL_DAILY_FULL', 'DCHUB_TRIAL_TOOL_DAILY_FULL'];

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


describe('digestAskLine / digestAskApplies (pure)', () => {
  it('says the email opens nothing, names subscribe_digest with a source, and no plan or price', () => {
    const l = digestAskLine('list_transactions');
    expect(l.startsWith(DIGEST_ASK_LEAD)).toBe(true);
    expect(l).toContain('`subscribe_digest`');
    expect(l).toContain('source "depth_wall"');
    expect(l).not.toMatch(/\bPro\b|\bDeveloper\b|\$\d|bind_email|claim_free_key/);
    expect(digestAskLine('bad name; x')).toBe('');
  });
  it('applies only to an unbound, unpaid, un-asked preview of a depth tool on an ask surface', () => {
    const ok = { depth: true, partial: true, bound: false, asked: false, paid: false, excluded: false };
    expect(digestAskApplies(ok)).toBe(true);
    for (const k of ['depth', 'partial']) expect(digestAskApplies({ ...ok, [k]: false })).toBe(false);
    for (const k of ['bound', 'asked', 'paid', 'excluded']) expect(digestAskApplies({ ...ok, [k]: true })).toBe(false);
  });
});

describe('depth wall tool set', () => {
  it('the depth tools are in; tools where an email opens more, Pro-only, Land & Power and write tools are out', () => {
    for (const t of ['list_transactions', 'compare_isos', 'get_pipeline', 'hyperscaler_deals', 'get_tax_incentives', 'get_market_dcpi_rank'])
      expect(S._depthWallTool(t, {})).toBe(true);
    for (const t of ['get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel', 'rank_markets', 'ai_capacity_index',
      'get_fiber_intel', 'get_dchub_recommendation', 'analyze_site', 'compare_sites', 'get_composite_site_score', 'subscribe_digest', 'bind_email'])
      expect(S._depthWallTool(t, {})).toBe(false);
  });
});

describe('keyless list_transactions wall on /mcp, production transport', () => {
  it('first wall: the digest line once, directly above the human line; tagged digest_line', async () => {
    const r = await (await session())();
    expect(r.sc.preview_is_partial || r.sc.trial_preview).toBe(true);
    expect(() => JSON.parse(r.texts[0])).not.toThrow();                // block 0 stays JSON
    const k = r.texts.findIndex((t) => t.startsWith(HUMAN));
    expect(k).toBeGreaterThan(0);
    expect(r.texts[k - 1].split('\n\n').at(-1)).toBe(digestAskLine('list_transactions'));
    expect(count(r.text, '`subscribe_digest`')).toBe(1);
    expect(r.text).not.toContain('bind_email');                          // no unlock ask was added
    expect(r.ev && r.ev.email_ask).toBe('digest_line');
  });

  it('kill switch DCHUB_DEPTH_DIGEST_ASK=0: no line, no tag', async () => {
    const r = await withEnv('DCHUB_DEPTH_DIGEST_ASK', '0', async () => (await session())());
    expect(r.text).not.toContain('subscribe_digest');
    expect(r.ev && r.ev.email_ask).toBeUndefined();
  });

  it('a tool where an email opens more keeps its own ask, never the digest line', async () => {
    const r = await (await session('Claude Code', 'ai_capacity_index'))();
    expect(r.text).not.toContain('`subscribe_digest`');
    expect(r.ev && r.ev.email_ask).toBe('line');
  });
});

describe('markEmailAsk / quotaWallEventBody carry digest_line', () => {
  it('stores it, never over an unlock ask, and sends it', async () => {
    const { markEmailAsk, quotaWallEventBody, WALL_ASK_KINDS, DIGEST_ASK_KINDS } = await import('../lib/keyless-wall.mjs');
    expect(WALL_ASK_KINDS.has('digest_line')).toBe(false);
    expect(DIGEST_ASK_KINDS.has('digest_line')).toBe(true);
    const c = {};
    markEmailAsk(c, 'digest_line');
    expect(c._emailAsk).toBe('digest_line');
    expect(quotaWallEventBody({ c, name: 'list_transactions', status: 'trial_used' }).email_ask).toBe('digest_line');
    const c2 = { _emailAsk: 'line' };
    markEmailAsk(c2, 'digest_line');
    expect(c2._emailAsk).toBe('line');
    markEmailAsk(c, 'line');                                              // an unlock ask still wins
    expect(c._emailAsk).toBe('line');
  });
});

describe('_depthDigestAskStep guards, one context at a time', () => {
  const wall = () => ({
    content: [{ type: 'text', text: '{"transactions":[]}' }, { type: 'text', text: HUMAN + ' this answer hid the total.' }],
    structuredContent: { preview_is_partial: true, transactions: [] },
  });
  const run = (store) => S._runInCtxForTest(store, () => {
    const out = S._depthDigestAskStep(wall(), 'list_transactions');
    return { out, ask: store._emailAsk };
  });
  const shown = (o) => o.out.content.some((b) => (b.text || '').includes('`subscribe_digest`'));
  it('an unbound free caller gets it and the tag', () => {
    const r = run({ tier: 'free' });
    expect(shown(r)).toBe(true);
    expect(r.ask).toBe('digest_line');
  });
  it('another email ask already on the response: nothing added, the ask kept', () => {
    const r = run({ tier: 'free', _emailAsk: 'line' });
    expect(shown(r)).toBe(false);
    expect(r.ask).toBe('line');
  });
  it('an email on file, a paid tier, an execute_plan step, Grok: nothing', () => {
    for (const store of [{ tier: 'free', email: 'a@b.co' }, { tier: 'developer' }, { tier: 'free', loopback_step: true },
      { tier: 'free', platform: 'grok' }]) {
      const r = run(store);
      expect(shown(r)).toBe(false);
      expect(r.ask).toBeUndefined();
    }
  });
  // Measured live 11-08 after mcp#1316: keyless get_grid_data carried the line under a human line
  // that names "a free DC Hub key" as the plan that returns the fields. A free-key or capacity wall
  // is not a depth wall; an email does open (or raise) it.
  it('a free-key wall (keyless get_grid_data, an email-cap unlock): nothing', () => {
    const grid = S._runInCtxForTest({ tier: 'anonymous' }, () => S._depthDigestAskStep(wall(), 'get_grid_data'));
    expect(JSON.stringify(grid)).not.toContain('subscribe_digest');
    const cap = S._runInCtxForTest({ tier: 'free' }, () => S._depthDigestAskStep(
      { ...wall(), structuredContent: { preview_is_partial: true, unlock_kind: 'email_cap' } }, 'list_transactions'));
    expect(JSON.stringify(cap)).not.toContain('subscribe_digest');
  });
  it('a capacity wall (the call ration is spent): nothing', () => {
    const r = S._runInCtxForTest({ tier: 'free' }, () => S._depthDigestAskStep(
      { ...wall(), structuredContent: { preview_is_partial: true, error: 'quota_exceeded' } }, 'list_transactions'));
    expect(JSON.stringify(r)).not.toContain('subscribe_digest');
  });
  it('a full answer (no preview) and a repeat wall (no human line): nothing', () => {
    const full = S._runInCtxForTest({ tier: 'free' }, () => S._depthDigestAskStep(
      { ...wall(), structuredContent: { transactions: [] } }, 'list_transactions'));
    expect(JSON.stringify(full)).not.toContain('subscribe_digest');
    const repeat = S._runInCtxForTest({ tier: 'free' }, () => S._depthDigestAskStep(
      { ...wall(), content: [{ type: 'text', text: '{}' }] }, 'list_transactions'));
    expect(JSON.stringify(repeat)).not.toContain('subscribe_digest');
  });
});
