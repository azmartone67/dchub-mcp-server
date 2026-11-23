// paid-only-plan-and-grid-data-1123.test.mjs — owner decision 2026-11-23: execute_plan, get_grid_data,
// get_refined_queue and get_power_availability_timeline give a FULL answer only to a paid key (Developer and up;
// lib/paid-full-only.mjs). A keyless caller and a free-class key (no email, a bound
// email, a trial key) get a preview, never the full answer, on every lane that used to open it:
//   * the keyless first full answer of the day (lib/keyless-first-full.mjs, DCHUB_KEYLESS_FIRST_FULL, ON in prod);
//   * the keyless full-answer trial (lib/keyless-full-trial.mjs, DCHUB_KEYLESS_FULL_TRIAL, ON in prod);
//   * a free key's depth on get_grid_data (KEYED_FREE_BONUS, server.mjs);
//   * an email-bound key's monthly full execute_plan (lib/siting-email-seat.mjs SITING_MONTHLY_TOOLS);
//   * a free key's plan steps run under its own key (an email-bound key's step got the full grid read).
//   * get_refined_queue: any free key got the full survivor set (it was in no gated set);
//   * get_power_availability_timeline: everyone got the full timeline (FREE_FULL_TOOLS).
// A paid key still gets the full answer from every one of them. The data API answers every MCP read at full depth
// (its X-Internal-Key is honoured ahead of the caller's key), so the stub below does the same for these two.
//
// "Full" is read off figures only the full backend payload carries (peak, the 24h series, the generation mix):
// the keyless stub the data API serves (production's rule: a key or this server's internal read gets the full
// payload) never carries them, so a preview cannot show them by accident and a full answer cannot hide them.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as F from '../lib/keyless-first-full.mjs';
import * as K from '../lib/keyless-full-trial.mjs';
import { PAID_FULL_ONLY_TOOLS } from '../lib/paid-full-only.mjs';
import { assignArm, ARM_CONTROL } from '../lib/continuation.mjs';

process.env.DCHUB_TOP_METROS_FREE = '0';
process.env.DCHUB_LEAN_RESPONSES = '0';
// Production transport (see test/email-bound-decision-full.test.mjs): previews leave with isError false.
process.env.DCHUB_PREVIEW_ISERROR = '0';
const _compactWas = process.env.DCHUB_PLAN_COMPACT;

const BASE = 'https://backend.paid-only-1123.test';
const SECRET = 'paid-only-1123-internal-key-not-real';
const G = '<gated: identified-tier or higher>';
// Figures that exist only in the full payload. 7 distinct, odd numbers so no timestamp or id collides.
const PEAK = 102347, SERIES0 = 90011, NG_MW = 40289, NUC_MW = 30757, MIN = 85903;
const FULL_MARKS = [PEAK, SERIES0, NG_MW, NUC_MW, MIN].map(String);
const GI_FULL = {
  iso: 'PJM', region: 'PJM', rto_code: 'PJM', demand_mw: 93825, demand_period: '2026-11-23T14', peak_mw: PEAK, min_mw: MIN,
  load_factor: 0.839, queue_depth_gw: 373.6, queue_depth_basis: 'generation_queue', market_count: 64, build_count: 0,
  generation_mix: { NG: { mw: NG_MW }, NUC: { mw: NUC_MW } }, as_of: '2026-11-23T14:00:00Z',
  demand_24h: Array.from({ length: 8 }, (_, i) => ({ period: `2026-11-23T${String(i + 1).padStart(2, '0')}`, mw: SERIES0 + i * 400 })),
};
const GI_STUB = {
  iso: 'PJM', region: 'PJM', rto_code: 'PJM', demand_mw: 93825, demand_period: '2026-11-23T14', demand_24h: G, peak_mw: G,
  min_mw: G, load_factor: G, generation_mix: G, gated: true, tier_required: 'identified',
  message: 'You got the headline demand for PJM (93825 MW @ 2026-11-23T14). Full 24h series + generation mix + headroom '
    + 'requires a free key (no email needed, no credit card). For fund-grade access see /enterprise.',
};
const QUEUE = { iso: 'PJM', total_projects: 1174, total_gw: 373.6, as_of: '2026-11-23',
  by_fuel: { solar: 120.1, storage: 90.2, gas: 60.3 },
  projects: Array.from({ length: 6 }, (_, i) => ({ name: `Q${i}`, mw: 100 + i, fuel: 'solar', status: 'active', state: 'PA' })) };

