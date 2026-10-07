// ── source_capacity match mode: target_mw → POST /api/v1/listings/match ──────
//
// 2026-09-28. source_capacity gained a second mode instead of a new tool (the
// tool count stays 92, owner decision). With target_mw or target_kw it calls
// the backend bundle matcher (dchub-backend routes/exclusive_listings.py
// match_capacity, util/capacity_matcher.py); without one it browses exactly as
// before. Every response below is a FIXTURE in that endpoint's shape; nothing
// here reaches a network.
//
// ★ WHAT THIS FILE PINS
//   1. The mode switch. No target → the old GET, byte for byte in its query;
//      a target → one POST to /match with the backend's body and the caller's
//      identity headers (the same ones request_capacity_intro forwards).
//   2. No provider names. The backend labels providers per response; this side
//      renders allow-listed leg fields only and strips identity keys from the
//      JSON. A fixture that smuggles a provider name in must not surface it.
//   3. The walls. Matching is identified-only, so a keyless caller gets the
//      sign-in steps AND the sentence that browsing stays open; each 403 that
//      is not a plan wall gets its own note, not "needs a higher plan".
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'http://127.0.0.1:1';
const READ = 'source_capacity';

// ── /match contract fixtures ─────────────────────────────────────────────────
const CITATION_PUBLIC = {
  source: 'DC Hub Capacity Source', url: 'https://dchub.cloud/listings',
  license: 'CC-BY-4.0', redistribution: 'permitted_with_attribution',
  cite_as: 'DC Hub Capacity Source, dchub.cloud',
};
const intro = (slug) => ({ method: 'POST', path: `/api/v1/listings/${slug}/intro`, mcp_tool: 'request_capacity_intro' });
const leg = (over) => ({
  ref: 'L1', listing: 'dfw-40mw-powered-shell', provider_label: 'Provider A', kw: 40000,
  available_from: '2027-04', market: 'Dallas', state: 'TX', country: 'US', same_provider_as: [],
  url: 'https://dchub.cloud/listings?l=dfw-40mw-powered-shell', introduction: intro('dfw-40mw-powered-shell'),
  ...over,
});
const QUOTA_FREE = { intro_requests: {
  limit: 1, used: 0, remaining: 1, unlimited: false, period: 'calendar_month_utc',
  resets_at: '2026-10-01T00:00:00Z', upgrade_url: 'https://dchub.cloud/pricing',
} };
const QUOTA_FREE_USED = { intro_requests: { ...QUOTA_FREE.intro_requests, used: 1, remaining: 0 } };
const QUOTA_PAID = { intro_requests: {
  limit: null, used: null, remaining: null, unlimited: true, period: 'calendar_month_utc',
  resets_at: null, upgrade_url: null,
} };
const envelope = (over) => ({
  ok: true, citation: CITATION_PUBLIC,
  request: { target_kw: 40000, min_chunk_kw: 0, max_sites: 1, max_providers: 1 },
  exact: [], bundles: [], shortfall: null, candidates_considered: 6,
  data_as_of: '2026-09-28T12:00:00+00:00',
  note: 'Providers are shown as labels that only mean something inside this response.',
  viewer: { identified: true, tier: 'free', channel: 'mcp', email_masked: 'j***@acme.com' },
  caller_tier: 'free', quota: QUOTA_FREE,
  retrieval_receipt: { reference: 'RR-1', issued_at: '2026-09-28T12:00:00+00:00' },
  ...over,
});
const MATCH_EXACT = envelope({ exact: [leg({})] });
// A bundle: no single listing fits 40 MW; two Dallas listings from two
// providers and one Phoenix listing sharing a provider across bundles.
const MATCH_BUNDLE = envelope({
  request: { target_kw: 40000, min_chunk_kw: 5000, max_sites: 3, max_providers: 2, available_by: '2027-12' },
  bundles: [
    { legs: [
        leg({ ref: 'L1', listing: 'dfw-25mw-shell', kw: 25000, available_from: '2027-03', provider_label: 'Provider A',
              url: 'https://dchub.cloud/listings?l=dfw-25mw-shell', introduction: intro('dfw-25mw-shell') }),
        leg({ ref: 'L2', listing: 'phx-15mw-turnkey', kw: 15000, available_from: '2027-06', market: 'Phoenix', state: 'AZ',
              provider_label: 'Provider B', url: 'https://dchub.cloud/listings?l=phx-15mw-turnkey',
              introduction: intro('phx-15mw-turnkey') }),
      ], total_kw: 40000, sites: 2, providers: 2, earliest_full_delivery: '2027-06' },
    { legs: [
        leg({ ref: 'L1', listing: 'dfw-25mw-shell', kw: 20000, available_from: '2027-03', provider_label: 'Provider A',
              url: 'https://dchub.cloud/listings?l=dfw-25mw-shell', introduction: intro('dfw-25mw-shell') }),
        leg({ ref: 'L3', listing: 'dfw-20mw-colo', kw: 20000, available_from: '2027-09', provider_label: 'Provider A',
              same_provider_as: ['L1'], url: 'https://dchub.cloud/listings?l=dfw-20mw-colo', introduction: intro('dfw-20mw-colo') }),
      ], total_kw: 40000, sites: 2, providers: 1, earliest_full_delivery: '2027-09' },
  ],
});
const MATCH_SHORTFALL = envelope({
  request: { target_kw: 40000, min_chunk_kw: 0, max_sites: 1, max_providers: 1 },
  shortfall: {
    target_kw: 40000, best_kw: 25000, kw_short: 15000,
    legs: [leg({ listing: 'dfw-25mw-shell', kw: 25000, available_from: '2027-03' })],
    sites: 1, providers: 1, closes_at: '2028-01',
    timeline: [{ date: '2027-09', deliverable_kw: 30000, meets_target: false },
               { date: '2028-01', deliverable_kw: 40000, meets_target: true }],
  },
});
const E401_MATCH = {
  ok: false, error: 'identity_required',
  message: 'Sign in (or sign up free) to match capacity.',
  reason: 'sign_in_required', sign_up_url: 'https://dchub.cloud/signup?src=capacity_match',
  access: { required: 'registered', granted: false, reason: 'sign_in_required',
            unlock: { web_sign_in_url: 'https://dchub.cloud/login?redirect=%2Flistings',
                      mcp_steps: ['claim_free_key', 'bind_email'], pricing_url: null } },
};
const E403_REVIEW = {
  ok: false, error: 'account_review', message: 'This account is under review for Capacity Source access.',
  reason: 'account_review',
  access: { required: 'registered', granted: false, reason: 'account_review',
            unlock: { web_sign_in_url: null, mcp_steps: [], pricing_url: null, contact: 'jonathan@dchub.cloud' } },
};
const E403_QUOTA = {
  ok: false, error: 'intro_quota_exhausted', message: 'The free plan includes 1 introduction request per month.',
  reason: 'intro_quota_exhausted', quota: QUOTA_FREE_USED, reset_at: '2026-10-01T00:00:00Z',
  upgrade_url: 'https://dchub.cloud/pricing',
  access: { required: 'registered', granted: false, reason: 'intro_quota_exhausted',
            unlock: { web_sign_in_url: null, mcp_steps: ['unlock_more_data'], pricing_url: 'https://dchub.cloud/pricing' } },
};
const E403_SELF = {
  ok: false, error: 'self_intro_not_allowed', reason: 'self_intro_not_allowed',
  message: "This account shares a domain with the listing's provider, so it cannot register for this listing.",
};
const E403_UPGRADE = {
  ok: false, error: 'upgrade_required', message: 'This listing is available on Pro.',
  access: { required: 'pro', granted: false, reason: 'upgrade_required',
            unlock: { web_sign_in_url: null, mcp_steps: [], pricing_url: 'https://dchub.cloud/pricing' } },
};
const E429_SWEEP = { ok: false, error: 'rate_limited', reason: 'parameter_sweep',
  message: 'Too many different sizes in a short time — try again in a few minutes.', retry_after_s: 600 };
