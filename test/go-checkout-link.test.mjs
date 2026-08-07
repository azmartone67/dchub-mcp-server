// go-checkout-link.test.mjs — guards for the /go/c click-tracked checkout link.
//
// The point of this change is MEASUREMENT, and the way a measurement change
// does damage is by breaking the thing it measures. So the assertions are
// weighted accordingly: one test proves the link is wrapped, and five prove
// that every degraded path still yields a URL a human can actually pay at.
//
// The attribution assertion is the load-bearing one. client_reference_id is
// what binds a payment back to the caller (Fix E session-bind; r-durable-key
// pk-/k- durable-key bind). If _goUrl dropped or mangled the ref, checkouts
// would still succeed and nobody would notice for weeks — the payment would
// just stop attaching to the key that earned it. That is a silent revenue
// bug, so the ref is asserted to survive the round trip byte-for-byte.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { _goUrl } from '../server.mjs';

const SECRET = 'test-internal-key-not-a-real-secret';
const PACK = 'https://buy.stripe.com/9B69AU08y2FfbSR55UaZi0i';
const DEV  = 'https://buy.stripe.com/7sY5kE8F4fs13ml0PEaZi0c';
const REF  = 'pk-' + 'a'.repeat(64);

let _savedKey, _savedFlag;
beforeEach(() => {
  _savedKey = process.env.DCHUB_INTERNAL_KEY;
  _savedFlag = process.env.DCHUB_GO_LINKS;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  delete process.env.DCHUB_GO_LINKS;
});
afterEach(() => {
  if (_savedKey === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = _savedKey;
  if (_savedFlag === undefined) delete process.env.DCHUB_GO_LINKS;
  else process.env.DCHUB_GO_LINKS = _savedFlag;
});

/** Decode a /go/c link the way routes/checkout_click_tracker.py does. */
function verifyAsBackend(url, secret = SECRET) {
  const token = url.replace('https://dchub.cloud/go/c/', '');
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect_ = createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  if (expect_ !== sig) return null;
  const [plan, ref] = Buffer.from(payload, 'base64url').toString().split('|');
  return { plan, ref };
}

describe('_goUrl — the link becomes measurable', () => {
  it('wraps a pack link and round-trips plan + ref exactly', () => {
    const out = _goUrl(PACK + '?client_reference_id=' + REF);
    expect(out.startsWith('https://dchub.cloud/go/c/')).toBe(true);
    const got = verifyAsBackend(out);
    expect(got).not.toBeNull();
    expect(got.plan).toBe('metered');
    // The whole conversion loop hangs off this value surviving intact.
    expect(got.ref).toBe(REF);
  });

  it('maps each known Stripe link to its canonical plan name', () => {
    expect(verifyAsBackend(_goUrl(DEV + '?client_reference_id=k-x')).plan).toBe('developer');
    expect(verifyAsBackend(_goUrl(PACK)).plan).toBe('metered');
  });

  it('sends a plan NAME, never a URL — the backend resolves the destination', () => {
    // This is what makes an open redirect impossible: nothing in the token can
    // name a host. If a future edit put the URL in the payload, this fails.
    const got = verifyAsBackend(_goUrl(PACK + '?client_reference_id=' + REF));
    expect(got.plan).not.toMatch(/https?:|stripe|\//);
  });

  it('rejects a tampered token (signature is checked, not decorative)', () => {
    const out = _goUrl(PACK + '?client_reference_id=' + REF);
    const tampered = out.slice(0, -1) + (out.slice(-1) === 'a' ? 'b' : 'a');
    expect(verifyAsBackend(tampered)).toBeNull();
    // ...and a valid token signed with a DIFFERENT secret must not verify.
    expect(verifyAsBackend(out, 'other-secret')).toBeNull();
  });
});

describe('_goUrl — fail-open: a human can always still pay', () => {
  it('returns the DIRECT link when no signing secret is configured', () => {
    delete process.env.DCHUB_INTERNAL_KEY;
    const direct = PACK + '?client_reference_id=' + REF;
    expect(_goUrl(direct)).toBe(direct);
  });

  it('returns the DIRECT link when the kill switch is set', () => {
    for (const v of ['0', 'false', 'no', 'off']) {
      process.env.DCHUB_GO_LINKS = v;
      const direct = PACK + '?client_reference_id=' + REF;
      expect(_goUrl(direct)).toBe(direct);
    }
  });

  it('leaves an UNRECOGNISED stripe link untouched rather than guessing', () => {
    // A link id absent from _GO_PLAN_BY_LINK has no plan the backend could
    // resolve — wrapping it would 302 the human to /pricing instead of
    // checkout, turning a measurement gap into a lost sale.
    const unknown = 'https://buy.stripe.com/zzzNOTAREALLINK99?client_reference_id=' + REF;
    expect(_goUrl(unknown)).toBe(unknown);
    const foreign = 'https://example.com/pay?client_reference_id=' + REF;
    expect(_goUrl(foreign)).toBe(foreign);
  });

  it('never throws on junk input', () => {
    for (const bad of [null, undefined, '', 0, {}, []]) {
      expect(() => _goUrl(bad)).not.toThrow();
    }
  });
});
