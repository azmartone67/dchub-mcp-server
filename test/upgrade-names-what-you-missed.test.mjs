// upgrade-names-what-you-missed.test.mjs — r-missed-upgrade (2026-09-29, owner-approved)
//
// A masked or preview answer's upgrade prompt names what THIS answer hid and the
// lowest rung that returns it, instead of a generic plan list.
//
// MEASURED through the real handlers before this change (same harness as below):
//   get_interconnection_queue, free key  "🔒 Free tier: 3 of 10 results shown. Full set + every
//                                         premium tool: …" — capacity_mw, project_name and total_gw
//                                         were null and nothing said so
//   get_retirement_headroom, no key      "_upgrade.message": "Anonymous tier — aggregate metrics
//                                         masked. … call the claim_free_key tool" — a free key does
//                                         not return the MW; Developer does
//   get_gas_economics, no key            the same claim_free_key message over gas prices that are Pro
//
// Each family below runs the REAL registered handler under a real caller seat
// (_ctxALS) with only the backend stubbed, and checks two things per seat:
//   1. every field the prompt names was actually withheld in that response
//      (the backend sent a figure, the caller got null / a changed value), and
//      the prompt names no other field;
//   2. the rung the prompt names returns those fields when the handler is driven
//      at that rung, and the rung below it (when the caller is below it) does not.
// HARD gate: deterministic, no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { fieldLabel, collectMissed, missedSentence, lowestRung, rungFloor, rungSentence, RUNGS, missedUpgrade }
  from '../lib/upgrade-missed.mjs';

const BASE = 'https://backend.missed-upgrade.test';
let S, TOOLS, realFetch;
let creditsFor = {};

const QUEUE = { iso: 'ERCOT', total_projects: 78, total_gw: 412.5,
  projects: Array.from({ length: 10 }, (_, i) => ({ project_name: 'Proj ' + i, capacity_mw: 100 + i,
    fuel_type: 'Gas', status: 'active', state: 'TX', county: 'Harris' })) };
const DEALS = { transactions: Array.from({ length: 5 }, (_, i) => ({ name: 'Deal ' + i, buyer: 'B' + i,
  seller: 'S' + i, value: 1e9 + i, value_display: '$1.' + i + 'B', mw: 200 + i, date: '2026-0' + (i + 1) + '-01' })),
  total: 5, total_value: 5e9 };
const GAS_PRICING = { market_name: 'Dallas', henry_hub_spot_usd_mmbtu: 2.91, hub_spot_usd_mmbtu: 2.71,
  basis_diff_usd_mmbtu: -0.2, delivered_industrial_usd_mmbtu: 3.9, delivered_electric_usd_mmbtu: 3.1, fetched_at: '2026-09-28' };
const GAS_G2G = { gas_price_used_usd_mmbtu: 2.868,
  scenarios_usd_per_mwh: { avg_ccgt_6800_btu_kwh: 19.5, peaker_10000_btu_kwh: 28.68 },
  burner_tip: { usd_mmbtu: 2.868, monthly_min_usd_mmbtu: 1.9, monthly_max_usd_mmbtu: 4.1, window: 'ttm' } };
const RETIRE = { _entity: 'retirement_headroom_results', ok: true, total_retiring_mw: 1190.3, data: [
  { generator: { name: 'Zeta', generator_id: '1', capacity_mw: 812.4, retirement_date: '2026-12-31', fuel_category: 'Coal' },
    queue_pressure: { competing_mw: 4417.3, competing_projects: 12 } },
  { generator: { name: 'Alpha', generator_id: '2', capacity_mw: 377.9, retirement_date: '2026-12-31', fuel_category: 'Gas' },
    queue_pressure: { competing_mw: 2963.8, competing_projects: 9 } }] };
const SITE = { success: true, location: { lat: 39.04, lon: -77.48, state: 'VA' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, gas_pipeline_access: 71.3, fiber_connectivity: 95.4,
            market_conditions: 60.6, risk_resilience: 72.2 },
  power_cost: { industrial_cents_kwh: 8.37 }, nearby: { substations_50km: 212, total_capacity_mw: 8336.4 },
  fiber: { nearest_carrier_km: 0.41, carrier_count: 623 }, interpretation: 'Excellent site' };

