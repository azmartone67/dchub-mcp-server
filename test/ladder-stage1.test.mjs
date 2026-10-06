// ladder-stage1.test.mjs — the tier ladder, stage 1 (owner decision 2026-09-29):
// one reason per rung. Drives EVERY tool in the live /mcp tools/list at every seat
// through the real express app, against a stub backend that answers everything in
// full, with the per-day full-answer allowance both fresh and spent.
//
// Two things are pinned:
//
//  1. PER-SEAT OUTCOME for every tool stage 1 changed (the table below): Developer
//     is full and unlimited on grid/fiber intel; the $10 pack is Developer depth
//     per call and opens no Pro-only tool; Developer / Starter get the free key's
//     3-row preview on get_dchub_recommendation instead of a wall; the pack opens
//     retirement MW; a grandfathered Starter key keeps its old allowance.
//
//  2. THE INVERSION GUARD, across all 92 tools: no rung receives data the rung
//     above it does not. "Data" is the set of backend values that reached the
//     caller — every number / row id / row name the stub put in its answer that
//     survives into the response (content text or structuredContent). An upgrade
//     prompt, a link or a notice is not data, so extra CTA fields on a lower rung
//     cannot fake an inversion, and a masked or trimmed field on the upper rung is
//     exactly what makes one. Ladder (cheapest first):
//        anon ≤ free key ≤ free key + email ≤ pack ≤ Developer ≤ Pro
//        free key + email ≤ Starter ≤ Developer
//     Starter and the pack are not ordered against each other.
//
// Adapted from the uncommitted audit harness (tier audit 2026-09-29) and
// test/plan-query-tier-claims.test.mjs. HARD gate: deterministic; a fetch fence
// refuses anything but loopback, and the test fails if anything tried.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

// ── network fence: only loopback may be fetched ──
const BLOCKED = [];
const _realFetch = globalThis.fetch;

const K_FREE = 'dch_live_ladder1_free00001';
const K_IDENT = 'dch_live_ladder1_ident0001';
const K_PACK = 'dch_live_ladder1_packs0001';
const K_STARTER = 'dch_live_ladder1_start0001';
const K_DEV = 'dch_live_ladder1_devel0001';
const K_PRO = 'dch_live_ladder1_propro001';
const KEY_TIER = { [K_FREE]: 'free', [K_IDENT]: 'identified', [K_PACK]: 'identified', [K_STARTER]: 'starter',
  [K_DEV]: 'developer', [K_PRO]: 'pro' };
const KEY_EMAIL = { [K_IDENT]: 'ident@example.com', [K_PACK]: 'pack@example.com' };
const SEATS = [['anon', null], ['free', K_FREE], ['ident', K_IDENT], ['pack', K_PACK], ['starter', K_STARTER],
  ['developer', K_DEV], ['pro', K_PRO]];
// lower ≤ upper
const WITH_DATA_FLOOR = 70;   // measured 77 of 92
const GRADED_FLOOR = 55;      // measured 65 of 92
const ROW_LABEL_FLOOR = 2500;   // measured 3180 labelled trimmed lists across the sweep
const LADDER_PAIRS = [['anon', 'free'], ['free', 'ident'], ['ident', 'pack'], ['pack', 'developer'],
  ['developer', 'pro'], ['ident', 'starter'], ['starter', 'developer']];
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};

// Stub data. Values are distinctive so a value seen in a response can only have
// come from the backend (see dataTokens).
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  id: `fac_${i}`, name: `Site ${i}`, project_name: `Proj ${i}`, operator: 'Op', market: 'dallas', iso: 'PJM', state: 'OH', county: 'Franklin',
  fuel_type: 'Gas', capacity_mw: 1000 + i * 11.7, power_mw: 50.31 + i, queue_status: 'active', status: 'operational',
  estimated_ttp_months: 51.5 + i, fuel_class: 'firm', lat: 39.9123 + i / 100, lng: -83.0123, lon: -83.0123,
  coordinate_precision: 'county_centroid', fiber_km: 4.27 + i, candidate_id: `cand_${i}`, snapshot_id: 'snap_1',
  value: 1234567 + i, value_usd: 7654321 + i, score: 71.3 + i, dcpi_score: 64.2 + i, price_per_mwh: 48.7 + i,
  distance_km: 3.37 + i, url: `https://dchub.cloud/facility/${i}`, carrier: `Carrier ${i}`,
}));
const GENERIC = { ok: true, count: 10, total: 10, total_mw: 10525.4, total_value_usd: 99887766, data: ROWS, results: ROWS,
  deals: ROWS, changes: ROWS, facilities: ROWS, markets: ROWS, items: ROWS, projects: ROWS, routes: ROWS, sites: ROWS,
  iso: 'PJM', iso_name: 'PJM Interconnection', demand_mw: 91234.5, fuel_mix: { gas: 40.1, nuclear: 33.3 },
  constraint_score: 61.7, queue_depth_gw: 287.4, composite_score: 77.7, verdict: 'strong',
  _cite: 'DC Hub (dchub.cloud)' };
