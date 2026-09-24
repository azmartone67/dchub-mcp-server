// rank-markets-count-sort-score.test.mjs — r-score-count-sorts (2026-09-24).
//
// After dchub-backend#5408, rank_markets' `score` is the value the ranking is
// sorted by. On most_operators it IS operator_count, and on fastest_growing it
// IS facility_count. Both counts are free, so the free tiers now get `score`
// on those two sorts. Every other sort keeps it null: best_overall /
// most_capacity / cheapest_power are MW, and ai_ready is the DCPI composite.
//
// Runs the REAL registered handler (createServer()._registeredTools) under real
// caller seats, with only the backend stubbed; those keyed seats are gated by
// _gateToolNumerics. The keyless preview trims (trimForTrial) are pinned
// directly at the bottom of this file.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'https://backend.count-sort-score.test';
let S, TOOLS, realFetch;

const row = (rank, market, fac, mw, ops, score) => ({
  rank, market, metro_slug: market.replace(/-[a-z]{2}$/, ''), city: market, state: 'VA', country: 'US',
  score, total_mw: mw, facility_count: fac, operator_count: ops, value: 'v',
  url: `https://dchub.cloud/markets/${market}`,
});
// Shaped like the live payloads, measured 2026-09-24.
const PAYLOADS = {
  most_operators: [row(1, 'ashburn-va', 191, 5793, 55, 55.0), row(2, 'dallas-tx', 102, 1268, 51, 51.0)],
  fastest_growing: [row(1, 'ashburn-va', 191, 5793, 55, 191.0), row(2, 'sterling-va', 116, 2652, 19, 116.0)],
  best_overall: [row(1, 'ashburn-va', 191, 5793, 55, 8887.2), row(2, 'dallas-tx', 102, 1268, 51, 5097.2)],
  most_capacity: [row(1, 'ashburn-va', 191, 5793, 55, 5793.0), row(2, 'sterling-va', 116, 2652, 19, 2652.0)],
  cheapest_power: [row(1, 'ashburn-va', 191, 5793, 55, 5793.0), row(2, 'sterling-va', 116, 2652, 19, 2652.0)],
  ai_ready: [row(1, 'midland-tx', 12, 300, 6, 84.2), row(2, 'williston-nd', 4, 90, 3, 76.9)],
  // fail-closed: a count sort whose score no longer equals its count
  drifted: [row(1, 'ashburn-va', 191, 5793, 55, 8887.2)],
};
const SCORE_BASIS = 'score is the value the results are sorted by, as described in methodology '
  + '(not a 0-100 scale, not rank-derived); it does not change with limit.';

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let u = null; try { u = new URL(url); } catch { /* not a URL */ }
    const p = u ? u.pathname : '';
    if (p.startsWith('/api/v1/mcp/tools/rank_markets')) {
      const asked = u.searchParams.get('criteria');
      // 'drifted' is served as most_operators with a score that is not the count
      const criteria = asked === 'drifted' ? 'most_operators' : asked;
      return json({ criteria, region: 'us', result_count: 2, score_basis: SCORE_BASIS,
        results: PAYLOADS[asked] });
    }
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

let seatN = 0;
const seat = (tier, key, extra = {}) => ({
  ...(key ? { api_key: key } : {}), tier, ...extra, platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '203.0.113.' + (10 + (seatN % 200)), session_id: 'sess-count-sort-' + (++seatN),
});
const FREE_SEATS = {
  keyless: () => seat('trial', 'dch_trial_count_sort', { is_trial: true }),
  'a free key': () => seat('free', 'dch_live_free_count_sort'),
  'an identified key': () => seat('identified', 'dch_live_identified_count_sort'),
};
async function call(criteria, s) {
  const T = TOOLS.rank_markets;
  const parsed = await T.inputSchema.safeParseAsync({ criteria, region: 'us', limit: 2 });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
// Every results[] the answer carries, from both channels.
function resultSets(r) {
  const text = (r.content || []).map((c) => c.text || '').join('\n');
  const sets = [];
  try { const h = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); if (Array.isArray(h.results)) sets.push(h.results); } catch { /* no JSON head */ }
  const sc = r.structuredContent || {};
  if (Array.isArray(sc.results)) sets.push(sc.results);
  return { sets, text };
}

