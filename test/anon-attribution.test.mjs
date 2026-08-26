// anon-attribution.test.mjs — r-anon-attrib (2026-08-26).
//
// THE BUG: every Smithery / listed-connector caller is anonymous. The listing
// asks for no API key and the gateway mediates the transport, so the call
// carries neither a durable key nor an Mcp-Session-Id. _stripeWithKey needs the
// former, _stripeWithSession needs the latter and returns the URL UNTOUCHED
// without one — so client_reference_id was simply absent. _goUrl bakes that same
// ref into the signed /go/c payload, so the click stamped
// mcp_checkout_clicks.ref = '' and joined nothing, forever. Verified on prod
// Neon 2026-08-25: of 6 all-time click rows, the ONE real human (Mozilla/
// Windows, 08-13, sig_ok=true) has an EMPTY ref.
//
// These tests weight two risks. First, that the fix does not actually fire for
// the cohort it exists for. Second — the more expensive one — that it fires for
// a cohort that already HAD an identity, emitting a second competing
// client_reference_id and silently detaching payments from the key that earned
// them. That second class is asserted from both directions.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  _goUrl, _stripeWithAnon, _anonAttribRef, _packCheckoutUrl, _subCheckoutUrl,
  ANON_REF_PREFIX, _ctxALS, trialHeader, _trialGapClause, _checkoutBinds, _afterPayClause,
} from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

const SECRET = 'test-internal-key-not-a-real-secret';
const PACK = 'https://buy.stripe.com/9B69AU08y2FfbSR55UaZi0i';
const STARTER = 'https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g';