const FACILITY = { id: 'fac_1', slug: 'fac-1', name: 'Sweep DC 1', operator: 'Equinix', provider: 'Equinix', city: 'Columbus', state: 'OH', country: 'US',
  market: 'columbus', lat: 39.961234, lng: -83.001234, latitude: 39.961234, longitude: -83.001234, power_mw: 48.5, capacity_mw: 48.5, it_load_mw: 36.2,
  square_feet: 250000, status: 'operational', tier_level: 'III', pue: 1.31, year_built: 2019, tenants: ['A', 'B', 'C', 'D'], url: 'https://dchub.cloud/facility/fac-1',
  address: '1 Main St', utility: 'AEP Ohio', substation_distance_km: 1.7 };
const RETIRE = { _entity: 'retirement_headroom_results', ok: true, total_retiring_mw: 812.4,
  data: [{ generator: { name: 'Zeta Station', capacity_mw: 812.4, retirement_date: '2026-12-31' },
    queue_pressure: { competing_mw: 4417.3, competing_projects: 12 } }] };
const GAS = { market_name: 'Dallas', henry_hub_spot_usd_mmbtu: 2.917, basis_diff_usd_mmbtu: -0.412,
  delivered_industrial_usd_mmbtu: 3.853, delivered_electric_usd_mmbtu: 3.771 };

// Every number (≠ small integers, which collide with counts and limits) and every
// row id / row name string the stub can return.
const DATA_VALUES = new Set();
(function collect(o) {
  if (o === null || o === undefined) return;
  if (Array.isArray(o)) { o.forEach(collect); return; }
  if (typeof o === 'object') { Object.values(o).forEach(collect); return; }
  if (typeof o === 'number' && (!Number.isInteger(o) || Math.abs(o) > 100)) DATA_VALUES.add(o);
  if (typeof o === 'string' && /^(fac_\d|Site \d|Proj \d|cand_\d|Carrier \d|Zeta Station|Sweep DC 1)/.test(o)) DATA_VALUES.add(o);
})([ROWS, GENERIC, FACILITY, RETIRE, GAS]);

