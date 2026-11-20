// first-plan-depth-m22.test.mjs — Grok free-to-paid note, M2.2 (owner 2026-11-18): the first-plan depth test
// (lib/first-plan-depth-test.mjs).
//
//   * the arm: off by default, off without a salt (fail closed), 50±2% over 10k synthetic IPs, stable per IP;
//   * the step token carries the arm once, and a reused token carries nothing;
//   * kff_arm rides first in the LOGGED params, never in the handler's args.
import { describe, it, expect } from 'vitest';
import { firstPlanArm, firstPlanDepthTestOn, withKffArm, KFF_ARM_EMAIL, KFF_ARM_PRO } from '../lib/first-plan-depth-test.mjs';
import { mintPlanFirstFullToken, planFirstFullTokenArm, consumePlanFirstFullToken } from '../lib/keyless-first-full.mjs';

const ON = { DCHUB_FIRST_PLAN_DEPTH_TEST: '1', DCHUB_FIRST_PLAN_TEST_SALT: 'unit-salt' };
const ips = Array.from({ length: 10_000 }, (_, i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);

describe('the arm', () => {
  it('off by default; switch on without a salt (or a blank one) is off', () => {
    expect(firstPlanDepthTestOn({})).toBe(false);
    expect(firstPlanArm('198.51.100.7', {})).toBeNull();
    expect(firstPlanArm('198.51.100.7', { DCHUB_FIRST_PLAN_DEPTH_TEST: '1' })).toBeNull();
    expect(firstPlanArm('198.51.100.7', { DCHUB_FIRST_PLAN_DEPTH_TEST: '1', DCHUB_FIRST_PLAN_TEST_SALT: '  ' })).toBeNull();
    expect(firstPlanArm('198.51.100.7', { DCHUB_FIRST_PLAN_DEPTH_TEST: '0', DCHUB_FIRST_PLAN_TEST_SALT: 's' })).toBeNull();
    expect(firstPlanArm('198.51.100.7', { DCHUB_FIRST_PLAN_TEST_SALT: 's' })).toBeNull();
    expect(firstPlanArm('', ON)).toBeNull();
  });
  it('splits 10k synthetic IPs 50±2%', () => {
    const email = ips.filter((ip) => firstPlanArm(ip, ON) === KFF_ARM_EMAIL).length;
    const pro = ips.filter((ip) => firstPlanArm(ip, ON) === KFF_ARM_PRO).length;
    expect(email + pro).toBe(10_000);
    expect(email / 10_000).toBeGreaterThanOrEqual(0.48);
    expect(email / 10_000).toBeLessThanOrEqual(0.52);
  });
  it('stable per IP; the salt decides it', () => {
    const first = ips.slice(0, 500).map((ip) => firstPlanArm(ip, ON));
    expect(ips.slice(0, 500).map((ip) => firstPlanArm(ip, ON))).toEqual(first);
    const other = ips.slice(0, 500).map((ip) => firstPlanArm(ip, { ...ON, DCHUB_FIRST_PLAN_TEST_SALT: 'other' }));
    expect(other).not.toEqual(first);
  });
});

describe('the step token and the logged params', () => {
  it('a token carries its arm until consumed; one minted without an arm carries none', () => {
    const t = mintPlanFirstFullToken(Date.now(), KFF_ARM_EMAIL);
    expect(planFirstFullTokenArm(t)).toBe(KFF_ARM_EMAIL);
    expect(consumePlanFirstFullToken(t)).toBe(true);
    expect(planFirstFullTokenArm(t)).toBeNull();
    expect(consumePlanFirstFullToken(t)).toBe(false);
    const u = mintPlanFirstFullToken();
    expect(planFirstFullTokenArm(u)).toBeNull();
    expect(planFirstFullTokenArm('forged')).toBeNull();
  });
  it('kff_arm is the first logged key; args are not touched; no arm = the same object', () => {
    const args = { intent: 'x', iso: 'ERCOT' };
    const p = withKffArm(args, KFF_ARM_PRO);
    expect(Object.keys(p)[0]).toBe('kff_arm');
    expect(p).toEqual({ kff_arm: 'pro_depth', intent: 'x', iso: 'ERCOT' });
    expect(args).toEqual({ intent: 'x', iso: 'ERCOT' });
    expect(withKffArm(args, null)).toBe(args);
    expect(withKffArm(args, 'bogus')).toBe(args);
  });
});

// ── end to end: the real server, a stub backend that answers by the forwarded caller tier (as routes/dcpi.py does),
// each step a real loopback request. ──────────────────────────────────────────────────────────────────────────────
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { createGitRefSandbox } from './helpers/repo-sandbox.mjs';
import { beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SALT = 'e2e-salt-m22';
const EMAIL_KEY = 'dch_live_EMAILm22key0123456789abcdef00';
const ROW = { iso: 'ERCOT', market_count: 12, avg_constraint: 41.2, avg_excess: 63.5, avg_time_to_power_months: 30,
  avg_queue_wait_months: 44, avg_kwh_cents: 8.1, sum_emergency_30d: 2 };
const LOCKED = { iso: 'ERCOT', market_count: 12, locked: true, avg_constraint: null, avg_excess: null,
  avg_time_to_power_months: null, avg_queue_wait_months: null, avg_kwh_cents: null, sum_emergency_30d: null };
const PLAN = { intent: 'how soon can a 100 MW load get power in ERCOT' };
const PAID = ['pro', 'enterprise', 'admin'];
const routes = (heard) => (p, req) => {
  const tier = String(req.headers['x-dchub-caller-tier'] || '');
  if (p === '/api/v1/keys/validate') return undefined;
  if (p === '/api/v1/dcpi/iso-comparison') { heard.push(tier); return { isos: [PAID.includes(tier) ? ROW : LOCKED] }; }
  if (p.startsWith('/api/v1/grid/intelligence/')) return { iso: 'ERCOT', demand_mw: 52000, as_of: '2026-11-16T00:00:00Z', generation_mix: { NG: { mw: 27000 } } };
  if (p.startsWith('/api/v1/interconnection-queue/')) return { iso: 'ERCOT', total_projects: 10, total_gw: 400, projects: [] };
  if (p.startsWith('/api/v1/mcp/full-cap/')) return { ok: false };
  return undefined;
};
// The email-bound free key (an email on a free key = _emailFullSeat).
const validate = (inner) => (p, req, body) => {
  if (p === '/api/v1/keys/validate' && body && body.api_key === EMAIL_KEY) {
    return { valid: true, tier: 'free', developer_id: 'dev_m22_email', email: 'agent@example.com', tier_detail: { users_plan: 'free' } };
  }
  return inner(p, req, body);
};
const heardH = [], heardO = [];
let H, O, SB, fence, why = '';
const _compact = process.env.DCHUB_PLAN_COMPACT;
beforeAll(async () => {
  process.env.DCHUB_PLAN_COMPACT = '0';   // this file reads executed[] step bodies
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: validate(routes(heardH)) });
  SB = createGitRefSandbox(REPO, 'origin/main', 'm22-origin-main');
  if (!SB) why = 'origin/main is not available in this clone';
  else O = await startHarness({ extraRoutes: validate(routes(heardO)), serverUrl: pathToFileURL(path.join(SB.root, 'server.mjs')).href });
}, 180_000);
afterAll(async () => {
  for (const k of ['DCHUB_FIRST_PLAN_DEPTH_TEST', 'DCHUB_FIRST_PLAN_TEST_SALT']) delete process.env[k];
  if (_compact === undefined) delete process.env.DCHUB_PLAN_COMPACT; else process.env.DCHUB_PLAN_COMPACT = _compact;
  if (O) await O.stop();
  if (H) await H.stop();
  if (SB) SB.cleanup();
  if (fence) fence.restore();
});
const on = () => { process.env.DCHUB_FIRST_PLAN_DEPTH_TEST = '1'; process.env.DCHUB_FIRST_PLAN_TEST_SALT = SALT; };
const off = () => { delete process.env.DCHUB_FIRST_PLAN_DEPTH_TEST; delete process.env.DCHUB_FIRST_PLAN_TEST_SALT; };
let ipN = 1;
// A fresh caller IP in the wanted arm under the test salt.
function ipIn(arm) {
  for (;;) {
    const ip = `198.18.${100 + (ipN >> 8)}.${ipN++ & 255}`;
    if (firstPlanArm(ip, { DCHUB_FIRST_PLAN_DEPTH_TEST: '1', DCHUB_FIRST_PLAN_TEST_SALT: SALT }) === arm) return ip;
  }
}
const UA = { 'user-agent': 'Mozilla/5.0' };
// A real client session (initialize as cursor), then the plan in it.
async function plan(h, ip, extra = {}) {
  const h0 = { ...UA, 'x-forwarded-for': ip, ...extra };
  const init = await h.init('/mcp', 'cursor', h0);
  const sid = init.headers.get('mcp-session-id');
  const hs = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await h.post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, hs);
  const r = await h.call('/mcp', 'execute_plan', PLAN, hs);
  return r.msg && r.msg.result;
}
// Track rows sent since `from` (the server posts each to /api/v1/mcp/track; a held row leaves within 5 s).
async function trackRows(h, from) {
  await new Promise((r) => setTimeout(r, 5_500));
  return h.hits.slice(from).filter((x) => x.path === '/api/v1/mcp/track').map((x) => x.body)
    .flatMap((b) => (Array.isArray(b) ? b : b && Array.isArray(b.rows) ? b.rows : [b])).filter((b) => b && b.tool);
}
const gridStep = (res) => ((res && res.structuredContent && res.structuredContent.executed) || []).find((e) => e && e.tool === 'get_grid_intelligence') || {};
const DECISION = ['constraint_score', 'excess_power_score', 'avg_time_to_power_months', 'avg_queue_wait_months', 'retail_price_cents_kwh'];
const STEP_TOOLS = ['get_grid_intelligence', 'get_interconnection_queue', 'get_refined_queue'];
async function armedPlan(arm, extra = {}) {
  on();
  try {
    const from = H.hits.length; heardH.length = 0;
    const res = await plan(H, ipIn(arm), extra);
    return { res, rows: await trackRows(H, from), heard: heardH.slice() };
  } finally { off(); }
}

