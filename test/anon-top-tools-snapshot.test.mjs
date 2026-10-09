// anon-top-tools-snapshot.test.mjs — Grok A6(d): a snapshot of what an ANONYMOUS caller gets back
// from the ten tools that carry the most free-tier traffic, pinned to the honesty contract the
// owner's external auditor reads:
//
//   * taste class (the three "tighten step 1" decision tools + get_energy_prices): a labelled
//     `taste` with a headline, a `withheld` LIST (section + count + unlocks_at — never a silent
//     null), completeness.status 'partial'.
//   * preview class: provenance.completeness is 'partial_preview' — never 'walled' (the tool
//     returned data) and never 'unknown'.
//   * wall class (Pro-only tools): provenance.completeness is 'walled' — the one place it is
//     correct, because no data came back.
//   * on EVERY tool: exactly ONE dchub.cloud page link that sells/unlocks, and it is the relay
//     `human_url`. Methodology/data-source pages (provenance) are allowed beside it; a second
//     commerce link (/pricing, /go/c/, a raw Stripe URL, a second /upgrade page) is not.
//
// This PR pins current behaviour; it changes none (guards only). Real /mcp handler over loopback
// HTTP, a 127.0.0.1 stub backend, every off-loopback connect refused and recorded (same harness
// as test/free-decision-tools-preview-only.test.mjs). No network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'anon-top-tools-snapshot-internal-key';
const GI = {
  demand_mw: 95021, demand_period: '2026-10-07T23', generation_mix_period: '2026-10-07T03',
  generation_mix: { COL: { mw: 13136 }, NG: { mw: 33582 }, NUC: { mw: 27692 }, OIL: { mw: 248 },
    OTH: { mw: 3490 }, SUN: { mw: 28 }, WAT: { mw: 1517 }, WND: { mw: 5943 } },
  peak_mw: 95021, min_mw: 74723, load_factor: 0.786,
  demand_24h: Array.from({ length: 22 }, (_, i) => ({ period: `2026-10-07T${String(i + 1).padStart(2, '0')}`, mw: 80000 + i * 500 })),
  related_intel: Array.from({ length: 4 }, (_, i) => ({ title: `intel ${i}`, url: `https://dchub.cloud/intel/${i}` })),
};
const CMP = { isos: [{ iso: 'PJM', iso_name: 'PJM Interconnection (mid-Atlantic + Ohio Valley)',
  avg_constraint: 49.2, avg_excess: 28.8, avg_time_to_power_months: 30.3, avg_queue_wait_months: 30.4,
  avg_curtailment_pct: 1, avg_reserve_margin_pct: 12.5, avg_kwh_cents: 14.4, total_stranded_capacity_mw: 1200,
  sum_emergency_30d: 0, market_count: 64, build_count: 0, latest_computed_at: '2026-10-07T18:34:37Z' }] };
const QSNAP = { by_iso: [{ iso: 'PJM', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue',
  queued_generation_gw: 135.1, as_of: '2026-10-07' }] };
const EXT = { available: true, forward_load_mw: 105415, committed_capacity_mw: 142206.4, operating_reserve_mw: 15859,
  grid_carbon_intensity_lb_mwh: 801.66, capacity_auction_price_usd_mw_day: 333.44,
  capacity_auction_delivery_year: '2027/2028', capacity_auction_source: 'PJM 2027/2028 BRA report' };
