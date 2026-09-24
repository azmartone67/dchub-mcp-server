// relay-cap-no-session.test.mjs — r-relay-cap-anon (2026-09-24)
//
// r-relay-cap keeps one human line per session. Sessionless gated calls pass the
// literal 'no-session', and the cap counted it as a session, so the first
// sessionless caller on a replica silenced the relay line for every later
// sessionless caller. Measured live 2026-09-24: 0 of 4 sessionless gated calls
// carried HUMAN_FIRST_MARKER in the text; the same call with a session did.
//
// Guards: 'no-session' and '' never cap; a real session still caps (control),
// and the cap never leaks across sessions.
//
// Qualifies for the hard gate: deterministic, no network, mutates nothing.
import { describe, it, expect } from 'vitest';
import { composeHumanCta, HUMAN_FIRST_MARKER } from '../server.mjs';

const URL_H = 'https://dchub.cloud/upgrade/h/tok.sig';
// A gated body that already carries its wall's /go/c pointer: the shape on which
// the cap drops the relay tail for a repeat session.
const body = () => '{"iso":"ERCOT","rows":[1,2,3]}\n\n📦 **Depth-limited preview** → https://dchub.cloud/go/c/abc.def';
const has = (s) => s.includes(HUMAN_FIRST_MARKER);
let n = 0;
const realSid = () => 'relay-cap-anon-' + (++n) + '-' + Date.now();

describe("sessionless callers are never capped", () => {
  it.each(['no-session', ''])('every call with session %j keeps the relay line', (sid) => {
    for (let i = 0; i < 4; i++) {
      expect(has(composeHumanCta(URL_H, body(), null, sid))).toBe(true);
    }
  });

  it("a real session using the line does not silence 'no-session' either", () => {
    const s = realSid();
    expect(has(composeHumanCta(URL_H, body(), null, s))).toBe(true);
    expect(has(composeHumanCta(URL_H, body(), null, 'no-session'))).toBe(true);
  });
});

describe('control: a real session is still capped to one line', () => {
  it('second gated response in the same session drops the repeat tail', () => {
    const s = realSid();
    expect(has(composeHumanCta(URL_H, body(), null, s))).toBe(true);
    const second = composeHumanCta(URL_H, body(), null, s);
    expect(has(second)).toBe(false);
    expect(second).toContain('https://dchub.cloud/go/c/');   // the wall's own pointer stays
  });

  it('a different real session still gets its line', () => {
    const a = realSid(); const b = realSid();
    composeHumanCta(URL_H, body(), null, a);
    expect(has(composeHumanCta(URL_H, body(), null, b))).toBe(true);
  });
});