const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const KEY_TIER = {};
let prevInternal, prevBase;
beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'missed-upgrade-test-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    let p = '', q = null; try { const u = new URL(url); p = u.pathname; q = u.searchParams; } catch { /* not a URL */ }
    if (p === '/api/v1/interconnection-queue/by-iso') return json(QUEUE);
    if (p === '/api/v1/deals') return json(structuredClone(DEALS));
    if (/\/gas-pricing$/.test(p)) return json(GAS_PRICING);
    if (/\/gas-to-grid$/.test(p)) return json(GAS_G2G);
    if (p === '/api/v1/retirement-headroom') return json(RETIRE);
    if (p === '/api/site-score') return json(SITE);
    if (p.startsWith('/api/v1/mcp/credits/balance')) {
      const k = (q && q.get('key')) || '';
      const cr = creditsFor[k] || 0;
      return json({ credits: cr, had_pack: cr > 0, lp_grandfathered: false });
    }
    if (p.startsWith('/api/v1/mcp/credits/burn')) return json({ ok: true });
    if (p === '/api/v1/keys/validate') {
      let k = ''; try { k = JSON.parse((init && init.body) || '{}').api_key || ''; } catch { /* ignore */ }
      return json({ valid: true, tier: KEY_TIER[k] || 'free', email: 'x@example.com' });
    }
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});
beforeEach(() => { creditsFor = {}; S.keyCache && S.keyCache.clear && S.keyCache.clear(); });

// ── seats ───────────────────────────────────────────────────────────────────
let n = 0;
// 'free' is a free key whose flagship allowance is spent: the counters are
// cleared per call and none of these tools grants a free key a full answer, so
// every free-key call here is the preview a spent key gets.
function seat(kind) {
  n += 1;
  const base = { platform: 'claude', client_name_raw: 'claude-code', client_ip: '198.51.100.' + (10 + (n % 200)),
    session_id: 'sess-missed-upgrade-' + n };
  const key = 'dch_live_missedup_' + kind + '_' + n;
  switch (kind) {
    case 'nokey': return { ...base, tier: 'free' };
    case 'free': return { ...base, api_key: key, tier: 'free' };
    case 'pack': creditsFor[key] = 1000; return { ...base, api_key: key, tier: 'identified' };
    case 'starter': return { ...base, api_key: key, tier: 'starter' };
    case 'developer': return { ...base, api_key: key, tier: 'developer' };
    case 'pro': return { ...base, api_key: key, tier: 'pro' };
    default: throw new Error(kind);
  }
}
async function call(name, args, s) {
  for (const m of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) if (m && m.clear) m.clear();
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error('zod rejected ' + name);
  const r = await S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
  const text = (r.content || []).map((c) => c.text || '').join('\n');
  return { r, text, all: text + '\n' + JSON.stringify(r.structuredContent || {}) };
}

// ── reading the prompt ──────────────────────────────────────────────────────
// Every "This answer hid …" sentence in the response (text and structured).
const HID_RE = /This answer (?:hid (.+?)(?:, and (\d+) more ([a-z]+))?|showed (\d+) of (\d+) ([a-z]+))\.\**\s+(The plans that return them are listed behind the link|They come with DC Hub Developer|They come with DC Hub Pro|A free DC Hub key|The payer checks out in one click: \*\*\$10)/g;
const RUNG_OF = { 'The plans that return them are listed behind the link': 'pack', 'They come with DC Hub Developer': 'developer',
  'They come with DC Hub Pro': 'pro', 'A free DC Hub key': 'free_key', 'The payer checks out in one click: **$10': 'pack' };
