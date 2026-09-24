// relay-one-ask.test.mjs — r-relay-one-ask (2026-09-24)
//
// Measured live 2026-09-24 after #530: sessionless get_grid_intelligence carried
// the `→ **For your human:**` relay line 3 of 3 times, but get_fiber_intel and
// get_water_risk never did. Their wall line (trialHeader) read "your human can
// pay in one click → /go/c …", which _HUMAN_CTA_SIGNATURES counts as the
// response's one human ask, so composeHumanCta dropped the /upgrade/h relay and
// the human was sent straight to a raw checkout (0 minted-link clicks in 7d).
//
// Guards: the wall line is a payer-facing checkout pointer (rungs and links
// intact) and not a human ask; composing it the way the gated trial path does
// yields exactly ONE human ask, the relay line with the /upgrade/h link; and
// machine_pay no longer tells agents to prefer paying over relaying.
//
// Qualifies for the hard gate: deterministic, no network, mutates nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  trialHeader, composeHumanCta, HUMAN_FIRST_MARKER, _hasHumanCta, _ctxALS,
} from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const withCtx = (c, fn) => _ctxALS.run(c, fn);
const RELAY = 'https://dchub.cloud/upgrade/h/tok.sig';
const count = (s, sub) => s.split(sub).length - 1;

describe('the trial wall line is a checkout pointer, not the human ask', () => {
  it.each(['no-session', '', 'e6f1c0de-1234-4aaa-9999-abcdef012345'])('session %j', (sid) => {
    const line = withCtx({ session_id: sid }, () => trialHeader('get_fiber_intel', sid, '3 of 2358 results shown'));
    expect(_hasHumanCta(line)).toBe(false);
    expect(line).not.toMatch(/your human/i);
    expect(line).toContain('the payer checks out in one click: ');
    expect(line).toContain('**$10 one-time = 1,000 API credits**');   // rungs unchanged
    expect(line).toMatch(/credits don’t expire → https:\/\//);          // checkout link kept
    expect(line).toContain('claim_free_key');                          // off-ramp kept
  });
});

describe('composed the way the gated trial path composes it', () => {
  // server.mjs: composeHumanCta(_humanUrlB, phase9L_clean_preview(_upgradeHeader, _trialText) + …)
  it.each(['get_fiber_intel', 'get_water_risk', 'rank_markets'])('%s carries exactly one human ask: the relay line', (tool) => {
    const sid = 'no-session';
    const body = '{"rows":[1,2,3]}\n\n---\n\n' + withCtx({ session_id: sid }, () => trialHeader(tool, sid, '3 of 20 results shown'));
    const out = withCtx({ session_id: sid }, () => composeHumanCta(RELAY, body, null, sid));
    expect(count(out, HUMAN_FIRST_MARKER)).toBe(1);
    expect(count(out, RELAY)).toBe(1);
    expect(out.indexOf(HUMAN_FIRST_MARKER)).toBeGreaterThan(out.indexOf('{"rows"'));   // data leads
  });

  it('the call site still feeds trialHeader through composeHumanCta with the relay url', () => {
    expect(SRC).toMatch(/: trialHeader\(name, _sid, _gapClause\);/);
    expect(SRC).toMatch(/composeHumanCta\(_humanUrlB, phase9L_clean_preview\(_upgradeHeader, _trialText\)/);
  });
});

describe('machine_pay does not steer agents away from the human', () => {
  it('the payable note no longer says to prefer paying over relaying', () => {
    const start = SRC.indexOf('function _wallMachinePay(');
    const fn = SRC.slice(start, SRC.indexOf('\n}\n', start));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).not.toMatch(/over relaying to your human/i);
  });
});
