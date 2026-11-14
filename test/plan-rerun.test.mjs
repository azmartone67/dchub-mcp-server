// plan-rerun.test.mjs — move 3 (lib/plan-rerun.mjs): re-run a plan and get back only what changed,
// with no account. Unit half pins the honesty rules on the pure module; the e2e half runs the real
// server.mjs against a stub backend on /mcp, /mcp/core and the directory profiles.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  computeRerun, applyRerun, readToken, takeRerunToken, figuresOf, rowListOf, planRerunOn,
  RERUN_TOKEN_PREFIX, RERUN_MAX_AGE_DAYS,
} from '../lib/plan-rerun.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const SECRET = 'unit-test-secret-not-real';
const ENV = {};
const INTENT = 'rank markets for a 200 MW AI campus';

// A planted figure that must never appear in a token in the clear.
const PLANTED = 987654.321;

function steps(over = {}) {
  const base = [
    { step: 1, tool: 'ai_capacity_index', args: { horizon: 90 }, status: 'executed', ms: 500,
      result: { index_name: 'AI Compute Capacity Index', as_of: '2026-11-08',
        markets: [
          { market: 'ashburn-va', score: 450, deployable_mw: PLANTED },
          { market: 'columbus-oh', score: 300, deployable_mw: 400 },
          { market: 'dallas-tx', score: 280, deployable_mw: 350 },
        ],
        human_url: 'https://dchub.cloud/u/aaaa', retrieved_at: '2026-11-09T08:34:15Z' } },
    { step: 2, tool: 'get_market_dcpi_rank', args: { market: 'ashburn-va' }, status: 'executed', ms: 300,
      result: { market_slug: 'ashburn-va', verdict: 'AVOID', composite_score: 26.7, computed_at: '2026-11-09T08:00:00Z',
        as_of: '2026-11-09' } },
    { step: 3, tool: 'get_grid_intelligence', args: { region_id: 'PJM' }, status: 'gated_preview', ms: 200,
      result: { iso: 'PJM', taste: { demand_mw: 90000 }, _queue_depth_gw_withheld: true, preview_is_partial: true,
        as_of: '2026-11-09T07:00:00Z', for_your_human: { url: 'https://dchub.cloud/u/aaaa' } } },
  ];
  return typeof over === 'function' ? over(JSON.parse(JSON.stringify(base))) : base;
}
const run = (executed, extra = {}) => computeRerun({ intent: INTENT, context: undefined, executed, c: null,
  profile: null, secret: SECRET, env: ENV, ...extra });
const decode = (tok) => JSON.parse(Buffer.from(tok.slice(RERUN_TOKEN_PREFIX.length).split('.')[0], 'base64url').toString('utf8'));