function prompts(all) {
  const out = [];
  const s = all.replace(/\\"/g, '"');
  for (const m of s.matchAll(HID_RE)) {
    const labels = [];
    let others = 0;
    if (m[1]) {
      for (const part of m[1].split(/, | and /)) {
        const o = /^(\d+) other fields?$/.exec(part);
        if (o) others += Number(o[1]); else if (part) labels.push(part);
      }
    }
    out.push({ labels, others, more: m[2] ? Number(m[2]) : null, rung: RUNG_OF[m[7]] });
  }
  return out;
}

// Keys whose figure the caller did NOT get as the backend sent it.
//   leaf:   the backend sent a value under this key and the response holds it
//           null, or the backend sent a number and the response a string;
//   object: a plain object whose every numeric member was withheld that way
//           (a masked table such as scenarios_usd_per_mwh or scores). An object
//           that kept any figure (nearby.substations_50km) is not "a field hid".
// Arrays are never a field; rows cut from them are the prompt's "N more" part.
function withheldKeys(backend, response) {
  const byKey = (o, acc = new Map()) => {
    if (Array.isArray(o)) { o.forEach((x) => byKey(x, acc)); return acc; }
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (!acc.has(k)) acc.set(k, []);
        acc.get(k).push(v);
        byKey(v, acc);
      }
    }
    return acc;
  };
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const objWithheld = (bo, ro) => {
    const nums = Object.entries(bo).filter(([, v]) => isNum(v));
    return nums.length > 0 && nums.every(([k, v]) => ro[k] === null || ro[k] !== v);
  };
  const b = byKey(backend), r = byKey(response);
  const out = new Set();
  // Owner 2026-10-08: the decision tools' taste withholds a field by LEAVING IT OUT beside its
  // `_<field>_in_pro: true` marker (never a null in place); a marker-backed absence is withheld.
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    for (const [k] of b) if (!r.has(k) && response['_' + k + '_in_pro'] === true) out.add(k);
  }
  for (const [k, rv] of r) {
    const bv = b.get(k);
    if (!bv) continue;
    const scalar = (v) => v !== null && v !== undefined && typeof v !== 'object';
    if (bv.some(scalar) && rv.some((v) => v === null)) out.add(k);                          // nulled
    if (bv.some(isNum) && rv.some((v) => scalar(v) && !isNum(v))) out.add(k);               // figure → prose
    const bObj = bv.find(plain), rObj = rv.find(plain);
    if (bObj && rObj && objWithheld(bObj, rObj)) out.add(k);
  }
  return out;
}
function responsePayload(res) {
  const sc = res.r.structuredContent;
  if (sc && typeof sc === 'object' && Object.keys(sc).length > 3) return sc;
  try { return JSON.parse((res.r.content || [])[0].text); } catch { return sc || {}; }
}
function expectNamesOnlyWithheld(res, backend, label) {
  const ps = prompts(res.all);
  expect(ps.length, `${label}: no "This answer hid" prompt — the checks below would be vacuous`).toBeGreaterThan(0);
  const withheld = withheldKeys(backend, responsePayload(res));
  const allowed = new Set([...withheld].map(fieldLabel));
  for (const p of ps) {
    expect(p.labels.length + (p.more || 0), `${label}: the prompt named nothing`).toBeGreaterThan(0);
    // "and N other fields" is a claim too: named + others cannot exceed what was withheld.
    expect(p.labels.length + p.others, `${label}: the prompt counts more withheld fields than this response withheld `
      + `(named ${p.labels.join(' | ')} + ${p.others} other; withheld: ${[...allowed].join(' | ')})`)
      .toBeLessThanOrEqual(allowed.size);
    for (const l of p.labels) {
      expect(allowed.has(l), `${label}: the prompt names "${l}", which this response did not withhold `
        + `(withheld: ${[...allowed].join(' | ')})`).toBe(true);
    }
  }
  return ps;
}
function expectFullFor(res, backend, keys, label) {
  const withheld = withheldKeys(backend, responsePayload(res));
  for (const k of keys) expect(withheld.has(k), `${label}: "${k}" is still withheld at this rung`).toBe(false);
  expect(prompts(res.all), `${label}: a full answer still carries a missed-upgrade prompt`).toEqual([]);
}
const RUNG_SEAT = { free_key: 'free', pack: 'pack', developer: 'developer', pro: 'pro' };
const BELOW = { pack: 'free', developer: 'pack', pro: 'developer' };
const RANK = { nokey: -1, free: 0, pack: 1, starter: 1.5, developer: 2, pro: 3 };
const RUNG_RANK = { free_key: 0, pack: 1, developer: 2, pro: 3 };

