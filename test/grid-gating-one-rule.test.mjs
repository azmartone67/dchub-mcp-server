// grid-gating-one-rule.test.mjs — Grok QA 2026-10-22, items 2 and 3.
//
// Item 2. get_grid_data on a /grid/latest grid (AESO, TAIPOWER), keyless, live 2026-10-22: top-level
// `demand_mw: null` and the relay line "this answer hid demand (MW)", while `metrics.demand_mw.value`
// carried 10583 in the same answer. The MCP server reads the backend with X-Internal-Key, so the
// backend answers in full and the free-tier trim decides; it withheld the bare number by its name and
// kept the same figure inside a {value, unit, timestamp} row. Now one rule (the metric-name rule) decides
// both. The guard: a gated get_grid_data answer carries the demand figure NOWHERE (any key, any channel,
// text included); a paid answer still carries it (so the guard is not vacuous).
//
// Item 3. compare_isos "ERCOT,EU_DE_LU" came back with an empty EU_DE_LU row and `_<field>_in_pro`
// upgrade markers on DCPI/queue fields DC Hub does not track outside the US. Now those fields are the
// explicit GRID_NOT_COVERED value, listed in `not_covered`, never marked withheld; the shares come from
// the feed's own stored percentages when it stores no per-fuel rows.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { leadingJsonEnd } from '../lib/plan-free-fields.mjs';

const BASE = 'https://backend.grid-gating.test';
const T = '2026-10-22T19:38:48+00:00';
const row = (value, unit = 'MW') => ({ timestamp: T, unit, value });
// Demand figures chosen so the number appears nowhere else in a fixture or the server's own copy.
const AESO_DEMAND = 10583.37;
const BA_DEMAND = 4321.77;
const AESO = {   // the shape /api/v1/grid/latest/AESO returns to an internal caller (live, 2026-10-22)
  iso: 'AESO', family: 'canada', demand_mw: AESO_DEMAND, metrics_count: 9, newest_at: T, oldest_at: T,
  as_of_basis: 'each metric carries the timestamp of its own stored row',
  source: 'DC Hub grid_data (live ingest per feed; see /data-sources)',
  metrics: {
    carbon_intensity: row(480, 'g/kWh'), demand_mw: row(AESO_DEMAND), fuel_gas_mw: row(9067),
    fuel_wind_mw: row(248), fuel_solar_mw: row(1024), fuel_hydro_mw: row(72),
    generation_total_mw: row(10669), gas_pct: row(85, 'pct'), renewable_pct: row(12.6, 'pct'),
  },
};
const BA = {     // a US utility BA reached through the /grid/latest fallback: demand also as its own block
  iso: 'XYZBA', family: 'us_utility_ba', demand_mw: BA_DEMAND, metrics_count: 2, newest_at: T, oldest_at: T,
  metrics: { fuel_gas_mw: row(3000), generation_total_mw: row(4400) },
  demand: { demand_mw: row(BA_DEMAND) }, demand_basis: 'EIA-930 region-data hourly demand',
};
const EU = {     // ENTSO-E zone: the feed stores no per-fuel rows and no load (live, 2026-10-22)
  iso: 'EU_DE_LU', family: 'entsoe', demand_mw: null, metrics_count: 3, newest_at: '2026-10-22T19:00:00+00:00',
  oldest_at: '2026-10-22T19:00:00+00:00',
  metrics: { gas_pct: row(11.7, 'pct'), generation_total_mw: row(60192), renewable_pct: row(54.6, 'pct') },
};
const ERCOT_GI = { iso: 'ERCOT', region: 'ERCOT', demand_mw: 56339, demand_period: '2026-10-22T18',
  generation_mix_period: '2026-10-22T04', gen_mix: { NG: 29551, WND: 12569, SUN: 0, NUC: 3846, COL: 8072 } };