const QUEUE_BY_ISO = {
  iso: 'PJM', as_of: '2026-10-07', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue',
  queued_load_data_center_gw: 40.2, queued_load_dc_share_pct: 29.7, new_applications_q_gw: 12.3,
  new_applications_period: '2026-Q2', historical_completion_pct: 18.5, queued_generation_gw: 135.1,
  queued_generation_gw_as_of: '2026-10-07', top_subregions: [{ name: 'Dominion', gw: 41.0 }],
  source_url: 'https://www.pjm.com/planning/service-requests', source_name: 'PJM queue', v: 'published',
  project_count: 972,
  projects: Array.from({ length: 25 }, (_, i) => ({ queue_id: `AG1-${100 + i}`, project_name: `Project ${i}`,
    capacity_mw: 100 + i, fuel_type: 'SOLAR', state: 'VA', queue_status: 'active' })),
};
const MARKET = {
  success: true,
  market: { id: 'northern-virginia', name: 'Northern Virginia',
    cities: ['Ashburn', 'Sterling', 'Reston', 'Herndon', 'Manassas', 'Leesburg', 'Chantilly', 'Dulles'] },
  stats: { facility_count: 857, total_power_mw: 13366.0, avg_power_mw: 41.2, provider_count: 90, mw_reporting_count: 320 },
  as_of: '2026-10-06T14:22:31Z', as_of_basis: 'MAX(discovered_at) over the facilities this response counts',
  top_providers: Array.from({ length: 10 }, (_, i) => ({ name: `Provider ${i}`, facilities: 30 - i, power_mw: 900 - i * 40 })),
  by_status: { operational: 600, under_construction: 150, planned: 107 },
  recent_facilities: Array.from({ length: 5 }, (_, i) => ({ name: `Facility ${i}`, city: 'Ashburn', capacity_mw: 60 + i })),
  market_pricing: { available: true, basis: 'broker_report', asking_rate: 160.0, asking_rate_range: [160.0, 185.0],
    unit: '$/kW/mo', deal_size: '250-500 kW wholesale', vacancy_percent: 4.0, period: 'H1 2026', stale: false,
    source: 'CBRE / JLL market reports, H1 2026 (as held by DC Hub) $160-185/kW/mo' },
  siting: { available: true,
    iso: { code: 'PJM', class: 'RTO', operator: 'PJM Interconnection', as_of: '2026-10-07' },
    utilities: { names: ['Dominion Energy Virginia'], kind: 'IOU', source_url: 'https://www.scc.virginia.gov/' },
    dcpi: { verdict: 'CAUTION', band: 'excess-power score at least 40 and grid-constraint score at most 60',
      definition: 'Thresholds are the published DCPI method, not this market\'s scores. The scores are a paid field.',
      signal_tier: 'full', data_basis: 'measured', as_of: '2026-10-07', method_url: 'https://dchub.cloud/dcpi/methodology' },
    time_to_power: { band: '24_to_48_months', edges_months: [24, 48], as_of: '2026-10-07' },
    mw: { total_mw: 13366.0, rows_reporting: 320, rows_total: 857, coverage_pct: 37.3, coverage: 'PARTIAL' } },
  _gated: false,
  related_intel: Array.from({ length: 4 }, (_, i) => ({ title: `nova intel ${i}` })),
};


const SITE = { success: true, location: { lat: 39.04, lon: -77.48, state: 'VA' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, fiber_connectivity: 95.4 }, interpretation: 'Excellent site' };
const FAC = { success: true, id: 100, name: 'Site 100', city: 'Ashburn', state: 'VA', country: 'US', capacity_mw: 48.7, operator: 'Op', status: 'operational' };
const ROWS = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, name: 'Site ' + i, iso: 'PJM', score: 50 + i, lat: 39 + i / 10, lon: -77, city: 'Ashburn', state: 'VA', country: 'US' }));

let S, PORT, httpServer, stub, prevBase, prevSecret, prevIsError, prevFlag;

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
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') return send({ valid: false, tier: 'free' });
      if (p === '/api/v1/keys/auto-mint') return send({ error: 'no' }, 404);
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/mcp/full-cap/consume') return send({ ok: false });
      if (p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/mcp/monthly-usage') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/mcp/should-mint-claim') return send({ should_mint: false });
      if (p === '/api/v1/grid/intelligence/PJM') return send(GI);
      if (p === '/api/v1/dcpi/iso-comparison') return send(CMP);
      if (p === '/api/v1/interconnection-queue/snapshot') return send(QSNAP);
      if (p === '/api/v1/grid/extended/PJM') return send(EXT);
      if (p === '/api/v1/interconnection-queue/by-iso') return send(QUEUE_BY_ISO);
      if (p === '/api/v1/markets/northern-virginia') return send(MARKET);
      if (p === '/api/site-score') return send(SITE);
      if (/^\/api\/v1\/facilit(y|ies)\/\d+/.test(p)) return send(FAC);
      if (p.startsWith('/api/v1/energy/')) return send({ success: true, caller_tier: 'pro', avg_rate_kwh: 0.2341, scope: 'iso_footprint_avg', filter: { iso: 'PJM', sector: 'all', state: null }, retail_rates: { avg_cents_kwh: 23.41, latest_period: '2026', max_cents_kwh: 30.1, min_cents_kwh: 18.2, states_covered: 1 } });
      return send({ success: true, count: ROWS.length, data: ROWS, results: ROWS, as_of: '2026-10-08' });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevFlag = process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
  delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;   // default ON
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  if (prevIsError === undefined) delete process.env.DCHUB_PREVIEW_ISERROR; else process.env.DCHUB_PREVIEW_ISERROR = prevIsError;
  if (prevFlag === undefined) delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY; else process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = prevFlag;
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
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

