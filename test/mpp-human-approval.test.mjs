/**
 * HUMAN-APPROVAL POLICY for agent payments (owner, agent QA round 2, 2026-10-20).
 *
 * Agent QA found get_fiber_intel (and every MPP tool) telling the agent it could
 * pay $0.50/call itself: "a declared parameter of this tool, so you can set it
 * yourself ... No key, no account, no human." Owner: any payment requires the
 * human's explicit approval; agent-facing text must never invite the agent to
 * spend on its own. The human-relayed link stays the one ask.
 *
 * Pinned with the rail ARMED (MPP_ENABLED=1), so it cannot pass just because MPP
 * happens to be dark.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
const HOOK = readFileSync(join(ROOT, 'mpp-hook.mjs'), 'utf8');
// Phrases that invite an agent to pay on its own. Checked against string
// literals only (comments may quote them as history).
const INVITE_RE = /set (?:them|it) yourself|no human needed|no human, no account|No key, no account, no human|pay autonomously|pay(?: for it per call)? yourself|pay for this call YOURSELF|Autonomous agents? (?:can|\?)|TO PAY IT YOURSELF/i;
let mpp; let realFetch;

function literalLines(src) {
  // comments, and the existing prose detector regex (a matcher, not copy)
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !l.includes('_MPP_PROSE_RE'));
}

beforeAll(async () => {
  process.env.MPP_ENABLED = '1';
  process.env.MPP_SIDECAR_URL = 'http://127.0.0.1:1';
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true, price_usd: '0.50',
    challenge: { id: 'c1', expires: '2099-01-01T00:00:00Z', intent: 'charge', method: 'stripe' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  mpp = await import('../mpp-hook.mjs');
});
afterAll(() => { globalThis.fetch = realFetch; });

describe('no passive self-pay offer is ever shipped', () => {
  it('the policy flag is off', () => {
    expect(mpp.MPP_SELF_PAY_ADVERTISED).toBe(false);
  });
  it('every offer builder returns null for every payable tool, rail armed', async () => {
    for (const t of mpp.MPP_COVERED_TOOLS) {
      expect(mpp.mppAdvertiseHint(t)).toBeNull();
      expect(await mpp.mppOffer(t)).toBeNull();
      expect(await mpp.mppPrewallOffer(t, 0)).toBeNull();
      expect(mpp.mppUndercapOffer(t, 3)).toBeNull();
    }
  });
  it('server.mjs gates the wall block, the paywall text, the tease and the preview offer on the flag', () => {
    const wall = SERVER.slice(SERVER.indexOf('function _wallMachinePay('), SERVER.indexOf('function _wallMachinePay(') + 400);
    expect(wall).toMatch(/if \(!MPP_SELF_PAY_ADVERTISED\) return undefined;/);
    expect(SERVER).toMatch(/const _mppOn = MPP_SELF_PAY_ADVERTISED && mppEnabled\(\);/);
    expect(SERVER).toMatch(/if \(MPP_SELF_PAY_ADVERTISED && mppEnabled\(\) && isMppTool\(name\)\) \{/);
    expect(SERVER).toMatch(/const _mppSC = \(MPP_SELF_PAY_ADVERTISED && mppEnabled\(\) && isMppTool\(name\)\)/);
    expect(SERVER).toMatch(/if \(MPP_SELF_PAY_ADVERTISED && process\.env\.X402_ENABLED === 'true'/);
  });
});

describe('every payment text that remains requires the human\'s approval', () => {
  it('the payment params say the human must approve', () => {
    const shape = mpp.mppArgShape();
    for (const k of mpp.MPP_ARG_KEYS) {
      const d = shape[k].description || shape[k]._def?.description || '';
      expect(d).toMatch(/human/i);
      expect(d).toMatch(/approv/i);
      expect(d).not.toMatch(/Agents only/);
    }
  });
  it('the explicit-request challenge (mpp_pay=true) leads with the approval rule', async () => {
    const e = await mpp.mppChallengeError('get_fiber_intel');
    expect(e).toBeTruthy();
    expect(e.message).toContain(mpp.MPP_HUMAN_APPROVAL_LINE);
    expect(e.message).not.toMatch(INVITE_RE);
  });
  it('no string literal in server.mjs or mpp-hook.mjs invites the agent to pay on its own', () => {
    const hits = [...literalLines(SERVER), ...literalLines(HOOK)].filter((l) => INVITE_RE.test(l));
    expect(hits).toEqual([]);
  });
  it('the relay instruction no longer points to machine_pay', () => {
    expect(SERVER).not.toMatch(/If you can pay autonomously instead, see machine_pay/);
  });
});
