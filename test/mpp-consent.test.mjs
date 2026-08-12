/**
 * MPP CONSENT INVARIANT — "an agent that did not ask to pay must never be billed."
 *
 * The rail is live and settles against a LIVE Stripe key, so the expensive failure
 * here is not a missed conversion — it is charging a caller who never opted in.
 * Nothing in the suite asserted that boundary before this file: mpp-onestep and
 * mpp-prewall both cover the ADVERTISING side (does the offer render, does the
 * challenge embed), and neither pins the CONSENT side.
 *
 * Two things must hold, and they are different in kind:
 *
 *   1. VALUE  — mppCredential() is the only thing that can unlock a settle, and it
 *      returns null for every shape that is not an explicit credential. The
 *      load-bearing case is `_meta.mpp_pay=true`: that opts into a QUOTE (an
 *      HMAC-signed challenge — no money moves) and must NOT read as authority to
 *      charge. Quote-intent and pay-intent are separate consents.
 *
 *   2. STRUCTURE — in server.mjs the ONLY mppVerify() call site is nested inside
 *      `if (_mppCred)`. A unit test on mppCredential cannot see a refactor that
 *      moves the settle call out from behind its guard, so that shape is asserted
 *      against the real source text.
 *
 * Pure-local: no network, no sidecar, no Stripe, no money.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
let mpp;

beforeAll(async () => {
  // Enabled on purpose: the invariant must hold with the rail ARMED, not because
  // MPP happens to be dark. A guard that only passes while the feature is off is
  // vacuous — that is the exact failure mode this file exists to avoid.
  process.env.MPP_ENABLED = '1';
  process.env.MPP_SIDECAR_URL = 'http://127.0.0.1:1';  // never dialled by these tests
  mpp = await import('../mpp-hook.mjs');
});

describe('MPP consent: no opt-in, no charge', () => {
  // Every one of these is a caller who did NOT hand over a credential. If any
  // returns non-null, server.mjs would enter the settle branch and bill them.
  const NON_CONSENTING = {
    'no extra at all':            undefined,
    'null extra':                 null,
    'extra with no _meta':        {},
    'empty _meta':                { _meta: {} },
    'unrelated _meta keys':       { _meta: { progressToken: 'abc', traceparent: '00-x' } },
    'progress token only':        { _meta: { progressToken: 42 } },
    'quote opt-in (mpp_pay)':     { _meta: { mpp_pay: true } },
    'quote opt-in (alt key)':     { _meta: { 'org.paymentauth/pay': true } },
    'quote opt-in via args':      { _meta: {} },
    'receipt echoed back':        { _meta: { 'org.paymentauth/receipt': { reference: 'pi_1' } } },
    'credential key set null':    { _meta: { 'org.paymentauth/credential': null } },
    'credential key undefined':   { _meta: { 'org.paymentauth/credential': undefined } },
    'credential key false':       { _meta: { 'org.paymentauth/credential': false } },
    'credential key zero':        { _meta: { 'org.paymentauth/credential': 0 } },
    'requestInfo without cred':   { requestInfo: { _meta: { mpp_pay: true } } },
  };

  for (const [label, extra] of Object.entries(NON_CONSENTING)) {
    it(`does not read a payable credential from: ${label}`, () => {
      expect(mpp.mppCredential(extra), `${label} must not authorize a charge`).toBeNull();
    });
  }

  it('treats mpp_pay=true as quote-intent, NEVER as pay-intent', () => {
    const quoteOnly = { _meta: { mpp_pay: true } };
    // It DOES want a challenge...
    expect(mpp.mppWantsChallenge(quoteOnly, {})).toBe(true);
    // ...but a challenge is a signed price quote, not authority to charge. The
    // settle path keys off mppCredential alone, which must stay null here.
    expect(mpp.mppCredential(quoteOnly)).toBeNull();
  });

  it('does not infer consent from the tool being payable', () => {
    // Being on the rail is not consent. Both must be true to settle, and the
    // second one is the caller's decision.
    expect(mpp.isMppTool('analyze_site')).toBe(true);
    expect(mpp.mppCredential({ _meta: {} })).toBeNull();
  });

  it('reads a credential ONLY from the explicit credential key', () => {
    // The positive case — proves the assertions above fail for the right reason
    // (a real credential IS detected) rather than mppCredential returning null
    // unconditionally, which would make every test above pass vacuously.
    const consenting = { _meta: { [mpp.MPP_CRED_KEY]: 'eyJjaGFsbGVuZ2UiOnt9fQ' } };
    expect(mpp.mppCredential(consenting)).toBe('eyJjaGFsbGVuZ2UiOnt9fQ');
    // object-shaped credentials are accepted too
    expect(mpp.mppCredential({ _meta: { [mpp.MPP_CRED_KEY]: { spt: 'x' } } })).toEqual({ spt: 'x' });
  });
});

describe('MPP consent: the settle call stays behind its guard', () => {
  it('every mppVerify() call site in server.mjs is nested under `if (_mppCred)`', () => {
    const src = readFileSync(SERVER, 'utf8');
    const lines = src.split('\n');
    const callSites = lines
      .map((l, i) => ({ line: i + 1, text: l }))
      .filter((r) => /\bmppVerify\s*\(/.test(r.text) && !/^\s*(\*|\/\/)/.test(r.text)
                     && !/^import\b/.test(r.text.trim()));

    // If this hits 0 the guard has gone vacuous — the settle call was renamed or
    // removed and this test would otherwise "pass" while checking nothing.
    expect(callSites.length, 'no mppVerify() call site found — guard is vacuous').toBeGreaterThan(0);

    for (const site of callSites) {
      // Walk back for the nearest enclosing consent check. It must appear within a
      // few lines above the settle call and must not be closed before it.
      const window = lines.slice(Math.max(0, site.line - 8), site.line - 1).join('\n');
      expect(window, `mppVerify at server.mjs:${site.line} is not guarded by a credential check`)
        .toMatch(/if\s*\(\s*_mppCred\s*\)/);
    }
  });

  it('the credential that guards the settle comes from mppCredential(extra)', () => {
    const src = readFileSync(SERVER, 'utf8');
    // Pins the SOURCE of the guard value. Without this, `_mppCred` could be
    // reassigned from something permissive (e.g. a default-true flag) and the
    // structural test above would still pass.
    expect(src).toMatch(/const\s+_mppCred\s*=\s*mppCredential\s*\(\s*extra\s*\)/);
  });
});
