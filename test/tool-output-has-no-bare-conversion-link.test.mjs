// r-bare-link-guard: the conversion link an agent-facing RESULT hands a human.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THIS PROTECTS
// ────────────────────────────────────────────────────────────────────────────
// A gated or trimmed tool result is the only place a human ever sees a DC Hub
// checkout link: the agent relays whatever URL the result carried. Two URL
// shapes are worth nothing there —
//
//   https://dchub.cloud/pricing            the WALL. A page about prices, not a
//                                          way through one, and a click on it is
//                                          indistinguishable from someone typing
//                                          the URL: no session, no attribution.
//   https://dchub.cloud/ai?ref=…           a static marketing page that reads
//                                          neither ?ref nor ?sid, so the query
//                                          is decoration and the click is again
//                                          unattributable.
//
// — against the per-CALL minted alternative the server already has:
// /go/c/<payload>.<sig> (302s to Stripe) and /upgrade/h/<payload>.<sig> (the
// human relay page), both HMAC-signed over THIS caller's session and key.
//
// ────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS NEXT TO THE OTHER TWO
// ────────────────────────────────────────────────────────────────────────────
// gated-unlock-is-tokenized.test.mjs guards the URL COMPOSERS — _unlockUrl,
// trialHeader, applyTrialGuardIfFree, buildHumanRelay, _packCheckoutUrl,
// _cleanPlatformUnlockUrl — by calling each one and reading what it returns.
// It is a hand-picked list of five composers.
//
// paywall-extras-attribution.test.mjs (2026-09-19) guards buildPaywallExtras,
// the /pricing/upgrade hop, which neither of the other two reaches — see the
// measured boundary below.
//
// This file guards the ENVELOPES AND DECORATORS those composers feed, which
// that list never reaches:
//
//   buildDepthTease          the dominant preview surface. It assembles
//                            _upgrade.message, web_relay, map_relay,
//                            upgrade_this_key_* and agent_payment — a dozen
//                            URL-bearing fields, none of them produced by a
//                            composer the other file calls.
//   _unlockMoreDataEnvelope  the result of the one tool whose entire job is to
//                            hand over a checkout link.
//   withFrontDoorNudge /     the decorators that append prose to a finished
//   withStarterPack /        result on its way out. A link introduced here
//   withBindHint             rides on tools that are not gated at all.
//
// And it runs buildDepthTease over the WHOLE REGISTERED POPULATION (every name
// in toolspec.json), not over three fixtures — so a tool added tomorrow is
// covered without anyone remembering to add it here. toolspec.json is already
// pinned against the live registry by test/toolspec-is-real.test.mjs.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE CANNOT CATCH, AND WHO CATCHES IT
// ────────────────────────────────────────────────────────────────────────────
// Mutation-tested twice, and BOTH runs are recorded because the second one
// found a boundary the first did not describe.
//
// 2026-09-19 — five of six mutations went red here. The survivor:
//
//   _unlockUrl's fail-open `|| CREDITS_URL` → 'https://dchub.cloud/pricing'
//
// That branch is unreachable from a call — both members of _unlockRungs
// swallow their own errors, so even with no signing secret the pack rung still
// returns a buy.stripe.com link and the fallback never fires. A call-based
// guard structurally cannot see it. gated-unlock-is-tokenized.test.mjs covers
// it by READING _unlockUrl's body ("has no wall URL anywhere in its own body,
// reachable or not"), and that test does go red on the mutation.
//
// 2026-09-20 — re-run against the 9 commits of server.mjs that landed after
// the file was written (#466-#476), because a guard verified against old code
// says nothing about new code. Six mutations, and the split is SHARP:
//
//   KILLED here (4 of 21 cases red on each):
//     buildDepthTease upgrade_url   _unlockUrl(name,_sid) → bare /pricing
//     buildDepthTease credits_url   _packCheckoutUrl(_sid) → bare /pricing
//     buildDepthTease web_explore_url  → https://dchub.cloud/ai?ref=mcp
//
//   SURVIVED here, all three inside buildPaywallExtras:
//     its upgradeUrl → bare /pricing
//     its signupUrl  → /ai?ref=
//     dropping `sid` from its params, which strips the session-bearing
//       exemption carriesSid() grants /pricing/upgrade
//
// buildPaywallExtras is a SEPARATE producer that buildDepthTease never calls,
// so nothing below can reach it. All three of those were then confirmed to go
// red in paywall-extras-attribution.test.mjs (3 of its 5 cases). Three files,
// three disjoint producers, no overlap and no hole — but deleting any one of
// them reopens a real one.
//
// ────────────────────────────────────────────────────────────────────────────
// THESE ARE CALLS, NOT GREPS — and that is the point
// ────────────────────────────────────────────────────────────────────────────
// server.mjs legitimately contains both banned strings in places a source scan
// cannot tell apart from a defect: in comments that quote the defect they fixed,
// in the tools/list annotation (deliberately un-tokenized — see NOT BANNED
// below), and in the ChatGPT commerce scrub. A scan would have to special-case
// all three and would still miss a URL assembled from parts. Reading what the
// producer RETURNS has none of those problems.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  _ctxALS, buildDepthTease, _unlockMoreDataEnvelope,
  withFrontDoorNudge, withStarterPack, withBindHint,
} from '../server.mjs';