const SAMPLE = {
  iso: 'PJM', region_iso: 'PJM', market: 'dallas', market_slug: 'dallas', metro: 'dallas', state: 'OH', country: 'US',
  lat: 39.96, lon: -83.0, lng: -83.0, latitude: 39.96, longitude: -83.0, query: 'data center ashburn', q: 'data center ashburn',
  question: 'best market for 100MW', intent: 'find a site for 100MW in Ohio', topic: 'power', goal: 'find power for 100MW',
  email: 'sweep@example.com', facility_id: 'fac_1', id: 'fac_1', site_id: 'site_1', name: 'Sweep', capacity_mw: 100,
  target_mw: 200, mw: 100, horizon_months: 18, url: 'https://dchub.cloud/facility/1', text: 'sample text',
  dataset: 'facilities', format: 'json', scenario: 'add 500MW', tool: 'get_grid_scoreboard', listing_id: 'lst_1',
  intent_id: 'int_1', shortlist_id: 'sl_1', market_a: 'dallas', market_b: 'phoenix', address: '1 Main St, Columbus OH',
  company: 'Equinix', operator: 'Equinix', city: 'Columbus', fuel: 'gas', key: 'x', api_key: 'x',
};
function sampleFor(name, prop) {
  if (prop && prop.enum && prop.enum.length) return prop.enum[0];
  if (name in SAMPLE) return (prop && prop.type === 'array') ? [SAMPLE[name]] : SAMPLE[name];
  if (!prop) return 'x';
  if (prop.type === 'number' || prop.type === 'integer') return 1;
  if (prop.type === 'boolean') return false;
  if (prop.type === 'array') {
    const it2 = prop.items || {};
    if (it2.type === 'object') {
      const o = {}; for (const [k, p] of Object.entries(it2.properties || {})) o[k] = sampleFor(k, p);
      return [o, { ...o, lat: 32.8, lon: -96.8, lng: -96.8, name: 'B', market: 'phoenix' }];
    }
    if (/site|market|iso/i.test(name)) return /iso/i.test(name) ? ['PJM', 'ERCOT'] : ['dallas', 'phoenix'];
    return ['a', 'b'];
  }
  if (prop.type === 'object') {
    const o = {}; for (const [k, p] of Object.entries(prop.properties || {})) if ((prop.required || []).includes(k)) o[k] = sampleFor(k, p);
    return o;
  }
  return 'dallas';
}
function argsFor(tool) {
  const s = tool.inputSchema || {};
  const props = s.properties || {};
  const a = {};
  for (const k of s.required || []) a[k] = sampleFor(k, props[k]);
  for (const k of ['iso', 'market', 'state', 'lat', 'lon', 'limit']) {
    if (props[k] && !(k in a)) a[k] = k === 'limit' ? 50 : sampleFor(k, props[k]);
  }
  if (props.sites && !a.sites) a.sites = sampleFor('sites', props.sites);
  if (tool.name === 'get_facility') a.facility_id = 'fac_1';
  if (tool.name === 'compare_isos') a.isos = 'PJM,ERCOT,CAISO';
  if (tool.name === 'semantic_search') a.q = 'behind-the-meter gas';
  if (tool.name === 'search_intelligence') a.query = 'behind-the-meter gas';
  if (tool.name === 'compare_sites') { a.locations = '33.45,-112.07;39.04,-77.48'; delete a.sites; }
  if (tool.name === 'get_retirement_headroom') { a.target_mw = 200; a.horizon_months = 18; a.region_iso = 'MISO'; }
  return a;
}

let S, PORT, httpServer, stub, TOOLS;
let PEEK_N = 0;

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  globalThis.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(u)) {
      BLOCKED.push(u.slice(0, 120));
      return Promise.reject(new Error('ladder-stage1: network fenced'));
    }
    return _realFetch(input, init);
  };
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const send = (o) => res.end(JSON.stringify(o));
      if (url.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        return send(KEY_TIER[key]
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_ladder1', email: KEY_EMAIL[key] || null,
              tier_detail: { users_plan: KEY_TIER[key] } }
          : { valid: false, tier: 'free' });
      }
      if (url.pathname === '/api/v1/mcp/credits/balance') {
        const key = url.searchParams.get('key') || '';
        return send({ credits: key === K_PACK ? 900 : 0, had_pack: key === K_PACK });
      }
      if (url.pathname === '/api/v1/mcp/full-cap/peek') return send({ ok: true, n: PEEK_N });
      if (url.pathname === '/api/v1/retirement-headroom') return send(RETIRE);
      if (/^\/api\/v1\/markets\/[^/]+\/gas-pricing$/.test(url.pathname)) return send(GAS);
      if (/^\/api\/v1\/markets\/[^/]+\/gas-to-grid$/.test(url.pathname)) return send({});
      if (/^\/api\/v1\/(facility|facilities)\/[^/]+$/.test(url.pathname) && !/facilities\/(search|nearby)$/.test(url.pathname)) return send(FACILITY);
      if (url.pathname.startsWith('/api/v1/mcp/tools/')) return send(GENERIC);
      if (url.pathname.startsWith('/api/v1/mcp/') || url.pathname.startsWith('/api/v1/keys/')) return send({});
      return send(GENERIC);
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  const sid = await session(null);
  const { json } = await post({ 'mcp-session-id': sid }, { jsonrpc: '2.0', id: 9, method: 'tools/list' });
  TOOLS = JSON.parse(json).result.tools;
}, 60000);

afterAll(async () => {
  globalThis.fetch = _realFetch;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await _realFetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, json };
}

async function session(key) {
  const headers = key ? { 'x-api-key': key } : {};
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ladder-stage1-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  await post({ ...headers, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return sid;
}

// Every backend value that reached the caller, from every JSON object in the
// content text and from structuredContent.
function dataTokens(texts, sc) {
  const out = new Set();
  const walk = (o, d = 0) => {
    if (d > 14 || o === null || o === undefined) return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, d + 1)); return; }
    if (typeof o === 'object') { for (const v of Object.values(o)) walk(v, d + 1); return; }
    if (DATA_VALUES.has(o)) out.add(typeof o === 'number' ? 'n:' + o : 's:' + o);
  };
  walk(sc);
  for (const t of texts) {
    const i = t.indexOf('{'); const j = t.lastIndexOf('}');
    if (i < 0 || j <= i) continue;
    try { walk(JSON.parse(t.slice(i, j + 1))); } catch (_) { /* prose, not JSON */ }
  }
  return out;
}

