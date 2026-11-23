// first-plan-depth-m22.test.mjs — Grok free-to-paid note, M2.2 (owner 2026-11-18): the first-plan depth test
// (lib/first-plan-depth-test.mjs).
//
//   * the arm: off by default, off without a salt (fail closed), 50±2% over 10k synthetic IPs, stable per IP;
//   * the step token carries the arm once, and a reused token carries nothing;
//   * kff_arm rides first in the LOGGED params, never in the handler's args.
//   * 2026-11-23 (owner): execute_plan left the keyless first-full lane, so no keyless plan is a first full answer
//     and the arm is never assigned through the real handler. The lib is kept (inert); the end-to-end section below
//     pins that a keyless plan carries no arm and no full depth with the switch on, salted or not.
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
import { beforeAll, afterAll } from 'vitest';

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
const heardH = [];
let H, fence;
const _compact = process.env.DCHUB_PLAN_COMPACT;
beforeAll(async () => {
  process.env.DCHUB_PLAN_COMPACT = '0';   // this file reads executed[] step bodies
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: validate(routes(heardH)) });
}, 180_000);
afterAll(async () => {
  for (const k of ['DCHUB_FIRST_PLAN_DEPTH_TEST', 'DCHUB_FIRST_PLAN_TEST_SALT']) delete process.env[k];
  if (_compact === undefined) delete process.env.DCHUB_PLAN_COMPACT; else process.env.DCHUB_PLAN_COMPACT = _compact;
  if (H) await H.stop();
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

describe('through the real handler, each step a real loopback request (owner 2026-11-23: no keyless plan is full)', () => {
  for (const arm of [KFF_ARM_PRO, KFF_ARM_EMAIL]) {
    it(`switch on, salted, an IP in the ${arm} arm: no first full answer, no arm on any row, no full-depth step`, async () => {
      const { res, rows, heard } = await armedPlan(arm);
      expect(res.structuredContent.first_full_answer).toBeUndefined();
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.params && r.params.kff_arm, r.tool).toBeUndefined();
      expect(rows.find((r) => r.tool === 'execute_plan').status).not.toBe('keyless_first_full_answer');
      expect(heard).not.toContain('pro');
      for (const k of DECISION) expect(gridStep(res).figures ? gridStep(res).figures[k] ?? null : null, k).toBeNull();
    }, 120_000);
  }

  it('QA and bot callers are not assigned: no arm on any row', async () => {
    for (const extra of [{ 'x-dchub-qa': '1' }, { 'user-agent': 'dchub-internal/1.0' }]) {
      const { rows } = await armedPlan(KFF_ARM_EMAIL, extra);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.params && r.params.kff_arm, JSON.stringify(extra) + ' ' + r.tool).toBeUndefined();
    }
  }, 120_000);

  it('the switch on without a salt: no arm, no first full answer', async () => {
    process.env.DCHUB_FIRST_PLAN_DEPTH_TEST = '1';
    try {
      const from = H.hits.length; heardH.length = 0;
      const res = await plan(H, ipIn(KFF_ARM_EMAIL));
      const rows = await trackRows(H, from);
      expect(res.structuredContent.first_full_answer).toBeUndefined();
      expect(heardH).not.toContain('pro');
      for (const r of rows) expect(r.params && r.params.kff_arm, r.tool).toBeUndefined();
    } finally { off(); }
  }, 120_000);
});
