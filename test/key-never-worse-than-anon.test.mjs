// key-never-worse-than-anon.test.mjs — P0-3 / P0-5 (owner D2, 2026-10-03).
//
// MEASURED live 2026-10-03 (UA dchub-qa-readonly, X-DCHub-QA: 1): anonymous
// get_market_dcpi_rank returned composite_score_band; a free key returned it
// null. The keyless trim (trimForTrial) leaves a BAND beside each masked score;
// the keyed free mask (_gateToolNumerics → _nullFreeFigures) left none. A key
// was worse than no key.
//
// Owner D2: verdict + composite_score (+ composite_score_band) are free on every
// surface; excess_power_score, constraint_score, time_to_power_months, queue
// wait, kWh, narrative and forecast stay below Developer / pack.
//
// WHAT THIS PINS, through the REAL registered handlers under a real caller seat
// (_ctxALS), only the backend stubbed:
//   1. get_market_dcpi_rank phoenix: keyless AND free key return the numeric
//      composite, its band (the verdict), and no sub-score / kWh figure.
//   2. The generic helper: for each tool in PARITY_TOOLS, every non-null DATA key
//      path a keyless caller gets, a free key also gets non-null.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'https://backend.key-never-worse.test';
let S, TOOLS, realFetch;

// Phoenix as the backend answers the server's internal key (full row).
const PHX = {
  id: 1346, market_slug: 'phoenix', market_name: 'Phoenix', state: 'AZ', iso: 'WECC', verdict: 'CAUTION',
  excess_power_score: 58.2, constraint_score: 62.1, composite_score: 41.9, quality_score: 88.0,
  time_to_power_months: 42.5, queue_wait_months: 41.5, avg_kwh_cents: '13.024', emergency_count_30d: 0,
  published: true, latitude: 33.4484, longitude: -112.07067, signal_tier: 'partial',
  top_risks_json: ['42-month interconnection queue'], top_opportunities_json: ['500 MW behind-the-meter headroom'],
  forecast: {
    available: true, method: 'linear_regression', samples_in_30d: 30,
    trend_per_day: { excess_power_score: -0.37, constraint_score: 0.21, time_to_power_months: null },
    projection: {
      '3mo': { excess_power_score: 52.3, constraint_score: 64.4, implied_verdict: 'CAUTION', verdict_change_from_now: false },
      '6mo': { excess_power_score: 44.1, constraint_score: 71.2, implied_verdict: 'AVOID', verdict_change_from_now: true },
    },
  },
};
const SUB_FIGURES = ['58.2', '62.1', '42.5', '41.5', '13.024', '52.3', '64.4', '44.1', '71.2'];
const FACILITY = {
  id: 'fac_77', slug: 'sweep-dc-77', name: 'Sweep DC 77', operator: 'Equinix', provider: 'Equinix',
  city: 'Phoenix', state: 'AZ', country: 'US', market: 'phoenix', status: 'operational',
  latitude: 33.451234, longitude: -112.071234, power_mw: 48.5, square_feet: 250000, pue: 1.31,
  year_built: 2019, tier_level: 'III', url: 'https://dchub.cloud/facility/sweep-dc-77',
};
// The live /api/v1/markets/<slug> shape (measured 2026-10-03): counts, cities,
// broker pricing, recent facilities and a DCPI verdict, no DCPI score.
const MARKET = {
  _gated: false, as_of: '2026-09-26', by_status: { Announced: 35, Operational: 190 },
  market: { id: 'phoenix', name: 'Phoenix', cities: ['Phoenix', 'Mesa', 'Tempe', 'Chandler', 'Goodyear'] },
  recent_facilities: [{ id: 14042410, name: 'Evocative Phoenix', city: 'Phoenix', power_mw: 12.5, status: 'Announced' },
                      { id: 13865967, name: 'Apple Mesa', city: 'Mesa', power_mw: null, status: 'Announced' }],
  dcpi: { verdict: 'CAUTION', url: 'https://dchub.cloud/dcpi/phoenix' },
};
const SITE = {
  ok: true, lat: 33.45, lon: -112.07, verdict: 'CAUTION', composite_score: 63.4, overall_score: 63.4,
  limiting_factor: { factor: 'water', score: 41.0 },
  scores: { power: 70.2, fiber: 66.1, water: 41.0, risk: 58.3 },
  nearest_substation: { distance_miles: 2.4, kv_band: '230kV+' },
};

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (!url.startsWith(BASE)) throw new Error('network fence: ' + url);
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: 0, had_pack: false });
    if (p.startsWith('/api/v1/dcpi/scores/')) return json(PHX);
    if (p.startsWith('/api/v1/facilities/') || p.startsWith('/api/v1/facility/')) return json(FACILITY);
    if (p.startsWith('/api/v1/markets/')) return json(MARKET);
    if (/site|analy/.test(p)) return json(SITE);
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
// Live keyless /mcp seats resolve to tier 'free' with no api_key (measured:
// quota.tier "free" on the anonymous phoenix call); 'anonymous' is the other
// spelling the server accepts. Both are covered.
const seat = (tier, key) => ({
  ...(key ? { api_key: key } : {}), tier, platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '198.51.100.' + (10 + (seatN % 200)), session_id: 'sess-key-never-worse-' + (++seatN),
});
const KEYLESS = [['keyless (tier free, no key)', () => seat('free', null)],
                 ['keyless (tier anonymous)', () => seat('anonymous', null)]];