// The documented row-total contract (initialize instructions: "the full count is
// in the sibling `_..._total_in_pro` field"). Every trimmed list's rung label
// `_<k>_total_unlocks_at` must sit beside `_<k>_total_in_pro`, and no rung-suffixed
// total (`_<k>_total_in_free|developer`) may replace it.
function rowTotalScan(texts, sc) {
  const out = { inPro: 0, labelled: 0, broken: [] };
  const walk = (o, d = 0) => {
    if (d > 14 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, d + 1)); return; }
    for (const [k, v] of Object.entries(o)) {
      let m = /^_(.+)_total_in_pro$/.exec(k);
      if (m && typeof v === 'number') out.inPro++;
      m = /^_(.+)_total_unlocks_at$/.exec(k);
      if (m) {
        out.labelled++;
        if (typeof o[`_${m[1]}_total_in_pro`] !== 'number') out.broken.push(`${k} without _${m[1]}_total_in_pro`);
        if (!['free', 'developer', 'pro'].includes(v)) out.broken.push(`${k}=${JSON.stringify(v)}`);
      }
      if (/^_(.+)_total_in_(free)$/.test(k)) out.broken.push(`${k} (rung-suffixed total replaces the documented one)`);
      if (v && typeof v === 'object') walk(v, d + 1);
    }
  };
  walk(sc);
  for (const t of texts) {
    const i = t.indexOf('{'); const j = t.lastIndexOf('}');
    if (i < 0 || j <= i) continue;
    try { walk(JSON.parse(t.slice(i, j + 1))); } catch (_) { /* prose */ }
  }
  return out;
}

async function call(tool, args, key, spent) {
  for (const mp of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) mp && mp.clear && mp.clear();
  PEEK_N = spent ? 999 : 0;
  const headers = key ? { 'x-api-key': key } : {};
  const sid = await session(key);
  const { json } = await post({ ...headers, 'mcp-session-id': sid }, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: tool, arguments: args } });
  // Each session holds a full McpServer (~3.4 MB); ~1,300 calls would exhaust the
  // worker heap, so release every session the moment its call has answered.
  try { S._sessionMaps().sessions.get(sid)?.close?.(); } catch (_) { /* already closed */ }
  S._releaseSession(sid);
  let r = {};
  try { r = JSON.parse(json).result || {}; } catch (_) { r = {}; }
  const texts = (r.content || []).map((c) => c.text || '');
  const text = texts.join('\n');
  return { text, sc: r.structuredContent || null, isError: r.isError === true,
    wall: S.isHardWallText(text), tokens: dataTokens(texts, r.structuredContent || null),
    rowTotals: rowTotalScan(texts, r.structuredContent || null) };
}

// full: every value Pro saw · preview: some · none: no backend value at all
// (a wall, or a structure-only preview)
function outcome(res, proTokens) {
  if (!res.tokens.size) return 'none';
  for (const t of proTokens) if (!res.tokens.has(t)) return 'preview';
  return 'full';
}

// ── 1. per-seat outcome for every tool stage 1 changed ────────────────────────
// [fresh, spent] per seat. The comment on each row is the pre-stage-1 value
// measured by the 2026-09-29 tier audit (A1 matrix) for the same seat.
const F = 'full', P = 'preview', N = 'none';
const PINNED = {
  // grid intel's preview is structure only (audit 'V'): no backend value → N.
  get_grid_intelligence: {
    anon: [N, N], free: [F, N], ident: [F, N],
    pack: [F, F],                       // unchanged: full per call
    starter: [F, N],                    // unchanged (grandfathered A10)
    developer: [F, F],                  // was A10 → V (10/day, then preview)
    pro: [F, F] },
  get_fiber_intel: {
    anon: [P, P], free: [F, P], ident: [F, P],
    pack: [F, F], starter: [F, P],
    developer: [F, F],                  // was A10 → P3
    pro: [F, F] },
  get_dchub_recommendation: {
    anon: [P, P], free: [P, P], ident: [P, P],
    pack: [P, P],                       // was F (the pack opened a Pro tool)
    starter: [P, P],                    // was W (a wall below the free key's preview)
    developer: [P, P],                  // was W
    pro: [F, F] },
  get_retirement_headroom: {
    anon: [P, P], free: [P, P], ident: [P, P],
    pack: [F, F],                       // was M·mw (pack = Developer depth)
    starter: [P, P], developer: [F, F], pro: [F, F] },
};