let ipN = 20;
let rpcId = 100;
// One fresh caller (own IP, own session) per call so per-IP counters never carry.
async function callAs({ client = 'claude-code', key = null } = {}, name, args) {
  const ip = `203.0.113.${ipN++}`;
  const h0 = { 'x-forwarded-for': ip, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  const h = { ...h0, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  const text = (result.content || []).map((c) => c.text || '').join('\n');
  let data = null;
  for (const c of result.content || []) {
    const t = typeof c.text === 'string' ? c.text : '';
    const i = t.indexOf('{');
    if (i < 0) continue;
    // first balanced JSON object in the block
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const ch = t[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { try { data = JSON.parse(t.slice(i, j + 1)); } catch (_) { data = null; } break; } }
    }
    if (data) break;
  }
  return { ip, sid, body, result, text, sc: result.structuredContent || {}, data: data || {} };
}


// ── the guard ────────────────────────────────────────────────────────────────
const PAGE_LINK = /https:\/\/(?:www\.)?dchub\.cloud\/[^\s"'`<>\\)\]}]*[^\s"'`<>\\)\]}.,;:!?*]/g;
const MACHINE = /^https:\/\/dchub\.cloud\/(?:api\/v1\/|mcp(?![A-Za-z0-9_-])|\.well-known\/)/;
// Provenance pages that may sit beside the one commerce link (they explain a number, they sell nothing).
const PROVENANCE_PAGE = /^https:\/\/dchub\.cloud\/(?:dcpi\/methodology|data-sources)(?:\/|$)/;
const base = (u) => String(u).replace(/[?#].*$/, '');
export function commerceLinks(result) {
  const all = JSON.stringify(result).match(PAGE_LINK) || [];
  return [...new Set(all.filter((u) => !MACHINE.test(u) && !PROVENANCE_PAGE.test(u)).map(base))];
}
export function summarize(r) {
  const sc = r.sc || {};
  const prov = sc.provenance || {};
  return {
    error: sc.error || null,
    taste: !!(sc.taste && sc.taste.headline),
    withheld: Array.isArray(sc.withheld) ? sc.withheld.map((w) => w.section) : null,
    completeness: sc.completeness && sc.completeness.status ? sc.completeness.status : null,
    provenance_completeness: prov.completeness || null,
    wall: sc._wall === true,
    one_link_is_human_url: sc.human_url ? JSON.stringify(commerceLinks(r.result)) === JSON.stringify([base(sc.human_url)]) : false,
  };
}

// The ten tools and what an anonymous caller is held to today (measured 2026-10-08; the withheld
// section names are the ones the fixtures above produce).
const TASTE = (withheld) => ({ error: null, taste: true, withheld, completeness: 'partial', provenance_completeness: 'partial_preview', wall: false, one_link_is_human_url: true });
const PREVIEW = { error: null, taste: false, withheld: null, completeness: null, provenance_completeness: 'partial_preview', wall: false, one_link_is_human_url: true };
const WALL = { error: 'pro_required', taste: false, withheld: null, completeness: null, provenance_completeness: 'walled', wall: true, one_link_is_human_url: true };
const CASES = [
  ['get_energy_prices',        { iso: 'PJM' },                    TASTE(['rate_range', 'iso_footprint'])],
  ['get_interconnection_queue', { iso: 'PJM' },
    TASTE(['projects', 'load_queue', 'new_applications', 'completion_history', 'top_subregions'])],
  ['get_market_intel',        { market: 'northern-virginia' },
    TASTE(['providers', 'recent_facilities', 'cities', 'capacity_mw', 'facility_counts', 'time_to_power', 'pricing', 'related_intel'])],
  ['get_grid_intelligence',   { region_id: 'PJM' },
    TASTE(['dcpi_scores', 'queue_and_time_to_power', 'demand_history', 'generation_mix_detail', 'grid_stress', 'capacity', 'price', 'related_intel'])],
  ['get_facility',            { id: 100 },                        PREVIEW],
  ['get_grid_data',           { iso: 'PJM' },                    PREVIEW],
  ['get_fiber_intel',         { metro: 'ashburn' },               PREVIEW],
  ['rank_markets',            {},                                 PREVIEW],
  ['get_dchub_recommendation', {},                                PREVIEW],
  ['analyze_site',            { lat: 39.04, lon: -77.48 },        WALL],
];

describe('anonymous responses of the ten top tools', () => {
  const got = {};
  for (const [tool, args] of CASES) {
    it(tool, async () => {
      const r = await callAs({ client: 'claude-code' }, tool, args);
      got[tool] = r;
      const s = summarize(r);
      const sc = r.sc;
      expect(r.result.content?.length, 'no content block returned').toBeGreaterThan(0);
      // 1. exactly ONE commerce link, and it is the relay human_url
      expect(sc.human_url, 'anonymous answer carries no human_url').toMatch(/^https:\/\/dchub\.cloud\/(?:upgrade\/h|u)\//);
      expect(commerceLinks(r.result), 'more than one commerce link in the response').toEqual([base(sc.human_url)]);
      // 2. completeness is never 'walled' unless the tool returned nothing (wall class), never unknown
      if (tool !== 'analyze_site') expect(s.provenance_completeness, 'a response that returned data read walled/unknown').toBe('partial_preview');
      else expect(s.provenance_completeness).toBe('walled');
      // 3. taste class: headline + a withheld LIST with counts (no silent nulls) + completeness partial
      if (tool === 'get_energy_prices' || /^(get_interconnection_queue|get_market_intel|get_grid_intelligence)$/.test(tool)) {
        expect(sc.taste && sc.taste.headline, 'taste rows missing').toBeTruthy();
        expect(Array.isArray(sc.withheld) && sc.withheld.length > 0, 'no withheld list').toBe(true);
        for (const w of sc.withheld) {
          expect(typeof w.section).toBe('string');
          expect(w.count, w.section).toBeGreaterThan(0);
          expect(w.unlocks_at, w.section).toBe('developer');
        }
        expect(sc.completeness.status).toBe('partial');
        // the withheld sections are LISTED, not nulled in place
        for (const w of sc.withheld) expect(sc, w.section + ' nulled in place').not.toHaveProperty(w.section, null);
      }
      // 4. the whole summary equals the pinned snapshot
      expect(s).toEqual(CASES.find((c) => c[0] === tool)[2]);
    }, 30_000);
  }
  it('no off-loopback connection was attempted', () => { expect(foreign).toEqual([]); });
});

describe('must-fail controls: the summary and link counter catch the regressions this guard is for', () => {
  const rel = 'https://dchub.cloud/upgrade/h/AAAA.' + 'b'.repeat(32);
  it('a second commerce link is seen; a provenance page and a machine endpoint are not', () => {
    const ok = { text: `go ${rel} see https://dchub.cloud/dcpi/methodology and https://dchub.cloud/api/v1/keys/claim and https://dchub.cloud/mcp` };
    expect(commerceLinks(ok)).toEqual([rel]);
    expect(commerceLinks({ ...ok, extra: 'or https://dchub.cloud/pricing' })).toEqual([rel, 'https://dchub.cloud/pricing']);
    expect(commerceLinks({ ...ok, extra: 'or https://dchub.cloud/go/c/abc.123' })).toHaveLength(2);
  });
  it('summarize reads a nulled-out or walled response differently from a taste', () => {
    const taste = { result: {}, sc: { human_url: rel, taste: { headline: {} }, withheld: [{ section: 'x', count: 1 }], completeness: { status: 'partial' }, provenance: { completeness: 'partial_preview' } } };
    expect(summarize(taste).taste).toBe(true);
    expect(summarize({ ...taste, sc: { ...taste.sc, provenance: { completeness: 'walled' } } }).provenance_completeness).toBe('walled');
    expect(summarize({ ...taste, sc: { ...taste.sc, withheld: undefined } }).withheld).toBeNull();
  });
});
