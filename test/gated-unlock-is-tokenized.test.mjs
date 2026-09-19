// r-gated-cta-tokenized (2026-09-18): the URL a gated tool actually hands a human.
//
// WHAT THIS PROTECTS, AND WHY IT IS A DIFFERENT FILE FROM gated-tool-cta.
// That one guards the tools/list ANNOTATION, which is cached and shared across
// sessions and therefore must NOT be tokenized. This one guards the opposite
// surface: the URLs COMPOSED PER CALL into a gated result — the one an agent
// relays and a human clicks.
//
// The defect. Every machine-readable `upgrade_url` on that path typed one
// constant, UPGRADE_URL = https://dchub.cloud/ai#pricing, and the trial-preview
// envelope glued '?ref=mcp-trial&tool=X' onto it. Everything after a '#' IS the
// fragment, so that query never reaches a server: the link was unattributable,
// AND it was not an unlock — it is a page about pricing, handed to a human
// whose agent is one click from a checkout we already mint per call. The
// free-tier nudge on all 91 tools did the same with a bare
// https://dchub.cloud/pricing.
//
// THE RULE ENFORCED HERE: a dchub.cloud URL emitted as an unlock by a gated
// tool must be signed and session-bearing — /upgrade/h/<payload>.<sig> or
// /go/c/<payload>.<sig> — or a buy.stripe.com link (what /go/c degrades to
// with no signing secret). /pricing, /pricing/upgrade and /ai are none of
// those, and the first two are the wall rather than a way through.
//
// These are CALLS, not greps. A source scan cannot tell a live bare URL from
// one a comment mentions, and it cannot see a URL assembled from parts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  _ctxALS, _rungsText, _unlockUrl, _cleanPlatformUnlockUrl, trialHeader, applyTrialGuardIfFree,
  buildHumanRelay, _packCheckoutUrl, UPGRADE_URL, SIGNUP_URL,
} from '../server.mjs';

const SECRET = 'test-internal-key-not-a-real-secret';
const SID = '1aa6536d-b1d4-24b4-74a8-e89ba266e781';
const KEY = 'dch_live_testkey_not_real';