// Full-only figures for the two queue/timing tools (odd, distinct values).
const RQ_TOTAL = 446263;
const REFINED = { _entity: 'queue_results', count_total_matching: 827, count_returned: 3, total_queued_mw: RQ_TOTAL,
  filters_applied: { iso: 'PJM', min_mw: 100, status: 'active' }, source_as_of: '2026-10-31',
  results: [1, 2, 3].map((i) => ({ project_name: 'Proj ' + i, queue_id: 'Q-77' + i, iso: 'PJM', state: 'PA',
    capacity_mw: 52111 + i * 202, fuel_type: 'GAS', queue_status: 'active' })) };
const RQ_MARKS = [String(RQ_TOTAL), '52313', '52515', '52717'];
const TIMELINE = { ok: true, state: 'OH', years: 5, as_of: '2026-11-01',
  timeline: [2026, 2027, 2028].map((y, i) => ({ year: y, under_construction_mw: 31313 + i, planned_mw: 52717 + i, testing_mw: 59 + i,
    retiring_mw: 431 + i, cumulative_firm_signal_mw: 96113 + i, units: 12 + i })),
  queue_context: { active_mw: 77731, by_iso: [{ iso: 'PJM', active_mw: 77731 }],
    iso_reported: [{ iso: 'PJM', gw: 77.7, mw: 77731, primary: true, basis: 'PJM reports 77731 MW active.' }] } };
const TL_MARKS = ['31313', '52717', '96113', '77731', '77.7'];
// Seats by key: what /keys/validate would have put on the ctx.
const KEYS = {
  'dch_live_free_noemail_0000000001': { tier: 'free' },
  'dch_live_free_bound_00000000001': { tier: 'identified', email: 'bound-1123@example.com' },
  'dch_live_trial_000000000000001': { tier: 'trial' },
  'dch_live_developer_0000000001': { tier: 'developer' },
};
const FREE_KEYS = ['dch_live_free_noemail_0000000001', 'dch_live_free_bound_00000000001', 'dch_live_trial_000000000000001'];
const PAID_KEY = 'dch_live_developer_0000000001';

const loopback = { ip: null };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch;
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_KEYLESS_FULL_TRIAL',
  'DCHUB_KEYLESS_FIRST_FULL', 'DCHUB_FIRST_PLAN_DEPTH_TEST', 'DCHUB_FIRST_PLAN_TEST_SALT', 'DCHUB_PLAN_COMPACT'];
const prevEnv = {};

// A plan step, in process: the ctx the /mcp handler builds for a loopback tools/call (its key from X-API-Key,
// plan_first_full only when the plan's token is live), the step tool's handler, a JSON-RPC answer.
async function runStep(init) {
  const h = (init && init.headers) || {};
  const body = JSON.parse(init.body);
  const { name, arguments: a } = body.params;
  const T = TOOLS[name];
  if (!T) return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'unknown tool' } });
  const pf = F.consumePlanFirstFullToken(h[F.KEYLESS_FIRST_FULL_PLAN_HEADER]);
  const key = h['X-API-Key'] || null;
  const ctx = { tier: 'free', platform: 'cursor', client_name_raw: 'cursor', user_agent: 'cursor/1.0', client_ip: loopback.ip,
    session_id: null, loopback_step: true, ...(key ? { api_key: key, ...KEYS[key] } : {}), ...(pf ? { plan_first_full: true } : {}) };
  const parsed = await T.inputSchema.safeParseAsync(a || {});
  const result = parsed.success
    ? await S._ctxALS.run(ctx, () => T.handler(parsed.data, { signal: new AbortController().signal }))
    : { isError: true, content: [{ type: 'text', text: 'invalid args' }] };
  return json({ jsonrpc: '2.0', id: body.id, result });
}