const SECRET = 'test-internal-key-not-a-real-secret';
const SID = '1aa6536d-b1d4-24b4-74a8-e89ba266e781';
const KEY = 'dch_live_testkey_not_real';

const ALL_TOOL_NAMES = JSON.parse(
  readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8')).map((t) => t.name);

// The env this guard must not inherit from the developer's shell: a set
// DCHUB_GO_LINKS=0 or a missing signing secret changes which branch produces
// the URL, and a guard that only passes under one accidental env proves nothing.
const ENV = ['DCHUB_INTERNAL_KEY', 'DCHUB_GO_LINKS', 'DCHUB_HUMAN_RELAY',
  'DCHUB_RELAY_KEY_BIND', 'DCHUB_ANON_ATTRIB', 'DCHUB_UPGRADE_URL',
  'DCHUB_SIGNUP_URL', 'DCHUB_STARTER_PACK'];
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

// /pricing/upgrade?…&sid=… is the documented keyless hop: the backend reads
// ?sid and binds the purchase to that session, so it IS session-bearing even
// though it is not HMAC-signed. buildHumanRelay falls back to it. Banning it
// would ban the anonymous rung itself. Same rule as
// gated-unlock-is-tokenized.test.mjs — the two files must agree on this or one
// of them is lying about what "bare" means.
const carriesSid = (u) => /[?&]sid=[^&#]+/.test(u);

/** The two shapes this guard exists to keep out of a tool RESULT. */
function bareLinks(urls) {
  return urls.filter((u) => {
    if (/^https?:\/\/dchub\.cloud\/ai(?:$|[?#/])/.test(u)) return true;
    if (/^https?:\/\/(?:api\.)?dchub\.cloud\/pricing(?:\/upgrade)?(?:$|[?#])/.test(u)) {
      return !carriesSid(u);
    }
    return false;
  });
}

/** A realistic gated payload: a headline plus a list big enough that the tease
 *  names locked depth, which is what triggers the upsell block at all. */
function gatedResult() {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: true, market: 'Dallas', iso: 'ERCOT', overall_score: 71,
        substations: Array.from({ length: 14 }, (_, i) => ({ id: i, name: 'S' + i })),
        _substations_total_in_developer: 14,
        _cite: 'DC Hub (dchub.cloud)',
      }),
    }],
  };
}

const textResult = (t) => ({ content: [{ type: 'text', text: t }] });

// ═══════════════════════════════════════════════════════════════════════════
describe('the depth-tease envelope — every registered tool', () => {
  it('knows the real population', () => {
    // A population that silently emptied would make every case below vacuous.
    expect(ALL_TOOL_NAMES.length).toBeGreaterThan(80);
    expect(ALL_TOOL_NAMES).toContain('get_grid_intelligence');
    expect(ALL_TOOL_NAMES).toContain('analyze_site');
  });

  it('carries no bare /pricing and no /ai?ref= for ANY tool', async () => {
    const offenders = [];
    for (const name of ALL_TOOL_NAMES) {
      const out = await withCtx({ session_id: SID }, () =>
        buildDepthTease(name, gatedResult(), { session_id: SID }, 'free'));
      if (!out) continue;                       // tool does not tease — nothing to check
      const bad = bareLinks(urlsIn(out));
      if (bad.length) offenders.push(`${name}: ${[...new Set(bad)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('actually produced an upsell for the flagship pair — not an empty pass', async () => {
    // Without this, the sweep above would be green if buildDepthTease returned
    // null for all 91 tools: nothing checked, nothing failed.
    for (const name of ['get_grid_intelligence', 'analyze_site']) {
      const out = await withCtx({ session_id: SID }, () =>
        buildDepthTease(name, gatedResult(), { session_id: SID }, 'free'));
      expect(out, `${name} produced no tease at all`).toBeTruthy();
      const urls = urlsIn(out);
      expect(urls.some((u) => u.includes('/go/c/') || u.includes('/upgrade/h/')),
             `${name} teased without any tokenized link: ${urls.join(' ')}`).toBe(true);
    }
  });

  it('is still clean for a KEYED caller, whose envelope adds four more links', async () => {
    // The key-bound branch (upgrade_this_key_url / _pack_url / _tiers) only
    // assembles when ctx carries an api_key, so the anonymous sweep above never
    // reaches it.
    const out = await withCtx({ session_id: SID, api_key: KEY }, () =>
      buildDepthTease('get_fiber_intel', gatedResult(), { session_id: SID, api_key: KEY }, 'free'));
    expect(out).toBeTruthy();
    expect(bareLinks(urlsIn(out))).toEqual([]);
    expect(JSON.stringify(out)).toContain('upgrade_this_key_url');
  });

  it('degrades to a payable link, never to the wall, with no signing secret', async () => {
    delete process.env.DCHUB_INTERNAL_KEY;
    const out = await withCtx({ session_id: SID }, () =>
      buildDepthTease('analyze_site', gatedResult(), { session_id: SID }, 'free'));
    expect(out).toBeTruthy();
    expect(bareLinks(urlsIn(out))).toEqual([]);
  });

  it('is clean for a caller with NO session id at all', async () => {
    // Smithery and other gateways forward no Mcp-Session-Id. That is exactly the
    // branch where a composer is most tempted to fall back to a static page.
    const out = await withCtx({}, () =>
      buildDepthTease('get_grid_intelligence', gatedResult(), {}, 'free'));
    if (out) expect(bareLinks(urlsIn(out))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('unlock_more_data — the one tool that exists to hand over a link', () => {
  it('carries no bare /pricing and no /ai?ref=', () => {
    const out = withCtx({ session_id: SID }, () =>
      _unlockMoreDataEnvelope({ reason: 'the full substation list' }));
    expect(bareLinks(urlsIn(out))).toEqual([]);
  });

  it('…and did emit tokenized rungs, so the check above was not vacuous', () => {
    const out = withCtx({ session_id: SID }, () =>
      _unlockMoreDataEnvelope({ reason: 'the full substation list' }));
    const urls = urlsIn(out);
    expect(urls.filter((u) => u.includes('/go/c/')).length).toBeGreaterThan(1);
    expect(urls.some((u) => u.includes('/upgrade/h/'))).toBe(true);
  });

  it('is clean for a keyed caller and with no signing secret', () => {
    const keyed = withCtx({ session_id: SID, api_key: KEY },
                          () => _unlockMoreDataEnvelope({ reason: 'x' }));
    expect(bareLinks(urlsIn(keyed))).toEqual([]);
    delete process.env.DCHUB_INTERNAL_KEY;
    const nosecret = withCtx({ session_id: SID }, () => _unlockMoreDataEnvelope({ reason: 'x' }));
    expect(bareLinks(urlsIn(nosecret))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the outbound decorators — prose appended to a finished result', () => {
  // These run on results that are NOT gated, so a bare link introduced here
  // would ship on tools no paywall guard ever looks at.
  const cases = [
    ['withFrontDoorNudge', (r, n, c) => withFrontDoorNudge(r, n, c)],
    ['withStarterPack',    (r, n, c) => withStarterPack(r, n, c)],
    ['withBindHint',       (r, n, c) => withBindHint(r, n, c)],
  ];

  for (const [label, fn] of cases) {
    it(`${label} adds no bare conversion link`, () => {
      const offenders = [];
      for (const name of ALL_TOOL_NAMES) {
        // A distinct sid per call: withStarterPack fires once per session, so
        // one shared sid would silence it after the first tool.
        const c = { session_id: `${SID}-${name}`, api_key: null };
        const out = withCtx(c, () => fn(textResult('{"ok":true,"rows":[1,2,3]}'), name, c));
        const bad = bareLinks(urlsIn(out));
        if (bad.length) offenders.push(`${name}: ${[...new Set(bad)].join(', ')}`);
      }
      expect(offenders).toEqual([]);
    });
  }

  it('at least one decorator actually decorated something', () => {
    // Guards the whole block against the all-passthrough failure: if every
    // decorator returned its input unchanged, the three cases above would be
    // green and would be measuring nothing.
    let changed = 0;
    for (const name of ALL_TOOL_NAMES) {
      const c = { session_id: `${SID}-probe-${name}` };
      const before = textResult('{"ok":true,"rows":[1,2,3]}');
      for (const [, fn] of cases) {
        const after = fn(before, name, c);
        if (JSON.stringify(after) !== JSON.stringify(before)) { changed += 1; break; }
      }
    }
    expect(changed, 'no decorator modified any result — the sweep is inert').toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('MUST-FAIL CONTROLS — the checker can see a violation', () => {
  it('bareLinks rejects the two shapes by name', () => {
    expect(bareLinks(['https://dchub.cloud/pricing'])).toHaveLength(1);
    expect(bareLinks(['https://dchub.cloud/pricing/upgrade?tool=x&ref=mcp'])).toHaveLength(1);
    expect(bareLinks(['https://api.dchub.cloud/pricing/upgrade?tier=metered'])).toHaveLength(1);
    expect(bareLinks(['https://dchub.cloud/ai'])).toHaveLength(1);
    expect(bareLinks(['https://dchub.cloud/ai?ref=mcp-trial&tool=analyze_site'])).toHaveLength(1);
    expect(bareLinks(['https://dchub.cloud/ai#pricing?ref=mcp-trial'])).toHaveLength(1);
  });

  it('bareLinks accepts the tokenized shapes it exists to prefer', () => {
    expect(bareLinks(['https://dchub.cloud/go/c/abc.' + 'a'.repeat(32)])).toEqual([]);
    expect(bareLinks(['https://dchub.cloud/upgrade/h/abc.' + 'a'.repeat(32)])).toEqual([]);
    expect(bareLinks(['https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g'])).toEqual([]);
    // the documented sid hop
    expect(bareLinks([`https://api.dchub.cloud/pricing/upgrade?tier=metered&sid=${SID}`])).toEqual([]);
  });

  it('urlsIn finds a link buried in nested prose, not only a top-level field', () => {
    const nested = { a: { b: [{ msg: 'tell them → https://dchub.cloud/pricing now' }] } };
    expect(bareLinks(urlsIn(nested))).toEqual(['https://dchub.cloud/pricing']);
  });

  it('a planted bare link in a real envelope IS caught', () => {
    // Proves the sweep's instrument works on the actual object shape, without
    // waiting for a mutation of server.mjs.
    const out = withCtx({ session_id: SID }, () => _unlockMoreDataEnvelope({ reason: 'x' }));
    const planted = JSON.parse(JSON.stringify(out));
    planted.__planted = 'https://dchub.cloud/ai?ref=mcp-trial&tool=analyze_site';
    expect(bareLinks(urlsIn(planted))).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('what this guard deliberately does NOT ban', () => {
  it('the tools/list annotation, which must stay un-tokenized', () => {
    // tools/list is cached and shared across sessions: a token frozen there is
    // ONE caller's, served to everyone, and misattributes every other click.
    // test/gated-tool-cta.test.mjs owns that contract. This guard never reads
    // tools/list, and this case exists so a future reader does not "fix" the
    // annotation to match this file.
    const annotation = 'https://dchub.cloud/pricing/upgrade?tool=x&ref=mcp-tools-list';
    expect(bareLinks([annotation]), 'shape-wise this IS bare — and correct there').toHaveLength(1);
  });

  it('the ChatGPT commerce scrub, which replaces Stripe links WITH /pricing', () => {
    // _scrubCommerce rewrites every buy.stripe.com URL to the plain pricing page
    // for ChatGPT-platform sessions only, because OpenAI's App Directory treats a
    // digital-goods checkout link-out as a rejection class. Every producer this
    // file drives runs with no platform set, so the scrub never fires here — the
    // exemption is structural, not a special case in bareLinks().
    expect(process.env.DCHUB_CHATGPT_COMMERCE_SCRUB_DISABLE).toBeUndefined();
  });

  it('informational, non-checkout dchub.cloud pages', () => {
    for (const u of ['https://dchub.cloud/playground?ref=mcp-get_grid_intelligence',
                     'https://dchub.cloud/signup?from=mcp&tier=free&direct=1',
                     'https://dchub.cloud/connect?ref=mcp-tools-list&tool=x',
                     'https://dchub.cloud/mcp',
                     'https://dchub.cloud/listings#terms']) {
      expect(bareLinks([u]), u).toEqual([]);
    }
  });

  it('comments in server.mjs, which a source scan could not tell from a defect', () => {
    // Stated rather than asserted: this guard reads RETURN VALUES, so a string
    // in a comment is structurally invisible to it. The three live comment
    // occurrences are the reason this file is not a grep.
    const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const commented = SRC.split('\n')
      .filter((l) => /^\s*(\/\/|\*)/.test(l))
      .filter((l) => /dchub\.cloud\/(pricing|ai\?ref=)/.test(l));
    expect(commented.length,
           'if this hits 0 the note above is stale, not wrong — re-read it')
      .toBeGreaterThan(0);
  });
});