const ENV = ['DCHUB_INTERNAL_KEY', 'DCHUB_GO_LINKS', 'DCHUB_HUMAN_RELAY',
  'DCHUB_RELAY_KEY_BIND', 'DCHUB_ANON_ATTRIB', 'DCHUB_UPGRADE_URL'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.DCHUB_INTERNAL_KEY = SECRET;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

const withCtx = (store, fn) => _ctxALS.run({ ...store }, fn);

/** Every http(s) URL in anything — string, object, nested. */
function urlsIn(x) {
  const s = typeof x === 'string' ? x : JSON.stringify(x ?? '');
  return (s.match(/https?:\/\/[^\s"'`)\]}>,\\]+/g) || [])
    .map((u) => u.replace(/[.,;:]+$/, ''));
}

const SIGNED = /^https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c)\/[A-Za-z0-9_-]+\.[0-9a-f]{32}$/;
const isSigned = (u) => SIGNED.test(u.split('?')[0]) || SIGNED.test(u);
const isStripe = (u) => /^https:\/\/buy\.stripe\.com\//.test(u);

/** /pricing/upgrade?…&sid=… is the documented keyless hop: the backend reads
 *  ?sid and binds the purchase to the session, so it IS session-bearing even
 *  though it is not signed. buildHumanRelay falls back to it, and banning it
 *  would ban the anonymous rung itself. */
const carriesSid = (u) => /[?&]sid=[^&#]+/.test(u);

/** The shapes this change exists to keep out of a gated response. */
function banned(urls) {
  return urls.filter((u) => {
    // /ai is a static marketing page: it reads neither ?ref nor ?sid, so no
    // query makes it session-bearing and no click on it is attributable.
    if (/^https?:\/\/dchub\.cloud\/ai(?:$|[?#])/.test(u)) return true;
    if (/^https?:\/\/(?:api\.)?dchub\.cloud\/pricing(?:\/upgrade)?(?:$|[?#])/.test(u)) {
      return !carriesSid(u);
    }
    return false;
  });
}

/** An unlock URL: ours, and not one of the informational non-checkout links. */
const NON_UNLOCK = /\/(playground|api\/v1\/redeem|signup|mcp|docs)\b/;
function unlockUrls(x) {
  return urlsIn(x).filter((u) => /dchub\.cloud|buy\.stripe\.com/.test(u))
    .filter((u) => !NON_UNLOCK.test(u));
}

describe('the unlock URL a gated tool composes', () => {
  it('is signed and session-bearing on the free-tier nudge (all 91 tools)', () => {
    const out = withCtx({ session_id: SID }, () =>
      applyTrialGuardIfFree('rank_markets', { results: [1, 2, 3, 4, 5] }, false));
    const urls = unlockUrls(out);
    expect(urls.length, 'the nudge lost its unlock link entirely').toBeGreaterThan(0);
    for (const u of urls) {
      expect(isSigned(u) || isStripe(u) || carriesSid(u),
             `${u} is not a signed, session-bearing unlock`).toBe(true);
    }
    expect(banned(urlsIn(out))).toEqual([]);
  });

  it('is signed and session-bearing on the trial header', () => {
    const t = withCtx({ session_id: SID }, () =>
      trialHeader('get_grid_intelligence', SID, '3 of 10 results shown'));
    const urls = unlockUrls(t);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(isSigned(u) || isStripe(u) || carriesSid(u), u).toBe(true);
    expect(banned(urlsIn(t))).toEqual([]);
  });

  it('is signed and session-bearing on the tuned get_market_intel header', () => {
    // 91% of paywall sessions hit this tool first (v_first_paywall_tool), so
    // its override is the single most-rendered upgrade surface in the product.
    const t = withCtx({ session_id: SID }, () =>
      trialHeader('get_market_intel', SID, ''));
    expect(banned(urlsIn(t))).toEqual([]);
    for (const u of unlockUrls(t)) expect(isSigned(u) || isStripe(u) || carriesSid(u), u).toBe(true);
  });

  it('carries the CALLER’s session, not somebody else’s', () => {
    const a = withCtx({ session_id: SID }, () => _unlockUrl('analyze_site', SID));
    const b = withCtx({ session_id: 'ffffffff-0000-4000-8000-000000000001' },
                      () => _unlockUrl('analyze_site', 'ffffffff-0000-4000-8000-000000000001'));
    expect(a).not.toBe(b);
    expect(isSigned(a) || isStripe(a)).toBe(true);
  });

  it('binds a KEYED caller’s unlock to their key, not only their session', () => {
    const url = withCtx({ session_id: SID, api_key: KEY },
                        () => _unlockUrl('get_fiber_intel', SID));
    expect(isSigned(url)).toBe(true);
    const payload = url.split('/').pop().split('.')[0];
    const decoded = Buffer.from(payload, 'base64url').toString();
    expect(decoded).toContain('pk-' + createHash('sha256').update(KEY).digest('hex'));
  });

  it('the signature verifies under the shared secret', () => {
    // A "signed-looking" URL whose HMAC does not check out is a dead link the
    // backend logs as valid=false. Verified the way routes/human_relay does.
    const url = withCtx({ session_id: SID }, () => _unlockUrl('analyze_site', SID));
    const [payload, sig] = url.split('/').pop().split('.');
    const want = createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
    expect(sig).toBe(want);
  });

  it('has no wall URL anywhere in its own body, reachable or not', () => {
    // The defensive catch cannot be reached from a call — both members of
    // _unlockRungs swallow their own errors — so it is read instead of run.
    // Scoped to this one function: a repo-wide scan would trip on the
    // tools/list annotation and on the ChatGPT commerce scrub, both of which
    // are deliberate.
    const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const i = SRC.indexOf('function _unlockUrl(');
    expect(i, '_unlockUrl was renamed — re-aim this test').toBeGreaterThan(0);
    const body = SRC.slice(i, SRC.indexOf('\n}', i));
    expect(body).not.toMatch(/dchub\.cloud\/(pricing|ai)/);
    expect(body).not.toContain('UPGRADE_URL');
  });

  it('degrades to a payable Stripe link, never to the wall, with no secret', () => {
    delete process.env.DCHUB_INTERNAL_KEY;
    const url = withCtx({ session_id: SID }, () => _unlockUrl('analyze_site', SID));
    expect(banned([url])).toEqual([]);
    expect(isStripe(url) || isSigned(url), url).toBe(true);
  });
});

describe('the constants that used to be typed as CTAs', () => {
  it('UPGRADE_URL is still a fragment link — which is why it is not a CTA', () => {
    // Pinned so the reason stays legible: everything after '#' is the
    // fragment, so ?ref= glued after it never reaches a server. The constant
    // survives as the fail-open of last resort and as the informational
    // pricing anchor; it must not come back as an unlock.
    expect(UPGRADE_URL).toContain('#');
  });

  it('no gated composer emits it', () => {
    const surfaces = [
      withCtx({ session_id: SID }, () =>
        applyTrialGuardIfFree('analyze_site', { overall_score: 71 }, false)),
      withCtx({ session_id: SID }, () => trialHeader('analyze_site', SID, '')),
      withCtx({ session_id: SID }, () => _rungsText('analyze_site', 'free', SID)),
      withCtx({ session_id: SID }, () => buildHumanRelay('analyze_site', 'free', SID)),
      withCtx({ session_id: SID }, () => _packCheckoutUrl(SID)),
    ];
    for (const s of surfaces) {
      expect(urlsIn(s).filter((u) => u.startsWith(UPGRADE_URL)), JSON.stringify(s).slice(0, 160))
        .toEqual([]);
      expect(banned(urlsIn(s))).toEqual([]);
    }
  });
});

describe('the upgrade_url fields inside the tool dispatcher', () => {
  // These live inside the 6,000-line tools/call closure and cannot be called
  // in isolation, so they are read rather than run. A source assertion is the
  // weaker instrument and it is used here ONLY where the stronger one cannot
  // reach — the composers above are exercised by calling them. It is scoped
  // to the field, not to the file: a repo-wide scan would trip on the
  // tools/list annotation and the ChatGPT commerce scrub, both deliberate.
  it('never assign a wall URL literal', () => {
    const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const code = SRC.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))          // drop comment lines
      .filter((l) => !/ref=mcp-tools-list/.test(l));           // the cached annotation
    const bad = code.filter((l) => {
      if (!/\bupgrade_url\s*:/.test(l)) return false;
      // A literal wall URL…
      if (/['`"]https?:\/\/(?:api\.)?dchub\.cloud\/(pricing|ai)/.test(l)) return true;
      // …and the constant that composes one. UPGRADE_URL is
      // https://dchub.cloud/ai#pricing; _refUrl() glues '?ref=…' on AFTER the
      // '#', so the query is part of the fragment and reaches no server. That
      // composed form is the exact URL ChatGPT flagged, and a literal-only
      // scan cannot see it — which is how it survived the first pass of this
      // very guard.
      if (/\bUPGRADE_URL\b/.test(l)) return true;
      // ★ THE EXEMPTION IS GONE (2026-09-19, owner decision). This used to
      // let _refUrl(SIGNUP_URL) through on the _isCleanPlatform() branch,
      // because for ChatGPT/OpenAI sessions the server deliberately emitted no
      // unlock at all. The owner flipped that branch to the signed /upgrade/h
      // relay, so SIGNUP_URL on an upgrade_url field is now the SAME defect as
      // the others: a static marketing page that reads neither ?ref nor ?sid.
      // It stays legal on a signup_url field, which is what it is.
      if (/\bSIGNUP_URL\b/.test(l)) return true;
      return false;
    });
    expect(bad.map((l) => l.trim().slice(0, 110))).toEqual([]);
  });

  it('MUST-FAIL CONTROL: the scan sees both a literal AND a composed one', () => {
    const lit = "        upgrade_url: 'https://dchub.cloud/pricing/upgrade',";
    const composed = '        upgrade_url: _refUrl(UPGRADE_URL),';
    const hit = (l) => /\bupgrade_url\s*:/.test(l)
      && (/['`"]https?:\/\/(?:api\.)?dchub\.cloud\/(pricing|ai)/.test(l)
          || /\bUPGRADE_URL\b/.test(l));
    expect(hit(lit)).toBe(true);
    expect(hit(composed)).toBe(true);
    expect(hit('        upgrade_url: _unlockUrl(name, _sid),')).toBe(false);
  });

  it('the ChatGPT clean-platform branch hands over a signed relay, not /ai', () => {
    // 2026-09-19, owner decision: this branch used to emit
    // https://dchub.cloud/ai?ref=mcp-trial&tool=X — the URL ChatGPT flagged.
    const url = withCtx({ session_id: SID }, () =>
      _cleanPlatformUnlockUrl('analyze_site', SID));
    expect(isSigned(url), url).toBe(true);
    expect(url).toContain('/upgrade/h/');
    expect(banned([url])).toEqual([]);
    // it carries THIS caller's session
    const payload = url.split('/').pop().split('.')[0];
    expect(Buffer.from(payload, 'base64url').toString()).toContain(SID);
  });

  it('…and never degrades into a checkout link on that platform', () => {
    // ★ THE WHOLE REASON THIS IS NOT _unlockUrl. _unlockUrl fails open to
    // CREDITS_URL — a raw buy.stripe.com Payment Link — and _scrubCommerce
    // strips exactly those for ChatGPT/OpenAI because a digital-goods checkout
    // link-out is an App Directory rejection class. With no signing secret
    // this one must land on the informational page, not on Stripe.
    delete process.env.DCHUB_INTERNAL_KEY;
    const url = withCtx({ session_id: SID }, () =>
      _cleanPlatformUnlockUrl('analyze_site', SID));
    expect(isStripe(url), 'a Stripe link reached the clean platform').toBe(false);
    expect(url).not.toContain('/go/c/');
    expect(url).toBe(SIGNUP_URL);
    // …whereas the general helper DOES degrade to a payable link, which is
    // correct for every other platform and wrong for this one.
    const general = withCtx({ session_id: SID }, () => _unlockUrl('analyze_site', SID));
    expect(isStripe(general) || isSigned(general)).toBe(true);
  });
});

describe('what this guard deliberately does NOT ban', () => {
  it('the tools/list annotation stays un-tokenized', () => {
    // A token there would be one caller's, served to every caller out of a
    // shared cache. test/gated-tool-cta.test.mjs owns that contract; this test
    // exists so a future reader does not "fix" it to match this file.
    expect(banned(['https://dchub.cloud/pricing?ref=mcp-tools-list&tool=x']).length).toBe(1);
  });

  it('the checker can actually see a violation', () => {
    // MUST-FAIL CONTROL. If `banned` or `unlockUrls` stopped matching, every
    // assertion above would pass on anything.
    expect(banned(urlsIn('go to https://dchub.cloud/ai?ref=mcp-trial&tool=analyze_site')))
      .toEqual(['https://dchub.cloud/ai?ref=mcp-trial&tool=analyze_site']);
    expect(banned(urlsIn({ upgrade_url: 'https://dchub.cloud/ai#pricing?ref=mcp-trial' })).length)
      .toBe(1);
    expect(banned(urlsIn({ u: 'https://dchub.cloud/pricing/upgrade' })).length).toBe(1);
    expect(isSigned('https://dchub.cloud/upgrade/h/abc.' + 'a'.repeat(32))).toBe(true);
    expect(isSigned('https://dchub.cloud/upgrade/h/abc')).toBe(false);
    expect(unlockUrls('see https://dchub.cloud/playground?ref=relay')).toEqual([]);
    // …and the sid exemption is real, not a hole: with a sid it passes, without one it does not.
    expect(banned(['https://api.dchub.cloud/pricing/upgrade?tier=metered&sid=' + SID])).toEqual([]);
    expect(banned(['https://api.dchub.cloud/pricing/upgrade?tier=metered']).length).toBe(1);
  });
});
