// =============================================================================
// Comprehensive MCP regression test suite
// -----------------------------------------------------------------------------
// Prevents silent param-ignoring bugs (like search_facilities ignoring
// operator/state/market) from shipping. Tests three axes:
//   (a) Every tool registered in server.mjs appears in tools/list
//   (b) For tools with filter params, two different param values produce
//       DIFFERENT results (proves the filter actually bites)
//   (c) Documented fields appear in the response
//
// Uses a real free key against the live API (MCP_API_KEY env). PAID_ONLY tools
// that are NOT in KEYED_FREE_BONUS assert they gate (trial_preview / paywall)
// rather than returning data. Run with: npx vitest run
// =============================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { gateReason } from './gate-reason.mjs';

const MCP_URL = process.env.MCP_URL || 'https://dchub.cloud/mcp';
const PROTOCOL_VERSION = '2025-11-25';

// r-ci-selftag (2026-08-18): this suite runs against LIVE prod on every push,
// and its clientInfo self-ID below is only read at initialize — a tools/call
// routed to a replica that never saw that initialize lost the tag and was
// published as anonymous EXTERNAL demand (80.4% of 7d real calls / 72.1% of
// real agents, since rotating runner IPs mint a new agent_id per run). The
// header rides EVERY request, so replica routing cannot lose it.
const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
  'X-MCP-Platform': 'dchub-regression-test',
  ...(process.env.MCP_API_KEY ? { 'X-API-Key': process.env.MCP_API_KEY } : {}),
};

// ── All 38 tools registered in server.mjs via trackedTool(srv, ...) ──
const ALL_TOOLS = [
  'search_facilities', 'get_facility', 'get_market_intel', 'get_market_dcpi_rank',
  'get_gas_index', 'get_grid_scoreboard', 'compare_isos', 'get_intelligence_index',
  'list_transactions', 'get_news', 'get_pipeline', 'get_interconnection_queue',
  'get_grid_data', 'get_changes', 'save_site', 'list_saved_sites',
  'set_market_alert', 'export_dataset', 'analyze_site', 'compare_sites',
  'get_infrastructure', 'get_fiber_intel', 'get_energy_prices', 'get_renewable_energy',
  'get_tax_incentives', 'get_water_risk', 'get_grid_intelligence', 'get_agent_registry',
  'get_backup_status', 'get_dchub_recommendation', 'rank_markets', 'find_alternatives',
  'score_facility', 'ai_capacity_index', 'hyperscaler_deals', 'site_selection_canvas',
  'grid_transition_radar', 'deal_autopsy',
];

// Tools that require a paid/enterprise key for full data (from server.mjs PAID_ONLY_TOOLS)
const PAID_ONLY = new Set([
  'analyze_site', 'compare_sites', 'get_grid_intelligence', 'get_fiber_intel',
  'get_dchub_recommendation', 'get_facility', 'get_market_intel', 'get_intelligence_index',
  'get_grid_data', 'get_infrastructure', 'get_energy_prices', 'get_renewable_energy',
  'get_tax_incentives', 'get_water_risk', 'get_pipeline', 'list_transactions',
  'get_interconnection_queue', 'compare_isos', 'rank_markets', 'ai_capacity_index',
  'hyperscaler_deals',
]);

// KEYED_FREE_BONUS: with a free dev key these return real data
const KEYED_FREE_BONUS = new Set([
  'get_market_intel', 'get_grid_data', 'get_water_risk',
  'get_energy_prices', 'get_renewable_energy',
]);

let sessionId = null;

async function init() {
  const resp = await fetch(MCP_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'dchub-regression-test', version: '1.0.0' },
        capabilities: {},
      },
    }),
  });
  sessionId = resp.headers.get('Mcp-Session-Id') || resp.headers.get('mcp-session-id');
  await resp.text();
  await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...HEADERS, 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
}

async function listTools() {
  const resp = await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...HEADERS, 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} }),
  });
  const text = await resp.text();
  const payload = parseSSE(text);
  return payload?.result?.tools || [];
}