const KEYED = () => seat('free', 'dch_live_key_never_worse_' + (++seatN));

async function call(name, args, s) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
function head(r) {
  const text = (r.content || []).map((c) => c.text || '').join('\n');
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { /* fallthrough */ }
  try { return JSON.parse(text); } catch { return null; }
}

// ── the generic helper ───────────────────────────────────────────────────────
// Envelope, not data: seat-specific upsell, quota, identity and PREVIEW blocks
// differ by design between a keyless and a keyed seat (a key has no
// claim_free_key step, and a keyless preview describes its own trim in
// continuation / next_session / provenance.preview*). Every `_`-prefixed key is
// a marker or note about gating, never backend data.
const ENVELOPE = new Set(['quota', 'identity', 'tier', 'upgrade_url', 'next_tool', 'next_tool_hint',
  'next_ask', 'note', 'nudge', 'unlock', 'upgrade', 'for_your_human', 'citation', 'cite_as',
  'retrieved_at', 'served_at', 'generated_at', 'session', 'connect_url', 'pricing_url',
  'continuation', 'next_session', 'platform', 'tool', 'trial_preview', 'preview_is_partial',
  'preview', 'preview_warning']);
export function nonNullDataPaths(o, path = '', out = new Set()) {
  if (o === null || o === undefined) return out;
  if (Array.isArray(o)) { o.forEach((v) => nonNullDataPaths(v, path + '[]', out)); return out; }
  if (typeof o !== 'object') { out.add(path); return out; }
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('_') || ENVELOPE.has(k)) continue;
    nonNullDataPaths(v, path ? path + '.' + k : k, out);
  }
  return out;
}
export function missingForKey(anonPayload, keyedPayload) {
  const keyed = nonNullDataPaths(keyedPayload);
  return [...nonNullDataPaths(anonPayload)].filter((p) => !keyed.has(p)).sort();
}

const COMPARED = { n: 0 };
const WALLS = [];
const PARITY_TOOLS = {
  get_market_dcpi_rank: { market_slug: 'phoenix' },
  get_facility: { facility_id: 'fac_77' },
  get_market_intel: { market: 'phoenix' },
  analyze_site: { lat: 33.45, lon: -112.07 },
};