describe('ladder stage 1 — per-seat outcome on the tools it changed', () => {
  it('the fence held and tools/list is the full catalogue', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(92);
    expect(BLOCKED).toEqual([]);
  });

  for (const [tool, want] of Object.entries(PINNED)) {
    it(`${tool}: every seat, allowance fresh and spent`, async () => {
      const t = TOOLS.find((x) => x.name === tool);
      expect(t, `${tool} not in tools/list`).toBeTruthy();
      const args = argsFor(t);
      const pro = await call(tool, args, K_PRO, false);
      expect(pro.tokens.size, `${tool}: Pro got no backend data — the stub does not reach this tool`).toBeGreaterThan(0);
      const bad = [];
      for (const [seat, key] of SEATS) {
        for (const [i, spent] of [[0, false], [1, true]]) {
          const r = await call(tool, args, key, spent);
          const got = outcome(r, pro.tokens);
          if (got !== want[seat][i]) bad.push(`${seat} ${spent ? 'spent' : 'fresh'}: want ${want[seat][i]}, got ${got}${r.wall ? ' (hard wall)' : ''}`);
        }
      }
      expect(bad, `${tool}:\n  ${bad.join('\n  ')}`).toEqual([]);
    }, 60000);
  }

  it('Developer on get_dchub_recommendation: the free key\'s 3-row preview, one Pro line, no pack, no wall', async () => {
    const t = TOOLS.find((x) => x.name === 'get_dchub_recommendation');
    const r = await call('get_dchub_recommendation', argsFor(t), K_DEV, false);
    const f = await call('get_dchub_recommendation', argsFor(t), K_FREE, false);
    expect(r.wall).toBe(false);
    expect(r.text).not.toMatch(/needs full access|is a Pro tool\n\nYou're on/);
    expect(r.text).toMatch(/is a Pro tool/);
    expect(r.text).toMatch(/DC Hub Pro/);
    expect(r.text).not.toMatch(/\$10 one-time|1,000 API credits/);
    expect(r.text).not.toMatch(/still covers every other tool/);
    // the same data a free key sees
    expect([...r.tokens].sort()).toEqual([...f.tokens].sort());
  }, 30000);

  it('a grandfathered Starter key over its grid allowance is pointed at Developer, not Pro', async () => {
    const t = TOOLS.find((x) => x.name === 'get_grid_intelligence');
    const r = await call('get_grid_intelligence', argsFor(t), K_STARTER, true);
    expect(r.text).toMatch(/comes with DC Hub Developer/);
    expect(r.text).not.toMatch(/depth is Pro/);
  }, 30000);

  it('unlock_more_data never offers a rung at or below the caller\'s own', async () => {
    const t = TOOLS.find((x) => x.name === 'unlock_more_data');
    const plans = async (key) => {
      const r = await call('unlock_more_data', argsFor(t), key, false);
      return { ids: ((r.sc && r.sc.plans) || []).map((p) => p.id), text: r.text, rec: r.sc && r.sc.recommended_subscription };
    };
    const anon = await plans(null);
    expect(anon.ids).toEqual(expect.arrayContaining(['credits', 'developer', 'pro']));
    const dev = await plans(K_DEV);
    expect(dev.ids).not.toContain('developer');
    expect(dev.ids).not.toContain('credits');
    expect(dev.ids).toContain('pro');
    expect(dev.rec).toBe('pro');
    expect(dev.text).not.toMatch(/\*\*Developer\*\*|1,000 API credits\*\*/);
    const starter = await plans(K_STARTER);
    expect(starter.ids).not.toContain('credits');
    expect(starter.ids).toEqual(expect.arrayContaining(['developer', 'pro']));
    const pro = await plans(K_PRO);
    expect(pro.ids).toEqual([]);
    expect(pro.text).toMatch(/already holds every DC Hub rung/);
  }, 30000);

  it('PRO_ONLY_TOOLS is the decision layer; the pack opens none of it', () => {
    expect(S.PRO_ONLY_TOOLS.has('get_grid_intelligence')).toBe(false);
    expect(S.PRO_ONLY_TOOLS.has('get_fiber_intel')).toBe(false);
    for (const t of ['analyze_site', 'compare_sites', 'generate_site_analysis', 'get_dchub_recommendation', 'export_dataset']) {
      expect(S.PRO_ONLY_TOOLS.has(t), t).toBe(true);
      expect(S._packOpensTool(t), `pack opens ${t}`).toBe(false);
    }
  });
});