const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, n = 0;
beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    let p = ''; try { p = new URL(String(input && input.url ? input.url : input)).pathname; } catch { /* */ }
    if (p === '/api/v1/grid/latest/AESO') return json(AESO);
    if (p === '/api/v1/grid/latest/XYZBA') return json(BA);
    if (p === '/api/v1/grid/latest/EU_DE_LU') return json(EU);
    if (p.toLowerCase() === '/api/v1/grid/intelligence/xyzba') return json({ error: 'unknown region', valid: ['PJM'] }, 400);
    if (p.toLowerCase() === '/api/v1/grid/intelligence/ercot') return json(ERCOT_GI);
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: 0, had_pack: false });
    return json({});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; });

const seat = (tier, key) => ({ ...(key ? { api_key: key } : {}), tier, platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '203.0.113.' + (20 + (n % 200)), session_id: 'sess-grid-gating-' + (++n) });
// Live keyless /mcp resolves to tier 'free' with no api_key (test/key-never-worse-than-anon.test.mjs).
const SEATS = {
  anonymous: () => seat('free', null),
  free: () => seat('free', 'dch_live_grid_gating_0001'),
  pro: () => seat('pro', 'dch_live_grid_gating_pro1'),
};
async function call(name, args, s) {
  const tool = TOOLS[name];
  const parsed = await tool.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error('zod rejected ' + name);
  return S._ctxALS.run(s, () => tool.handler(parsed.data, { signal: new AbortController().signal }));
}
const serialized = (r) => JSON.stringify(r);
// The figure, in any channel, as any number format the server could print it in.
const carries = (r, v) => {
  const s = serialized(r);
  return [String(v), String(Math.round(v)), String(Math.round(v * 10) / 10), Math.round(v).toLocaleString('en-US')]
    .some((t) => s.includes(t));
};
// Was anything withheld from this answer? (the marker, the null'd headline, or the relay line)
const isGated = (r) => /_withheld"|_in_pro"|hid demand|"preview_is_partial":true|"gated":true/.test(serialized(r));

describe('item 2: one rule decides the demand headline and the metrics', () => {
  // A gated answer: the keyless seat (live keyless /mcp is tier 'free', no key). A free key with its daily
  // full answers left gets the full answer, which may carry demand; the invariant below covers it anyway.
  const demandNowhere = (r, demand, label) => {
    expect(carries(r, demand), `${label}: demand ${demand} leaked: ${serialized(r).slice(0, 600)}`).toBe(false);
    const bad = [];
    const walk = (v, p) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
        if (/demand/i.test(k) && typeof x === 'number') bad.push(`${p}.${k}`);
        if (/demand/i.test(k) && x && typeof x === 'object' && typeof x.value === 'number') bad.push(`${p}.${k}.value`);
        walk(x, `${p}.${k}`);
      }
    };
    walk(r.structuredContent, 'sc');
    (r.content || []).forEach((c, i) => { try { walk(JSON.parse(c.text), `content${i}`); } catch { /* prose */ } });
    expect(bad, label).toEqual([]);
  };
  it.each([['AESO', AESO_DEMAND], ['XYZBA', BA_DEMAND]])('%s, keyless: a gated answer carries demand nowhere', async (iso, demand) => {
    const r = await call('get_grid_data', { iso }, SEATS.anonymous());
    expect(isGated(r), `${iso}: the keyless answer is expected to be a gated preview`).toBe(true);
    demandNowhere(r, demand, iso);
    // the stored metric rows still say what exists and when (unit, timestamp); only the value goes
    const sc = r.structuredContent || JSON.parse(r.content[0].text.slice(0, r.content[0].text.lastIndexOf('}') + 1));
    expect(sc.metrics.fuel_gas_mw).toEqual({ timestamp: T, unit: 'MW', value: null });
  });
  it.each(['anonymous', 'free', 'pro'])('%s: the headline and the metric row never disagree', async (who) => {
    for (const iso of ['AESO', 'XYZBA']) {
      const r = await call('get_grid_data', { iso }, SEATS[who]());
      const t = r.content[0].text;
      const sc = JSON.parse(t.slice(0, t.lastIndexOf('}') + 1));
      const row = (sc.metrics && sc.metrics.demand_mw) || (sc.demand && sc.demand.demand_mw);
      if (!row) continue;
      expect(sc.demand_mw === null, `${iso}/${who}: headline withheld=${sc.demand_mw === null}, row value=${row.value}`)
        .toBe(row.value === null);
      if (sc.demand_mw === null) demandNowhere(r, iso === 'AESO' ? AESO_DEMAND : BA_DEMAND, `${iso}/${who}`);
    }
  });
  it('a paid caller still gets demand (the guard above is not vacuous)', async () => {
    const r = await call('get_grid_data', { iso: 'AESO' }, SEATS.pro());
    expect(carries(r, AESO_DEMAND)).toBe(true);
  });
  it('the rule is the metric-name rule: a {value, unit, timestamp} row is the figure of its key', () => {
    expect(S._isMetricRow({ value: 1, unit: 'MW', timestamp: T })).toBe(true);
    expect(S._isMetricRow({ value: 1 })).toBe(true);
    expect(S._isMetricRow({ value: '1' })).toBe(false);
    expect(S._isMetricRow({ value: 1, rows: [] })).toBe(false);   // not a metric row: walked as an object
  });
});

