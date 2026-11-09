// wall-ask-guard.test.mjs (harness copied from depth-wall-digest-ask.test.mjs): Grok move 4 (2026-11-09) asked
// for a regression test that fails if a gated tool can return a wall without an ask. Every tool tools/list
// serves is put through the response chain's ask steps as a keyless first wall on /mcp, with a real session:
// _gridSellThenDigestStep (the per-tool sell lines, the fiber / ai_capacity_index asks, the depth wall's
// digest offer), then _wallEmailLineStep (option A: the in-chat email line on a grid / queue or free-key
// wall). A tool that ends with no ask must be named below with its reason, so a new tool, or a tool whose
// wall kind moves, fails here until it gets an ask or a reason. Each ask's real wire is pinned in its own
// file (rank-markets-email-rows-ask, ai-capacity-email-rows-ask, fiber-email-ask, wall-email-line-freekey,
// keyless-wall-email-first, depth-wall-digest-ask).
//
// Found 11-09 by this guard: get_gas_intelligence asked for nothing (now _gasEmailAskStep, test/gas-intel-email-ask).
// Also found 11-09: a live probe with the QA UA (`dchub-qa-readonly`) never sees option A,
// because isBotOrInternalCtx reads `dchub` in the UA as an internal caller. A QA probe of a free-key wall
// therefore shows no ask that a real caller does get.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
const SHORT_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
const HUMAN = '→ **For your human:**';
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
      if (p.startsWith('/api/v1/grid/')) {
        const demand = Array.from({ length: 25 }, (_, i) => ({ ts: '2026-11-09T' + String(i % 24).padStart(2, '0') + ':00:00Z', mw: 40000 + i }));
        res.end(JSON.stringify({ success: true, iso: 'ERCOT', as_of: '2026-11-09T08:00:00Z', demand_mw: 41000,
          committed_capacity_mw: 90000, data_center_load: 5.1, fuel_mix: { gas: 0.4, wind: 0.3, solar: 0.1, coal: 0.1, nuclear: 0.1 },
          demand_24h: demand, ancillary_regup_price_usd_mw: 12.5 }));
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
// The after-merge QA call's shape: initialize, then tools/call, UA dchub-qa-readonly, X-DCHub-QA: 1.
async function session(clientName = 'Claude Code', tool = 'get_grid_data', path = '/mcp') {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, 'user-agent': 'dchub-qa-readonly', 'x-dchub-qa': '1' };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } }, path);
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' }, path);
  return async (args = {}) => {
    const before = events.length;
    const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: tool, arguments: args } }, path);
    const result = JSON.parse(body).result || {};
    // The wall-hit event leaves after the chain (C3 _finishWallRow, fire and forget): wait for this call's.
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


const NO_CHAIN_ASK = {
  // The email ask is written by another step, on the wall's own shape (row counts, the grid/queue taste):
  rank_markets: 'rank email ask needs the ranking row count (rank-markets-email-rows-ask)',
  ai_capacity_index: 'its email ask needs the index row count (ai-capacity-email-rows-ask)',
  get_grid_intelligence: 'grid/queue email line on the taste wall (keyless-wall-email-first)',
  get_interconnection_queue: 'grid/queue email line on the taste wall (keyless-wall-email-first)',
  get_market_intel: 'preview-only; its email line rides the same taste wall as grid/queue',
};
describe('guard: every walled tool ends a keyless first wall with an ask, or a named reason', () => {
  it('tools/list, each through the ask chain', async () => {
    const h0 = { 'x-forwarded-for': '198.51.100.250', 'user-agent': 'dchub-qa-readonly', 'x-dchub-qa': '1' };
    const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } });
    const sid = init.headers.get('mcp-session-id');
    const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
    const { body } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (JSON.parse(body).result.tools || []).map((t) => t.name);
    expect(tools.length).toBeGreaterThan(80);
    const wall = () => ({
      content: [{ type: 'text', text: '{"rows":[]}' }, { type: 'text', text: HUMAN + ' this answer hid 3 fields — open https://dchub.cloud/u/abc234' }],
      structuredContent: { preview_is_partial: true, trial_preview: true, rows: [], human_url: 'https://dchub.cloud/u/abc234',
        tier_masked: { tier_required: 'identified', fields: ['rows'] } },   // the keyless any-key mask (get_gas_intelligence)
    });
    const missing = [];
    for (const t of tools) {
      if (S.LP_TOOLS.has(t) || t in NO_CHAIN_ASK || S._writeToolForTest(t)) continue;
      const store = { tier: 'anonymous', platform: 'claude', session_id: 'guard-session-0001' };
      const out = S._runInCtxForTest(store, () => S._wallEmailLineStep(S._gridSellThenDigestStep(wall(), t), t));
      const txt = JSON.stringify(out);
      if (!store._emailAsk && !/`bind_email`|`subscribe_digest`|enter your email/.test(txt)) missing.push(t);
    }
    expect(missing).toEqual([]);
    for (const t of Object.keys(NO_CHAIN_ASK)) expect(tools, t).toContain(t);   // a stale reason fails too
  });
});