let PACK_CREDITS = 0;   // the pack seat: a free key whose credit balance is set per case
beforeAll(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  process.env.DCHUB_PLAN_COMPACT = '0';   // the full plan envelope: every step body is in it
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (url.startsWith('http://127.0.0.1:')) return runStep(init);
    if (!url.startsWith(BASE)) throw new Error('network fence: ' + url);
    const p = new URL(url).pathname;
    const h = (init && init.headers) || {};
    if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return json({ ok: false });
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: PACK_CREDITS, had_pack: PACK_CREDITS > 0 });
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    if (p === '/api/v1/mcp/lp-free-runs') return json({ ok: true, allowed: true, used: 1, limit: 1, remaining: 0, charge_ref: 'r1' });
    if (p.startsWith('/api/v1/grid/intelligence/') || p.startsWith('/api/v1/grid/latest/')) {
      // Production's rule: a key or this server's internal read gets the full payload.
      const full = !!h['X-API-Key'] || String(h['User-Agent'] || '').toLowerCase().startsWith('dchub-');
      return json(structuredClone(full ? GI_FULL : GI_STUB));
    }
    if (p === '/api/v1/interconnection-queue/refined') return json(structuredClone(REFINED));
    if (p === '/api/v1/power/availability-timeline') return json(structuredClone(TIMELINE));
    if (p.startsWith('/api/v1/interconnection-queue/')) return json(structuredClone(QUEUE));
    return json({});
  };
  process.env.DCHUB_API_BASE = BASE;
  process.env.DCHUB_ANON_DAILY_CAP = '1000';
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  if (_compactWas === undefined) delete process.env.DCHUB_PLAN_COMPACT; else process.env.DCHUB_PLAN_COMPACT = _compactWas;
});
afterEach(() => {
  for (const k of ['DCHUB_KEYLESS_FULL_TRIAL', 'DCHUB_KEYLESS_FIRST_FULL', 'DCHUB_FIRST_PLAN_DEPTH_TEST', 'DCHUB_FIRST_PLAN_TEST_SALT']) delete process.env[k];
  loopback.ip = null;
});

let n = 0;
function seat(over = {}) {
  n += 1;
  while (assignArm({ sessionId: `sess-po-${n}`, eligible: true }) !== ARM_CONTROL) n += 1;
  return { tier: 'free', platform: 'cursor', client_name_raw: 'cursor', user_agent: 'cursor/1.0',
    client_ip: `198.51.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`, session_id: `sess-po-${n}`, ...over };
}
const keyed = (key, over = {}) => seat({ api_key: key, ...KEYS[key], ...over });
async function call(name, s, args) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  loopback.ip = s.client_ip;
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const GD = { iso: 'PJM' };
const PLAN = { intent: 'grid headroom and interconnection queue for a 100 MW load in PJM', iso: 'PJM' };
const fullMarksIn = (r) => FULL_MARKS.filter((m) => JSON.stringify(r).includes(m));
const isFullAnswer = (r) => fullMarksIn(r).length > 0;
const firstFull = (r) => /first_full_answer/.test(JSON.stringify(r));

describe('the lanes themselves no longer list the paid-only tools', () => {
  it('lib/paid-full-only.mjs names all ten', () => {
    expect([...PAID_FULL_ONLY_TOOLS].sort()).toEqual([
      'ai_capacity_index', 'execute_plan', 'get_energy_prices', 'get_grid_data', 'get_grid_intelligence',
      'get_interconnection_queue', 'get_market_context', 'get_power_availability_timeline', 'get_refined_queue', 'rank_markets',
    ]);
  });
  it('the gate lists the three direct tools as paid-only, and none is free-full by design', () => {
    for (const t of ['get_grid_data', 'get_refined_queue', 'get_power_availability_timeline']) {
      expect(S.PAID_ONLY_TOOLS.has(t), t).toBe(true);
      expect(S.FREE_FULL_TOOLS.has(t), t).toBe(false);
    }
  });
  it('no lane can list them: an env list naming them on the trial adds nothing', () => {
    expect([...K.keylessFullTrialTools({ DCHUB_KEYLESS_FULL_TRIAL_TOOLS: PAID_FULL_ONLY_TOOLS.join(',') })]).toEqual([]);
    for (const t of PAID_FULL_ONLY_TOOLS) {
      expect(F.keylessFirstFullSeat(t, { client_ip: '198.51.100.9', user_agent: 'cursor/1.0' }), t).toBe(null);
      expect(F.planStepSeat(t, { loopback_step: true, plan_first_full: true }), t).toBe(null);
    }
  });
  it('first full answer of the day: the lane lists no tools at all', () => {
    expect(F.KEYLESS_FIRST_FULL_TOOLS).not.toContain('get_grid_data');
    expect(F.KEYLESS_FIRST_FULL_TOOLS).not.toContain('execute_plan');
    expect([...F.KEYLESS_FIRST_FULL_TOOLS]).toEqual([]);
  });
  it('a keyless seat on either tool is refused by both keyless lanes', () => {
    process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
    for (const t of PAID_FULL_ONLY_TOOLS) {
      expect(S._keylessFirstFullSeat(t, seat()), t).toBe(null);
      expect(S._keylessFullTrialSeat(t, seat()), t).toBe(null);
    }
    // the trial's other two tools are untouched
    expect(S._keylessFullTrialSeat('get_market_dcpi_rank', seat())).toBe('charge');
    expect(S._keylessFullTrialSeat('get_facility', seat())).toBe('charge');
  });
});