describe('plan-rerun: tokens', () => {
  it('a fresh run mints a signed token and adds only {token, how}', () => {
    const ex = steps();
    const rr = run(ex);
    expect(rr.mode).toBe('fresh');
    expect(rr.newToken.startsWith(RERUN_TOKEN_PREFIX)).toBe(true);
    const out = applyRerun({ executed: ex, answer_guide: 'g' }, rr);
    expect(Object.keys(out.rerun).sort()).toEqual(['how', 'token']);
    expect(out.rerun.how).toMatch(/execute_plan again .*context\.rerun_token/);
    expect(out.executed).toHaveLength(3);
    expect(out.answer_guide).toBe('g');
    expect(rr.telemetry).toEqual({ rerun_token_issued: true });
  });

  it('holds no figure, key, URL or intent text in the clear', () => {
    const rr = run(steps(), { c: { api_key: 'dch_live_SECRETKEY123', tier: 'free' } });
    const body = JSON.stringify(decode(rr.newToken));
    expect(body).not.toContain(String(PLANTED));
    expect(body).not.toContain('987654');
    expect(body).not.toContain('SECRETKEY');
    expect(body).not.toContain('dchub.cloud');
    expect(body).not.toContain('200 MW');
    expect(rr.newToken.length).toBeLessThan(1200);
  });

  it('a tampered, foreign, expired or different-plan token compares nothing and keeps the full answer', () => {
    const t = run(steps()).newToken;
    const flip = t.slice(0, -3) + (t.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
    for (const [tok, reason] of [[flip, 'bad_signature'], ['hello', 'not_a_rerun_token'],
      [computeRerun({ intent: INTENT, executed: steps(), secret: 'other-secret', env: ENV }).newToken, 'bad_signature']]) {
      const ex = steps();
      const rr = run(ex, { token: tok });
      expect(rr.status).toBe('not_compared');
      expect(rr.reason).toBe(reason);
      const out = applyRerun({ executed: ex }, rr);
      expect(out.executed).toHaveLength(3);
      expect(out.rerun.status).toBe('not_compared');
      expect(out.rerun.token.startsWith(RERUN_TOKEN_PREFIX)).toBe(true);
    }
    const old = computeRerun({ intent: INTENT, executed: steps(), secret: SECRET, env: ENV,
      now: Date.now() - (RERUN_MAX_AGE_DAYS + 1) * 86400000 }).newToken;
    expect(run(steps(), { token: old }).reason).toBe('expired');
    expect(run(steps(), { token: t, intent: 'compare phoenix vs columbus' }).reason).toBe('different_plan');
    expect(run(steps(), { token: t, context: { market: 'phoenix' } }).reason).toBe('different_plan');
    expect(run(steps(), { token: t, c: { api_key: 'k', tier: 'pro' } }).reason).toBe('different_access');
  });

  it('intent whitespace and case, the cohort tag and the token itself do not change the plan', () => {
    const t = run(steps(), { context: { market: 'ashburn', cohort: 'x' } }).newToken;
    const rr = run(steps(), { token: t, intent: '  Rank markets for a 200 MW   AI campus ', context: { market: 'ashburn', rerun_token: 'zzz' } });
    expect(rr.status).toBe('unchanged');
  });

  it('readToken refuses oversized input without parsing it', () => {
    expect(readToken(SECRET, RERUN_TOKEN_PREFIX + 'a'.repeat(9000)).reason).toBe('not_a_rerun_token');
  });
});

describe('plan-rerun: only what changed', () => {
  it('run 2 unchanged: executed[] is empty and every step is listed with both as_of dates', () => {
    const t = run(steps()).newToken;
    const ex = steps();
    const rr = run(ex, { token: t });
    expect(rr.status).toBe('unchanged');
    const out = applyRerun({ executed: ex, answer_guide: 'G', ranked_answer: { x: 1 }, intent_answer: {}, power_evidence: [] }, rr);
    expect(out.executed).toEqual([]);
    expect(out.rerun.unchanged.map((u) => u.tool)).toEqual(['ai_capacity_index', 'get_market_dcpi_rank', 'get_grid_intelligence']);
    expect(out.rerun.unchanged[1]).toMatchObject({ as_of_previous: '2026-11-09', as_of_now: '2026-11-09' });
    expect(out.answer_guide).toMatch(/^NO CHANGE since your previous run/);
    expect(out.ranked_answer).toBeUndefined();
    expect(rr.telemetry).toMatchObject({ rerun: 'unchanged', rerun_unchanged: 3, rerun_changed: 0, rerun_within_7d: true });
  });

  it('serve-time noise (relay links, retrieved_at, computed_at, next_session) is not a change', () => {
    const t = run(steps()).newToken;
    const ex = steps((s) => {
      s[0].result.human_url = 'https://dchub.cloud/u/bbbb';
      s[0].result.retrieved_at = '2026-11-10T01:00:00Z';
      s[0].result.next_session = { tool: 'get_changes' };
      s[1].result.computed_at = '2026-11-10T01:00:00Z';
      s[2].result.for_your_human = { url: 'https://dchub.cloud/u/cccc', text: 'other words' };
      s[2].ms = 9999;
      return s;
    });
    expect(run(ex, { token: t }).status).toBe('unchanged');
  });

  it('execute_plan\'s size cut is not a change: fingerprints read the step\'s own answer before the cut', () => {
    const full1 = steps();
    const fullMap1 = new Map(full1.map((e) => [e, e.result]));
    const t = run(full1, { fullOf: (e) => fullMap1.get(e) }).newToken;
    // Run 2: the same tool answers, but the returned step 1 was slimmed (a once-per-session block
    // pushed it over 6 KB): rows cut, a truncation flag and note added.
    const ex = steps();
    const fullMap2 = new Map(ex.map((e) => [e, JSON.parse(JSON.stringify(e.result))]));
    ex[0].result = { ...ex[0].result, markets: ex[0].result.markets.slice(0, 1), truncated: true,
      truncation: { rows_kept_per_array: 1 }, note: 'step result slimmed' };
    expect(run(ex, { token: t, fullOf: (e) => fullMap2.get(e) }).status).toBe('unchanged');
    // CONTROL: fingerprinting the cut view would have called it a change.
    expect(run(ex, { token: run(steps()).newToken }).status).toBe('changed');
  });

  it('run 2 with one mutated figure returns only that step', () => {
    const t = run(steps()).newToken;
    const ex = steps((s) => { s[1].result.composite_score = 31.2; s[1].result.verdict = 'CAUTION'; return s; });
    const rr = run(ex, { token: t });
    expect(rr.status).toBe('changed');
    const out = applyRerun({ executed: ex }, rr);
    expect(out.executed.map((e) => e.tool)).toEqual(['get_market_dcpi_rank']);
    expect(out.executed[0].result.composite_score).toBe(31.2);
    expect(out.rerun.unchanged.map((u) => u.step)).toEqual([1, 3]);
    expect(out.rerun.changed.map((u) => u.step)).toEqual([2]);
    expect(out.answer_guide).toMatch(/^RE-RUN since .*executed\[\] holds only what changed \(1 step/);
  });

  it('a changed step returns only its changed and added rows', () => {
    const t = run(steps()).newToken;
    const ex = steps((s) => {
      s[0].result.markets[1].score = 333;                                    // columbus moved
      s[0].result.markets.push({ market: 'phoenix-az', score: 200, deployable_mw: 300 });   // new row
      return s;
    });
    const rr = run(ex, { token: t });
    const out = applyRerun({ executed: ex }, rr);
    expect(out.executed).toHaveLength(1);
    expect(out.executed[0].result.markets.map((m) => m.market)).toEqual(['columbus-oh', 'phoenix-az']);
    expect(out.executed[0].rows_trimmed_to_changed).toBe(true);
    expect(out.rerun.changed[0].rows).toMatchObject({ path: 'markets', changed: ['market=columbus-oh'],
      added: ['market=phoenix-az'], unchanged: ['market=ashburn-va', 'market=dallas-tx'], removed_count: 0 });
  });

  it('a removed row is counted, and a removed step is listed', () => {
    const t = run(steps()).newToken;
    const ex = steps((s) => { s[0].result.markets.pop(); return s.slice(0, 2); });
    const rr = run(ex, { token: t });
    expect(rr.status).toBe('changed');
    expect(rr.changed[0].rows.removed_count).toBe(1);
    expect(rr.removed.map((r) => r.tool)).toEqual(['get_grid_intelligence']);
  });
});

describe('plan-rerun: never "no change" without a comparison', () => {
  it.each([['failed', 'step_failed'], ['timed_out', 'step_timed_out'], ['not_run', 'step_not_run'], ['skipped_unresolved', 'step_not_run']])(
    'a step that is %s now is not_compared, and the run is partly_compared', (status, reason) => {
      const t = run(steps()).newToken;
      const ex = steps((s) => { s[1].status = status; s[1].result = { error: 'x' }; return s; });
      const rr = run(ex, { token: t });
      expect(rr.status).toBe('partly_compared');
      expect(rr.not_compared).toEqual([expect.objectContaining({ step: 2, reason })]);
      const out = applyRerun({ executed: ex }, rr);
      expect(out.executed.map((e) => e.step)).toEqual([2]);      // returned as it came back
      expect(out.answer_guide).toMatch(/could not be compared/);
      expect(out.answer_guide).not.toMatch(/NO CHANGE/);
    });

  it('a step that failed LAST time is not_compared (no_previous_result), not "changed" or "unchanged"', () => {
    const t = run(steps((s) => { s[1].status = 'timed_out'; s[1].result = { error: 'x' }; return s; })).newToken;
    const rr = run(steps(), { token: t });
    expect(rr.status).toBe('partly_compared');
    expect(rr.not_compared[0]).toMatchObject({ step: 2, reason: 'no_previous_result' });
  });

  it('a step served at a different depth (a withheld marker appeared) is not_compared', () => {
    const t = run(steps()).newToken;
    const ex = steps((s) => { s[1].result._composite_score_withheld = true; return s; });
    const rr = run(ex, { token: t });
    expect(rr.not_compared[0]).toMatchObject({ step: 2, reason: 'depth_changed' });
  });

  it('a preview one time and a full answer the other is not_compared', () => {
    const t = run(steps()).newToken;
    const ex = steps((s) => { s[2].status = 'executed'; return s; });
    expect(run(ex, { token: t }).not_compared[0]).toMatchObject({ step: 3, reason: 'depth_changed' });
  });
});

describe('plan-rerun: switches and plumbing', () => {
  it('off with DCHUB_PLAN_RERUN=0, off with no secret, off on a surface that is not allowed', () => {
    expect(planRerunOn({ DCHUB_PLAN_RERUN: '0' })).toBe(false);
    expect(planRerunOn({})).toBe(true);
    expect(computeRerun({ intent: INTENT, executed: steps(), secret: SECRET, env: { DCHUB_PLAN_RERUN: 'off' } })).toBeNull();
    expect(computeRerun({ intent: INTENT, executed: steps(), secret: '', env: ENV })).toBeNull();
    expect(computeRerun({ intent: INTENT, executed: steps(), secret: SECRET, env: ENV, surfaceOk: false })).toBeNull();
  });

  it('takeRerunToken removes the token from context before planning', () => {
    const a = { intent: 'x', context: { market: 'phoenix', rerun_token: ' pr1.abc.def ' } };
    expect(takeRerunToken(a)).toBe('pr1.abc.def');
    expect(a.context).toEqual({ market: 'phoenix' });
    const b = { intent: 'x', context: { rerun_token: 'pr1.x.y' } };
    takeRerunToken(b);
    expect(b.context).toBeUndefined();
    expect(takeRerunToken({ intent: 'x', context: { market: 'a' } })).toBeNull();
  });

  it('figuresOf keeps data and drops plumbing; rowListOf ignores lists that are not named rows', () => {
    expect(figuresOf({ score: 1, human_url: 'u', _x_withheld: true, verdict: 'BUILD', link: 'https://x', as_of: 'd' }))
      .toEqual({ score: 1, verdict: 'BUILD' });
    expect(rowListOf({ withheld: [{ field: 'a' }, { field: 'b' }] })).toBeNull();
    expect(rowListOf({ data: { rows: [{ slug: 'a' }, { slug: 'b' }] } }).path).toBe('data.rows');
  });
});

// ── e2e: the real server on a stub backend ──────────────────────────────────
const row = (market, rank, score) => ({ market, rank, city: market, state: 'XX', score,
  deployable_mw: { value: 100 + rank }, ai_ready_mw: { value: 100 }, hyperscale_ready: true });
let MARKETS = [row('ashburn-va', 1, 450), row('columbus-oh', 2, 300), row('dallas-tx', 3, 280)];
let VERDICT = { 'ashburn-va': ['AVOID', 26.7], 'columbus-oh': ['BUILD', 71.2], 'dallas-tx': ['CAUTION', 55.1] };
const RANK_ROWS = [{ rank: 1, market: 'Columbus', slug: 'columbus-oh', score: 71.2 },
  { rank: 2, market: 'Dallas', slug: 'dallas-tx', score: 55.1 }, { rank: 3, market: 'Ashburn', slug: 'ashburn-va', score: 26.7 }];

let H, fence;
const sc = (res) => {
  const line = res.raw.split('\n').find((l) => l.startsWith('data:')) || res.raw;
  return JSON.parse(line.replace(/^data:\s*/, '')).result.structuredContent;
};
const plan = (path, args, headers = {}) => H.call(path, 'execute_plan', { intent: INTENT, ...args },
  { 'user-agent': 'curl/8.0', ...headers });
const trackRows = (from) => H.hits.slice(from).filter((h) => h.path === '/api/v1/mcp/track'
  && h.body && h.body.tool === 'execute_plan_steps').map((h) => h.body.params);

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => {
    if (p === '/api/v1/ai-capacity-index') return { ok: true, index_name: 'AI Compute Capacity Index', as_of: '2026-11-08', markets: MARKETS };
    // 5.27: the AI-campus ranking leads with rank_markets criteria=ai_ready. Its rows are fixed here
    // (the figure that moves between runs is the DCPI card below, as before).
    if (p === '/api/v1/mcp/tools/rank_markets') return { criteria: 'ai_ready', region: 'us', as_of: '2026-11-08', results: RANK_ROWS };
    const m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p);
    if (m && VERDICT[m[1]]) return { ok: true, market_slug: m[1], iso: 'PJM', verdict: VERDICT[m[1]][0], composite_score: VERDICT[m[1]][1], as_of: '2026-11-09' };
    return undefined;
  } });
}, 60_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore && fence.restore(); });