// ── 2. the inversion guard, all tools ─────────────────────────────────────────
describe('ladder stage 1 — the documented row total survives the rung label', () => {
  // The initialize instructions tell agents the full count of a trimmed list is in
  // `_<k>_total_in_pro`. Stage 1 names the real rung in a SIBLING, never instead.
  const list = { ok: true, data: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` })) };
  for (const [tool, rung] of [['get_refined_queue', 'free'], ['get_interconnection_queue', 'developer'],
    ['get_dchub_recommendation', 'pro']]) {
    it(`${tool} (keyless): _data_total_in_pro kept, _data_total_unlocks_at = ${rung}`, () => {
      const out = S.trimForTrial(JSON.parse(JSON.stringify(list)), tool);
      expect(out.data).toHaveLength(S.TRIAL_PREVIEW_ROWS);
      expect(out._data_total_in_pro).toBe(10);
      expect(out._data_total_unlocks_at).toBe(rung);
      expect(Object.keys(out).filter((k) => /_total_in_(free|developer)$/.test(k))).toEqual([]);
    });
  }
});

describe('ladder stage 1 — no rung gets more than the rung above it, on any tool', () => {
  it('drives every tool in tools/list at every seat, fresh and spent', async () => {
    const inversions = [];
    let compared = 0;
    const withData = new Set();     // tools where Pro receives backend values
    let inPro = 0, labelled = 0;    // documented row totals seen / rung labels seen
    const brokenTotals = [];
    const graded = new Set();       // tools where some rung receives FEWER values than Pro
    for (const t of TOOLS) {
      const args = argsFor(t);
      for (const spent of [false, true]) {
        const got = {};
        for (const [seat, key] of SEATS) {
          const r = await call(t.name, args, key, spent);
          got[seat] = r.tokens;
          inPro += r.rowTotals.inPro; labelled += r.rowTotals.labelled;
          for (const x of r.rowTotals.broken) brokenTotals.push(`${t.name} ${seat}${spent ? ' spent' : ''}: ${x}`);
        }
        if (got.pro.size) withData.add(t.name);
        if (SEATS.some(([seat]) => got[seat].size < got.pro.size)) graded.add(t.name);
        for (const [lo, hi] of LADDER_PAIRS) {
          compared++;
          const extra = [...got[lo]].filter((x) => !got[hi].has(x));
          if (extra.length) {
            inversions.push(`${t.name} ${spent ? 'spent' : 'fresh'}: ${lo} sees ${extra.length} value(s) ${hi} does not (e.g. ${extra.slice(0, 3).join(', ')})`);
          }
        }
      }
    }
    expect(compared).toBe(TOOLS.length * 2 * LADDER_PAIRS.length);
    // The documented `_..._total_in_pro` contract holds wherever a preview withholds rows.
    if (process.env.LADDER_DEBUG) console.error(`[ladder] total_in_pro=${inPro} unlocks_at=${labelled}`);
    expect(brokenTotals, 'row-total contract:\n  ' + brokenTotals.join('\n  ')).toEqual([]);
    expect(labelled, 'no trimmed list carried a rung label — the contract check is vacuous').toBeGreaterThanOrEqual(ROW_LABEL_FLOOR);
    expect(inPro, 'every labelled trimmed list carries the documented total').toBeGreaterThanOrEqual(labelled);
    if (process.env.LADDER_DEBUG) console.error(`[ladder] withData=${withData.size} graded=${graded.size}`);
    // Non-vacuity: the guard only means something where Pro sees data and a
    // lower rung sees less of it. Floors measured 2026-09-29 (see the PR).
    expect(withData.size, 'tools whose Pro answer carries backend values').toBeGreaterThanOrEqual(WITH_DATA_FLOOR);
    expect(graded.size, 'tools where some rung gets less than Pro').toBeGreaterThanOrEqual(GRADED_FLOOR);
    expect(BLOCKED).toEqual([]);
    expect(inversions, 'rung inversions:\n  ' + inversions.join('\n  ')).toEqual([]);
  }, 600000);
});