describe.each(Object.keys(FREE_SEATS))('%s', (label) => {
  it.each([['most_operators', 'operator_count', [55, 51]], ['fastest_growing', 'facility_count', [191, 116]]])(
    '★ %s: score is published and equals %s', async (criteria, countKey, want) => {
      const { sets, text } = resultSets(await call(criteria, FREE_SEATS[label]()));
      expect(sets.length, `no rows came back — ${text.slice(0, 160)}`).toBeGreaterThan(0);
      for (const rows of sets) {
        expect(rows.map((r) => r.score)).toEqual(want);
        for (const r of rows) {
          expect(r.score).toBe(r[countKey]);
          expect(r._score_in_pro).toBeUndefined();
          expect(r.score_band).toBeUndefined();
          // the MW gate from #502 is untouched on the same rows
          expect(r.total_mw).toBeNull();
        }
      }
    });

  it.each([['best_overall'], ['most_capacity'], ['cheapest_power'], ['ai_ready']])(
    '%s: score stays null', async (criteria) => {
      const { sets, text } = resultSets(await call(criteria, FREE_SEATS[label]()));
      expect(sets.length, `no rows came back — ${text.slice(0, 160)}`).toBeGreaterThan(0);
      for (const rows of sets) for (const r of rows) {
        expect(r.score).toBeNull();
        expect(r._score_in_pro).toBe(true);
      }
      for (const v of PAYLOADS[criteria].map((r) => r.score)) expect(text).not.toContain(String(v));
    });

  it('a count sort whose score is NOT its count stays null (fail closed)', async () => {
    const { sets, text } = resultSets(await call('drifted', FREE_SEATS[label]()));
    expect(sets.length).toBeGreaterThan(0);
    for (const rows of sets) for (const r of rows) expect(r.score).toBeNull();
    expect(text).not.toContain('8887.2');
  });
});

describe('paid callers are untouched', () => {
  it.each([['developer'], ['paid']])('%s keeps every score', async (tier) => {
    for (const criteria of ['ai_ready', 'most_operators']) {
      const { sets } = resultSets(await call(criteria, seat(tier, 'dch_live_' + tier + '_count_sort')));
      expect(sets.length).toBeGreaterThan(0);
      for (const rows of sets) expect(rows.map((r) => r.score)).toEqual(PAYLOADS[criteria].map((r) => r.score));
    }
  });
});

// The keyless preview, the capped preview and the depleted-pack teaser trim
// with trimForTrial rather than _gateToolNumerics, so it carries the same rule.
describe('trimForTrial (the keyless preview trims)', () => {
  const payload = (criteria, rows) => ({ criteria, region: 'us', result_count: rows.length,
    score_basis: SCORE_BASIS, results: rows.map((r) => ({ ...r })) });

  it.each([['most_operators', [55, 51]], ['fastest_growing', [191, 116]]])(
    '★ %s: score survives the trim', (criteria, want) => {
      const out = S.trimForTrial(payload(criteria, PAYLOADS[criteria]), 'rank_markets');
      expect(out.results.map((r) => r.score)).toEqual(want);
      for (const r of out.results) { expect(r._score_in_pro).toBeUndefined(); expect(r.score_band).toBeUndefined(); }
      expect(out.score_basis).toBe(SCORE_BASIS);
    });

  it.each([['best_overall'], ['most_capacity'], ['cheapest_power'], ['ai_ready']])(
    '%s: score stays null', (criteria) => {
      const out = S.trimForTrial(payload(criteria, PAYLOADS[criteria]), 'rank_markets');
      for (const r of out.results) expect(r.score).toBeNull();
    });

  it('a count sort whose score is not its count stays null', () => {
    const out = S.trimForTrial(payload('most_operators', PAYLOADS.drifted), 'rank_markets');
    expect(out.results[0].score).toBeNull();
  });

  it('only rank_markets: another tool with the same payload keeps score null', () => {
    const out = S.trimForTrial(payload('most_operators', PAYLOADS.most_operators), 'search_facilities');
    for (const r of out.results) expect(r.score).toBeNull();
  });
});