describe('get_grid_data', () => {
  it('keyless, with the first-full lane on (prod default): call 1 and call 2 are previews', async () => {
    const s = seat();
    const r1 = await call('get_grid_data', s, GD);
    const r2 = await call('get_grid_data', seat({ client_ip: s.client_ip }), GD);
    expect(fullMarksIn(r1), 'call 1').toEqual([]);
    expect(firstFull(r1)).toBe(false);
    expect(fullMarksIn(r2), 'call 2').toEqual([]);
  });
  it('keyless, with the full-answer trial on (prod): no full answer', async () => {
    process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
    process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
    const s = seat();
    for (let i = 0; i < 3; i++) expect(fullMarksIn(await call('get_grid_data', seat({ client_ip: s.client_ip }), GD)), 'call ' + (i + 1)).toEqual([]);
  });
  for (const key of FREE_KEYS) {
    it(`free-class key (${KEYS[key].tier}${KEYS[key].email ? ', email bound' : ''}): a preview, the headline kept`, async () => {
      const r = await call('get_grid_data', keyed(key), GD);
      expect(r.isError).not.toBe(true);
      expect(fullMarksIn(r)).toEqual([]);
      expect(JSON.stringify(r), 'the preview keeps the headline demand').toContain('93825');
    });
  }
  it('paid key (Developer): the full answer', async () => {
    const r = await call('get_grid_data', keyed(PAID_KEY), GD);
    expect(r.isError).not.toBe(true);
    expect(fullMarksIn(r).sort()).toEqual([...FULL_MARKS].sort());
  });
});

describe('get_refined_queue', () => {
  const ARGS = { iso: 'PJM', min_mw: 100 };
  const marks = (r) => RQ_MARKS.filter((m) => JSON.stringify(r).includes(m));
  it('keyless, both keyless lanes on: call 1 and call 2 are previews', async () => {
    process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
    const s = seat();
    for (let i = 0; i < 2; i++) {
      const r = await call('get_refined_queue', seat({ client_ip: s.client_ip }), ARGS);
      expect(marks(r), 'call ' + (i + 1)).toEqual([]);
      expect(firstFull(r)).toBe(false);
    }
  });
  for (const key of FREE_KEYS) {
    it(`free-class key (${KEYS[key].tier}${KEYS[key].email ? ', email bound' : ''}): a preview, the rows kept`, async () => {
      const r = await call('get_refined_queue', keyed(key), ARGS);
      expect(r.isError).not.toBe(true);
      expect(marks(r)).toEqual([]);
      expect(JSON.stringify(r), 'the preview keeps what it is a preview of').toContain('Q-771');
    });
  }
  it('paid key (Developer): the full answer', async () => {
    const r = await call('get_refined_queue', keyed(PAID_KEY), ARGS);
    expect(r.isError).not.toBe(true);
    expect(marks(r).sort()).toEqual([...RQ_MARKS].sort());
  });
});

