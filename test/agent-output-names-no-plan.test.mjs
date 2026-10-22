// agent-output-names-no-plan.test.mjs — Grok QA 2026-10-22 item 4; owner rule 2026-10-10 (agent-facing
// text and fields name no plan and state no price).
//
// Grok, live keyless /mcp on 10-22: `_<field>_in_pro` keys and the plan name "developer"
// (`unlocks_at`, `_<k>_total_unlocks_at`, `required_tier`) were back in tool results. Measured the same
// day on 20 tools: 15 carried them (compare_isos, get_energy_prices, get_fiber_intel, get_gas_index,
// get_grid_intelligence, get_interconnection_queue, get_news, get_pipeline, get_tax_incentives,
// get_water_risk, hyperscaler_deals, list_transactions, rank_markets, search_facilities). mcp#1071 had
// renamed them for the siting tools only; lib/plan-free-fields.mjs now runs for every tool.
//
// This guard fails the build if any agent-facing output names a plan:
//   1. tools/list on every MCP path (descriptions, titles, every inputSchema string) and the initialize
//      instructions;
//   2. the FINAL result of EVERY tool in tools/list, through the real express app, for the keyless, free
//      key and email-bound seats, fresh and with the daily allowance spent: no key that names a plan
//      (`_x_in_pro`, `_x_in_developer`, `*_unlocks_at`, `required_tier`, ...), no such token in any text,
//      and no plan named in prose ("Pro plan", "DC Hub Developer", ...).
// Not vacuous: with the rewrite switched off (DCHUB_PLAN_FREE_FIELDS_V1=0) the same sweep finds them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const _realFetch = globalThis.fetch;
const BLOCKED = [];
const K_FREE = 'dch_live_noplan_free_0000000000000001';
const K_IDENT = 'dch_live_noplan_ident_000000000000001';
const KEY_TIER = { [K_FREE]: 'free', [K_IDENT]: 'free' };
const KEY_EMAIL = { [K_IDENT]: 'ident@example.com' };
const SEATS = [['anon', null], ['free', K_FREE], ['ident', K_IDENT]];

// ── what "names a plan" means ─────────────────────────────────────────────────────────────────────────
export const PLAN_KEY = /(^|_)in_(pro|developer|starter|enterprise)$|(^|_)unlocks_at$|^_*(substation_)?required_tier$|^pro_hint$/i;
// a rung key is a plan name only when its value is one (`tier_required: 'free_key'` is a guided 401)
export const RUNG_KEY = /(^|_)(required_plan|plan_required|tier_required|required_rung)$/i;
export const PLAN_VALUE = /^(pro|developer|starter|founder|founding|enterprise|pack|business|team|paid)$/i;
export const PLAN_TOKEN = /_in_(pro|developer)\b|_unlocks_at\b|\brequired_tier\b/;
// A plan named in prose. Capitalised plan word next to a plan noun, or DC Hub + plan word. The data
// field `developer` (a project's developer, get_refined_queue) and "contract plans" are not plan names.
export const PLAN_PROSE = /\b(Pro|Developer|Starter|Founder|Enterprise)\s+(plan|tier|seat|subscription|key|rung|users?|callers?|only)\b|\bDC Hub (Pro|Developer|Starter|Founder|Enterprise)\b|\b(in|with|on|needs|requires|upgrade to) (Pro|Developer|Starter|Enterprise)\b|\$\s?\d+(\.\d+)?\s*(\/|per)\s*mo(nth)?\b/;

