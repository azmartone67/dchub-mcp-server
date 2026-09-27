// rank-markets-value-strip.test.mjs — r-value-strip (2026-09-27).
//
// Measured live 2026-09-27 08:57 UTC, anonymous POST /mcp rank_markets
// {criteria:"ai_ready"}: score, excess_power_score and time_to_power_months
// were null on every row, and the row's display string sat beside them with
// the number: "value":"BUILD · 86.4 excess-power · ~9mo to power", in both
// the text and the structuredContent channel.
//
// Policy (owner, 2026-09-24): MW and the DCPI scores stay paid; the free tiers
// get `score` only on most_operators / fastest_growing. So `value` keeps its
// free words only. Runs the REAL registered handler under real caller seats
// with only the backend stubbed, and pins trimForTrial / _freeRankValue
// directly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'https://backend.value-strip.test';
let S, TOOLS, realFetch;

const dcpiRow = (rank, market, verdict, excess, ttp, composite) => ({
  rank, market, metro_slug: market, city: market, state: 'TX', iso: 'ERCOT', country: 'US',
  score: composite, value: `${verdict} · ${excess} excess-power · ~${Math.trunc(ttp)}mo to power`,
  dcpi_verdict: verdict, excess_power_score: excess, constraint_score: 20.1,
  time_to_power_months: ttp, avg_kwh_cents: 10.312, signal_tier: 'full',
  as_of: '2026-09-27T06:37:09.940750+00:00', url: `https://dchub.cloud/dcpi/${market}`,
});
const buildRow = (rank, market, fac, mw, ops, score, value) => ({
  rank, market, metro_slug: market.replace(/-[a-z]{2}$/, ''), city: market, state: 'VA', country: 'US',
  score, value, total_mw: mw, facility_count: fac, operator_count: ops,
  url: `https://dchub.cloud/markets/${market}`,
});
// Shaped like the live payloads.
const PAYLOADS = {
  ai_ready: [dcpiRow(1, 'midland-tx', 'BUILD', 86.4, 9.6, 84.2), dcpiRow(2, 'odessa-tx', 'BUILD', 71.1, 8.2, 76.9)],
  best_overall: [buildRow(1, 'ashburn-va', 191, 5793, 55, 8887.2, '191 fac / 5793 MW / 55 ops')],
  most_capacity: [buildRow(1, 'ashburn-va', 191, 5793, 55, 5793.0, '5793 MW')],
  cheapest_power: [buildRow(1, 'ashburn-va', 191, 5793, 55, 5793.0, '~$13.04/MWh')],
  most_operators: [buildRow(1, 'ashburn-va', 191, 5793, 55, 55.0, '55 operators')],
};
const WANT = {
  ai_ready: ['BUILD', 'BUILD'],
  best_overall: ['191 fac / 55 ops'],
  most_capacity: [''],
  cheapest_power: [''],
  most_operators: ['55 operators'],
};
// the figures each criteria's value must not carry for a free caller
const HIDDEN = {
  ai_ready: ['86.4', '71.1', '~9mo', '~8mo'],
  best_overall: ['5793'],
  most_capacity: ['5793'],
  cheapest_power: ['13.04'],
  most_operators: [],
};

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let u = null; try { u = new URL(url); } catch { /* not a URL */ }
    const p = u ? u.pathname : '';
    if (p.startsWith('/api/v1/mcp/tools/rank_markets')) {
      const criteria = u.searchParams.get('criteria');
      return json({ criteria, region: 'us', result_count: PAYLOADS[criteria].length,
        results: PAYLOADS[criteria].map((r) => ({ ...r })) });
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
  client_ip: '198.51.100.' + (10 + (seatN % 200)), session_id: 'sess-value-strip-' + (++seatN),
});
const FREE_SEATS = {
  // A seat with no key at all hits the claim-a-key wall in this harness (live
  // it auto-mints a trial key first), so the keyless path runs as that trial seat.
  keyless: () => seat('trial', 'dch_trial_value_strip', { is_trial: true }),
  'a free key': () => seat('free', 'dch_live_free_value_strip'),
  'an identified key': () => seat('identified', 'dch_live_identified_value_strip'),
};
async function call(criteria, s) {
  const T = TOOLS.rank_markets;
  const parsed = await T.inputSchema.safeParseAsync({ criteria, region: 'us', limit: 2 });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
function resultSets(r) {
  const text = (r.content || []).map((c) => c.text || '').join('\n');
  const sets = [];
  try { const h = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); if (Array.isArray(h.results)) sets.push(h.results); } catch { /* no JSON head */ }
  const sc = r.structuredContent || {};
  if (Array.isArray(sc.results)) sets.push(sc.results);
  return { sets, text, sc: JSON.stringify(sc) };
}