describe('plan-rerun e2e on /mcp', () => {
  it('run 1 -> token; run 2 unchanged -> only the unchanged list; run 3 after one figure moved -> only that step', async () => {
    const hdr = { 'x-api-key': PRO_KEY };
    const r1 = sc(await plan('/mcp', {}, hdr));
    expect(r1._entity).toBe('plan_execution');
    const tok = r1.rerun && r1.rerun.token;
    expect(typeof tok).toBe('string');
    expect(r1.executed.length).toBeGreaterThan(1);
    const ran = r1.executed.filter((e) => e.status === 'executed' || e.status === 'gated_preview').length;

    const before2 = H.hits.length;
    const r2 = sc(await plan('/mcp', { context: { rerun_token: tok } }, hdr));
    expect(r2.rerun.status).toBe('unchanged');
    expect(r2.executed.filter((e) => e.status !== 'skipped_meta')).toEqual([]);
    expect(r2.rerun.unchanged).toHaveLength(ran);
    expect(r2.answer_guide).toMatch(/^NO CHANGE/);
    expect(trackRows(before2)[0]).toMatchObject({ rerun_token_issued: true, rerun: 'unchanged', rerun_within_7d: true, rerun_changed: 0 });
    // The token never reaches a step's args or the backend.
    expect(JSON.stringify(H.hits.slice(before2).filter((h) => h.path !== '/api/v1/mcp/track'))).not.toContain(tok.slice(4, 40));

    VERDICT = { ...VERDICT, 'columbus-oh': ['CAUTION', 61.0] };
    const r3 = sc(await plan('/mcp', { context: { rerun_token: r2.rerun.token } }, hdr));
    VERDICT = { ...VERDICT, 'columbus-oh': ['BUILD', 71.2] };
    expect(r3.rerun.status).toBe('changed');
    const back = r3.executed.filter((e) => e.status !== 'skipped_meta');
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((e) => e.tool === 'get_market_dcpi_rank' && JSON.stringify(e.args).includes('columbus'))).toBe(true);
    expect(r3.rerun.unchanged.length).toBe(ran - back.length);
  });

  it('a keyless caller gets a token and an honest re-run too', async () => {
    const r1 = sc(await plan('/mcp', {}));
    expect(r1.rerun && r1.rerun.token).toBeTruthy();
    const r2 = sc(await plan('/mcp', { context: { rerun_token: r1.rerun.token } }));
    expect(['unchanged', 'partly_compared']).toContain(r2.rerun.status);
    // A keyed token presented keyless compares nothing.
    const k = sc(await plan('/mcp', {}, { 'x-api-key': PRO_KEY }));
    const r3 = sc(await plan('/mcp', { context: { rerun_token: k.rerun.token } }));
    expect(r3.rerun).toMatchObject({ status: 'not_compared', reason: 'different_access' });
  });

  it.each(['/mcp/chatgpt', '/mcp/claude', '/mcp/grok'])('%s carries no rerun block (directory surfaces unchanged)', async (p) => {
    const res = await H.call(p, 'execute_plan', { intent: INTENT }, { 'user-agent': 'Mozilla/5.0 (Macintosh)' });
    expect(res.raw).toMatch(/plan_execution|execute_plan/);
    expect(res.raw).not.toMatch(/rerun/);
  });
});

