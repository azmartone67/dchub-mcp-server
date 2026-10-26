// internal-challenge-state.test.mjs (2026-10-25): POST /mcp/internal/challenge-state
// tells our sentinel probe whether the anonymous-connector challenge is ON and how
// much of THIS caller's CHALLENGE_MAX is used. The probe ran from one egress IP whose
// budget was spent, so it reported INDETERMINATE (healthy) whether or not the
// challenge worked. Real server.mjs app on loopback, stub backend, no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { challengeCallerKey, challengeState } from '../lib/challenge-state.mjs';

const KEY = 'test-internal-key-not-a-real-secret';   // the harness's DCHUB_INTERNAL_KEY
let H, fence, prevWorkos;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
  prevWorkos = process.env.DCHUB_WORKOS_OAUTH_ENABLED;   // read per call by _workosEnabled()
}, 120_000);
afterAll(async () => {
  if (prevWorkos === undefined) delete process.env.DCHUB_WORKOS_OAUTH_ENABLED;
  else process.env.DCHUB_WORKOS_OAUTH_ENABLED = prevWorkos;
  if (H) await H.stop();
  if (fence) fence.restore();
});

const state = (headers = {}) => H.post('/mcp/internal/challenge-state', {}, headers);

describe('POST /mcp/internal/challenge-state', () => {
  it('is internal only: no key or a wrong key is 403 and says nothing', async () => {
    for (const h of [{}, { 'x-internal-key': 'nope' }]) {
      const r = await state(h);
      expect(r.status).toBe(403);
      expect(r.raw).not.toMatch(/challenge|budget|WORKOS/i);
    }
  });

  it('names every gate that turns the challenge off', async () => {
    delete process.env.DCHUB_WORKOS_OAUTH_ENABLED;
    const r = await state({ 'x-internal-key': KEY, 'x-dc-client-ip': '198.51.100.20' });
    expect(r.status).toBe(200);
    expect(r.msg.effective).toBe('off');
    expect(r.msg.off_reasons).toContain('DCHUB_WORKOS_OAUTH_ENABLED is not on');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('counts the challenges the LIVE handler issued to this caller, and only this caller', async () => {
    process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1';
    const ip = '198.51.100.7';
    const hdr = { 'user-agent': 'Claude-User', 'x-dc-client-ip': ip };
    const before = (await state({ 'x-internal-key': KEY, 'x-dc-client-ip': ip })).msg;
    expect(before).toMatchObject({ effective: 'on', caller_key_source: 'x-dc-client-ip', caller_challenges_issued: 0 });
    const init = await H.init('/mcp', 'claude-ai', hdr);
    const sid = init.headers.get('mcp-session-id');
    expect(sid).toBeTruthy();
    const h = { ...hdr, 'mcp-session-id': sid };
    let got401 = false;
    for (let i = 0; i < 4 && !got401; i++) {
      const r = await H.call('/mcp', 'why_dchub', {}, h);
      got401 = r.status === 401;
    }
    expect(got401, 'the live challenge never fired, so this test proves nothing').toBe(true);
    const after = (await state({ 'x-internal-key': KEY, 'x-dc-client-ip': ip })).msg;
    expect(after.caller_challenges_issued).toBe(1);
    expect(after.caller_budget_left).toBe(after.challenge_max - 1);
    // Another caller's budget is untouched.
    const other = (await state({ 'x-internal-key': KEY, 'x-dc-client-ip': '198.51.100.99' })).msg;
    expect(other.caller_challenges_issued).toBe(0);
    // It never echoes the IP it keyed on.
    expect(JSON.stringify(after)).not.toContain(ip);
  });
});

describe('lib/challenge-state', () => {
  it('caller key: edge IP, then the first X-Forwarded-For hop, then none', () => {
    expect(challengeCallerKey({ 'x-dc-client-ip': ' 1.1.1.1 ', 'x-forwarded-for': '2.2.2.2' })).toEqual({ key: '1.1.1.1', source: 'x-dc-client-ip' });
    expect(challengeCallerKey({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' })).toEqual({ key: '2.2.2.2', source: 'x-forwarded-for' });
    expect(challengeCallerKey({})).toEqual({ key: '', source: 'none' });
    expect(challengeCallerKey(null)).toEqual({ key: '', source: 'none' });
  });

  it('state: on, off with every reason, and budget arithmetic', () => {
    const on = challengeState({ workosEnabled: true, killSwitch: false, claudeAllowed: true, afterN: 1, max: 3, issued: 3, callerKeySource: 'x-dc-client-ip' });
    expect(on).toMatchObject({ effective: 'on', off_reasons: [], caller_challenges_issued: 3, caller_budget_left: 0 });
    const off = challengeState({ workosEnabled: false, killSwitch: true, claudeAllowed: false, afterN: 1, max: 0, issued: 0 });
    expect(off.effective).toBe('off');
    expect(off.off_reasons).toEqual(['DCHUB_WORKOS_OAUTH_ENABLED is not on', 'DCHUB_OAUTH_CHALLENGE_DISABLE is on',
      'DCHUB_CHALLENGE_MAX is 0', 'DCHUB_CHALLENGE_CLIENTS does not include claude']);
    expect(challengeState({ workosEnabled: true, claudeAllowed: true, max: 3, issued: 1 }).caller_budget_left).toBe(2);
    expect(challengeState({ workosEnabled: true, claudeAllowed: true, max: 3, issued: 'x' }).caller_challenges_issued).toBe(0);
  });
});