const E429_REVIEW = { ok: false, error: 'review_required', reason: 'review_required',
  message: "This account has reached today's Capacity Source review threshold.", retry_after_s: 86400,
  access: { required: 'registered', granted: false, reason: 'review_required',
            unlock: { web_sign_in_url: null, mcp_steps: [], pricing_url: null, contact: 'jonathan@dchub.cloud' } } };
const E400 = { ok: false, error: 'invalid_request', message: 'give target_kw or target_mw, not both' };
const LIST_EMPTY = {
  ok: true, program: { name: 'DC Hub Capacity Source', status: 'live' }, count: 0, items: [],
  caller_tier: 'anonymous', can_see_pocket: false,
};

// ── a stubbed network that records every call (same shape as
//    test/capacity-source-tools.test.mjs) ─────────────────────────────────────
let S, TOOLS, realFetch;
let calls = [];
let responder = null;
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let pathname = '';
    try { pathname = new URL(url).pathname; } catch { /* not a URL */ }
    let body;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    const rec = { url, pathname, method: String(init.method || 'GET').toUpperCase(), headers: init.headers || {}, body };
    calls.push(rec);
    if (pathname.startsWith('/api/v1/listings')) {
      if (!responder) throw new Error(`unexpected listings call: ${rec.method} ${url}`);
      return responder(rec);
    }
    return json(200, {});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);

afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; responder = null; });

const listingCalls = () => calls.filter((c) => c.pathname.startsWith('/api/v1/listings'));
const seat = (over = {}) => ({
  api_key: 'dch_live_match_test', tier: 'free', platform: 'claude',
  client_name_raw: 'claude-ai', source: 'glama', client_ip: '203.0.113.9',
  session_id: 'sess-capacity-match', ...over,
});
async function call(args, who) {
  const T = TOOLS[READ];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected: ${JSON.stringify(parsed.error.issues)}`);
  const run = () => T.handler(parsed.data, { signal: new AbortController().signal });
  return who ? S._ctxALS.run(who, run) : run();
}
const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');
// The rendered lines only: content[1] (content[0] is the JSON, the last block the source line).
const rendered = (r) => (r.content || []).slice(1, -1).map((c) => c.text || '').join('\n');
async function accepts(payload) {
  const res = await TOOLS[READ].outputSchema.safeParseAsync(payload);
  return { ok: res.success, issues: JSON.stringify(res.error?.issues) };
}

describe('the mode switch', () => {
  it('no target: the browse GET exactly as before, and /match is never called', async () => {
    responder = () => json(200, LIST_EMPTY);
    await call({ market: 'Dallas', state: 'TX', min_mw: 20, available_by: '2027-06', limit: 10 }, seat());
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(lc[0].method).toBe('GET');
    expect(lc[0].pathname).toBe('/api/v1/listings');
    expect(Object.fromEntries(new URL(lc[0].url).searchParams))
      .toEqual({ market: 'Dallas', state: 'TX', min_mw: '20', available_by: '2027-06', limit: '10' });
  });

  it('a slug still opens one listing even when a target is also passed', async () => {
    responder = () => json(200, { ok: true, locked: true, listing: { slug: 'dfw-40mw-powered-shell' } });
    await call({ slug: 'dfw-40mw-powered-shell', target_mw: 40 }, seat());
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(lc[0].pathname).toBe('/api/v1/listings/dfw-40mw-powered-shell');
  });

  it('target_mw: ONE POST to /match with the backend body and the caller identity headers', async () => {
    responder = () => json(200, MATCH_EXACT);
    const r = await call({
      target_mw: 40, min_chunk_kw: 5000, max_sites: 3, max_providers: 2, available_by: '2027-12',
      market: 'Dallas', state: 'TX', region: 'north_america', location: 'Texas', delivery_type: 'powered_shell',
      min_mw: 99, limit: 7,                           // browse-only: must NOT travel to /match
    }, seat());
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(lc[0].method).toBe('POST');
    expect(lc[0].pathname).toBe('/api/v1/listings/match');
    expect(lc[0].body).toEqual({
      target_mw: 40, min_chunk_kw: 5000, max_sites: 3, max_providers: 2, available_by: '2027-12',
      market: 'Dallas', state: 'TX', region: 'north_america', location: 'Texas', delivery_type: 'powered_shell',
    });
    // The same identity request_capacity_intro forwards (callAPIWrite).
    expect(lc[0].headers['X-API-Key']).toBe('dch_live_match_test');
    expect(lc[0].headers['X-MCP-Session']).toBe('sess-capacity-match');
    expect(lc[0].headers['X-MCP-Platform']).toBe('claude');
    expect(lc[0].headers['X-Forwarded-For']).toBe('203.0.113.9');
    expect(r.isError).toBeFalsy();
  });

  it('target_kw alone sends target_kw and nothing unasked', async () => {
    responder = () => json(200, MATCH_EXACT);
    await call({ target_kw: 500 }, seat());
    expect(listingCalls()[0].body).toEqual({ target_kw: 500 });
  });

  it('max_sites outside one to six is refused by the schema before any call', async () => {
    for (const bad of [0, 7, 2.5]) {
      const res = await TOOLS[READ].inputSchema.safeParseAsync({ target_mw: 10, max_sites: bad });
      expect(res.success, String(bad)).toBe(false);
    }
    expect((await TOOLS[READ].inputSchema.safeParseAsync({ target_mw: 10, max_sites: 6 })).success).toBe(true);
  });
});

describe('rendering a match', () => {
  it('exact fit: says so, per-leg kW / place / date, the next step with the slug, and the free quota', async () => {
    responder = () => json(200, MATCH_EXACT);
    const r = await call({ target_mw: 40 }, seat());
    const t = rendered(r);
    expect(t).toContain('Single-listing fits (1)');
    expect(t).toContain('dfw-40mw-powered-shell: 40,000 kW in Dallas, TX, US, available from 2027-04');
    expect(t).toContain('Next: request_capacity_intro slug="dfw-40mw-powered-shell"');
    expect(t).toContain('Introduction requests: 1 of 1 left this month on the free plan (resets 2026-10-01).');
    expect(r.structuredContent.next_steps).toEqual(['request_capacity_intro']);
    const ok = await accepts(r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('bundle: says no single listing fits, groups legs by listing, one next step per listing', async () => {
    responder = () => json(200, MATCH_BUNDLE);
    const r = await call({ target_mw: 40, max_sites: 3, max_providers: 2 }, seat());
    const t = rendered(r);
    expect(t).toContain('No single listing fits the whole requirement. 2 bundles of listings deliver it together:');
    expect(t).toContain('Bundle 1: 40,000 kW across 2 sites from 2 providers, fully delivered by 2027-06');
    expect(t).toContain('phx-15mw-turnkey: 15,000 kW in Phoenix, AZ, US, available from 2027-06 [Provider B]');
    // Grouped by listing: dfw-25mw-shell appears in both bundles and gets ONE line naming both uses.
    const byListing = t.slice(t.indexOf('By listing'));
    const dfw = byListing.split('\n').filter((l) => l.startsWith('- dfw-25mw-shell'));
    expect(dfw).toHaveLength(1);
    expect(dfw[0]).toContain('bundle 1 leg 25,000 kW from 2027-03; bundle 2 leg 20,000 kW from 2027-03');
    for (const slug of ['dfw-25mw-shell', 'phx-15mw-turnkey', 'dfw-20mw-colo']) {
      expect(byListing.match(new RegExp(`request_capacity_intro slug="${slug}"`, 'g')), slug).toHaveLength(1);
    }
    expect(t).toContain('A bundle needs one introduction per listing in it.');
    // Free plan, one intro left, smallest bundle needs two: the note says so.
    expect(r.structuredContent.next_steps_note).toContain('needs 2 introductions and this free account has 1 left');
    const ok = await accepts(r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('never outputs a provider name, even one the backend smuggles into a leg', async () => {
    const leaky = structuredClone(MATCH_BUNDLE);
    leaky.bundles[0].legs[0].provider = 'Northwind Data Centers';
    leaky.bundles[0].legs[0].contact = { email: 'sam@northwind.example' };
    leaky.bundles[0].legs[1].operator_name = 'Northwind Data Centers';
    responder = () => json(200, leaky);
    const r = await call({ target_mw: 40, max_sites: 3 }, seat());
    const all = JSON.stringify(r);
    expect(all).not.toContain('Northwind');
    expect(all).not.toContain('northwind');
    // Control: the smuggled field WAS in what the stub served.
    expect(JSON.stringify(leaky)).toContain('Northwind');
    // The labels are kept: they are response-local, not names.
    expect(rendered(r)).toContain('[Provider A]');
  });

  it('shortfall: best reachable, kW short, the timeline and when the gap closes', async () => {
    responder = () => json(200, MATCH_SHORTFALL);
    const r = await call({ target_mw: 40 }, seat());
    const t = rendered(r);
    expect(t).toContain('No listing or bundle delivers 40,000 kW (40 MW) within these limits.');
    expect(t).toContain('Shortfall: best reachable now 25,000 kW of 40,000 kW (15,000 kW short) across 1 site.');
    expect(t).toContain('2027-09: 30,000 kW deliverable');
    expect(t).toContain('2028-01: 40,000 kW deliverable — meets the target');
    expect(t).toContain('Scheduled capacity closes the gap by 2028-01.');
    expect(t).toContain('pass max_sites (and max_providers) above one');
    expect(t).toContain('request_capacity_intro without a slug');
  });

  it('a shortfall no schedule closes says so', async () => {
    const none = structuredClone(MATCH_SHORTFALL);
    none.shortfall.closes_at = null;
    none.shortfall.timeline = [];
    responder = () => json(200, none);
    expect(rendered(await call({ target_mw: 40 }, seat()))).toContain('No scheduled capacity in the current listings closes the gap.');
  });

  it('quota: exhausted free and unlimited paid each render their own line', async () => {
    responder = () => json(200, { ...MATCH_EXACT, quota: QUOTA_FREE_USED });
    expect(rendered(await call({ target_mw: 40 }, seat()))).toContain('0 of 1 left this month on the free plan (resets 2026-10-01). More now: unlimited from Developer up');
    responder = () => json(200, { ...MATCH_EXACT, quota: QUOTA_PAID, caller_tier: 'pro' });
    expect(rendered(await call({ target_mw: 40 }, seat({ tier: 'pro' })))).toContain('Introduction requests: unlimited on this plan.');
  });
});

describe('walls and errors on match', () => {
  it('keyless 401: the sign-in steps, and the note says browsing stays open', async () => {
    responder = () => json(401, E401_MATCH);
    const r = await call({ target_mw: 40 });
    const sc = r.structuredContent;
    expect(r.isError).toBeFalsy();
    expect(sc.next_steps).toEqual(['claim_free_key', 'bind_email', READ]);
    expect(sc.next_steps_note).toContain('This wall is identity, not payment.');
    expect(sc.next_steps_note).toContain('browsing source_capacity without a target stays open');
    expect(sc.identity_note).toMatch(/OAuth/);
  });

  it('control: the browse/slug 401 note is unchanged (no match sentence)', async () => {
    responder = () => json(401, E401_MATCH);
    const sc = (await call({ slug: 'dfw-40mw-powered-shell' })).structuredContent;
    expect(sc.next_steps_note).toBe('This wall is identity, not payment. Call claim_free_key, then bind_email, then source_capacity. Bind only an email your human explicitly gives you.');
  });

  it('403 account_review: no tool to call, names the contact, not "higher plan"', async () => {
    responder = () => json(403, E403_REVIEW);
    const sc = (await call({ target_mw: 40 }, seat())).structuredContent;
    expect(sc.next_steps).toEqual([]);
    expect(sc.next_steps_note).toContain('under review');
    expect(sc.next_steps_note).toContain('jonathan@dchub.cloud');
    expect(sc.next_steps_note).not.toContain('higher plan');
  });

  it('403 intro_quota_exhausted (request_capacity_intro): monthly limit, reset date, upgrade, standing requirement free', async () => {
    responder = () => json(403, E403_QUOTA);
    const r = await TOOLS.request_capacity_intro.handler({
      slug: 'dfw-40mw-powered-shell', name: 'Jane Doe', company: 'Acme', accept_terms: true, terms_version: 'v1',
    }, { signal: new AbortController().signal });
    const sc = r.structuredContent;
    expect(sc.next_steps).toEqual(['unlock_more_data', 'request_capacity_intro']);
    expect(sc.next_steps_note).toContain('(1 per calendar month, UTC)');
    expect(sc.next_steps_note).toContain('resets on 2026-10-01');
    expect(sc.next_steps_note).toContain('human_url');   // r-relay-contract: the link to relay, not a tool to call
    expect(sc.next_steps_note).toContain('stays free');
    expect(sc.next_steps_note).not.toContain('higher plan');
  });

  it('403 self_intro_not_allowed: pick another listing, not an upgrade', async () => {
    responder = () => json(403, E403_SELF);
    const r = await TOOLS.request_capacity_intro.handler({
      slug: 'dfw-40mw-powered-shell', name: 'Jane Doe', company: 'Acme', accept_terms: true, terms_version: 'v1',
    }, { signal: new AbortController().signal });
    const sc = r.structuredContent;
    expect(sc.next_steps).toEqual(['source_capacity']);
    expect(sc.next_steps_note).toContain('shares a domain');
    expect(sc.next_steps_note).not.toContain('unlock_more_data');
  });

  it('control: a plain 403 upgrade_required keeps the plan note and unlock_more_data', async () => {
    responder = () => json(403, E403_UPGRADE);
    const sc = (await call({ slug: 'dfw-40mw-powered-shell' }, seat())).structuredContent;
    expect(sc.next_steps).toEqual(['unlock_more_data', READ]);
    expect(sc.next_steps_note).toContain('higher plan');
  });

  it('429 parameter_sweep and review_required are errors with their own note', async () => {
    responder = () => json(429, E429_SWEEP);
    const sweep = await call({ target_mw: 40 }, seat());
    expect(sweep.isError).toBe(true);
    expect(sweep.structuredContent.next_steps_note).toContain('Wait 600s');
    expect(sweep.structuredContent.next_steps_note).toContain('Do not step through sizes');
    expect(sweep.structuredContent._error_mitigation.deterministic_hint).toContain(E429_SWEEP.message);

    responder = () => json(429, E429_REVIEW);
    const review = await call({ target_mw: 40 }, seat());
    expect(review.isError).toBe(true);
    expect(review.structuredContent.next_steps_note).toContain('Do not retry today');
    expect(review.structuredContent.next_steps_note).toContain('jonathan@dchub.cloud');
  });

  it('400 invalid_request is an error carrying the backend message', async () => {
    responder = () => json(400, E400);
    const r = await call({ target_mw: 40, target_kw: 40000 }, seat());
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('give target_kw or target_mw, not both');
  });
});

describe('registration', () => {
  it('source_capacity stays FREE_FULL and read-only; no new tool was added', () => {
    expect(S.FREE_FULL_TOOLS.has(READ)).toBe(true);
    expect(TOOLS[READ].annotations.readOnlyHint).toBe(true);
    expect(Object.keys(TOOLS).filter((n) => /match/i.test(n))).toEqual([]);
  });

  it('the description names the match mode without a digit', () => {
    const d = TOOLS[READ].description;
    expect(d).toContain('pass target_mw or target_kw');
    expect(d).toContain('shortfall timeline');
    expect(d).toContain('providers stay anonymised until an introduction is accepted');
  });
});