let _savedKey, _savedFlag, _savedAnon;
beforeEach(() => {
  _savedKey = process.env.DCHUB_INTERNAL_KEY;
  _savedFlag = process.env.DCHUB_GO_LINKS;
  _savedAnon = process.env.DCHUB_ANON_ATTRIB;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  delete process.env.DCHUB_GO_LINKS;
  delete process.env.DCHUB_ANON_ATTRIB;
});
afterEach(() => {
  for (const [k, v] of [['DCHUB_INTERNAL_KEY', _savedKey],
                        ['DCHUB_GO_LINKS', _savedFlag],
                        ['DCHUB_ANON_ATTRIB', _savedAnon]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

/** Run fn inside a realistic per-request AsyncLocalStorage store. */
const withCtx = (store, fn) => _ctxALS.run({ ...store }, fn);

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

const refOf = (url) => {
  const m = /[?&]client_reference_id=([^&#]*)/.exec(url);
  return m ? decodeURIComponent(m[1]) : '';
};

describe('the anonymous cohort gets an attribution id at all', () => {
  it('mints a ref when there is NO key and NO session', () => {
    const ref = withCtx({}, () => _anonAttribRef());
    expect(ref).toMatch(/^a-[0-9a-f]{32}$/);
    expect(ref.startsWith(ANON_REF_PREFIX)).toBe(true);
  });

  it("treats the literal 'no-session' sentinel as no session", () => {
    // _stripeWithSession already special-cases this string; the anon path has to
    // agree or that cohort keeps falling through the crack.
    const ref = withCtx({ session_id: 'no-session' }, () => _anonAttribRef());
    expect(ref).toMatch(/^a-[0-9a-f]{32}$/);
  });

  it('binds the ref onto a checkout URL', () => {
    const url = withCtx({}, () => _stripeWithAnon(PACK));
    expect(refOf(url)).toMatch(/^a-[0-9a-f]{32}$/);
  });

  it('survives the /go/c round trip, which is what makes the CLICK measurable', () => {
    // This is the load-bearing assertion: mcp_checkout_clicks.ref is populated
    // from the signed payload, so a ref that does not survive here leaves the
    // click exactly as unattributable as before the fix.
    const url = withCtx({}, () => _packCheckoutUrl(''));
    expect(url).toContain('https://dchub.cloud/go/c/');
    const decoded = verifyAsBackend(url);
    expect(decoded).not.toBeNull();
    expect(decoded.plan).toBe('metered');
    expect(decoded.ref).toMatch(/^a-[0-9a-f]{32}$/);
  });

  it('reaches Stripe as client_reference_id, which is what makes the PAYMENT joinable', () => {
    // The backend resolves /go/c to the canonical link and re-appends this ref,
    // and main.py's pack branch stores it as mcp_topups.mcp_session_id.
    const ref = withCtx({}, () => refOf(_stripeWithAnon(PACK)));
    expect(ref).toMatch(/^a-/);
    // ...and the prefix is the one the backend classifies as ref_kind 'anon'.
    expect(ref.slice(0, 2)).toBe('a-');
  });
});

describe('it NEVER competes with an identity that already exists', () => {
  it('a durable key wins — no anon ref is minted', () => {
    expect(withCtx({ api_key: 'dch_live_abc123' }, () => _anonAttribRef())).toBe('');
  });

  it('a real session wins — no anon ref is minted', () => {
    expect(withCtx({ session_id: 'e6f1c0de-1234-4aaa-9999-abcdef012345' },
                   () => _anonAttribRef())).toBe('');
  });

  it('a keyed pack link still carries pk-, not an anon ref', () => {
    const url = withCtx({ api_key: 'dch_live_abc123' }, () => _packCheckoutUrl(''));
    const decoded = verifyAsBackend(url);
    expect(decoded.ref).toMatch(/^pk-[0-9a-f]{64}$/);
    expect(decoded.ref).not.toContain('a-0');
  });

  it('a session-bound pack link still carries the bare session id', () => {
    const sid = 'e6f1c0de-1234-4aaa-9999-abcdef012345';
    const decoded = verifyAsBackend(withCtx({ session_id: sid }, () => _packCheckoutUrl(sid)));
    expect(decoded.ref).toBe(sid);
  });

  it('a keyed SUBSCRIPTION link still carries k-, not an anon ref', () => {
    const decoded = verifyAsBackend(
      withCtx({ api_key: 'dch_live_abc123' }, () => _subCheckoutUrl(STARTER, '')));
    expect(decoded.ref).toMatch(/^k-[0-9a-f]{64}$/);
  });

  it('is idempotent — never appends a SECOND client_reference_id', () => {
    const once = withCtx({}, () => _stripeWithAnon(PACK));
    const twice = withCtx({}, () => _stripeWithAnon(once));
    expect(twice).toBe(once);
    expect((twice.match(/client_reference_id=/g) || []).length).toBe(1);
  });
});

describe('one id per request, so every link in one envelope agrees', () => {
  it('all four unlock_more_data links share ONE ref (the human may click any)', () => {
    const refs = withCtx({}, () => [
      verifyAsBackend(_packCheckoutUrl('')).ref,
      verifyAsBackend(_subCheckoutUrl(STARTER, '')).ref,
      verifyAsBackend(_subCheckoutUrl('https://buy.stripe.com/7sY5kE8F4fs13ml0PEaZi0c', '')).ref,
      verifyAsBackend(_subCheckoutUrl('https://buy.stripe.com/7sY7sM9J8enX7CB69YaZi0l', '')).ref,
    ]);
    expect(new Set(refs).size).toBe(1);
    expect(refs[0]).toMatch(/^a-[0-9a-f]{32}$/);
  });

  it('SEPARATE requests get SEPARATE ids — it identifies the offer, not a person', () => {
    const a = withCtx({}, () => _anonAttribRef());
    const b = withCtx({}, () => _anonAttribRef());
    expect(a).not.toBe(b);
  });
});

describe('degraded paths still yield a payable link', () => {
  it('kill switch DCHUB_ANON_ATTRIB=0 restores the exact prior behaviour', () => {
    process.env.DCHUB_ANON_ATTRIB = '0';
    expect(withCtx({}, () => _anonAttribRef())).toBe('');
    expect(withCtx({}, () => _stripeWithAnon(PACK))).toBe(PACK);
    // still a working, payable /go/c link — just unattributed, i.e. today
    const url = withCtx({}, () => _packCheckoutUrl(''));
    expect(verifyAsBackend(url).ref).toBe('');
  });

  it('no AsyncLocalStorage store at all → no throw, no ref, plain link', () => {
    expect(_anonAttribRef()).toBe('');
    expect(_stripeWithAnon(PACK)).toBe(PACK);
  });

  it('no DCHUB_INTERNAL_KEY → direct Stripe link that still carries the ref', () => {
    delete process.env.DCHUB_INTERNAL_KEY;
    const url = withCtx({}, () => _packCheckoutUrl(''));
    expect(url.startsWith('https://buy.stripe.com/')).toBe(true);
    expect(refOf(url)).toMatch(/^a-/);
  });

  it('a falsy URL is returned unchanged rather than decorated', () => {
    expect(withCtx({}, () => _stripeWithAnon(''))).toBe('');
    expect(withCtx({}, () => _stripeWithAnon(null))).toBe(null);
  });
});

describe('the same-session-unlock promise is made ONLY where it is true', () => {
  // THE BUG THIS PINS: "the moment they pay, THIS session unlocks — just call
  // <tool> again" was asserted unconditionally in trialHeader, and
  // next_call_full_after_checkout was hardcoded `true` in unlock_more_data,
  // while binds_to_session beside it was correctly !!_sid. Both were false for
  // exactly the cohort that cannot bind: no key, no session — i.e. Smithery.
  // Found by driving a real anonymous tools/call, not by reading the code:
  // sessionId arrives as the literal 'no-session' on the stateless path.
  const unlockClause = (t) => t.slice(t.indexOf('$10 one-time'));

  it('a session-bearing caller IS promised the same-session unlock', () => {
    const t = withCtx({ session_id: 'e6f1c0de-1234-4aaa-9999-abcdef012345' },
      () => trialHeader('rank_markets', 'e6f1c0de-1234-4aaa-9999-abcdef012345', 'https://x/'));
    expect(unlockClause(t)).toMatch(/THIS session unlocks/);
  });

  it('a keyed caller IS promised it (credits land on the key hash)', () => {
    const t = withCtx({ api_key: 'dch_live_abc123' },
      () => trialHeader('rank_markets', '', 'https://x/'));
    expect(unlockClause(t)).toMatch(/THIS session unlocks/);
  });

  it("the 'no-session' sentinel is NOT promised it, and is told what DOES happen", () => {
    const t = withCtx({}, () => trialHeader('rank_markets', 'no-session', 'https://x/'));
    expect(unlockClause(t)).not.toMatch(/THIS session unlocks/);
    expect(t).toMatch(/cannot bind/);
    expect(t).toMatch(/emails the key/);       // the mechanism that DOES exist
  });

  it('an empty sessionId is NOT promised it either', () => {
    const t = withCtx({}, () => trialHeader('rank_markets', '', 'https://x/'));
    expect(unlockClause(t)).not.toMatch(/THIS session unlocks/);
  });

  it('unlock_more_data derives the promise instead of hardcoding it', () => {
    // Source pin: the field is computed from the identity on the call. A literal
    // `true` here is the original defect.
    expect(SRC).toContain('next_call_full_after_checkout: _unlockBinds');
    expect(SRC).not.toContain('next_call_full_after_checkout: true');
    expect(SRC).toContain("const _unlockBinds = !!(_sid || (_ctx && _ctx.api_key));");
  });

  it('the count and the preview framing are ONE line, not two', () => {
    // They were adjacent lines saying the same thing (~200 chars of duplication).
    const t = withCtx({}, () => trialHeader('rank_markets', 'no-session', 'https://x/',
                                            _trialGapClause({ results: [1, 2, 3, 4, 5] })));
    expect(t).toContain('3 of 5 results shown');
    expect(t.trimEnd().split('\n')).toHaveLength(1);
  });
});

describe('the bind promise has ONE source of truth', () => {
  // WHY THIS EXISTS: the first fix corrected trialHeader and unlock_more_data,
  // and verifying the deploy from the outside showed the DAILY-CAP WALL still
  // telling the same anonymous caller "the moment they pay, your next call
  // returns the full result" — in the same response. Re-typed copy is how a
  // fixed invariant comes back, so all surfaces now call one helper.
  it('binds for a session, for a key, and for neither', () => {
    expect(withCtx({}, () => _checkoutBinds('e6f1c0de-1234-4aaa-9999-abc'))).toBe(true);
    expect(withCtx({ session_id: 'e6f1c0de-1234-4aaa-9999-abc' }, () => _checkoutBinds(''))).toBe(true);
    expect(withCtx({ api_key: 'dch_live_abc' }, () => _checkoutBinds(''))).toBe(true);
    expect(withCtx({}, () => _checkoutBinds(''))).toBe(false);
    expect(withCtx({}, () => _checkoutBinds('no-session'))).toBe(false);
    expect(withCtx({ session_id: 'no-session' }, () => _checkoutBinds(''))).toBe(false);
  });

  it('the clause promises a same-session unlock only when it binds', () => {
    expect(withCtx({ session_id: 'e6f1c0de-1' }, () => _afterPayClause('', 'rank_markets')))
      .toMatch(/THIS session unlocks/);
    const anon = withCtx({}, () => _afterPayClause('no-session', 'rank_markets'));
    expect(anon).not.toMatch(/THIS session unlocks/);
    expect(anon).toMatch(/cannot bind/);
    expect(anon).toMatch(/emails the key/);
  });

  it('NO surface re-types the promise as a literal', () => {
    // Source pin: every occurrence must route through _afterPayClause. A new
    // hand-written "your next call returns full data" is the regression.
    expect(SRC).not.toContain('your next call returns the full result');
    expect(SRC).not.toContain('your next call returns full data (no reconnect)');
    // ...and the helper is actually used at more than one site.
    expect((SRC.match(/_afterPayClause\(/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});
