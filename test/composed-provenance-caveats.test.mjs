// composed-provenance-caveats.test.mjs: G-2 (2026-10-07).
//
// MEASURED before (live, be#6488 deployed): get_grid_data PJM carried provenance.caveats
// [{code: "preliminary", ...}] (EIA's hourly values are collected as reported and corrected later),
// while get_grid_intelligence and compare_isos, which serve the same EIA figures, build their own
// composed provenance (lib/grid-provenance.mjs) and carried none. A warning that travels with a
// figure on one tool must travel with it on the others.
// Pins: contributing upstreams' valid caveats are carried (one per code), invalid ones are not,
// nothing is invented when no upstream sent one, the code list equals the contract fixture, and
// the real handlers (pro and free-key seats) return them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { composeGridProvenance, composeCompareProvenance, CAVEAT_CODES } from '../lib/grid-provenance.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('../canonical/provenance_envelope_1_2.json', import.meta.url), 'utf8'));
const EIA = (iso) => `EIA-930 hourly RTO/BA feed (${iso}) + DC Hub grid intelligence`;
const QUEUE = 'US ISO public interconnection queues (ERCOT GIS / PJM NSQ / MISO GI / SPP / CAISO / NYISO / ISO-NE)';
const PRELIM = { code: 'preliminary', text: 'EIA-930 hourly values are collected as reported and corrected later by EIA.' };
const gi = (iso, caveats = [PRELIM]) => ({ iso, demand_mw: 1000, demand_period: '2026-10-06T10',
  generation_mix: { NG: { mw: 500 } },
  provenance: { provenance_version: 1, source: EIA(iso), as_of: '2026-10-06T10:00:00Z', basis_class: 'derived',
    ...(caveats ? { caveats } : {}) } });
const cmp = (...isos) => ({ isos: isos.map((iso) => ({ iso, iso_name: iso, avg_constraint: 50, avg_excess: 60, market_count: 10, build_count: 3 })) });
const qsnap = (...isos) => ({ by_iso: isos.map((iso) => ({ iso, queued_load_total_gw: 10 })),
  provenance: { source: QUEUE, as_of: null, as_of_basis: 'UNMEASURED at collection level: x.' } });

describe('the closed code list', () => {
  it('equals the contract fixture', () => {
    expect([...CAVEAT_CODES]).toEqual(FIXTURE.caveat_codes.codes);
    expect(CAVEAT_CODES).not.toContain('hourly_preliminary');
  });
});

describe('composeGridProvenance carries the contributing upstream\'s caveats', () => {
  it('carries the telemetry caveat into the composite', () => {
    const p = composeGridProvenance('PJM', { gi: gi('PJM'), cmp: cmp('PJM'), qsnap: qsnap('PJM') });
    expect(p.caveats).toEqual([PRELIM]);
    expect(p.basis).toBe('mixed');
  });
  it('no upstream caveat means no caveats key (nothing is invented)', () => {
    const p = composeGridProvenance('PJM', { gi: gi('PJM', null), cmp: cmp('PJM'), qsnap: qsnap('PJM') });
    expect(p).not.toHaveProperty('caveats');
  });
  it('drops a code that is not on the list, a blank text, and a non-object; keeps the good ones', () => {
    const bad = [{ code: 'made_up', text: 'x' }, { code: 'preliminary', text: '  ' }, 'junk', null,
      { code: 'county_centroid', text: ' ok ' }];
    const p = composeGridProvenance('PJM', { gi: gi('PJM', bad), cmp: cmp('PJM') });
    expect(p.caveats).toEqual([{ code: 'county_centroid', text: 'ok' }]);
  });
  it('a caveats value that is not an array is ignored', () => {
    expect(composeGridProvenance('PJM', { gi: gi('PJM', { code: 'preliminary', text: 'x' }), cmp: cmp('PJM') }))
      .not.toHaveProperty('caveats');
  });
  it('the same code from two upstreams is carried once, the first text wins', () => {
    const q = qsnap('PJM'); q.provenance.caveats = [{ code: 'preliminary', text: 'second' }, { code: 'third_party_model', text: 'tpm' }];
    const p = composeGridProvenance('PJM', { gi: gi('PJM'), cmp: cmp('PJM'), qsnap: q });
    expect(p.caveats).toEqual([PRELIM, { code: 'third_party_model', text: 'tpm' }]);
  });
  it('an upstream that did NOT contribute does not lend its caveats', () => {
    const q = qsnap('ERCOT'); q.provenance.caveats = [{ code: 'third_party_model', text: 'tpm' }];   // no PJM row
    const p = composeGridProvenance('PJM', { gi: gi('PJM'), cmp: cmp('PJM'), qsnap: q });
    expect(p.caveats).toEqual([PRELIM]);
  });
  it('a single contributor still returns its own block, caveats included', () => {
    expect(composeGridProvenance('AZPS', { gi: gi('AZPS') }).caveats).toEqual([PRELIM]);
  });
});

