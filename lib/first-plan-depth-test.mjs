// first-plan-depth-test.mjs -- the first-plan depth test (Grok free-to-paid note, M2.2; owner 2026-11-18
// "lets do 1 and 2").
//
// WHY. A keyless caller's first execute_plan of the day runs its steps at full depth (KEYLESS_FIRST_FULL_STEP_TIER,
// owner 2026-11-15, Grok note G). Nobody has measured whether that depth, rather than the email key's depth the
// direct first-full calls get, is what brings a caller back or to a key. This splits the first plans in two.
//
// WHAT. firstPlanArm(clientIp): a deterministic arm per caller IP, sha256(salt + IP), on the same IP basis as
// capWallIdentity (lib/keyless-wall.mjs, ctx.client_ip):
//   'pro_depth'    the plan's steps run at full depth, exactly as today;
//   'email_depth'  the plan's steps take the email-bound free key's gate and forward caller tier 'free', the same
//                  depth a direct first-full call is served at (server.mjs, the step-tier promotion is skipped).
// Assigned only where the plan is CHARGED as its caller's first full answer (seat 'charge'): a QA caller
// ('observe') and a bot or internal caller (no seat) get no arm and today's path. The arm is logged as
// params.kff_arm on the plan's row and on every step row (mcp_tool_calls.params; the funnel reads it on rows with
// gate_status='keyless_first_full_answer').
//
// Switches (read per call), fail closed:
//   DCHUB_FIRST_PLAN_DEPTH_TEST   OFF unless 1/on/true/yes. Off = today's path, byte for byte.
//   DCHUB_FIRST_PLAN_TEST_SALT    the hash salt. Unset or blank = the test is off, whatever the switch says.
import { createHash } from 'node:crypto';

export const FIRST_PLAN_DEPTH_TEST_FLAG = 'DCHUB_FIRST_PLAN_DEPTH_TEST';
export const FIRST_PLAN_TEST_SALT_ENV = 'DCHUB_FIRST_PLAN_TEST_SALT';
export const KFF_ARM_EMAIL = 'email_depth';
export const KFF_ARM_PRO = 'pro_depth';
export const KFF_ARMS = Object.freeze([KFF_ARM_EMAIL, KFF_ARM_PRO]);

function _salt(env) {
  return String((env && env[FIRST_PLAN_TEST_SALT_ENV]) || '').trim();
}

export function firstPlanDepthTestOn(env = process.env) {
  return /^(1|on|true|yes)$/i.test(String((env && env[FIRST_PLAN_DEPTH_TEST_FLAG]) || '').trim()) && !!_salt(env);
}

// The arm for this caller IP, or null (test off, no salt, no IP).
export function firstPlanArm(clientIp, env = process.env) {
  try {
    if (!firstPlanDepthTestOn(env)) return null;
    const ip = String(clientIp || '').trim();
    if (!ip) return null;
    const h = createHash('sha256').update(_salt(env) + ip).digest();
    return (h[0] & 1) === 0 ? KFF_ARM_EMAIL : KFF_ARM_PRO;
  } catch (_) { return null; }
}

export const isKffArm = (a) => KFF_ARMS.includes(a);

// The params object to LOG with the arm first (the writer clips params at 4,000 characters; the funnel reads
// the arm by regex). `params` is never touched; no arm = `params` itself.
export function withKffArm(params, arm) {
  if (!isKffArm(arm)) return params;
  return { kff_arm: arm, ...(params && typeof params === 'object' && !Array.isArray(params) ? params : {}) };
}