// One family: at each seat, the prompt names only withheld fields and a rung;
// that rung returns them; the rung below the named one (when above the caller)
// still withholds.
function family({ tool, args, backend, seats, keysOf, expectRung }) {
  describe(`${tool}`, () => {
    for (const kind of seats) {
      it(`${kind}: names only what this response withheld, and the lowest rung that returns it`, async () => {
        const res = await call(tool, args, seat(kind));
        const ps = expectNamesOnlyWithheld(res, backend, `${tool}@${kind}`);
        const rungs = new Set(ps.map((p) => p.rung));
        expect([...rungs], `${tool}@${kind}: one rung per response`).toHaveLength(1);
        const rung = [...rungs][0];
        expect(rung, `${tool}@${kind}`).toBe(expectRung[kind]);
        expect(RUNG_RANK[rung], `${tool}@${kind}: the rung named is one the caller already holds`)
          .toBeGreaterThan(RANK[kind]);
        // the named rung really returns what was named
        const keys = keysOf(responsePayload(res));
        expect(keys.length, `${tool}@${kind}: nothing to check at the rung`).toBeGreaterThan(0);
        const at = await call(tool, args, seat(RUNG_SEAT[rung]));
        expectFullFor(at, backend, keys, `${tool}@${rung}`);
        // …and the rung below it does not (so it is the LOWEST), when the caller is below that
        const below = BELOW[rung];
        if (below && RANK[below] >= RANK[kind]) {
          const b = await call(tool, args, seat(below));
          const still = withheldKeys(backend, responsePayload(b));
          expect(keys.some((k) => still.has(k)), `${tool}@${below}: the rung below ${rung} already returns `
            + `everything, so ${rung} is not the lowest`).toBe(true);
        }
      });
    }
  });
}