describe('composeCompareProvenance carries them once, however many ISOs', () => {
  it('two ISOs with the same caveat give one entry', () => {
    const p = composeCompareProvenance(['PJM', 'ERCOT'], [gi('PJM'), gi('ERCOT')], cmp('PJM', 'ERCOT'), qsnap('PJM', 'ERCOT'));
    expect(p.caveats).toEqual([PRELIM]);
  });
  it('an ISO whose telemetry failed lends nothing; the other still does', () => {
    const p = composeCompareProvenance(['PJM', 'ERCOT'], [gi('PJM'), { error: 'API 500' }], cmp('PJM'), null);
    expect(p.caveats).toEqual([PRELIM]);
  });
  it('different codes from different ISOs are both carried', () => {
    const p = composeCompareProvenance(['PJM', 'ERCOT'], [gi('PJM'), gi('ERCOT', [{ code: 'county_centroid', text: 'cc' }])],
      cmp('PJM', 'ERCOT'), null);
    expect(p.caveats.map((c) => c.code)).toEqual(['preliminary', 'county_centroid']);
  });
  it('none sent means none emitted', () => {
    const p = composeCompareProvenance(['PJM', 'ERCOT'], [gi('PJM', null), gi('ERCOT', null)], cmp('PJM', 'ERCOT'), null);
    expect(p).not.toHaveProperty('caveats');
  });
});

// ── through the real handlers ───────────────────────────────────────────────
const BASE = 'http://127.0.0.1:1';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, N = 0;
const KEYED = { api_key: 'dch_live_cc_prov_test', tier: 'pro', platform: 'claude', client_name_raw: 'claude-ai', session_id: 'sess-cc-k' };
const FREE = { api_key: 'dch_free_cc_prov_test', tier: 'free', platform: 'claude', client_name_raw: 'claude-ai', session_id: 'sess-cc-f' };
async function call(tool, args, seat) {
  N += 1;
  const s = { ...seat, session_id: `${seat.session_id}-${N}`, client_ip: `198.51.100.${N % 250 + 1}` };
  const T = TOOLS[tool];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues).slice(0, 300));
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (!url.startsWith(BASE)) return json(503, { ok: false, error: 'fenced' });
    const path = new URL(url).pathname;
    if (path === '/api/v1/keys/validate') {
      const who = JSON.stringify([init && init.headers, init && init.body, url]);
      return json(200, { valid: true, tier: /dch_free/.test(who) ? 'free' : 'pro', developer_id: 'dev_cc' });
    }
    const m = /^\/api\/v1\/grid\/intelligence\/(PJM|ERCOT)$/.exec(path);
    if (m) return json(200, gi(m[1]));
    if (path === '/api/v1/dcpi/iso-comparison') return json(200, cmp('PJM', 'ERCOT'));
    if (path === '/api/v1/interconnection-queue/snapshot') return json(200, qsnap('PJM', 'ERCOT'));
    if (/^\/api\/v1\/grid\/extended\//.test(path)) return json(200, { available: false });
    return json(404, { error: 'not stubbed' });
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs?cc=' + Math.random());
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; });

describe('the real handlers return the carried caveat', () => {
  for (const [label, seat] of [['pro seat', KEYED], ['free key (trimmed preview)', FREE]]) {
    it(`get_grid_intelligence, ${label}`, async () => {
      const r = await call('get_grid_intelligence', { region_id: 'PJM' }, seat);
      expect(r.structuredContent.provenance.caveats).toEqual([PRELIM]);
      if (seat === KEYED) expect(JSON.parse(r.content[0].text).provenance.caveats).toEqual([PRELIM]);
    }, 30_000);
    it(`compare_isos, ${label}`, async () => {
      const r = await call('compare_isos', { isos: 'PJM,ERCOT' }, seat);
      expect(r.structuredContent.provenance.caveats).toEqual([PRELIM]);
      if (seat === KEYED) expect(JSON.parse(r.content[0].text).provenance.caveats).toEqual([PRELIM]);
    }, 30_000);
  }
});
