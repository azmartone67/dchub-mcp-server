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
const BOUND_KEY = 'dch_free_bound_guard';
const UNBOUND_KEY = 'dch_free_nobind_guard';
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
      // The real-handler guard below: a free key with an email bound, and one without.
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(key.startsWith(BOUND_KEY) ? { valid: true, tier: 'free', developer_id: 'dev_' + key, email: 'user@example.com' }
          : key.startsWith(UNBOUND_KEY) ? { valid: true, tier: 'free', developer_id: 'dev_' + key, email: null } : { valid: false, tier: 'free' }));
        return;
      }
      // Rows enough for a preview to withhold something (the default body below is empty, and an
      // empty answer is no wall).
      if (p === '/api/v1/hyperscaler-deals') {
        res.end(JSON.stringify({ success: true, count: 8, as_of: '2026-11-10T00:00:00Z',
          deals: Array.from({ length: 8 }, (_, i) => ({ actor: 'OpenAI', title: 'Deal ' + i, value_usd: 1e9 * (i + 1), mw: 100 * (i + 1), date: '2026-11-0' + (i + 1) })) }));
        return;
      }
      if (p === '/api/v1/tax-incentives') {
        res.end(JSON.stringify({ success: true, count: 2, last_updated: '2026-11-01', data: [
          { abbr: 'VA', name: 'Virginia', programs: [{ name: 'Sales tax exemption', value: 'full', min_investment_usd: 150000000 }], min_investment: 150000000 },
          { abbr: 'TX', name: 'Texas', programs: [] }] }));
        return;
      }
      if (p === '/api/v1/interconnection-queue/refined') {
        res.end(JSON.stringify({ ok: true, _entity: 'queue_results', count_returned: 10, count_total_matching: 10, total_queued_mw: 2045,
          results: Array.from({ length: 10 }, (_, i) => ({ project_name: 'P' + i, queue_id: 'PJM-' + i, iso: 'PJM', state: 'PA', fuel_type: 'Natural Gas',
            capacity_mw: 200 + i, queue_status: 'Active', estimated_ttp_months: 40, lat: 40.1, lng: -79.1, fiber_km: 3 })) }));
        return;
      }
      if (p.startsWith('/api/v1/facilities') || p.startsWith('/api/v1/facility/')) {
        const f = { id: 'equinix-dc1-ashburn', name: 'Equinix DC1', provider: 'Equinix', city: 'Ashburn', state: 'VA', country: 'US',
          power_mw: 48, latitude: 39.0438, longitude: -77.4874, raw_data: { floors: 3 } };
        res.end(JSON.stringify(p === '/api/v1/facilities' ? { success: true, count: 1, data: [f] } : f));
        return;
      }
      if (p === '/api/v1/dcpi/iso-comparison') {
        res.end(JSON.stringify({ isos: [{ iso: 'PJM', excess_power_score: 40, constraint_score: 60, time_to_power_months: 51, headroom_mw: 1000 },
          { iso: 'ERCOT', excess_power_score: 70, constraint_score: 30, time_to_power_months: 33, headroom_mw: 5000 }] }));
        return;
      }
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

// The digest line (lib/depth-digest-ask.mjs) tells the agent that an email does not open the fields the
// preview held back. The ask pass above runs a hand-built wall, so it cannot say whether that sentence
// is TRUE: mcp#1330 passed a unit test and failed live, because the real wall carried another
// unlock_kind. This pass runs the REAL handler, over HTTP, for every tools/list tool: a keyless first
// call (a real session, a client UA; the QA UA `dchub-qa-readonly` reads as internal and suppresses the
// email asks), then, where that call was a preview, the same call with a free key that has an email
// bound. "The email opened something" is measured on the data, not on a flag: the email-bound answer
// holds a value the keyless one did not (a field filled in, or more rows). Two rules, one per direction:
//   1. a keyless wall that carries the digest line gets nothing more for the email-bound key
//      (the line is true: the email opened nothing);
//   2. where the email-bound key gets more, the keyless wall must not carry the digest line and must
//      carry an email ask (`bind_email` / `claim_free_key` / "enter your email").
// Found 11-10 by this pass: compare_isos, hyperscaler_deals, get_tax_incentives and get_facility are in
// isFreeWithEmailTool, yet an email-bound free key gets the same preview as a keyless call (applyTierGate
// opens none of the first three for a free key, and the trial branch forces the preview; get_facility's
// free-key mask is the keyless mask), so the digest line is true there. get_refined_queue is opened by
// any key, and its keyless wall carries the bind_email ask, not the digest line.
import { DIGEST_ASK_LEAD } from '../lib/depth-digest-ask.mjs';
const ARG_SAMPLES = { isos: 'PJM,ERCOT', iso: 'PJM', state: 'VA', market: 'dallas', market_slug: 'dallas',
  query: 'dallas', id: 'equinix-dc1-ashburn', facility_id: 'equinix-dc1-ashburn', target_mw: 50, horizon_months: 18,
  intent: 'power headroom in Dallas', name: 'guard-list', shortlist_name: 'guard-list',
  from: '32.78,-96.80', to: '32.80,-96.79' };