describe('get_power_availability_timeline', () => {
  const ARGS = { state: 'OH' };
  const marks = (r) => TL_MARKS.filter((m) => JSON.stringify(r).includes(m));
  it('keyless, both keyless lanes on: call 1 and call 2 are previews', async () => {
    process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
    const s = seat();
    for (let i = 0; i < 2; i++) {
      const r = await call('get_power_availability_timeline', seat({ client_ip: s.client_ip }), ARGS);
      expect(marks(r), 'call ' + (i + 1)).toEqual([]);
      expect(firstFull(r)).toBe(false);
    }
  });
  for (const key of FREE_KEYS) {
    it(`free-class key (${KEYS[key].tier}${KEYS[key].email ? ', email bound' : ''}): a preview, the rows kept`, async () => {
      const r = await call('get_power_availability_timeline', keyed(key), ARGS);
      expect(r.isError).not.toBe(true);
      expect(marks(r)).toEqual([]);
      expect(JSON.stringify(r), 'the preview keeps what it is a preview of').toContain('"units":12');
    });
  }
  it('paid key (Developer): the full answer', async () => {
    const r = await call('get_power_availability_timeline', keyed(PAID_KEY), ARGS);
    expect(r.isError).not.toBe(true);
    expect(marks(r).sort()).toEqual([...TL_MARKS].sort());
  });
  // Review 2026-11-23: a pack credit buys the full call (credits_full), so the handler's own withhold must not
  // null iso_reported for it.
  it('a free key holding pack credits: the full answer, iso_reported included', async () => {
    const key = FREE_KEYS[0];
    PACK_CREDITS = 5;
    try {
      const r = await call('get_power_availability_timeline', keyed(key), ARGS);
      expect(r.isError).not.toBe(true);
      expect(marks(r).sort()).toEqual([...TL_MARKS].sort());
    } finally { PACK_CREDITS = 0; }
    // (the no-credit control is the free-class cases above; the credit lookup is cached per identity, so this key is not re-read)
  });
  it('who reads iso_reported follows the gate: paid / enterprise gate tier, paid depth tier, a paid rail', () => {
    const f = S._timelineFullSeat;
    expect(f({ _gate_tier_seen: 'paid', tier: 'team' })).toBe(true);      // team / metered fold to 'paid' at the gate
    expect(f({ _gate_tier_seen: 'enterprise', tier: 'research_seed' })).toBe(true);
    expect(f({ tier: 'developer' })).toBe(true);                           // a session-bound purchase: no api_key
    expect(f({ _paid_rail: true, tier: 'free', api_key: 'dch_live_x' })).toBe(true);
    for (const c of [{}, null, { tier: 'free' }, { tier: 'identified', api_key: 'k' }, { _gate_tier_seen: 'trial', tier: 'trial' },
      { _gate_tier_seen: 'free', tier: 'free' }]) expect(f(c), JSON.stringify(c)).toBe(false);
  });
});

describe('execute_plan', () => {
  const executed = (r) => (r.structuredContent && r.structuredContent.executed) || [];
  const stepTools = (r) => executed(r).filter((e) => e.status === 'executed' || e.status === 'gated_preview').map((e) => e.tool);
  it('keyless, first plan of the day (prod default): the plan runs, no figure of a full step', async () => {
    const r = await call('execute_plan', seat(), PLAN);
    expect(r.isError).not.toBe(true);
    expect(stepTools(r).length, 'the plan still ran its steps (the front door works)').toBeGreaterThan(0);
    expect(fullMarksIn(r)).toEqual([]);
    expect(firstFull(r)).toBe(false);
  }, 60_000);
  it('keyless with the M2.2 depth test switched on: still no full step', async () => {
    process.env.DCHUB_FIRST_PLAN_DEPTH_TEST = '1';
    process.env.DCHUB_FIRST_PLAN_TEST_SALT = 'salt-1123';
    for (let i = 0; i < 4; i++) expect(fullMarksIn(await call('execute_plan', seat(), PLAN)), 'seat ' + i).toEqual([]);
  }, 60_000);
  for (const key of FREE_KEYS) {
    it(`free-class key (${KEYS[key].tier}${KEYS[key].email ? ', email bound' : ''}): the plan runs, no full step, no monthly full plan`, async () => {
      const r = await call('execute_plan', keyed(key), PLAN);
      expect(r.isError).not.toBe(true);
      expect(stepTools(r).length).toBeGreaterThan(0);
      expect(fullMarksIn(r)).toEqual([]);
      expect(JSON.stringify(r)).not.toContain('free_full_runs');
    }, 60_000);
  }
  it('paid key (Developer): the plan carries the full step figures', async () => {
    const r = await call('execute_plan', keyed(PAID_KEY), PLAN);
    expect(r.isError).not.toBe(true);
    expect(isFullAnswer(r), JSON.stringify(executed(r).map((e) => [e.tool, e.status]))).toBe(true);
  }, 60_000);
});