describe('plan-rerun e2e on /mcp/core plan_and_answer', () => {
  const coreList = async () => {
    const res = await H.list('/mcp/core');
    const line = res.raw.split('\n').find((l) => l.startsWith('data:')) || res.raw;
    return JSON.parse(line.replace(/^data:\s*/, '')).result.tools.find((t) => t.name === 'plan_and_answer');
  };
  it('OFF by default: the submitted core catalog does not move and no core result carries a token', async () => {
    delete process.env.DCHUB_CORE_RERUN;
    const t = await coreList();
    expect(Object.keys(t.inputSchema.properties)).not.toContain('rerun_token');
    const res = await H.call('/mcp/core', 'plan_and_answer', { intent: INTENT }, { 'user-agent': 'curl/8.0' });
    expect(res.raw).not.toMatch(/rerun/);
  });

  it('with DCHUB_CORE_RERUN=1: lifts the token to the envelope and takes rerun_token back', async () => {
    process.env.DCHUB_CORE_RERUN = '1';
    expect(Object.keys((await coreList()).inputSchema.properties)).toContain('rerun_token');
    const hdr = { 'x-api-key': PRO_KEY, 'user-agent': 'curl/8.0' };
    const r1 = sc(await H.call('/mcp/core', 'plan_and_answer', { intent: INTENT }, hdr));
    expect(r1.rerun && typeof r1.rerun.token).toBe('string');
    expect(r1.rerun.how).toMatch(/plan_and_answer again/);
    expect(r1.rerun.how).not.toMatch(/execute_plan/);
    const r2 = sc(await H.call('/mcp/core', 'plan_and_answer', { intent: INTENT, rerun_token: r1.rerun.token }, hdr));
    expect(r2.rerun.status).toBe('unchanged');
    expect(r2.rerun.unchanged.length).toBeGreaterThan(0);
    expect(r2.notes.join(' ')).toMatch(/re-run/);
    expect(JSON.stringify(r2.sections)).not.toMatch(/"rerun"/);
    delete process.env.DCHUB_CORE_RERUN;
  });
});