describe('item 3: compare_isos says "not covered" for what DC Hub does not track outside the US', () => {
  const UNTRACKED = ['constraint_score', 'excess_power_score', 'avg_time_to_power_months', 'avg_queue_wait_months', 'queue_depth_gw'];
  it.each(Object.keys(SEATS))('%s: EU_DE_LU row is explicit, with no upgrade marker on an untracked field', async (who) => {
    const r = await call('compare_isos', { isos: 'ERCOT,EU_DE_LU' }, SEATS[who]());
    const sc = r.structuredContent;
    const eu = sc && sc.comparison && sc.comparison.EU_DE_LU;
    expect(eu, serialized(r).slice(0, 500)).toBeTruthy();
    for (const f of [...UNTRACKED, 'demand_mw', 'generation_mix_mw']) {
      expect(eu[f], `${who}: ${f}`).toBe(S.GRID_NOT_COVERED);
      expect(eu.not_covered, `${who}: not_covered lists ${f}`).toContain(f);
      // no upsell on a field no plan returns, under either marker name
      for (const m of [`_${f}_in_pro`, `_${f}_withheld`, `_${f}_total_in_pro`, `_${f}_total_available`]) {
        expect(eu[m], `${who}: ${m}`).toBeUndefined();
      }
    }
    expect(eu.not_covered_basis).toMatch(/coverage fact, not a withheld value/);
    // the text channel says the same thing
    const t0 = r.content[0].text;
    const block0 = JSON.parse(t0.slice(0, leadingJsonEnd(t0)));
    expect(block0.comparison.EU_DE_LU.constraint_score).toBe(S.GRID_NOT_COVERED);
    // every prose part (a block's text after its leading JSON, and the prose blocks)
    const prose = r.content.map((c) => (/^\s*[{[]/.test(c.text) ? c.text.slice(leadingJsonEnd(c.text)) : c.text)).join('\n');
    expect(prose).not.toMatch(/EU_DE_LU[^\n]*(hides|withheld)/);
  });
  it('a paid caller gets the figures the feed does store, so the row is no longer empty', async () => {
    const r = await call('compare_isos', { isos: 'ERCOT,EU_DE_LU' }, SEATS.pro());
    const eu = r.structuredContent.comparison.EU_DE_LU;
    expect(eu.generation_total_mw).toBe(60192);
    expect(eu.renewable_share_pct).toBe(54.6);
    expect(eu.gas_share_pct).toBe(11.7);
    expect(eu.renewable_share_basis).toMatch(/feed's own stored renewable_pct/);
  });
  it('shapeLatestGrid (pure): per-fuel rows still win over the stored percentages', () => {
    const r = S.shapeLatestGrid('AESO', AESO);
    expect(r.gas_share_pct).toBe(Math.round(1000 * 9067 / 10669) / 10);
    expect(r.demand_mw).toBe(AESO_DEMAND);
    expect(r.not_covered).toEqual(UNTRACKED);
  });
});