// What differs between two runs of the same call by design: relay tokens, timestamps, ids, timings.
const norm = (r) => JSON.stringify(r)
  .replace(/https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[^"\s\\]*)?/g, 'RELAY')
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'TS')
  .replace(/pr1\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g, 'RERUN')   // the rerun token carries its mint second
  .replace(/(\\?")(ms|elapsed_ms|duration_ms|took_ms|latency_ms|wall_ms)(\\?"):\d+/g, '$1$2$3:0')
  .replace(/(plan|req|sess|run|rp)[-_][A-Za-z0-9]{6,}/g, '$1-ID')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID');
// The steps run in parallel, so their rows arrive in either order: compared as a sorted set.
const rowsNorm = (rows) => rows.map((r) => norm({ tool: r.tool, status: r.status, tier: r.tier, params: r.params })).sort().join('\n');

// First, while both servers are fresh (a session's first call carries a one-time starter_pack on each).
describe('off is origin/main, byte for byte (git-ref sandbox)', () => {
  for (const [label, set] of [['switch off', off], ['switch on, no salt', () => { process.env.DCHUB_FIRST_PLAN_DEPTH_TEST = '1'; }]]) {
    it(`${label}: the first plan, its tracked rows and the backend's caller tier`, async () => {
      if (!O) { console.warn(`[first-plan-depth-m22] origin/main comparison not run: ${why}`); return; }
      set();
      try {
        const ip = ipIn(KFF_ARM_EMAIL);
        const fh = H.hits.length, fo = O.hits.length;
        heardH.length = 0; heardO.length = 0;
        const here = await plan(H, ip);
        const main = await plan(O, ip);
        expect(norm(here)).toBe(norm(main));
        expect(heardH).toEqual(heardO);
        expect(rowsNorm(await trackRows(H, fh))).toBe(rowsNorm(await trackRows(O, fo)));
      } finally { off(); }
    }, 120_000);
  }
});

describe('through the real handler, each step a real loopback request', () => {
  it('pro_depth: the steps read at full depth, as today; kff_arm leads the plan row and every step row', async () => {
    const { res, rows, heard } = await armedPlan(KFF_ARM_PRO);
    expect(res.structuredContent.first_full_answer).toMatchObject({ used: 1 });
    expect(heard).toEqual(['pro']);
    for (const k of DECISION) expect(typeof gridStep(res).figures[k], k).toBe('number');
    const planRow = rows.find((r) => r.tool === 'execute_plan');
    expect(planRow.status).toBe('keyless_first_full_answer');
    expect(Object.keys(planRow.params)[0]).toBe('kff_arm');
    expect(planRow.params.kff_arm).toBe(KFF_ARM_PRO);
    for (const t of STEP_TOOLS) expect(rows.find((r) => r.tool === t).params.kff_arm, t).toBe(KFF_ARM_PRO);
  }, 120_000);

  it('email_depth: the steps take the email key\'s depth; the grid step equals a direct email-bound key call', async () => {
    const { res, rows, heard } = await armedPlan(KFF_ARM_EMAIL);
    expect(res.structuredContent.first_full_answer).toMatchObject({ used: 1 });
    expect(rows.find((r) => r.tool === 'execute_plan').status).toBe('keyless_first_full_answer');
    for (const r of rows.filter((x) => x.tool === 'execute_plan' || STEP_TOOLS.includes(x.tool))) {
      expect(Object.keys(r.params)[0], r.tool).toBe('kff_arm');
      expect(r.params.kff_arm, r.tool).toBe(KFF_ARM_EMAIL);
      expect(r.tier, r.tool).toBe('free');   // the caller's own tier is logged, never a promoted one
    }
    heardH.length = 0;
    const d = await H.call('/mcp', 'get_grid_intelligence', { iso: 'ERCOT' }, { ...UA, 'x-forwarded-for': '198.18.99.1', 'x-api-key': EMAIL_KEY });
    expect(heard).toEqual(heardH);   // the backend saw the same caller tier: 'free'
    expect(heard).toEqual(['free']);
    const figures = gridStep(res).figures;
    const direct = d.msg.result.structuredContent;
    // Every data field the step shows; next_session and starter_pack are the caller's session envelope (a keyed vs a
    // keyless caller, a session's first call), not data.
    const shared = Object.keys(figures).filter((k) => k in direct && k !== 'next_session' && k !== 'starter_pack');
    expect(shared.length).toBeGreaterThan(15);
    for (const k of shared) expect(norm(figures[k]), k).toBe(norm(direct[k]));   // served_at is per call
    for (const k of DECISION) expect(figures[k], k).toBeNull();
  }, 120_000);

  it('QA and bot callers are not assigned: no arm on any row, the steps keep today\'s depth', async () => {
    for (const extra of [{ 'x-dchub-qa': '1' }, { 'user-agent': 'dchub-internal/1.0' }]) {
      const { rows } = await armedPlan(KFF_ARM_EMAIL, extra);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.params && r.params.kff_arm, JSON.stringify(extra) + ' ' + r.tool).toBeUndefined();
    }
  }, 120_000);

  it('the switch on without a salt: no arm, today\'s full depth', async () => {
    process.env.DCHUB_FIRST_PLAN_DEPTH_TEST = '1';
    try {
      const from = H.hits.length; heardH.length = 0;
      const res = await plan(H, ipIn(KFF_ARM_EMAIL));
      const rows = await trackRows(H, from);
      expect(res.structuredContent.first_full_answer).toMatchObject({ used: 1 });
      expect(heardH).toEqual(['pro']);
      for (const r of rows) expect(r.params && r.params.kff_arm, r.tool).toBeUndefined();
    } finally { off(); }
  }, 120_000);
});