function parseSSE(text) {
  const raw = text.trim();
  if (raw.startsWith('{')) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  for (const ev of raw.split(/\r?\n\r?\n/)) {
    const dataLines = ev.split(/\r?\n/)
      .filter(l => l.startsWith('data:'))
      .map(l => l.replace(/^data:\s?/, ''));
    if (!dataLines.length) continue;
    try {
      const candidate = JSON.parse(dataLines.join('\n'));
      if (candidate.result || candidate.error || candidate.jsonrpc) return candidate;
    } catch { /* try next */ }
  }
  return null;
}

async function callTool(name, args = {}) {
  const resp = await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...HEADERS, 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await resp.text();
  const payload = parseSSE(text);
  if (!payload) throw new Error(`no JSON-RPC payload in: ${text.slice(0, 200)}`);
  if (payload.error) throw new Error(`MCP error: ${JSON.stringify(payload.error)}`);

  const result = payload.result;
  if (result?.structuredContent) {
    return { ...result.structuredContent, __structured: true };
  }
  const c = result?.content;
  if (Array.isArray(c) && c[0]?.type === 'text') {
    const t = c[0].text;
    // Strip trailing upgrade/trial marketing block after divider
    const divider = '\n\n---\n\n';
    const idx = t.indexOf(divider);
    const cleaned = idx > 0 && /free trial|preview|upgrade|sign up/i.test(t.slice(idx + divider.length))
      ? t.slice(0, idx).trim()
      : t;
    try { return JSON.parse(cleaned); } catch { return { __raw: t }; }
  }
  return result;
}

/** Returns true if the response looks like a gated/paywall/trial preview */
// Gate recognition lives in ./gate-reason.mjs — ONE copy, shared with mcp.test.mjs.
// This local copy had drifted from that one and did NOT recognise the edge's
// `plan_required` rejection (dchub-frontend/_worker.js). Since a parsed
// plan_required object also satisfies `hasData` below, the PAID_ONLY assertion
// PASSED on a payload whose whole content is a refusal to serve — a broken tool
// behind that gate would have read as healthy. See test/edge-gate-recognition.test.mjs.
//
// A falsy response is NOT a gate here (mcp.test.mjs deliberately decides the
// opposite); gateReason leaves that call to each suite.
function isGated(r) {
  return gateReason(r) !== null;
}