describe('P0-3: get_market_dcpi_rank phoenix, composite free, sub-scores withheld', () => {
  it.each([...KEYLESS, ['a free key', KEYED]])('%s', async (_label, mk) => {
    const r = await call('get_market_dcpi_rank', { market_slug: 'phoenix' }, mk());
    for (const p of [head(r), r.structuredContent]) {
      if (!p || p.market_slug !== 'phoenix') continue;
      expect(p.verdict).toBe('CAUTION');
      expect(p.composite_score).toBe(41.9);
      expect(p.composite_score_band).toBe('CAUTION');
      for (const k of ['excess_power_score', 'constraint_score', 'time_to_power_months',
                       'queue_wait_months', 'avg_kwh_cents']) {
        expect(p[k], `${k} leaked`).toBeNull();
      }
    }
    const text = (r.content || []).map((c) => c.text || '').join('\n') + JSON.stringify(r.structuredContent || {});
    for (const f of SUB_FIGURES) {
      expect(new RegExp(`(?<![\\d.])${f.replace('.', '\\.')}(?!\\d)`).test(text), `figure ${f} leaked`).toBe(false);
    }
    expect(text).toContain('41.9');
  });
});

describe('P0-3: the keyless trim on its own withholds kWh sent as a string', () => {
  // The handler path above also runs _gateToolNumerics, which nulls the string;
  // a caller seat that skips that gate (a pack balance read) got "13.024" live.
  it('trimForTrial nulls avg_kwh_cents "13.024" and keeps the composite', () => {
    const out = S.trimForTrial(JSON.parse(JSON.stringify(PHX)), 'get_market_dcpi_rank');
    expect(out.avg_kwh_cents).toBeNull();
    expect(out._avg_kwh_cents_in_pro).toBe(true);
    expect(out.composite_score).toBe(41.9);
    expect(out.composite_score_band).toBe('CAUTION');
    expect(out.excess_power_score).toBeNull();
  });
});

describe('P0-5: a free key carries every non-null field the keyless answer carries', () => {
  it('the helper is not vacuous: it reports a field the key lost', () => {
    expect(missingForKey({ a: 1, b: { c: 'x' }, _m: true }, { a: 1, b: { c: null } })).toEqual(['b.c']);
    expect(missingForKey({ a: 1 }, { a: 1, extra: 2 })).toEqual([]);
  });

  describe.each(Object.keys(PARITY_TOOLS))('%s', (tool) => {
    it.each(KEYLESS)('free key ⊇ %s', async (_label, mkAnon) => {
      const anon = await call(tool, PARITY_TOOLS[tool], mkAnon());
      const keyed = await call(tool, PARITY_TOOLS[tool], KEYED());
      // A keyless WALL (no JSON: analyze_site, and the 'anonymous' spelling on
      // some tools) carries no data, so a key cannot be worse than it.
      // Its structuredContent is then the wall's own envelope (error,
      // current_tier, copy_version), not data.
      const a = head(anon);
      if (!a) { WALLS.push(`${tool} / ${_label}`); return; }
      const k = head(keyed) || {};
      COMPARED.n += nonNullDataPaths(a).size + nonNullDataPaths(anon.structuredContent || {}).size;
      expect(missingForKey(a, k), `${tool}: keyed lost keyless fields`).toEqual([]);
      expect(missingForKey(anon.structuredContent || {}, keyed.structuredContent || {}),
        `${tool}: keyed structuredContent lost keyless fields`).toEqual([]);
    });
  });

  it("get_market_dcpi_rank: the free key's composite and band equal the keyless values", async () => {
    const a = head(await call('get_market_dcpi_rank', { market_slug: 'phoenix' }, seat('free', null)));
    const k = head(await call('get_market_dcpi_rank', { market_slug: 'phoenix' }, KEYED()));
    expect(k.composite_score).toBe(a.composite_score);
    expect(k.composite_score_band).toBe(a.composite_score_band);
    expect(k.composite_score).toBe(41.9);
    expect(k.composite_score_band).toBe('CAUTION');
  });
});

// Last, so it reads the totals: the sweep above compared real keyless data, not
// a set of walls (measured 2026-10-03: 227 keyless data paths across the four).
describe('P0-5 sweep is not vacuous', () => {
  it('compared at least 150 keyless data paths, and walled only where expected', () => {
    expect(COMPARED.n).toBeGreaterThan(150);
    // analyze_site keyless returns no site data (owner, until B2 on 2026-10-19)
    expect(WALLS.filter((w) => !w.startsWith('analyze_site') && !w.includes('anonymous'))).toEqual([]);
  });
});