function offenders(texts, sc) {
  const out = [];
  const walk = (o, p, d = 0) => {
    if (d > 16 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${p}[${i}]`, d + 1)); return; }
    for (const [k, v] of Object.entries(o)) {
      if (PLAN_KEY.test(k)) out.push(`${p}.${k}`);
      if (RUNG_KEY.test(k) && typeof v === 'string' && PLAN_VALUE.test(v.trim())) out.push(`${p}.${k}=${v}`);
      walk(v, `${p}.${k}`, d + 1);
    }
  };
  walk(sc, 'sc');
  texts.forEach((t, i) => {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { walk(JSON.parse(t.slice(a, b + 1)), `content${i}`); } catch (_) { /* prose */ } }
    const m = PLAN_TOKEN.exec(t) || PLAN_PROSE.exec(t);
    if (m) out.push(`content${i}: "${t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20).replace(/\s+/g, ' ')}"`);
  });
  return out;
}

// ── stub backend (the ladder-stage1 shapes: lists long enough to be trimmed, scores, MW) ──────────────
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  id: `fac_${i}`, name: `Site ${i}`, operator: 'Op', market: 'dallas', iso: 'PJM', state: 'OH', capacity_mw: 1000 + i * 11.7,
  power_mw: 50.31 + i, estimated_ttp_months: 51.5 + i, lat: 39.9 + i / 100, lon: -83.0, value_usd: 7654321 + i,
  score: 71.3 + i, dcpi_score: 64.2 + i, constraint_score: 40.2 + i, price_per_mwh: 48.7 + i, distance_km: 3.37 + i,
}));
const GENERIC = { ok: true, count: 10, total: 10, total_mw: 10525.4, data: ROWS, results: ROWS, deals: ROWS, articles: ROWS,
  transactions: ROWS, facilities: ROWS, markets: ROWS, items: ROWS, projects: ROWS, features: ROWS, states: ROWS,
  iso: 'PJM', demand_mw: 91234.5, peak_mw: 95555.5, constraint_score: 61.7, excess_power_score: 55.1,
  avg_time_to_power_months: 31.5, queue_depth_gw: 287.4, composite_score: 77.7, verdict: 'CAUTION',
  metrics: { demand_mw: { value: 91234.5, unit: 'MW', timestamp: '2026-10-22T19:00:00Z' } } };
const SAMPLE = { iso: 'PJM', region_iso: 'PJM', market: 'dallas', market_slug: 'dallas', state: 'OH', country: 'US',
  lat: 39.96, lon: -83.0, query: 'data center ashburn', q: 'data center ashburn', intent: 'find a site for 100MW in Ohio',
  email: 'sweep@example.com', facility_id: 'fac_1', id: 'fac_1', name: 'Sweep', capacity_mw: 100, target_mw: 200,
  url: 'https://dchub.cloud/facility/1', dataset: 'facilities', scenario: 'add 500MW', market_a: 'dallas', market_b: 'phoenix' };
function sampleFor(name, prop) {
  if (prop && prop.enum && prop.enum.length) return prop.enum[0];
  if (name in SAMPLE) return (prop && prop.type === 'array') ? [SAMPLE[name]] : SAMPLE[name];
  if (!prop) return 'x';
  if (prop.type === 'number' || prop.type === 'integer') return 1;
  if (prop.type === 'boolean') return false;
  if (prop.type === 'array') return /iso/i.test(name) ? ['PJM', 'ERCOT'] : ['dallas', 'phoenix'];
  if (prop.type === 'object') return {};
  return 'dallas';
}
function argsFor(tool) {
  const s = tool.inputSchema || {}; const props = s.properties || {}; const a = {};
  for (const k of s.required || []) a[k] = sampleFor(k, props[k]);
  for (const k of ['iso', 'market', 'state', 'lat', 'lon']) if (props[k] && !(k in a)) a[k] = sampleFor(k, props[k]);
  if (tool.name === 'compare_isos') a.isos = 'PJM,ERCOT,EU_DE_LU';
  if (tool.name === 'compare_sites') { a.locations = '33.45,-112.07;39.04,-77.48'; delete a.sites; }
  if (tool.name === 'semantic_search') a.q = 'behind-the-meter gas';
  if (tool.name === 'search_intelligence') a.query = 'behind-the-meter gas';
  return a;
}

let S, PORT, httpServer, stub, TOOLS, PEEK_N = 0;
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } }); });
const prevEnv = {};
beforeAll(async () => {
  globalThis.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(u)) { BLOCKED.push(u.slice(0, 120)); return Promise.reject(new Error('fenced')); }
    return _realFetch(input, init);
  };
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const send = (o) => res.end(JSON.stringify(o));
      if (url.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        return send(KEY_TIER[key] ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_noplan', email: KEY_EMAIL[key] || null }
          : { valid: false, tier: 'free' });
      }
      if (url.pathname === '/api/v1/mcp/credits/balance') return send({ credits: 0, had_pack: false });
      if (url.pathname === '/api/v1/mcp/full-cap/peek') return send({ ok: true, n: PEEK_N });
      if (url.pathname.startsWith('/api/v1/mcp/') || url.pathname.startsWith('/api/v1/keys/')) return send({});
      return send(GENERIC);
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_PLAN_FREE_FIELDS_V1']) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  delete process.env.DCHUB_PLAN_FREE_FIELDS_V1;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  TOOLS = (await listTools('/mcp')).tools;
}, 60000);
afterAll(async () => {
  globalThis.fetch = _realFetch;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function post(path, headers, body) {
  const res = await _realFetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, status: res.status, json };
}
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'noplan-guard', version: '1.0' } };
async function session(path, key) {
  const h = key ? { 'x-api-key': key } : {};
  const init = await post(path, h, { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT });
  const sid = init.headers.get('mcp-session-id');
  if (sid) await post(path, { ...h, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  let instructions = '';
  try { instructions = JSON.parse(init.json).result.instructions || ''; } catch (_) { /* no body */ }
  return { sid, instructions };
}
async function listTools(path) {
  const { sid, instructions } = await session(path, null);
  const r = await post(path, sid ? { 'mcp-session-id': sid } : {}, { jsonrpc: '2.0', id: 9, method: 'tools/list' });
  if (sid) S._releaseSession(sid);
  let tools = [];
  try { tools = JSON.parse(r.json).result.tools || []; } catch (_) { tools = []; }
  return { tools, instructions };
}
async function callTool(tool, args, key, spent) {
  for (const mp of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) mp && mp.clear && mp.clear();
  PEEK_N = spent ? 999 : 0;
  const h = key ? { 'x-api-key': key } : {};
  const { sid } = await session('/mcp', key);
  const { json } = await post('/mcp', { ...h, 'mcp-session-id': sid }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });
  try { S._sessionMaps().sessions.get(sid)?.close?.(); } catch (_) { /* closed */ }
  S._releaseSession(sid);
  let r = {};
  try { r = JSON.parse(json).result || {}; } catch (_) { r = {}; }
  return { texts: (r.content || []).map((c) => c.text || ''), sc: r.structuredContent || null };
}
async function sweep() {
  const found = new Map();   // tool -> [seat: offender]
  let calls = 0;
  for (const t of TOOLS) {
    const args = argsFor(t);
    for (const spent of [false, true]) for (const [seat, key] of SEATS) {
      const { texts, sc } = await callTool(t.name, args, key, spent);
      calls++;
      const off = offenders(texts, sc);
      if (off.length) found.set(t.name, [...(found.get(t.name) || []), ...off.slice(0, 3).map((o) => `${seat}${spent ? '/spent' : ''}: ${o}`)]);
    }
  }
  return { found, calls };
}

describe('the matchers', () => {
  it('flag plan-naming keys, tokens and prose; leave data and neutral copy alone', () => {
    for (const k of ['_score_in_pro', '_data_total_in_pro', '_sections_total_in_developer', 'unlocks_at', '_withheld_unlocks_at',
      'full_unlocks_at', 'required_tier', '_required_tier', 'pro_hint']) expect(PLAN_KEY.test(k), k).toBe(true);
    for (const k of ['_score_withheld', '_data_total_available', 'developer', 'developer_name', 'tier', 'caller_tier', 'not_covered', 'tier_required'])
      expect(PLAN_KEY.test(k), k).toBe(false);
    expect(offenders([], { tier_required: 'pro', required_plan: 'developer' })).toHaveLength(2);
    expect(offenders([], { tier_required: 'free_key' })).toEqual([]);
    for (const t of ['upgrade to Pro for the full list', 'a DC Hub Developer key', 'the Pro plan', '$99/mo', 'Developer tier only'])
      expect(PLAN_PROSE.test(t), t).toBe(true);
    for (const t of ['ERCOT only: keep projects whose developer name contains this text', 'see DC Hub contract plans at /enterprise',
      'the lowest plan that returns them is a free DC Hub key', 'Profile', 'Production cost']) expect(PLAN_PROSE.test(t), t).toBe(false);
  });
});

describe('tools/list and initialize name no plan, on every MCP path', () => {
  it.each(['/mcp', '/mcp/oauth', '/mcp/grok', '/mcp/core', '/mcp/claude', '/mcp/chatgpt'])('%s', async (path) => {
    const { tools, instructions } = await listTools(path);
    if (path === '/mcp' || path === '/mcp/grok' || path === '/mcp/core') expect(tools.length, `${path} served no tools`).toBeGreaterThan(0);
    const bad = [];
    for (const t of tools) {
      const s = JSON.stringify({ title: t.title, description: t.description, inputSchema: t.inputSchema });
      const m = PLAN_TOKEN.exec(s) || PLAN_PROSE.exec(s);
      if (m) bad.push(`${t.name}: "${s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20)}"`);
    }
    const m = PLAN_TOKEN.exec(instructions) || PLAN_PROSE.exec(instructions);
    if (m) bad.push(`instructions: "${instructions.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20)}"`);
    expect(bad).toEqual([]);
  }, 30000);
});

describe('every tool result names no plan (keyless, free key, email-bound; fresh and spent)', () => {
  it('the rewrite off: the same sweep finds plan names (the guard can fail)', async () => {
    process.env.DCHUB_PLAN_FREE_FIELDS_V1 = '0';
    try {
      const { found } = await sweep();
      expect(found.size, 'with the rewrite off the sweep found nothing: the fixture no longer exercises the trims').toBeGreaterThanOrEqual(45);   // measured 59 tools 2026-10-22
    } finally { delete process.env.DCHUB_PLAN_FREE_FIELDS_V1; }
  }, 300000);
  it('the rewrite on: no tool result names a plan', async () => {
    const { found, calls } = await sweep();
    expect(calls).toBe(TOOLS.length * 2 * SEATS.length);
    expect(TOOLS.length).toBeGreaterThanOrEqual(90);
    expect(Object.fromEntries(found)).toEqual({});
  }, 300000);
  it('no socket left loopback', () => { expect(BLOCKED).toEqual([]); });
});