describe.each(Object.keys(FREE_SEATS))('%s', (label) => {
  it.each(Object.keys(PAYLOADS))('★ %s: value keeps only its free words, in both channels', async (criteria) => {
    const { sets, text, sc } = resultSets(await call(criteria, FREE_SEATS[label]()));
    expect(sets.length, `no rows came back — ${text.slice(0, 160)}`).toBeGreaterThan(0);
    for (const rows of sets) {
      expect(rows.map((r) => r.value)).toEqual(WANT[criteria].slice(0, rows.length));
    }
    for (const fig of HIDDEN[criteria]) {
      expect(text, `text channel still carries ${fig}`).not.toContain(fig);
      expect(sc, `structuredContent still carries ${fig}`).not.toContain(fig);
    }
  });
});

describe('paid callers are untouched', () => {
  it.each([['developer'], ['paid']])('%s keeps the full value string', async (tier) => {
    for (const criteria of Object.keys(PAYLOADS)) {
      const { sets } = resultSets(await call(criteria, seat(tier, 'dch_live_' + tier + '_value_strip')));
      expect(sets.length).toBeGreaterThan(0);
      for (const rows of sets) expect(rows.map((r) => r.value)).toEqual(PAYLOADS[criteria].map((r) => r.value));
    }
  });
});

// trimForTrial strips the DCPI string only. It keeps total_mw typed on purpose
// (test/typed-preview-rank-markets.test.mjs), so its MW value strings agree
// with a published total_mw; the free-tier gate above withholds both.
describe('trimForTrial (the keyless preview trims)', () => {
  it('ai_ready: value is the verdict only', () => {
    const out = S.trimForTrial({ criteria: 'ai_ready', region: 'us', results: PAYLOADS.ai_ready.map((r) => ({ ...r })) }, 'rank_markets');
    expect(out.results.map((r) => r.value)).toEqual(WANT.ai_ready);
    expect(JSON.stringify(out)).not.toContain('86.4');
  });
  it.each(['best_overall', 'most_capacity', 'most_operators'])('%s: value untouched (total_mw is typed here)', (criteria) => {
    const out = S.trimForTrial({ criteria, region: 'us', results: PAYLOADS[criteria].map((r) => ({ ...r })) }, 'rank_markets');
    expect(out.results.map((r) => r.value)).toEqual(PAYLOADS[criteria].map((r) => r.value));
  });
});

describe('_freeRankValue', () => {
  it.each([
    ['BUILD · 86.4 excess-power · ~9mo to power', 'BUILD'],
    ['CAUTION · 55 excess-power · time-to-power n/a', 'CAUTION · time-to-power n/a'],
    ['UNSCORED · None excess-power · time-to-power n/a', 'UNSCORED · None excess-power · time-to-power n/a'],
    ['191 fac / 5793 MW / 55 ops', '191 fac / 55 ops'],
    ['5793 MW', ''],
    ['~$13.04/MWh', ''],
    ['55 operators', '55 operators'],
    ['191 facilities', '191 facilities'],
  ])('%j -> %j', (inp, want) => {
    expect(S._freeRankValue(inp)).toBe(want);
  });
});
