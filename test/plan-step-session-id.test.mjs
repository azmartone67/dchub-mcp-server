// execute_plan steps are sessionless loopback calls, so every paywall signal and tracking row a step wrote carried
// session 'no-session' / null: all plan-step walls collapsed into ONE phantom session in the funnel's
// distinct-session count, and the step calls could not be joined to the caller (seen 2026-10-06: analyze_site and
// get_composite_site_score lp_wall signals from a Grok plan, both 'no-session').
// Each step now carries the caller's session through a single-use in-process token (forwarding the live
// mcp-session-id header would route the step into the caller's own in-flight transport).
// Real server.mjs on loopback, stub backend: no network, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const UA = { 'user-agent': 'Claude-User' };
const INTENT = { intent: 'analyze site 33.45,-112.07 for 100 MW and score it' };
// server.mjs is imported AFTER the harness has set DCHUB_API_BASE and PORT (it reads both once, at import); a
// top-level import here would load it against production defaults and send the plan's loopback nowhere useful.
let H, fence, run = {}, _mintPlanSessionToken, _consumePlanSessionToken;

async function settle(quietMs = 400, maxMs = 8000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
const signalsOf = (hits) => hits.filter((h) => h.path === '/api/v1/mcp/signal-paywall' && h.body).map((h) => h.body);
const tracksOf = (hits) => hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool && h.body.event !== 'recipe_lifecycle').map((h) => h.body);

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
  ({ _mintPlanSessionToken, _consumePlanSessionToken } = await import('../server.mjs'));
  await settle();
  // 1. a plan run inside a real session
  let before = H.hits.length;
  const init = await H.init('/mcp', 'claude-ai', UA);
  run.sid = init.headers.get('mcp-session-id');
  await H.call('/mcp', 'execute_plan', INTENT, { ...UA, 'mcp-session-id': run.sid });
  await settle();
  run.plan = H.hits.slice(before);
  // 2. an OUTSIDE caller sending the header with a token it made up (and one shaped like a real token)
  before = H.hits.length;
  const fake = 'f'.repeat(72);
  const init2 = await H.init('/mcp', 'claude-ai', UA);
  run.outsiderSid = init2.headers.get('mcp-session-id');
  await H.call('/mcp', 'analyze_site', { lat: 33.45, lon: -112.07 }, { ...UA, 'x-dchub-plan-session': fake });
  await settle();
  run.outsider = H.hits.slice(before);
}, 180_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('a plan step carries the caller session', () => {
  it('control: the plan ran real gated steps that wrote paywall signals and tracking rows', () => {
    expect(run.sid, 'a real session id').toMatch(/^[0-9a-f-]{20,}$/);
    expect(signalsOf(run.plan).length).toBeGreaterThan(0);
    expect(tracksOf(run.plan).filter((t) => t.tool !== 'execute_plan' && t.tool !== 'execute_plan_steps').length).toBeGreaterThan(0);
  });
  it('every plan-step paywall signal carries the caller session, never no-session', () => {
    for (const s of signalsOf(run.plan)) {
      expect(s.session_id, `${s.tool} ${s.signal_type}`).toBe(run.sid);
      expect(s.session_id).not.toBe('no-session');
    }
  });
  it('every plan-step tracking row carries the caller session too', () => {
    for (const t of tracksOf(run.plan)) expect(t.session_id, t.tool).toBe(run.sid);
  });
});

describe('an outside caller cannot borrow a session', () => {
  it('a made-up token in x-dchub-plan-session is ignored: the call stays sessionless', () => {
    const sigs = signalsOf(run.outsider).filter((s) => s.tool === 'analyze_site');
    const trk = tracksOf(run.outsider).filter((t) => t.tool === 'analyze_site');
    expect(sigs.length + trk.length, 'control: the outsider call reached the gate').toBeGreaterThan(0);
    for (const s of sigs) { expect(s.session_id).toBe('no-session'); expect(s.session_id).not.toBe(run.sid); }
    for (const t of trk) { expect(t.session_id == null).toBe(true); }
  });
});

describe('the token', () => {
  it('names a session once, and only once', () => {
    const tok = _mintPlanSessionToken('sess-abc');
    expect(typeof tok).toBe('string');
    expect(_consumePlanSessionToken(tok)).toBe('sess-abc');
    expect(_consumePlanSessionToken(tok), 'single use').toBeNull();
  });
  it('expires', () => {
    const t0 = 1_000_000;
    const tok = _mintPlanSessionToken('sess-exp', t0);
    expect(_consumePlanSessionToken(tok, t0 + 121_000), 'past the two-minute window').toBeNull();
    const ok = _mintPlanSessionToken('sess-ok', t0);
    expect(_consumePlanSessionToken(ok, t0 + 119_000)).toBe('sess-ok');
  });
  it('refuses to mint for no session, and to resolve junk', () => {
    for (const bad of [undefined, null, '', 0, {}]) expect(_mintPlanSessionToken(bad), String(bad)).toBeNull();
    for (const bad of [undefined, null, '', 'nope', 42, {}]) expect(_consumePlanSessionToken(bad), String(bad)).toBeNull();
  });
  it('two tokens for one session are independent', () => {
    const a = _mintPlanSessionToken('s1'), b = _mintPlanSessionToken('s1');
    expect(a).not.toBe(b);
    expect(_consumePlanSessionToken(a)).toBe('s1');
    expect(_consumePlanSessionToken(b)).toBe('s1');
  });
});