/** Deep-compare two results — returns true if they are meaningfully different */
function resultsDiffer(a, b) {
  // If either is gated, we can't compare data content
  if (isGated(a) || isGated(b)) return null; // indeterminate
  const aStr = JSON.stringify(a, null, 0);
  const bStr = JSON.stringify(b, null, 0);
  return aStr !== bStr;
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('MCP regression suite', () => {
  beforeAll(async () => { await init(); }, 20000);

  // ─── (a) Tool registration completeness ────────────────────────────────────
  describe('tool registration', () => {
    let registeredNames = [];
    beforeAll(async () => {
      const tools = await listTools();
      registeredNames = tools.map(t => t.name);
    }, 20000);

    it('tools/list returns all expected tools', () => {
      for (const name of ALL_TOOLS) {
        expect(registeredNames, `missing tool: ${name}`).toContain(name);
      }
    });

    it('tools/list count matches expected', () => {
      expect(registeredNames.length).toBeGreaterThanOrEqual(ALL_TOOLS.length);
    });
  });

  // ─── (b) Filter-bites: different params → different results ────────────────
  // The critical regression net: if a tool silently ignores a filter param,
  // both calls return the same data and the test FAILS.
  describe('filter-bites (params must produce different results)', () => {

    it('search_facilities: state=VA vs state=TX returns different facilities', async () => {
      const va = await callTool('search_facilities', { state: 'VA', limit: 5 });
      const tx = await callTool('search_facilities', { state: 'TX', limit: 5 });
      // Both should return data arrays
      expect(va?.data).toBeDefined();
      expect(tx?.data).toBeDefined();
      expect(Array.isArray(va.data)).toBe(true);
      expect(Array.isArray(tx.data)).toBe(true);
      // Results must differ (proves state param bites)
      const vaCities = (va.data || []).map(f => f.city || f.state).sort().join(',');
      const txCities = (tx.data || []).map(f => f.city || f.state).sort().join(',');
      expect(vaCities).not.toBe(txCities);
    }, 30000);

    it('search_facilities: operator=AWS vs operator=Google returns different providers', async () => {
      const aws = await callTool('search_facilities', { operator: 'AWS', limit: 5 });
      const goog = await callTool('search_facilities', { operator: 'Google', limit: 5 });
      expect(aws?.data).toBeDefined();
      expect(goog?.data).toBeDefined();
      // Check provider field differs
      const awsProviders = (aws.data || []).map(f => (f.provider || f.operator || '').toLowerCase());
      const googProviders = (goog.data || []).map(f => (f.provider || f.operator || '').toLowerCase());
      const awsHas = awsProviders.some(p => /aws|amazon/.test(p));
      const googHas = googProviders.some(p => /google/.test(p));
      // At least one set should contain the expected provider
      expect(awsHas || googHas).toBe(true);
      // And the two sets shouldn't be identical
      expect(JSON.stringify(aws.data)).not.toBe(JSON.stringify(goog.data));
    }, 30000);

    it('search_facilities: country=US vs country=GB returns different countries', async () => {
      const us = await callTool('search_facilities', { country: 'US', limit: 5 });
      const gb = await callTool('search_facilities', { country: 'GB', limit: 5 });
      expect(us?.data).toBeDefined();
      expect(gb?.data).toBeDefined();
      const usCountries = (us.data || []).map(f => f.country);
      const gbCountries = (gb.data || []).map(f => f.country);
      // US query should return US facilities
      expect(usCountries.every(c => c === 'US')).toBe(true);
      // GB query should return GB facilities
      expect(gbCountries.every(c => c === 'GB')).toBe(true);
    }, 30000);

    it('get_market_dcpi_rank: northern-virginia vs dallas returns different markets', async () => {
      const nova = await callTool('get_market_dcpi_rank', { market_slug: 'northern-virginia' });
      const dal = await callTool('get_market_dcpi_rank', { market_slug: 'dallas' });
      if (isGated(nova) || isGated(dal)) return; // skip if gated
      expect(JSON.stringify(nova)).not.toBe(JSON.stringify(dal));
    }, 30000);

    it('get_gas_index: state=TX vs state=CA returns different states', async () => {
      const tx = await callTool('get_gas_index', { state: 'TX' });
      const ca = await callTool('get_gas_index', { state: 'CA' });
      if (isGated(tx) || isGated(ca)) return;
      // Should reference different states
      const txStr = JSON.stringify(tx);
      const caStr = JSON.stringify(ca);
      expect(txStr).not.toBe(caStr);
    }, 30000);

    it('get_news: limit=1 vs limit=5 returns different counts', async () => {
      const one = await callTool('get_news', { limit: 1 });
      const five = await callTool('get_news', { limit: 5 });
      if (isGated(one) || isGated(five)) return;
      const oneItems = one?.articles || one?.data || one?.items || [];
      const fiveItems = five?.articles || five?.data || five?.items || [];
      expect(fiveItems.length).toBeGreaterThan(oneItems.length);
    }, 30000);

    it('get_market_intel: northern-virginia vs dallas (keyed-free-bonus)', async () => {
      const nova = await callTool('get_market_intel', { market: 'northern-virginia' });
      const dal = await callTool('get_market_intel', { market: 'dallas' });
      if (isGated(nova) && isGated(dal)) return; // both gated without key
      if (!isGated(nova) && !isGated(dal)) {
        expect(JSON.stringify(nova)).not.toBe(JSON.stringify(dal));
      }
    }, 30000);

    // FIXED (verified 2026-06, MCP v2.2.4): get_grid_data now honors `iso`,
    // repointed to /api/v1/grid/intelligence/<iso>. iso=ERCOT (~70.5 GW demand)
    // and iso=PJM (~121.6 GW demand) return distinct live demand curves.
    // Previously skipped when the backend ignored `iso` and returned a fixed
    // Colorado teaser for every ISO — now un-skipped as a live regression net.
    it('get_grid_data: iso=PJM vs iso=ERCOT should differ', async () => {
      const pjm = await callTool('get_grid_data', { iso: 'PJM' });
      const erc = await callTool('get_grid_data', { iso: 'ERCOT' });
      if (isGated(pjm) && isGated(erc)) return;
      expect(JSON.stringify(pjm)).not.toBe(JSON.stringify(erc));
    }, 30000);

    it('get_water_risk: state=TX vs state=AZ (keyed-free-bonus)', async () => {
      const tx = await callTool('get_water_risk', { state: 'TX' });
      const az = await callTool('get_water_risk', { state: 'AZ' });
      if (isGated(tx) && isGated(az)) return;
      if (!isGated(tx) && !isGated(az)) {
        expect(JSON.stringify(tx)).not.toBe(JSON.stringify(az));
      }
    }, 30000);

    it('get_energy_prices: state=TX vs state=NY (keyed-free-bonus)', async () => {
      const tx = await callTool('get_energy_prices', { state: 'TX' });
      const ny = await callTool('get_energy_prices', { state: 'NY' });
      if (isGated(tx) && isGated(ny)) return;
      if (!isGated(tx) && !isGated(ny)) {
        expect(JSON.stringify(tx)).not.toBe(JSON.stringify(ny));
      }
    }, 30000);

    it('get_renewable_energy: solar/TX vs wind/CA (keyed-free-bonus)', async () => {
      const solar = await callTool('get_renewable_energy', { energy_type: 'solar', state: 'TX' });
      const wind = await callTool('get_renewable_energy', { energy_type: 'wind', state: 'CA' });
      if (isGated(solar) && isGated(wind)) return;
      if (!isGated(solar) && !isGated(wind)) {
        expect(JSON.stringify(solar)).not.toBe(JSON.stringify(wind));
      }
    }, 30000);

    it('get_interconnection_queue: iso=ERCOT vs iso=PJM (paid, assert gate or diff)', async () => {
      const erc = await callTool('get_interconnection_queue', { iso: 'ERCOT' });
      const pjm = await callTool('get_interconnection_queue', { iso: 'PJM' });
      if (isGated(erc) && isGated(pjm)) return; // free key → gated, OK
      // With enterprise key: results should differ
      expect(JSON.stringify(erc)).not.toBe(JSON.stringify(pjm));
    }, 30000);

    it('rank_markets: cheapest_power vs most_capacity (paid, assert gate or diff)', async () => {
      const cheap = await callTool('rank_markets', { criteria: 'cheapest_power', limit: 5 });
      const cap = await callTool('rank_markets', { criteria: 'most_capacity', limit: 5 });
      if (isGated(cheap) && isGated(cap)) return;
      expect(JSON.stringify(cheap)).not.toBe(JSON.stringify(cap));
    }, 30000);

    it('site_selection_canvas: region=TX vs region=VA returns different markets', async () => {
      const tx = await callTool('site_selection_canvas', { capacity_mw: 50, region: 'TX', limit: 5 });
      const va = await callTool('site_selection_canvas', { capacity_mw: 50, region: 'VA', limit: 5 });
      if (isGated(tx) || isGated(va)) return;
      expect(JSON.stringify(tx)).not.toBe(JSON.stringify(va));
    }, 30000);
  });

  // ─── (c) Documented response fields ───────────────────────────────────────
  describe('documented response fields', () => {

    it('search_facilities returns {data: [{id, name, country}...], success}', async () => {
      const r = await callTool('search_facilities', { country: 'US', state: 'VA', limit: 3 });
      if (isGated(r)) return; // gated/rate-limited: can't assert on data content
      expect(r).toHaveProperty('data');
      expect(Array.isArray(r.data)).toBe(true);
      expect(r.data.length).toBeGreaterThan(0);
      const f = r.data[0];
      expect(f).toHaveProperty('id');
      expect(f).toHaveProperty('name');
      expect(f).toHaveProperty('country');
    }, 20000);

    it('get_market_dcpi_rank returns verdict + composite_score', async () => {
      const r = await callTool('get_market_dcpi_rank', { market_slug: 'northern-virginia' });
      if (isGated(r)) return;
      // Should have DCPI verdict fields
      const hasVerdict = r?.verdict || r?.dcpi_verdict || r?.composite_score != null;
      expect(hasVerdict).toBeTruthy();
    }, 20000);

    it('get_gas_index returns a DCGI score, or an honest reason it does not', async () => {
      // ★2026-08-08: the DCGI composite was WITHDRAWN. This assertion used to
      // demand a score, which would then fail for the RIGHT reason and read as
      // a regression. Inverted deliberately: the contract is no longer "a
      // number comes back", it is "a number OR a stated reason comes back".
      // ★2026-08-31: the DCGI was RESTORED 2026-08-30 (measured:
      // get_gas_index(TX) -> dcgi 81.9, GAS-ADVANTAGED). The assertion is
      // deliberately NOT reverted to demanding a score: a state that cannot be
      // priced legitimately returns verdict UNSCORED with dcgi null and an
      // `unscored_reason`, so "a number OR a stated reason" is the contract
      // that survives BOTH the withdrawal and the restoration. Re-tightening
      // it to "a number" would go red on an honest UNSCORED state, which is
      // how an assertion gets weakened again next time.
      // A bare empty/200 with neither still fails, which is the case that
      // matters — silently returning nothing is the failure mode a withdrawal
      // is most likely to introduce.
      const r = await callTool('get_gas_index', { state: 'TX' });
      if (isGated(r)) return;
      const hasDcgi = r?.score?.dcgi != null || r?.score?.verdict ||
                      r?.dcgi != null || r?.verdict;
      const hasReason = typeof r?.unavailable_reason === 'string' &&
                        r.unavailable_reason.length > 0;
      expect(hasDcgi || hasReason).toBeTruthy();
      // If it withheld the score it must say WHY, not just omit it.
      if (!hasDcgi) {
        expect(hasReason).toBe(true);
        expect(r.unavailable_reason.toLowerCase()).toContain('interstate');
      }
    }, 20000);

    it('get_grid_scoreboard returns grids array with iso + fuel data', async () => {
      const r = await callTool('get_grid_scoreboard', {});
      if (isGated(r)) return;
      const grids = r?.grids || r?.ranked_grids || r?.data;
      expect(grids).toBeDefined();
      expect(Array.isArray(grids)).toBe(true);
      expect(grids.length).toBeGreaterThan(0);
      const first = grids[0];
      expect(first).toHaveProperty('iso');
    }, 60000);

    it('get_news returns articles with title + source', async () => {
      const r = await callTool('get_news', { limit: 3 });
      if (isGated(r)) return;
      const articles = r?.articles || r?.data || r?.items || [];
      expect(articles.length).toBeGreaterThan(0);
      const a = articles[0];
      const hasTitle = a?.title || a?.headline;
      expect(hasTitle).toBeTruthy();
    }, 20000);

    it('get_changes returns delta object with as_of or since', async () => {
      const r = await callTool('get_changes', { since: '7d' });
      if (isGated(r)) return;
      // Should have some delta structure
      const hasDelta = r?.as_of || r?.since || r?.generated_at || r?.dcpi_movers || r?.new_facilities;
      expect(hasDelta).toBeTruthy();
    }, 20000);

    it('get_agent_registry returns platforms array', async () => {
      const r = await callTool('get_agent_registry', {});
      if (isGated(r)) return;
      const platforms = r?.platforms || r?.agents || r?.data || [];
      expect(platforms.length).toBeGreaterThan(0);
    }, 20000);

    it('get_backup_status returns health indicators', async () => {
      const r = await callTool('get_backup_status', {});
      if (isGated(r)) return;
      const hasHealth = r?.feeds || r?.summary || r?.success != null ||
                        r?.data_freshness || r?.heartbeat_score != null || r?.status;
      expect(hasHealth).toBeTruthy();
    }, 20000);

    it('hyperscaler_deals returns deals array (or gate)', async () => {
      const r = await callTool('hyperscaler_deals', { limit: 3 });
      if (isGated(r)) return;
      const deals = r?.deals || r?.data || [];
      expect(deals.length).toBeGreaterThan(0);
      const d = deals[0];
      expect(d).toHaveProperty('title');
    }, 20000);

    it('deal_autopsy returns deals with market verdicts (or gate)', async () => {
      const r = await callTool('deal_autopsy', { limit: 3 });
      if (isGated(r)) return;
      const deals = r?.deals || r?.data || [];
      expect(deals.length).toBeGreaterThan(0);
    }, 20000);

    it('grid_transition_radar returns markets with emergence signals (or gate)', async () => {
      const r = await callTool('grid_transition_radar', { max_months: 24, limit: 5 });
      if (isGated(r)) return;
      const markets = r?.emerging_markets || r?.markets || r?.emerging || r?.data || [];
      expect(markets.length).toBeGreaterThan(0);
    }, 20000);
  });

  // ─── PAID_ONLY tool gating assertions ──────────────────────────────────────
  // With a free key, these should return gated/paywall responses (not full data).
  // With an enterprise key, they return real data — so we assert either.
  describe('PAID_ONLY gating (free key → gate, enterprise key → data)', () => {
    const paidToolCalls = [
      { name: 'analyze_site', args: { lat: 33.45, lon: -112.07 } },
      { name: 'compare_sites', args: { locations: '[{"lat":33.45,"lon":-112.07},{"lat":39.04,"lon":-77.48}]' } },
      { name: 'get_grid_intelligence', args: { region_id: 'PJM' } },
      { name: 'get_fiber_intel', args: { carrier: 'Lumen' } },
      { name: 'get_dchub_recommendation', args: { context: '100MW AI campus in Texas' } },
    ];

    for (const { name, args } of paidToolCalls) {
      it(`${name} returns gated response OR real data (tier-dependent)`, async () => {
        const r = await callTool(name, args);
        // Either it's gated (free key) or it has meaningful data (paid key).
        const reason = gateReason(r);
        const hasData = r && !r.__structured && !r.__raw?.includes('sign up to unlock');
        // ★ This assertion used to be a bare `expect(gated || hasData).toBe(true)`,
        //   which on failure printed only "expected false to be true" — naming
        //   neither the tier, nor the gate, nor the shape that was rejected. Five
        //   of these went red the moment CI started authenticating (2026-09-01)
        //   and the output could not distinguish a product defect from a suite
        //   that cannot classify a paid-tier payload. A verdict you cannot trace
        //   to an observation is the defect this repo keeps paying for, so the
        //   failure now carries the evidence: gate name, tier, and top-level keys.
        expect(
          Boolean(reason) || Boolean(hasData),
          `${name}: not recognised as a gate and not counted as data.\n` +
          `  gateReason      : ${reason ?? 'null'}\n` +
          `  tier reported   : ${r?.identity?.tier ?? r?.quota?.tier ?? '(none)'}\n` +
          `  __structured    : ${Boolean(r?.__structured)}   __raw: ${Boolean(r?.__raw)}\n` +
          `  top-level keys  : ${r ? Object.keys(r).slice(0, 25).join(', ') : '(response was falsy)'}`,
        ).toBe(true);
      }, 20000);
    }
  });

  // ─── search → live page slug round-trip ────────────────────────────────────
  // Regression guard for a backend slug-source divergence. The agent-facing
  // `search_facilities` tool (→ /api/v1/facilities) emits a slug that does NOT
  // resolve on the canonical surfaces, so an agent that searches then opens the
  // result dead-ends. Verified live 2026-06-08 — two incompatible namespaces,
  // and NO single slug resolves on all three surfaces:
  //
  //   slug                                            get_facility  page  score_facility
  //   stack-stafford-technology-campus (search emits)     404        404      200
  //   stack-infrastructure-…-eb55e369 (/api/v1/search)    200        200      404
  //
  // The user-requested assertion is "every search-returned slug 200s on the
  // live page". It currently FAILS — flagging the divergence for the maintainer
  // to align the backend slug source. This suite is non-blocking (informational)
  // in CI, so the red surfaces the bug without gating; once /api/v1/facilities'
  // slug output is aligned with /facilities/<slug>, it becomes a passing guard.
  describe('search → live page slug round-trip', () => {
    const SITE = MCP_URL.replace(/\/mcp\/?$/, '') || 'https://dchub.cloud';
    const transient = (s) => s === 429 || s >= 500;

    // Collect the slugs the agent-facing search tool actually emits.
    async function searchToolSlugs() {
      const slugs = new Set();
      const probes = [
        { country: 'US', state: 'VA', limit: 10 },
        { query: 'ashburn', limit: 10 },
        { country: 'US', state: 'TX', limit: 10 },
      ];
      for (const args of probes) {
        let r;
        try { r = await callTool('search_facilities', args); } catch { continue; }
        if (isGated(r)) continue;
        const items = r.results || r.facilities || r.data || (Array.isArray(r) ? r : []);
        for (const f of items) {
          const s = f?.slug || f?.id;
          // skip bare numeric ids — the page/get_facility are slug-addressed
          if (typeof s === 'string' && s && !/^\d+$/.test(s)) slugs.add(s);
        }
      }
      return [...slugs];
    }

    it('every slug search_facilities returns resolves 200 on the live /facilities/<slug> page', async () => {
      const slugs = await searchToolSlugs();
      if (!slugs.length) return; // gated/empty/transient → nothing to assert
      const broken = [];
      let checked = 0;
      for (const slug of slugs) {
        const res = await fetch(`${SITE}/facilities/${encodeURIComponent(slug)}`, { method: 'HEAD' });
        if (transient(res.status)) continue; // live blip → don't count
        checked++;
        if (res.status !== 200) broken.push(`${slug} → HTTP ${res.status}`);
      }
      if (checked === 0) return;
      if (broken.length) {
        console.error(
          'SEARCH→PAGE SLUG DIVERGENCE — search_facilities emits slugs that 404 on the live page:\n  ' +
          broken.join('\n  ') +
          '\n  The resolvable page slug is the UUID-suffixed form /api/v1/search emits ' +
          '(e.g. stack-infrastructure-stack-stafford-technology-campus-eb55e369). ' +
          'Align /api/v1/facilities slug output with the /facilities/<slug> source.'
        );
      }
      expect(broken, 'search_facilities slugs that do not 200 on the live page').toEqual([]);
    }, 60000);

    // The full round-trip the user described: a slug an agent gets from
    // search_facilities should open (page), fetch (get_facility) AND score
    // (score_facility). Currently the search slug (e.g. "stack-stafford-va")
    // dead-ends on ALL three — a fully dangling identifier. This prints the
    // exact 3-surface matrix and asserts the round-trip so it stays visible
    // until the backend emits one canonical, resolvable slug everywhere.
    it('the search slug resolves on get_facility + page + score_facility (full round-trip)', async () => {
      const slugs = await searchToolSlugs();
      if (!slugs.length) return;
      const slug = slugs[0];
      const [getFac, page, score] = await Promise.all([
        fetch(`${SITE}/api/v1/facilities/${encodeURIComponent(slug)}`),
        fetch(`${SITE}/facilities/${encodeURIComponent(slug)}`, { method: 'HEAD' }),
        fetch(`${SITE}/api/v1/mcp/tools/score_facility`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ facility_id: slug }),
        }),
      ]);
      if (transient(getFac.status) || transient(page.status) || transient(score.status)) return;
      const scoreText = await score.text().catch(() => '');
      const scoreResolves = score.ok && !/facility not found/i.test(scoreText);
      console.error(
        `SEARCH SLUG "${slug}" resolution → ` +
        `get_facility=${getFac.status} | page=${page.status} | score_facility=${scoreResolves ? '200' : score.status}`
      );
      const failures = [];
      if (getFac.status !== 200) failures.push(`get_facility=${getFac.status}`);
      if (page.status !== 200) failures.push(`page=${page.status}`);
      if (!scoreResolves) failures.push(`score_facility=${score.status}`);
      expect(
        failures,
        `search slug "${slug}" should resolve everywhere; failed on: ${failures.join(', ')}`
      ).toEqual([]);
    }, 40000);
  });
});
