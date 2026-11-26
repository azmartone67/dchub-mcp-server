// gdl-plan-cite-e2e-1125.test.mjs — Grok daily head-to-head 2026-11-25 (planner 5.64), items A-F on a real server.mjs
// with a stub backend (no network). Pure units: test/gdl-plan-cite-1125.test.mjs.
//   A  every plan's cite_as / citation.cite_as is "Source: DC Hub (dchub.cloud), as of <YYYY-MM-DD>", no PARTIAL/preview
//   B  a fiber plan's cite_as says the intent_answer's own as_of day
//   C  get_site_context's citation is dated, by the Phoenix day of an evening UTC as_of
//   D  get_energy_prices for PJM keeps the 2026/27 auction rows (the delivery year in force)
//   E  the Ohio land plan reads get_permitting_intel {state: OH} and says no OH record is on file
//   F  "connect Phoenix to Los Angeles" reads both ends, nothing skipped_unresolved, and leads with the route
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.41' };
const ANON = { 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.42' };
const CITE_RE = /^Source: DC Hub \(dchub\.cloud\), as of \d{4}-\d{2}-\d{2}/;
const ROUTE = 'Zayo LA - Phoenix - Dallas';
const PJM_CTX = JSON.parse(readFileSync(new URL('./fixtures/pjm-wholesale-context-1124.json', import.meta.url), 'utf8'));
const SC_AS_OF = '2026-11-26T00:44:35Z';   // 17:44 on 2026-11-25 in Phoenix
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ env: { DCHUB_MCP_GET_SITE_CONTEXT: '1' }, extraRoutes: async (p, req, body, u) => {
    if (p === '/api/v1/fiber/routes') {
      return { type: 'FeatureCollection', count: 2, provenance: { as_of: '2026-03-15' },
        features: [{ type: 'Feature', properties: { name: `${ROUTE} seg1`, carrier: 'Zayo', class: 'longhaul' }, geometry: null },
          { type: 'Feature', properties: { name: `Other ${u.searchParams.get('market')} route`, carrier: 'Lumen', class: 'longhaul' }, geometry: null }] };
    }
    if (p === '/api/v1/fiber/cluster-latency') {
      return { pairs: [{ a: 'phoenix', b: 'los-angeles', distance_km: 574, floor_rtt_us: 5630, est_rtt_us: 7880 }] };
    }
    if (p === '/api/v1/permitting/intel') return { count: 0, records: [], as_of: '2026-11-20', state: u.searchParams.get('state') };
    if (p === '/api/v1/energy/summary' && u.searchParams.get('iso') === 'PJM') {
      return { ok: true, filter: { iso: 'PJM' }, as_of: '2026-08-31', wholesale_lmp: null, wholesale_context: PJM_CTX };
    }
    if (p === '/api/v1/land-power/site-context') {
      // the backend's full body carries no `view` key (_siteContextShape drops a full body that does)
      return { ok: true, lat: 39.04, lng: -77.48, as_of: SC_AS_OF, errors: {},
        substation: { name: 'TEST SUB', voltage: '230 kV', distance_km: 2, source: 'HIFLD', as_of: SC_AS_OF } };
    }
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

const plan = async (intent, hdr = PRO) => sc(await H.call('/mcp', 'execute_plan', { intent }, hdr));

describe('A: plan cite_as is the owner line on every plan', () => {
  const ASKS = ['connect Phoenix to Los Angeles with fiber', 'land for 100 MW in Ohio with any local restrictions',
    'PJM capacity auction prices for a Northern Virginia data center', 'Is 350 E Cermak, Chicago on-net for fiber?'];
  for (const [who, hdr] of [['pro', PRO], ['keyless', ANON]]) {
    for (const ask of ASKS) {
      it(`${who}: ${ask}`, async () => {
        const o = await plan(ask, hdr);
        expect(o._entity).toBe('plan_execution');
        for (const c of [o.cite_as, o.citation && o.citation.cite_as]) {
          expect(c).toMatch(CITE_RE);
          expect(c).not.toMatch(/PARTIAL|preview/i);
        }
        if (o.citation.completeness === 'partial_preview') {
          expect(o.completeness && o.completeness.note).toMatch(/^partial/);
          expect(o.citation.completeness_note).toMatch(/^partial/);
        }
      }, 120_000);
    }
  }
});

describe('B + F: connect Phoenix to Los Angeles', () => {
  it('reads both ends and the latency floor, nothing skipped_unresolved, leads with the route, cites the answer\'s day', async () => {
    const o = await plan('connect Phoenix to Los Angeles');
    expect(o.intent_class).toBe('fiber');
    const fi = o.executed.filter((e) => e.tool === 'get_fiber_intel').map((e) => e.args && e.args.market);
    expect(fi).toEqual(expect.arrayContaining(['phoenix', 'los-angeles']));
    expect(o.executed.some((e) => e.status === 'skipped_unresolved')).toBe(false);
    expect(o.executed.some((e) => e.tool === 'plan_fiber_leadin')).toBe(false);
    expect(planLeadText(o)).toMatch(new RegExp(`touching both Phoenix and Los Angeles: ${ROUTE}`));
    expect(o.intent_answer.not_established.join(' ')).toMatch(/measured route latency between Phoenix and Los Angeles is not served/);
    expect(o.intent_answer.as_of).toBe('2026-03-15');
    expect(o.cite_as).toBe('Source: DC Hub (dchub.cloud), as of 2026-03-15');
  }, 120_000);
});

describe('C: get_site_context is cited with the Phoenix day of its as_of', () => {
  it('citation and provenance carry the dated cite_as, 2026-11-25 for an as_of of 00:44Z on the 26th', async () => {
    const r = await H.call('/mcp', 'get_site_context', { lat: 39.04, lon: -77.48 }, PRO);
    const o = sc(r);
    // the answer carries the site data (not "did not answer"): a cite off the serve clock matches on the 25th only
    expect(o.available, JSON.stringify(o).slice(0, 400)).not.toBe(false);
    expect(JSON.stringify(o)).toContain('TEST SUB');
    expect(o.cite_as).toBe('DC Hub (dchub.cloud), as of 2026-11-25');
    expect(o.citation.cite_as).toBe(o.cite_as);
    expect(o.provenance.cite_as).toBe(o.cite_as);
  }, 120_000);
});

describe('D: PJM capacity rows keep the delivery year in force', () => {
  it('get_energy_prices iso=PJM serves the 2026/27 auction row ($329.17)', async () => {
    const o = sc(await H.call('/mcp', 'get_energy_prices', { iso: 'PJM' }, PRO));
    const periods = (o.wholesale_context.figures || []).filter((g) => /Base Residual/.test(g.name)).map((g) => g.period);
    expect(periods).toEqual(expect.arrayContaining(['2026/2027 delivery year', '2027/2028 delivery year', '2028/2029 delivery year']));
    expect(periods).not.toContain('2025/2026 delivery year');
  }, 120_000);
});

describe('E: Ohio land with local restrictions', () => {
  it('reads get_permitting_intel {state: OH} and says no OH permitting record is on file', async () => {
    const o = await plan('land for 100 MW in Ohio with any local restrictions');
    const pe = o.executed.filter((e) => e.tool === 'get_permitting_intel');
    expect(pe).toHaveLength(1);
    expect(pe[0].args).toMatchObject({ state: 'OH' });
    expect(pe[0].status).toBe('executed');
    expect(o.intent_answer.headline).toMatch(/No OH permitting record on file/);
    expect(o.intent_answer.headline.indexOf('find_sites')).toBe(0);
  }, 120_000);
});
