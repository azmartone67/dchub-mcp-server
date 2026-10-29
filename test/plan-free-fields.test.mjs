// plan-free-fields.test.mjs — QA B P1 (2026-10-19), owner rule 2026-10-10.
//
// QA: "Anonymous find_sites and canvas responses carry _required_tier 'pro' and *_total_in_pro fields.
// That names a plan to agents." The trimmers mark what they withheld with names that carry a plan, and the
// server reads those names internally, so the rewrite is the LAST step (lib/plan-free-fields.mjs):
//   _<k>_in_pro -> _<k>_withheld, _<k>_total_in_pro -> _<k>_total_available, plan-only keys dropped.
//
// This test reads the FINAL serialised result (content JSON + structuredContent) of the real registered
// handlers, and proves it is not vacuous: the same fixture run with the step switched off carries the
// plan-naming keys, so a green here means the step removed them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { planFreeFieldsStep, planFreeValue, PLAN_FREE_FIELD_TOOLS } from '../lib/plan-free-fields.mjs';

const BAD_KEY = /(^|_)pro(_|$)|_in_developer$|required_tier$|_unlocks_at$/i;
function badKeys(v, path = '', out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => badKeys(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) { if (BAD_KEY.test(k)) out.push(`${path}.${k}`); badKeys(x, `${path}.${k}`, out); }
  }
  return out;
}
// every JSON the result serialises: structuredContent and each JSON text block (and a raw-text token check)
function offenders(r) {
  const out = badKeys(r.structuredContent || {}, 'sc');
  (r.content || []).forEach((c, i) => {
    const t = c && c.text; if (typeof t !== 'string') return;
    try { out.push(...badKeys(JSON.parse(t), `content${i}`)); } catch { /* prose block */ }
    if (/_(total_)?in_pro\b|required_tier|_total_unlocks_at/.test(t)) out.push(`content${i}(raw)`);
  });
  return out;
}
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// Shapes copied from the live anonymous execute_plan / find_sites / canvas answers of 2026-10-19.
const LIVE_SHAPED = () => {
  const sc = {
    candidates: [{ site_ref: 'a', anchor: { type: 'substation', kv_band: '230-344 kV' } }],
    _candidates_total_in_pro: 10, _locked_fields: ['anchor.name'], _required_tier: 'pro',
    ranking: { _is_headroom_in_pro: true, order: 'x' },
    inputs: { _max_months_in_pro: true }, applied_filters: { _max_months_in_pro: true },
    _results_total_in_pro: 200, _results_total_unlocks_at: 'pro', _x_total_in_developer: 4,
    _substation_required_tier: 'pro', _upgrade: { pro_hint: 'The DC Hub plan with every tool.', tier: 'anonymous' },
    executed: [{ result: { _data_total_in_pro: 10, scope: { unscoped_totals: { _data_total_in_pro: 10 } } } }],
    note: 'each list\'s full length is in its _<field>_total_in_pro sibling',
  };
  return { structuredContent: sc, content: [{ type: 'text', text: JSON.stringify(sc) }] };
};

describe('planFreeFieldsStep (unit)', () => {
  it('the fixture is not vacuous: it carries plan-naming keys before the step', () => {
    expect(offenders(LIVE_SHAPED()).length).toBeGreaterThanOrEqual(10);
  });
  it('removes every plan-naming key from both channels and keeps a neutral twin of each count and marker', () => {
    const r = planFreeFieldsStep(deepFreeze(LIVE_SHAPED()), 'find_sites');   // frozen: proves no mutation of a shared entry
    expect(offenders(r)).toEqual([]);
    const sc = r.structuredContent;
    expect(sc._candidates_total_available).toBe(10);
    expect(sc.ranking._is_headroom_withheld).toBe(true);
    expect(sc.inputs._max_months_withheld).toBe(true);
    expect(sc.executed[0].result.scope.unscoped_totals._data_total_available).toBe(10);
    expect(sc._locked_fields).toEqual(['anchor.name']);              // the lock is still said
    expect(sc._upgrade).toEqual({ tier: 'anonymous' });
    expect(sc.note).toContain('_<field>_total_available');
    expect(JSON.parse(r.content[0].text)).toEqual(sc);
  });
  it('leaves the kill switch, an execute_plan step and the own-scrub profiles\' other tools alone', () => {
    const base = LIVE_SHAPED();
    // Grok QA 2026-10-22 item 4: every tool on the canonical surfaces; on the directory / Claude / core
    // profiles (ownScrub) only the siting family, as before.
    expect(offenders(planFreeFieldsStep(base, 'get_news'))).toEqual([]);
    expect(planFreeFieldsStep(base, 'get_news', { ownScrub: true })).toBe(base);
    expect(offenders(planFreeFieldsStep(base, 'find_sites', { ownScrub: true }))).toEqual([]);
    // An isError result is rewritten too (a keyless taste is served with isError: true).
    const err = { ...LIVE_SHAPED(), isError: true };
    expect(offenders(planFreeFieldsStep(err, 'find_sites'))).toEqual([]);
    expect(planFreeFieldsStep(base, 'find_sites', { skip: true })).toBe(base);
    process.env.DCHUB_PLAN_FREE_FIELDS_V1 = '0';
    try { expect(planFreeFieldsStep(base, 'find_sites')).toBe(base); } finally { delete process.env.DCHUB_PLAN_FREE_FIELDS_V1; }
  });
  it('covers the siting wall family', () => {
    for (const t of ['find_sites', 'site_selection_canvas', 'execute_plan', 'get_retirement_headroom', 'get_hosting_capacity']) {
      expect(PLAN_FREE_FIELD_TOOLS.has(t), t).toBe(true);
    }
  });
  it('a data field called developer is not a plan field', () => {
    expect(planFreeValue({ developer: 'Acme', basis_class: { developer: 'filed' } })).toEqual({ developer: 'Acme', basis_class: { developer: 'filed' } });
  });
});

