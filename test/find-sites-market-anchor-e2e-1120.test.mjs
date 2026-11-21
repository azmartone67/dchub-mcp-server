// find-sites-market-anchor-e2e-1120.test.mjs — Grok QA 2026-11-20 P2 (owner: "anchor results to the metro and state
// the AVOID caveat") on a real server.mjs with a stub backend:
//   * find_sites passes market= to the backend (/mcp), and the backend's avoid_note, anchored_market and ranked_after
//     note reach a keyless and a keyed caller, in the text and in structuredContent, on /mcp, /mcp/claude and
//     /mcp/chatgpt (the ChatGPT catalog does not list the input; its output is not frozen);
//   * execute_plan for 250 MW near Chicago leads with the AVOID line, and a search area 100 km or more from Chicago
//     is never named without the distance line (planner 5.55, lib/siting-caveat.mjs).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.39' };
const ANON = { 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.40' };
const CAND = (lat, lon, mkt, verdict, iso) => ({ anchor: { type: 'substation', voltage_kv: 345, name: 'Sub' }, fiber_distance_km: 1.2,
  gas_distance_km: 9.4, lat, lon, grid_operator: { resolved: true, iso }, market: { market: mkt, verdict, as_of: '2026-11-20' }, verdict });
const AVOID_NOTE = 'Chicago-area markets read AVOID on the Data Center Power Index (Chicago, Elk Grove Village; PJM), so they rank last: '
  + 'any CAUTION or BUILD area elsewhere ranks ahead of them. These areas are listed because the search is centred on Chicago. '
  + 'AVOID screens new power for a market, not a site: confirm timing with the serving utility.';
const NEAR = { success: true, count: 6, filter: { lat: 41.8781, lon: -87.6298, radius_km: 60, radius_source: 'market_default' },
  candidates: [CAND(41.95, -87.7, 'Chicago', 'AVOID', 'PJM'), CAND(42.0, -87.97, 'Elk Grove Village', 'AVOID', 'PJM'), CAND(41.76, -88.2, 'Chicago', 'AVOID', 'PJM')],
  anchored_market: { requested: 'chicago', resolved: true, market: 'Chicago', slug: 'chicago', state: 'IL', iso: 'PJM', verdict: 'AVOID',
    source_url: 'https://dchub.cloud/dcpi/chicago', search_centre: 'market_centre', note: 'Search areas around the published centre of the Chicago DCPI market.' },
  avoid_note: AVOID_NOTE };
// The live Grok repro: downstate MISO areas on St. Louis / Madison CAUTION, far from Chicago, no AVOID line.
const DOWNSTATE = { success: true, count: 10, filter: { state: 'IL' },
  candidates: [CAND(38.9, -89.9, 'St. Louis', 'CAUTION', 'MISO'), CAND(38.8, -90.1, 'Madison', 'CAUTION', 'MISO'), CAND(39.8, -89.6, 'Springfield', 'CAUTION', 'MISO')] };
const RANKED = { note: 'These areas all read CAUTION or better. Published DCPI markets in IL with a worse verdict rank after every one of them, so none of their substations is listed here: Chicago (PJM, AVOID). For one of them, call find_sites with its lat/lon (radius_km 50) or analyze_site at the point.',
  markets: [{ market: 'Chicago', slug: 'chicago', iso: 'PJM', verdict: 'AVOID', source_url: 'https://dchub.cloud/dcpi/chicago', lat: 41.87, lon: -87.63 }],
  count: 1, next_call: { tool: 'find_sites', args: { lat: 41.87, lon: -87.63, radius_km: 50 } } };
// Grok QA 2026-11-20 item 1, the exact repro (keyed, planner 5.52): the run widened find_sites to state=IL and pointed
// analyze_site at 41.787197, -89.710625 (near Dixon, about 170 km from Chicago) with no AVOID line. Two near-Chicago
// rows ride with it, so only the exact point can make the distance part fire.
const EXACT_INTENT = 'fastest 250 MW data center site near Chicago Illinois within 30 months';
const EXACT = { success: true, count: 10, filter: { state: 'IL' },
  candidates: [CAND(41.787197, -89.710625, 'Rockford', 'CAUTION', 'PJM'), CAND(41.95, -87.7, 'Chicago', 'AVOID', 'PJM'), CAND(42.0, -87.97, 'Elk Grove Village', 'AVOID', 'PJM')] };
const CHICAGO_CARD = { market_slug: 'chicago', market_name: 'Chicago', state: 'IL', iso: 'PJM', verdict: 'AVOID', composite_score: 21.9,
  latitude: 41.87, longitude: -87.63, computed_at: '2026-11-20T18:30:07+00:00', published: true };

let mode = 'near';
const seen = [];
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
const text = (r) => (r.msg.result.content || []).map((b) => b.text || '').join('\n');

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, body, u) => {
    seen.push(p + (u && u.search ? u.search : ''));
    if (p === '/api/v1/sites/find') {
      if (mode === 'near') return { status: 200, body: NEAR };
      if (mode === 'far') return { status: 200, body: DOWNSTATE };
      // 5.58: the exact intent now sends market=chicago (state=IL beside it); the backend centres the search there.
      if (mode === 'exact') return { status: 200, body: /[?&]market=chicago\b/.test(u && u.search ? u.search : '') ? NEAR : EXACT };
      // The backend could not resolve the market and searched the state: the 5.55 caveat is the safety net.
      if (mode === 'exact_unresolved') return { status: 200, body: EXACT };
      return { status: 200, body: { ...DOWNSTATE, ranked_after: RANKED } };
    }
    if (p.startsWith('/api/v1/dcpi/scores/chicago')) return { status: 200, body: CHICAGO_CARD };
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('find_sites market= on a real server.mjs', () => {
  it('market reaches the backend and is declared on /mcp, held off /mcp/chatgpt', async () => {
    mode = 'near';
    const before = seen.length;
    await H.call('/mcp', 'find_sites', { market: 'chicago' }, PRO);
    expect(seen.slice(before).some((x) => x.startsWith('/api/v1/sites/find') && /[?&]market=chicago\b/.test(x))).toBe(true);
    const canon = (await H.list('/mcp')).msg.result.tools.find((t) => t.name === 'find_sites');
    expect(Object.keys(canon.inputSchema.properties)).toContain('market');
    const gpt = (await H.list('/mcp/chatgpt')).msg.result.tools.find((t) => t.name === 'find_sites');
    expect(Object.keys(gpt.inputSchema.properties)).not.toContain('market');
  }, 120_000);

  for (const [path, who, headers] of [['/mcp', 'keyless', ANON], ['/mcp', 'keyed (Pro)', PRO],
    ['/mcp/claude', 'keyless', ANON], ['/mcp/chatgpt', 'keyless', ANON]]) {
    it(`${path} ${who}: avoid_note and anchored_market survive the masks, in text and structuredContent`, async () => {
      mode = 'near';
      const r = await H.call(path, 'find_sites', path === '/mcp/chatgpt' ? { lat: 41.8781, lon: -87.6298 } : { market: 'chicago' }, headers);
      expect(r.msg && r.msg.result, JSON.stringify(r.msg).slice(0, 300)).toBeTruthy();
      expect(text(r)).toContain('Chicago-area markets read AVOID on the Data Center Power Index');
      const s = r.msg.result.structuredContent;
      if (s) {
        expect(s.avoid_note).toBe(AVOID_NOTE);
        expect(s.anchored_market && s.anchored_market.verdict).toBe('AVOID');
      }
    }, 120_000);
  }

  for (const [path, who, headers] of [['/mcp', 'keyless', ANON], ['/mcp', 'keyed (Pro)', PRO], ['/mcp/claude', 'keyless', ANON]]) {
    it(`${path} ${who}: a state search's ranked_after note survives`, async () => {
      mode = 'ranked';
      const r = await H.call(path, 'find_sites', { state: 'IL' }, headers);
      expect(text(r)).toContain('none of their substations is listed here: Chicago (PJM, AVOID)');
    }, 120_000);
  }
});

describe('execute_plan 250 MW near Chicago (planner 5.55, anchored 5.58)', () => {
  for (const [who, headers] of [['keyed (Pro)', PRO], ['keyless', ANON]]) {
    it(`${who}: areas near Chicago: the lead carries the AVOID line`, async () => {
      mode = 'near';
      const r = await H.call('/mcp', 'execute_plan', { intent: 'Find land for a 250 MW data center near Chicago' }, headers);
      const o = sc(r);
      expect(o.planner_version).toBe('5.58');
      expect(o.executed.some((e) => e.tool === 'find_sites' && (e.status === 'executed' || e.status === 'gated_preview'))).toBe(true);
      expect(o.intent_answer.siting_caveat).toMatch(/^Chicago-area markets read AVOID on the Data Center Power Index/);
      expect(planLeadText(o)).toMatch(/^Chicago-area markets read AVOID on the Data Center Power Index \(Chicago, Elk Grove Village; PJM\), so they rank last/);
      expect(planLeadText(o)).not.toMatch(/\$\d|\bPro\b|upgrade|pricing/i);
    }, 120_000);

    it(`${who}: THE REPRO: areas far from Chicago are never named without the distance and AVOID line`, async () => {
      mode = 'far';
      const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Find land for a 250 MW data center near Chicago' }, headers));
      const lead = planLeadText(o);
      // mcp#1600: below full access the distance is said without a figure.
      expect(lead).toMatch(who === 'keyless'
        ? /^3 of the 3 areas shown sit well away from Chicago, outside its metro area\. Chicago-area markets \(PJM\) read AVOID/
        : /^3 of the 3 areas shown sit 100 km or more from Chicago \(up to about \d+ km\)\. Chicago-area markets \(PJM\) read AVOID/);
      expect(o.intent_answer.siting_caveat).toContain('For areas near Chicago, call find_sites market=chicago.');
    }, 120_000);

    // Grok QA 2026-11-20 item 1; owner 2026-11-20 "anchor fastest-site-near-X asks to the metro" (planner 5.58): the exact
    // intent is siting_search, and its find_sites step is now centred on Chicago (market=chicago, state=IL as the fallback).
    it(`${who}: THE EXACT GROK INTENT searches around Chicago and leads with the AVOID line`, async () => {
      mode = 'exact';
      const before = seen.length;
      const o = sc(await H.call('/mcp', 'execute_plan', { intent: EXACT_INTENT }, headers));
      expect(o.intent_class).toBe('siting_search');
      const fsStep = o.executed.find((e) => e.tool === 'find_sites');
      expect(fsStep && fsStep.args).toEqual({ market: 'chicago', state: 'IL' });
      const calls = seen.slice(before).filter((x) => x.startsWith('/api/v1/sites/find'));
      expect(calls.some((x) => /[?&]market=chicago\b/.test(x) && /[?&]state=IL\b/.test(x)), calls.join(' | ')).toBe(true);
      const lead = planLeadText(o);
      expect(lead).toMatch(/^Chicago-area markets read AVOID on the Data Center Power Index \(Chicago, Elk Grove Village; PJM\), so they rank last/);
      // Every area is within 60 km of Chicago: no distance line, and no "call find_sites market=chicago" (it already did).
      expect(o.intent_answer.siting_caveat).not.toMatch(/100 km or more|well away from Chicago|call find_sites market=/);
      expect(lead).not.toMatch(/\$\d|\bPro\b|upgrade|pricing/i);
    }, 120_000);

    it(`${who}: THE EXACT GROK INTENT when the market does not resolve: the Dixon point still gets the distance line`, async () => {
      mode = 'exact_unresolved';
      const o = sc(await H.call('/mcp', 'execute_plan', { intent: EXACT_INTENT }, headers));
      expect(o.executed.find((e) => e.tool === 'find_sites').args).toEqual({ market: 'chicago', state: 'IL' });
      const lead = planLeadText(o);
      if (who === 'keyless') {
        expect(lead).toMatch(/^One of the 3 areas shown sits well away from Chicago, outside its metro area\. Chicago-area markets \(PJM\) read AVOID on the Data Center Power Index \(DCPI\), so they rank last/);
        expect(o.intent_answer.siting_caveat).not.toMatch(/\d\s*km\b/);
      } else {
        expect(lead).toMatch(/^One of the 3 areas shown sits 100 km or more from Chicago \(up to about 170 km\)\. Chicago-area markets \(PJM\) read AVOID on the Data Center Power Index \(DCPI\), so they rank last/);
      }
      expect(o.intent_answer.siting_caveat).toContain('For areas near Chicago, call find_sites market=chicago.');
    }, 120_000);
  }

  // The ChatGPT catalog holds find_sites' market input off its listing (frozen schema); the plan's own step still sends it.
  for (const path of ['/mcp/claude', '/mcp/chatgpt']) {
    it(`${path} keyless: THE EXACT GROK INTENT sends market=chicago to the backend`, async () => {
      mode = 'exact';
      const before = seen.length;
      const o = sc(await H.call(path, 'execute_plan', { intent: EXACT_INTENT }, ANON));
      const calls = seen.slice(before).filter((x) => x.startsWith('/api/v1/sites/find'));
      expect(calls.some((x) => /[?&]market=chicago\b/.test(x)), calls.join(' | ')).toBe(true);
      // These surfaces lead with the DCPI card, not the caveat block (as on main); either way AVOID comes first.
      expect(planLeadText(o)).toMatch(/^Chicago[^.]{0,40}AVOID/);
    }, 120_000);
  }

  it('THE EXACT GROK INTENT with be#9113 ranked_after on the state search: the AVOID caveat still leads', async () => {
    mode = 'ranked';
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: EXACT_INTENT }, PRO));
    expect(o.executed.find((e) => e.tool === 'find_sites').args).toEqual({ market: 'chicago', state: 'IL' });
    expect(planLeadText(o)).toMatch(/^3 of the 3 areas shown sit 100 km or more from Chicago \(up to about \d+ km\)\. Chicago-area markets \(PJM\) read AVOID/);
  }, 120_000);

  it('a state search with ranked_after: the lead names Chicago as ranked after the areas listed', async () => {
    mode = 'ranked';
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Find land for a 250 MW data center in Illinois' }, PRO));
    expect(o.executed.some((e) => e.tool === 'find_sites')).toBe(true);
    expect(planLeadText(o)).toMatch(/Chicago \(PJM, AVOID\) ranks after every area listed here/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