describe('r-missed-upgrade: the prompt names what this answer hid and the lowest rung', () => {
  family({
    tool: 'get_interconnection_queue', args: { iso: 'ERCOT' }, backend: QUEUE,
    seats: ['nokey', 'free'],
    keysOf: (p) => [...withheldKeys(QUEUE, p)],
    // Owner 2026-10-08: preview-only on every non-paid seat, the pack included → Developer.
    expectRung: { nokey: 'developer', free: 'developer' },
  });
  family({
    tool: 'list_transactions', args: {}, backend: DEALS,
    seats: ['nokey', 'free'],
    keysOf: (p) => [...withheldKeys(DEALS, p)],
    expectRung: { nokey: 'pack', free: 'pack' },
  });
  family({
    tool: 'get_retirement_headroom', args: { target_mw: 50, horizon_months: 18 }, backend: RETIRE,
    // ladder stage 1 (2026-09-29): the $10 pack is Developer depth per call and opens
    // the MW, so it is the lowest rung below Developer; a pack holder sees it all
    // (no prompt). A grandfathered Starter key is past the pack: Developer.
    seats: ['nokey', 'free', 'starter'],
    keysOf: (p) => [...withheldKeys(RETIRE, p)],
    expectRung: { nokey: 'pack', free: 'pack', starter: 'developer' },
  });
  family({
    tool: 'get_gas_economics', args: { market: 'dallas' }, backend: { ...GAS_PRICING, ...GAS_G2G },
    seats: ['nokey'],
    keysOf: (p) => [...withheldKeys({ ...GAS_PRICING, ...GAS_G2G }, p)],
    expectRung: { nokey: 'pro' },
  });
  family({
    tool: 'analyze_site', args: { lat: 39.04, lon: -77.48 }, backend: SITE,
    seats: ['free', 'pack', 'starter'],
    keysOf: (p) => [...withheldKeys(SITE, p)],
    expectRung: { free: 'pro', pack: 'pro', starter: 'pro' },
  });

  it('the queue prompt reads as intended (the withheld section, then Developer — never the pack)', async () => {
    // Owner 2026-10-08: the queue is a labelled taste on every non-paid seat — the project rows
    // are withheld whole (no 3-row sample to count "more" from), and the lowest rung that
    // returns them is Developer; the $10 pack is never named as what returns them.
    const res = await call('get_interconnection_queue', { iso: 'ERCOT' }, seat('free'));
    const [p] = prompts(res.all);
    expect(p.labels).toEqual(expect.arrayContaining(['projects']));
    expect(p.rung).toBe('developer');
    expect(res.text).toMatch(/🔒 \*\*This answer hid projects\.\*\* They come with DC Hub Developer → https:\/\/dchub\.cloud\/go\/c\//);
    expect(res.text).not.toMatch(/\$10 one-time/);
  });

  it('keyed gas masks stay a mask: no prompt is invented where the answer had none', async () => {
    for (const kind of ['free', 'pack', 'starter']) {
      const res = await call('get_gas_economics', { market: 'dallas' }, seat(kind));
      expect(prompts(res.all), kind).toEqual([]);
    }
  });

  it('no monthly price anywhere in the new copy', async () => {
    for (const r of RUNGS) expect(rungSentence(r.id)).not.toMatch(/\/\s*mo\b|month|\$\d+\s*(?:\/|per)/i);
    const res = await call('get_retirement_headroom', { target_mw: 50, horizon_months: 18 }, seat('free'));
    expect(res.all).not.toMatch(/\$\d+(?:\.\d+)?\s*\/\s*mo\b|\$\d+(?:\.\d+)?\s*(?:per|a)\s*month/i);
  });
});

describe('lib/upgrade-missed.mjs', () => {
  it('names markers and logged keys only, and falls back to null when nothing is known', () => {
    expect(collectMissed({ a: 1, b: null }, [])).toBeNull();
    const m = collectMissed({ _locked_fields: ['data[].generator.capacity_mw'], x: { _project_name_in_pro: true },
      rows: [1, 2, 3], _rows_total_in_pro: 10 }, ['total_gw']);
    expect(m.labels).toEqual(['capacity (MW)', 'project names', 'total GW']);
    expect(m.rows).toEqual({ field: 'rows', shown: 3, total: 10 });
    expect(missedSentence(m, 'get_interconnection_queue'))
      .toBe('This answer hid capacity (MW), project names and total GW, and 7 more projects.');
  });

  it('lowestRung: the first rung at or above the floor where EVERY gate opens; null when none or unknown', () => {
    const devPlus = (s) => s.tier === 'developer' || s.tier === 'pro';
    const paying = (s) => s.credits > 0 || s.tier !== 'free';
    expect(lowestRung({ opens: [paying], floor: 0 })).toBe('pack');
    expect(lowestRung({ opens: [paying, devPlus], floor: 0 })).toBe('developer');
    expect(lowestRung({ opens: [paying], floor: 2 })).toBe('developer');
    expect(lowestRung({ opens: [() => false], floor: 0 })).toBeNull();
    expect(lowestRung({ opens: [], floor: 0 })).toBeNull();
    expect(missedUpgrade({ payload: { _x_in_pro: true }, opens: [] })).toBeNull();   // generic copy stays
  });

  it('rungFloor: a caller is never offered a rung it holds', () => {
    expect(rungFloor({ keyed: false })).toBe(0);
    expect(rungFloor({ keyed: true, tier: 'free' })).toBe(1);
    expect(rungFloor({ keyed: true, tier: 'identified', credits: 5 })).toBe(2);
    expect(rungFloor({ keyed: true, tier: 'starter' })).toBe(2);
    expect(rungFloor({ keyed: true, tier: 'developer' })).toBe(3);
    expect(rungFloor({ keyed: true, tier: 'pro' })).toBe(4);
  });
});
