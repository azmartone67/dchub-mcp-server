// free-numerics-gate.test.mjs — r-free-numerics (2026-09-22).
//
// MEASURED, live, keyless, the day this shipped:
//   get_market_dcpi_rank   avg_kwh_cents "10.309" (a string, which the preview
//                          trim does not null) next to the nulled scores
//   rank_markets           total_mw 5793 / 1268 / 923, and the same MW inside
//                          `value` ("191 fac / 5793 MW / 55 ops")
//   site_selection_canvas  every score again inside verdict_reasons
// And a free or identified KEY was not trimmed on any of the three: the backend
// answers the server's X-Internal-Key in full.
//
// These run the REAL registered handlers (createServer()._registeredTools) under
// a real caller seat (_ctxALS), with only the backend stubbed, so every return
// path the gate has to cover is the one production takes.
//
// WHAT THIS PINS, per tool:
//   * keyless and free-key callers get the figure null with its `_…_in_pro`
//     marker, in BOTH channels (content JSON and structuredContent);
//   * names, slugs, verdicts, ranks and counts stay;
//   * a free key holding $10-pack credits keeps today's full answer;
//   * Developer and paid keys keep today's full answer.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'https://backend.free-numerics.test';
let S, TOOLS, realFetch;
let credits = 0;

const CANVAS = {
  ok: true, product: 'Site Selection Canvas', matched: 20, universe: 333, tier: 'FREE',
  inputs: { capacity_mw: 100, region: 'TX', max_months: null, verdicts: ['BUILD', 'CAUTION'], limit: 12 },
  shortlist: [
    { market: 'Midland–Odessa', slug: 'midland-tx', state: 'TX', iso: 'ERCOT', verdict: 'BUILD',
      excess_power_score: 85.7, constraint_score: 20.1, time_to_power_months: 9.6, composite_score: 83.8,
      dcpi_url: 'https://dchub.cloud/dcpi/midland-tx',
      verdict_reasons: [
        { code: 'EXCESS_POWER_MEETS_BUILD_FLOOR', component: 'excess_power_score', value: 85.7,
          threshold: 65.0, unit: 'index_0_100', affects: 'verdict',
          message: 'Excess-power score 85.7 meets the 65.0 floor the BUILD band requires.' },
        { code: 'TIME_TO_POWER', component: 'time_to_power_months', value: 9.6, threshold: 60.0,
          unit: 'months', affects: 'composite_rank',
          message: 'Time-to-power 9.6 months weights the composite rank (capped at 60.0).' },
      ] },
  ],
  synthesis: { locked: true, message: 'The decision layer is locked.' },
};
const DCPI_RANK = {
  id: 1375, market_slug: 'dallas', market_name: 'Dallas', state: 'TX', iso: 'ERCOT', verdict: 'CAUTION',
  excess_power_score: 55.1, constraint_score: 48.2, composite_score: 51.3, quality_score: 71.0,
  time_to_power_months: 26.4, queue_wait_months: 31.0, avg_kwh_cents: '10.309',
  emergency_count_30d: 0, published: true, latitude: 32.80085, longitude: -96.81941,
  forecast: { available: false, samples_in_30d: 0 },
};
const RANK_MARKETS = {
  criteria: 'best_overall', region: 'us', result_count: 3, tier: 'free',
  results: [
    { rank: 1, market: 'ashburn-va', city: 'Ashburn', state: 'VA', country: 'US', score: 91.2,
      total_mw: 5793, facility_count: 191, operator_count: 55, value: '191 fac / 5793 MW / 55 ops',
      url: 'https://dchub.cloud/markets/ashburn' },
    { rank: 2, market: 'dallas-tx', city: 'Dallas', state: 'TX', country: 'US', score: 77.4,
      total_mw: 1268, facility_count: 102, operator_count: 51, value: '102 fac / 1268 MW / 51 ops',
      url: 'https://dchub.cloud/markets/dallas' },
  ],
};

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (p.startsWith('/api/v1/site-selection/canvas')) return json(CANVAS);
    if (p.startsWith('/api/v1/dcpi/scores/')) return json(DCPI_RANK);
    if (p.startsWith('/api/v1/mcp/tools/rank_markets')) return json(RANK_MARKETS);
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits, had_pack: credits > 0 });
    return json({});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => { credits = 0; });