// ── end to end: the real handlers, only the backend stubbed ───────────────────────────────────────────
const BASE = 'https://backend.plan-free.test';
const CANVAS = {
  ok: true, product: 'Site Selection Canvas', matched: 20, universe: 333, tier: 'FREE',
  inputs: { capacity_mw: 100, region: 'TX', max_months: 12, verdicts: ['BUILD'], limit: 12 },
  shortlist: [{ market: 'Midland', slug: 'midland-tx', state: 'TX', iso: 'ERCOT', verdict: 'BUILD',
    excess_power_score: 85.7, constraint_score: 20.1, time_to_power_months: 9.6, composite_score: 83.8 }],
  synthesis: { locked: true, message: 'locked' },
};
const mkCand = (i) => ({ site_ref: 'site_pf' + i, lat: 39.04 + i / 100, lon: -77.48, coordinate_precision_km: 0.1,
  anchor: { type: 'substation', name: 'PF Sub ' + i, voltage_kv: 345, city: 'Ashburn', state: 'VA', capacity_mva: 900 },
  gas_distance_km: 3.2, fiber_distance_km: 1.1 });
const FIND = { success: true, _entity: 'site_candidates', count: 10, anchors_considered: 7,
  filter: { state: 'VA' }, candidates: Array.from({ length: 10 }, (_, i) => mkCand(i)) };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, n = 0;
beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    let p = ''; try { p = new URL(String(input && input.url ? input.url : input)).pathname; } catch { /* */ }
    if (p.startsWith('/api/v1/site-selection/canvas')) return json(CANVAS);
    if (p.startsWith('/api/v1/sites/find')) return json(FIND);
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: 0, had_pack: false });
    return json({});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; delete process.env.DCHUB_PLAN_FREE_FIELDS_V1; });
const seat = (tier, key) => ({ ...(key ? { api_key: key } : {}), tier, platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '203.0.113.' + (20 + (n % 200)), session_id: 'sess-plan-free-' + (++n) });
async function call(name, args, s) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error('zod rejected ' + name);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const CALLS = [
  ['site_selection_canvas', { region: 'TX', max_months: 12 }, () => seat('anonymous', null)],
  ['site_selection_canvas', { region: 'TX', max_months: 12 }, () => seat('free', 'dch_live_plan_free_0001')],
  ['find_sites', { state: 'VA' }, () => seat('anonymous', null)],
  ['find_sites', { state: 'VA' }, () => seat('free', 'dch_live_plan_free_0002')],
];
describe('final serialised output of the anonymous and free-key siting tools', () => {
  it.each(CALLS)('%s (%#): no key names a plan, and the step is what removed them', async (tool, args, mk) => {
    process.env.DCHUB_PLAN_FREE_FIELDS_V1 = '0';
    const before = await call(tool, args, mk());
    delete process.env.DCHUB_PLAN_FREE_FIELDS_V1;
    const after = await call(tool, args, mk());
    // not vacuous: with the step off, this very call carries plan-naming keys; a wall would carry none
    expect(offenders(before), `${tool}: switch off — the fixture no longer produces plan-naming keys`).not.toEqual([]);
    expect(offenders(after)).toEqual([]);
    expect(JSON.stringify(after)).not.toMatch(/_in_pro\b|required_tier/);
  });
});

describe('an execute_plan step keeps the raw markers its caller reads', () => {
  it('a loopback step is left alone; the plan result built from it is not', async () => {
    const step = await call('find_sites', { state: 'VA' }, { ...seat('anonymous', null), loopback_step: true });
    expect(offenders(step), 'a loopback step must keep _..._in_pro for execute_plan\'s readers').not.toEqual([]);
  });
  it('the context flag is set from the request peer, and the rewrite sits in _sourceLineCb', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/loopback_step: _isLoopbackPeer\(req\)/);
    // Agent QA A (2026-10-20): leanResponseStep sits between the source line and this rename.
    // Wall-to-paid P3a (2026-10-23): _wallOuterStep wraps fn only (it flushes the wall row, no rewrite).
    expect(src).toMatch(/const _done = planFreeFieldsStep\(leanResponseStep\(_sourceLineStep\(await _wallOuterStep\(fn, args, extra, name\), name, args\), name,\s*\{ skip: leanSkip \}\), name, \{ skip: !!c\.loopback_step, ownScrub \}\)/);
    // item 4 (2026-10-28): next_call is added after the plan-free step, not on a loopback step or a frozen profile
    expect(src).toMatch(/return \(c\.loopback_step \|\| ownScrub \|\| _isCleanPlatform\(\)\) \? _done : withNextCall\(_done, name\);/);
    expect(src).toMatch(/const ownScrub = c\.profile === DIRECTORY_PROFILE \|\| c\.profile === CLAUDE_PROFILE \|\| c\.profile === CORE_PROFILE;/);
  });
});