const EMAIL_ASK_RE = /`bind_email`|`claim_free_key`|enter (?:an|your) email/i;
// A keyless result is a wall when it says it withheld something: the preview flags, a per-field
// `_x_withheld` marker, or the citation's word.
const isPreview = (sc) => !!sc && (sc.preview_is_partial === true || sc.trial_preview === true
  || /"_[a-z0-9_]+_withheld":true/.test(JSON.stringify(sc))
  || (sc.citation && sc.citation.completeness === 'partial_preview'));
// The answer's data, as the set of paths that hold a non-null value. The envelope the chain adds
// (links, citations, asks, quota, identity) and every `_`-prefixed marker are not data.
const ENVELOPE = new Set(['provenance', 'citation', 'cite_as', 'identity', 'next_ask', 'next_call', 'agent_instruction',
  'for_your_human', 'human_message', 'user_message', 'human_url', 'quota', 'platform', 'tool', 'show_to_user',
  'caller_tier', 'preview_is_partial', 'trial_preview', 'continuation', 'coordinates_status', 'agent_payment',
  'upgrade_url', 'unlock_kind', 'unlocked_tools', 'error', 'note', 'status', 'computed_at', 'retrieved_at']);
function dataPaths(sc) {
  const out = new Set();
  const walk = (v, path, depth) => {
    if (v === null || v === undefined || depth > 8) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + '[' + i + ']', depth + 1)); return; }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith('_') || (depth === 0 && ENVELOPE.has(k))) continue;
        walk(x, path + '.' + k, depth + 1);
      }
      return;
    }
    if (typeof v === 'string' && /^https:\/\/dchub\.cloud\//.test(v)) return;
    out.add(path);
  };
  walk(sc, '', 0);
  return out;
}
const gainedOver = (more, less) => { const a = dataPaths(less); return [...dataPaths(more)].filter((p) => !a.has(p)); };
// Tools whose keyless call is not a plain read of the tool (they fan out to other tools), so the
// email-bound key's answer is not comparable call for call.
const NOT_COMPARABLE = {
  execute_plan: 'runs other tools as steps; each step is checked as its own tool',
};
describe('guard (real handler): the digest line is never sent where an email opens the answer', () => {
  it('every tools/list tool, keyless first wall vs an email-bound free key', async () => {
    let n = 0;
    const call = async (tool, args, key) => {
      const h0 = { 'x-forwarded-for': `203.0.113.${(n++ % 250) + 1}`, 'user-agent': 'claude-code/2.0', ...(key ? { 'x-api-key': key } : {}) };
      const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } });
      const sid = init.headers.get('mcp-session-id');
      const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
      if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
      const { body } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });
      const result = JSON.parse(body).result || {};
      return { sc: result.structuredContent || {}, text: (result.content || []).map((c) => c.text || '').join('\n') };
    };
    const h0 = { 'x-forwarded-for': '203.0.113.251', 'user-agent': 'claude-code/2.0' };
    const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } });
    const sid = init.headers.get('mcp-session-id');
    const { body } = await post({ ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) }, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listed = JSON.parse(body).result.tools || [];
    expect(listed.length).toBeGreaterThan(80);
    const noSample = [], digestFalse = [], noEmailAsk = [], digestTrue = [], emailOpens = [];
    for (const t of listed) {
      const name = t.name;
      if (S.LP_TOOLS.has(name) || S._writeToolForTest(name) || name in NOT_COMPARABLE) continue;
      const props = (t.inputSchema && t.inputSchema.properties) || {};
      const args = {};
      for (const [k, v] of Object.entries(ARG_SAMPLES)) if (k in props) args[k] = v;
      const missing = ((t.inputSchema && t.inputSchema.required) || []).filter((k) => !(k in args));
      if (missing.length) { noSample.push(name + ':' + missing.join(',')); continue; }
      const anon = await call(name, args, null);
      if (!isPreview(anon.sc)) continue;                                  // not a wall: nothing to ask
      const digest = anon.text.includes(DIGEST_ASK_LEAD);
      const gained = gainedOver((await call(name, args, BOUND_KEY)).sc, anon.sc);
      if (digest && gained.length) digestFalse.push(name + ' (+' + gained.slice(0, 3).join(' ') + ')');
      if (digest && !gained.length) digestTrue.push(name);
      if (gained.length) {
        emailOpens.push(name);
        if (!EMAIL_ASK_RE.test(anon.text) && !(name in NO_CHAIN_ASK)) noEmailAsk.push(name);
      }
    }
    expect(noSample, 'a required argument with no sample value: add it to ARG_SAMPLES').toEqual([]);
    expect(digestFalse, 'the digest line says an email opens nothing, but an email-bound key got more').toEqual([]);
    expect(noEmailAsk, 'an email-bound key gets more, but the keyless wall asks for no email').toEqual([]);
    // Not vacuous: the pass reached both kinds of wall (the depth walls named above, and the queue
    // survivors a free key opens).
    expect(digestTrue).toEqual(expect.arrayContaining(['compare_isos', 'hyperscaler_deals', 'get_tax_incentives', 'get_facility']));
    expect(emailOpens).toContain('get_refined_queue');
    // Any key opens get_refined_queue, an unbound free key included: a free-key wall, never a depth wall.
    const anonQ = await call('get_refined_queue', { iso: 'PJM' }, null);
    expect(gainedOver((await call('get_refined_queue', { iso: 'PJM' }, UNBOUND_KEY)).sc, anonQ.sc).length).toBeGreaterThan(0);
  }, 240_000);
});