let seatN = 0;
const seat = (tier, key, extra = {}) => ({
  ...(key ? { api_key: key } : {}), tier, ...extra, platform: 'claude', client_name_raw: 'claude-ai',
  // a fresh identity per call, so a cached credit balance never crosses tests
  client_ip: '203.0.113.' + (10 + (seatN % 200)), session_id: 'sess-free-numerics-' + (++seatN),
});
async function call(name, args, s) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
// Both channels, parsed: the leading JSON of content[0] and structuredContent.
function channels(r) {
  const text = (r.content || []).map((c) => c.text || '').join('\n');
  let head = null;
  try { head = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { head = null; }
  if (!head) { try { head = JSON.parse(text); } catch { head = null; } }
  return { text, head, sc: r.structuredContent || {} };
}

const CASES = {
  site_selection_canvas: {
    args: { region: 'TX' },
    figures: ['85.7', '20.1', '9.6', '83.8'],
    rows: (p) => p.shortlist,
    kept: (p) => [p.shortlist[0].market, p.shortlist[0].verdict, p.matched],
    keptWant: ['Midland–Odessa', 'BUILD', 20],
  },
  get_market_dcpi_rank: {
    args: { market_slug: 'dallas' },
    figures: ['10.309', '55.1', '48.2', '51.3', '26.4'],
    rows: (p) => [p],
    kept: (p) => [p.market_slug, p.verdict, p.emergency_count_30d],
    keptWant: ['dallas', 'CAUTION', 0],
  },
  rank_markets: {
    args: {},
    figures: ['5793', '1268', '91.2', '77.4'],
    rows: (p) => p.results,
    kept: (p) => [p.results[0].market, p.results[0].facility_count, p.results[0].operator_count, p.results[0].rank],
    keptWant: ['ashburn-va', 191, 55, 1],
  },
};

// What a keyless caller actually is by the time a tool answers it. The canvas and
// the DCPI rank answer an anonymous seat; rank_markets walls one ("needs a free
// key") and the live keyless session reaches it on the auto-minted trial key.
const KEYLESS = {
  site_selection_canvas: () => seat('anonymous', null),
  get_market_dcpi_rank: () => seat('anonymous', null),
  rank_markets: () => seat('trial', 'dch_trial_free_numerics', { is_trial: true }),
};

describe.each(Object.keys(CASES))('%s — free tiers get names, verdicts and counts, not figures', (tool) => {
  const K = CASES[tool];

  it.each([['keyless', null, null], ['a free key', 'free', 'dch_live_free_numerics'],
           ['an identified key', 'identified', 'dch_live_identified_numerics']])(
    '★ %s: no figure in either channel', async (_label, tier, key) => {
      const r = await call(tool, K.args, tier ? seat(tier, key) : KEYLESS[tool]());
      const { text, head, sc } = channels(r);
      // not vacuous: the answer carries its rows (a wall would pass the checks below)
      expect([head, sc].some((p) => p && Array.isArray(K.rows(p)) && K.rows(p).length > 0),
        `${tool}: no rows came back at all — ${text.slice(0, 160)}`).toBe(true);
      const scText = JSON.stringify(sc);
      for (const f of K.figures) {
        expect(text, `${tool} content still carries ${f}`).not.toContain(f);
        expect(scText, `${tool} structuredContent still carries ${f}`).not.toContain(f);
      }
    });

  it('keeps the names, verdicts, ranks and counts', async () => {
    const r = await call(tool, K.args, seat('free', 'dch_live_free_numerics_kept'));
    const { head, sc } = channels(r);
    for (const p of [head, sc]) {
      if (!p || !K.rows(p)) continue;
      expect(K.kept(p)).toEqual(K.keptWant);
      for (const row of K.rows(p)) {
        const markers = Object.keys(row).filter((k) => k.endsWith('_in_pro'));
        expect(markers.length, `${tool} rows carry no _in_pro marker`).toBeGreaterThan(0);
      }
    }
  });

  it('a free key holding pack credits keeps today\'s full answer', async () => {
    credits = 500;
    const r = await call(tool, K.args, seat('free', 'dch_live_pack_holder_numerics'));
    const { text } = channels(r);
    expect(K.figures.some((f) => text.includes(f)), `${tool}: the pack holder lost the figures`).toBe(true);
  });

  it.each([['developer'], ['paid']])('a %s key keeps today\'s full answer', async (tier) => {
    const r = await call(tool, K.args, seat(tier, 'dch_live_' + tier + '_numerics'));
    const { text } = channels(r);
    expect(K.figures.some((f) => text.includes(f)), `${tool}: ${tier} lost the figures`).toBe(true);
  });
});

describe('the rank_markets display string keeps its counts', () => {
  it('"191 fac / 5793 MW / 55 ops" becomes "191 fac / 55 ops"', async () => {
    const r = await call('rank_markets', {}, KEYLESS.rank_markets());
    const { head, sc } = channels(r);
    expect([head, sc].filter((p) => p && Array.isArray(p.results)).length).toBeGreaterThan(0);
    for (const p of [head, sc]) {
      if (!p || !p.results) continue;
      expect(p.results[0].value).toBe('191 fac / 55 ops');
      expect(p.results[0].total_mw).toBeNull();
      expect(p.results[0]._total_mw_in_pro).toBe(true);
    }
  });
});
