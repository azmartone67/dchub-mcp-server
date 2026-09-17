// ── Capacity Source: two tools, the wall contract, and the lead gate ─────────
//
// source_capacity and request_capacity_intro front /api/v1/listings*, a
// backend contract built in parallel with these tools. They were named
// get_pocket_listings and request_listing_intro until 2026-09-13; those names
// still resolve through TOOL_ALIASES (pinned at the bottom of this file). Every response below is
// a FIXTURE in that contract's shape; nothing here reaches a network.
//
// ★ WHAT FAILS SILENTLY, and therefore what this file pins:
//   1. outputSchema. The SDK validates structuredContent on every SUCCESS
//      result, and a schema narrower than the payload answers -32602 for every
//      tier while telemetry logs the call as ok (hyperscaler_deals, twice). So
//      every contract response is parsed verbatim AND as it leaves the real
//      handler chain, which stamps its own keys on top.
//   2. The walls. 401/403/409/422 are how the backend says "not yet". Through
//      the stock upstream-error path they become {error:"API 401"}: reason,
//      unlock steps and terms discarded, flagged isError. An agent can act on
//      next_steps; it cannot act on a status string.
//   3. The lead gate. A request whose terms were not accepted must never reach
//      the backend. A refusal RESULT proves nothing about that; only the COUNT
//      of listings calls the stubbed network saw does, next to a control that
//      proves the same stub sees the call when it is allowed.
//   4. The path. encodeURIComponent leaves "." alone, so ".." is a dot segment
//      that URL normalisation resolves out of /api/v1/listings/.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const BASE = 'http://127.0.0.1:1';
const READ = 'source_capacity';
const WRITE = 'request_capacity_intro';
const ACCEPT = 'accept_capacity_terms';

// ── contract fixtures ────────────────────────────────────────────────────────
const VIEWER_ANON = {
  identified: false, tier: 'anonymous', channel: 'mcp', email_masked: null,
  identity_source: null, sign_in_url: 'https://dchub.cloud/login?redirect=%2Flistings',
};
const VIEWER_IDENTIFIED = {
  identified: true, tier: 'free', channel: 'mcp', email_masked: 'j***@acme.com',
  identity_source: 'api_key', sign_in_url: null,
};
const ACCESS_LOCKED = {
  required: 'registered', granted: false, reason: 'sign_in_required',
  unlock: {
    web_sign_in_url: 'https://dchub.cloud/login?redirect=%2Flistings%3Fl%3Ddfw-40mw',
    mcp_steps: ['claim_free_key', 'bind_email'], pricing_url: null,
  },
};
const TEASER = {
  id: 12, slug: 'dfw-40mw-powered-shell', title: '40 MW powered shell — DFW',
  summary: 'Energized Q2 2027, expandable.', status: 'pocket', access_required: 'registered',
  locked: true, market: 'Dallas', state: 'TX', country: 'US', capacity_mw: 40.0,
  available: 'Q2 2027', created_at: '2026-09-12T14:00:00+00:00',
  updated_at: '2026-09-12T14:00:00+00:00', expires_at: null,
  url: 'https://dchub.cloud/listings?l=dfw-40mw-powered-shell',
};
const TERMS_BLOCK = { version: '2026-09-11', url: 'https://dchub.cloud/listings#terms', summary: '…' };
const PROGRAM = {
  name: 'DC Hub Capacity Source', status: 'upcoming',
  headline: 'The live source for data center capacity', summary: '…',
  how_it_works: ['…', '…', '…'],
  register_interest: { method: 'POST', path: '/api/v1/listings/interest', mcp_tool: 'request_capacity_intro' },
  terms: TERMS_BLOCK,
};
const LIST_UPCOMING_EMPTY = {
  ok: true, program: PROGRAM, viewer: VIEWER_ANON, count: 0, items: [],
  pocket_locked_count: 0, caller_tier: 'anonymous', can_see_pocket: false,
};
const listWithItems = (n) => {
  const items = Array.from({ length: n }, (_, i) => ({
    ...TEASER, id: TEASER.id + i, slug: i ? `${TEASER.slug}-${i}` : TEASER.slug,
    ...(i === n - 1 ? { access_required: 'pro' } : {}),
  }));
  return {
    ok: true, program: { ...PROGRAM, status: 'live' }, viewer: VIEWER_ANON, count: n, items,
    pocket_locked_count: n, caller_tier: 'anonymous', can_see_pocket: false,
    upgrade_for_pocket: { tier_required: 'pro', url: 'https://dchub.cloud/pricing', message: '…' },
  };
};
const INTRODUCTION = {
  method: 'POST', path: '/api/v1/listings/dfw-40mw-powered-shell/intro',
  mcp_tool: 'request_capacity_intro', operator_contact: 'never_shared',
};
const DETAIL_LOCKED = {
  ok: true, locked: true, listing: TEASER, access: ACCESS_LOCKED,
  introduction: INTRODUCTION, viewer: VIEWER_ANON, caller_tier: 'anonymous',
};
const DETAIL_UNLOCKED = {
  ok: true, locked: false,
  listing: {
    ...TEASER, locked: false, latitude: 32.78, longitude: -96.8,
    asking_price: 125000000, asking_currency: 'USD',
    detail: { utility: 'Oncor', substation_kv: 345, expansion_mw: 80 },
  },
  access: { required: 'registered', granted: true, reason: null,
            unlock: { web_sign_in_url: null, mcp_steps: [], pricing_url: null } },
  introduction: INTRODUCTION, viewer: VIEWER_IDENTIFIED, caller_tier: 'free',
};
const DETAIL_UNLOCKED_PRICE_WITHHELD = {
  ...DETAIL_UNLOCKED,
  listing: { ...DETAIL_UNLOCKED.listing, asking_price: null, asking_currency: null, detail: {} },
};
const HEX64 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const INTRO_OK = {
  ok: true, lead_id: 'LD-7K2M9QXA', kind: 'listing_introduction',
  status: 'pending_email_confirmation', duplicate: false,
  listing: { slug: 'dfw-40mw-powered-shell', title: '40 MW powered shell — DFW' },
  registered_at: '2026-09-12T15:01:02+00:00', email_masked: 'j***@acme.com',
  confirmation: { required: true, sent: true, sent_to: 'j***@acme.com', expires_at: '2026-09-26T15:01:02+00:00' },
  verify_url: 'https://dchub.cloud/listings?verify=LD-7K2M9QXA',
  ledger: { seq: 12, entry_hash: HEX64 },
  next: 'Check j***@acme.com and click the confirmation link.',
};
const INTEREST_OK = {
  ...INTRO_OK, lead_id: 'LD-3PQ8ZT2B', kind: 'standing_requirement', status: 'registered',
  listing: null, matching_listings: 0, verify_url: 'https://dchub.cloud/listings?verify=LD-3PQ8ZT2B',
};
const INTEREST_PENDING = { ...INTEREST_OK, status: 'pending_email_confirmation', matching_listings: 2 };
const E401_SIGN_IN = {
  ok: false, error: 'identity_required', message: 'Sign in to request an introduction.',
  reason: 'sign_in_required', access: ACCESS_LOCKED,
};
const E401_BIND = {
  ok: false, error: 'identity_required', message: 'Bind an email to this key first.',
  reason: 'email_binding_required',
  access: { ...ACCESS_LOCKED, reason: 'email_binding_required',
            unlock: { ...ACCESS_LOCKED.unlock, mcp_steps: ['bind_email'] } },
};
const E403 = {
  ok: false, error: 'upgrade_required', message: 'This listing is available on Pro.',
  access: { required: 'pro', granted: false, reason: 'upgrade_required',
            unlock: { web_sign_in_url: null, mcp_steps: [], pricing_url: 'https://dchub.cloud/pricing' } },
};
const E404 = { ok: false, error: 'not_found' };
const E409 = {
  ok: false, error: 'terms_version_mismatch', message: 'The introduction terms have changed.',
  terms: { ...TERMS_BLOCK, version: '2026-10-01' },
};
const E422_TERMS = { ok: false, error: 'terms_not_accepted', message: 'Accept the introduction terms.', terms: TERMS_BLOCK };
const E422_INVALID = {
  ok: false, error: 'invalid_request', message: 'A requirement needs capacity_mw, markets or states.',
  fields: { requirement: 'one of capacity_mw, markets, states is required' },
};
const E429 = { ok: false, error: 'rate_limited', message: 'Too many introduction requests.', retry_after_s: 60 };
const E503 = { ok: false, error: 'ledger_unavailable', message: 'The lead register is temporarily unavailable.' };
const TERMS_OK = { ok: true, terms: { ...TERMS_BLOCK, text: '…' } };
const ACCEPT_OK = {
  ok: true, accepted: true, already_accepted: false, terms: TERMS_BLOCK,
  accepted_at: '2026-09-13T04:10:00.000000+00:00', ledger: { seq: 14, entry_hash: HEX64 },
};
const ACCEPT_ALREADY = { ok: true, accepted: true, already_accepted: true, terms: TERMS_BLOCK };
const ACCESS_TERMS = {
  required: 'registered', granted: false, reason: 'terms_acceptance_required',
  unlock: { web_sign_in_url: null, mcp_steps: ['accept_capacity_terms'], pricing_url: null,
            terms: TERMS_BLOCK, accept: { method: 'POST', path: '/api/v1/listings/terms/accept' } },
};
const DETAIL_LOCKED_TERMS = {
  ok: true, locked: true, listing: { ...TEASER, lock_reason: 'terms_acceptance_required' },
  access: ACCESS_TERMS, introduction: INTRODUCTION, viewer: VIEWER_IDENTIFIED, caller_tier: 'free',
};

// ── deal registration (2026-09-15) ───────────────────────────────────────────
// GET /api/v1/listings takes min_kw, region, location, delivery_type and
// available_by and answers with `filters`; every card gains capacity_kw, region
// and update_cadence; GET /api/v1/listings/<slug> gains `disclosure`, which carries
// the provider's identity, site and contact only once the provider has accepted
// a deal registration. The contract's first draft named it `identity`; the backend
// renamed it because structuredContent.identity is the caller identity stamp.
const TERMS_V15 = { ...TERMS_BLOCK, version: '2026-09-15' };
const TEASER_EU = {
  ...TEASER, id: 31, slug: 'fra-500kw-colocation', title: '500 kW colocation — Frankfurt',
  market: 'Frankfurt', state: null, country: 'DE', capacity_mw: 0.5, capacity_kw: 500,
  region: 'europe', update_cadence: 'monthly', url: 'https://dchub.cloud/listings?l=fra-500kw-colocation',
};
const FILTERS_EU = {
  min_kw: 500, min_mw: null, region: ['europe'], country: null, location: null, market: null,
  state: null, delivery_type: 'colocation', available_by: '2027-06', limit: 25,
};
const LIST_FILTERED = {
  ok: true, program: { ...PROGRAM, status: 'live', terms: TERMS_V15 }, viewer: VIEWER_ANON, count: 1,
  items: [TEASER_EU], filters: FILTERS_EU, pocket_locked_count: 1, caller_tier: 'anonymous', can_see_pocket: false,
};
const DISCLOSURE_RELEASED = {
  released: true, status: 'accepted', lead_id: 'LD-7K2M9QXA', accepted_at: '2026-09-15T16:20:00+00:00',
  provider: 'Northwind Data Centers', site: '1200 Industrial Blvd, Garland, TX',
  latitude: 32.91, longitude: -96.63, substation: 'Garland 345 kV',
  contact: { name: 'Sam Lee', email: 'sam.lee@northwind.example', phone: '+1 214 555 0100' },
  how: 'The provider accepted your deal registration.',
};
const DISCLOSURE_PENDING = {
  released: false, status: 'pending', lead_id: 'LD-7K2M9QXA', accepted_at: null,
  provider: null, site: null, latitude: null, longitude: null, substation: null, contact: null,
  how: 'The provider has your deal registration and has not answered yet.',
};
const LISTING_KW = { ...DETAIL_UNLOCKED.listing, capacity_kw: 40000, region: 'north_america', update_cadence: 'weekly' };
const DETAIL_RELEASED = { ...DETAIL_UNLOCKED, listing: LISTING_KW, disclosure: DISCLOSURE_RELEASED };
const DETAIL_PENDING = { ...DETAIL_UNLOCKED, listing: LISTING_KW, disclosure: DISCLOSURE_PENDING };

// ── the licence split (2026-09-15, owner decision; dchub-backend #4654) ──────
// The backend sends the PUBLIC block on teaser-level responses (the feed, the
// summary, a locked or anonymous single listing) and the CONFIDENTIAL block on
// full detail, a released identity and every terms/registration/ledger answer.
// Both blocks appear here verbatim, so this server's deference is tested
// against what actually arrives rather than against a paraphrase of it.
const CITATION_PUBLIC = {
  source: 'DC Hub Capacity Source', url: 'https://dchub.cloud/listings',
  license: 'CC-BY-4.0', redistribution: 'permitted_with_attribution',
  cite_as: 'DC Hub Capacity Source, dchub.cloud',
};
const CITATION_CONFIDENTIAL = {
  source: 'DC Hub Capacity Source', url: 'https://dchub.cloud/listings',
  license: 'LicenseRef-DCHub-Capacity-Source-Confidential', redistribution: 'not_permitted',
  license_url: 'https://dchub.cloud/listings#terms',
  cite_as: 'DC Hub Capacity Source (confidential — not for redistribution), dchub.cloud',
};
// GET /api/v1/listings/summary — the cached aggregate behind the pointers.
const SUMMARY_BODY = {
  ok: true, live_count: 2, total_mw: 40.5, latest_updated_at: '2026-09-15T12:00:00+00:00',
  generated_at: '2026-09-15T12:05:00+00:00', program_status: 'live',
  markets: [{ market: 'Dallas', state: 'TX', country: 'US', count: 1, mw: 40, delivery_types: ['powered_shell'] }],
};

// ── a stubbed network that records every call ────────────────────────────────
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
    return json(200, {});   // telemetry / heartbeat: swallowed, never reaches production
  };
  // server.mjs captures API_BASE at module evaluation; restore right after so
  // a sibling suite in this worker does not inherit the override.
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
const identifiedSeat = (over = {}) => ({
  api_key: 'dch_live_listing_test', tier: 'free', platform: 'claude',
  client_name_raw: 'claude-ai', source: 'glama', client_ip: '203.0.113.7',
  session_id: 'sess-capacity-source', ...over,
});
async function call(name, args, seat) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  const run = () => T.handler(parsed.data, { signal: new AbortController().signal });
  return seat ? S._ctxALS.run(seat, run) : run();
}
async function accepts(name, payload) {
  const res = await TOOLS[name].outputSchema.safeParseAsync(payload);
  return { ok: res.success, issues: JSON.stringify(res.error?.issues) };
}
const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const COMPLETE = {
  name: 'Jane Doe', company: 'Acme Capital', role: 'VP Development', capacity_mw: 40,
  markets: 'Dallas', states: 'TX', timeline: 'Q2 2027', use_case: 'AI inference',
  notes: 'Needs expansion rights.', message: 'Interested in a tour.', accept_terms: true,
  terms_version: '2026-09-11',
};

// ── source-level parse: comments/strings blanked, same-length rewrite ────────
// Same approach (and the same false-positive lessons) as
// test/handler-args-declared.test.mjs, reduced to what an arity check needs.
function blank(src, { strings }) {
  const out = src.split(''); const n = src.length;
  let i = 0, prev = '';
  const wipe = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < n) {
    const c = src[i]; const two = src.slice(i, i + 2);
    if (two === '//') { let j = src.indexOf('\n', i); if (j < 0) j = n; wipe(i, j); i = j; continue; }
    if (two === '/*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; wipe(i, j); i = j; continue; }
    if (c === '"' || c === "'") {
      const q = c; const s = i; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (src[i] === '\n') break;
        i++;
      }
      if (strings) wipe(s + 1, i - 1);
      prev = 'x'; continue;
    }
    if (c === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src.slice(i, i + 2) === '${') {
          let d = 1; i += 2;
          while (i < n && d) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; }
          continue;
        }
        if (strings && src[i] !== '\n') out[i] = ' ';
        i++;
      }
      prev = 'x'; continue;
    }
    if (c === '/' && prev !== 'x' && prev !== ')' && prev !== ']') {
      const s = i; i++; let incls = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') incls = true;
        else if (src[i] === ']') incls = false;
        else if (src[i] === '/' && !incls) { i++; break; }
        else if (src[i] === '\n') break;
        i++;
      }
      while (i < n && 'gimsuyd'.includes(src[i])) i++;
      if (strings) wipe(s + 1, i);
      prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = /[A-Za-z0-9_$]/.test(c) ? 'x' : c;
    i++;
  }
  return out.join('');
}
function topArgs(code, open) {
  const out = []; let i = open + 1, depth = 1, start = i;
  while (i < code.length) {
    const c = code[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { depth--; if (depth === 0) { out.push([start, i]); return out; } }
    else if (c === ',' && depth === 1) { out.push([start, i]); start = i + 1; }
    i++;
  }
  return out;
}
const CODE = blank(SRC, { strings: true });
const NOCOMMENT = blank(SRC, { strings: false });
function registration(name) {
  const found = [...NOCOMMENT.matchAll(new RegExp(`trackedTool\\(\\s*srv\\s*,\\s*'${name}'`, 'g'))];
  if (found.length !== 1) return { count: found.length, arity: null };
  return { count: 1, arity: topArgs(CODE, CODE.indexOf('(', found[0].index)).length };
}
// The literal of a `const X = new Set([...])` block with // comments removed, so
// a tool name mentioned in a comment cannot stand in for the entry itself.
function setLiteral(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error(`anchor missing from server.mjs: ${decl}`);
  return SRC.slice(i, SRC.indexOf(']);', i)).replace(/\/\/[^\n]*/g, '');
}

describe('registration', () => {
  it('both tools are registered on a real createServer()', () => {
    for (const n of [READ, WRITE, ACCEPT]) {
      expect(TOOLS[n], `${n} not registered`).toBeTruthy();
      expect(typeof TOOLS[n].handler).toBe('function');
    }
  });

  it('both use the 5-arg trackedTool(srv, name, description, schema, handler)', () => {
    // Controls first: the parser must see a known registration correctly, and
    // must be able to report something other than 5.
    expect(registration('bind_email')).toEqual({ count: 1, arity: 5 });
    const four = "f(srv, 'a, b', { x: 1, y: [2, 3] }, (q) => { g(1, 2); })";
    expect(topArgs(blank(four, { strings: true }), 1).length).toBe(4);
    expect(registration(READ)).toEqual({ count: 1, arity: 5 });
    expect(registration(WRITE)).toEqual({ count: 1, arity: 5 });
    expect(registration(ACCEPT)).toEqual({ count: 1, arity: 5 });
  });

  it('source_capacity is FREE_FULL and read-only, and not a write tool', () => {
    expect(S.FREE_FULL_TOOLS.has(READ)).toBe(true);
    const writes = setLiteral('const WRITE_TOOLS = new Set([');
    expect(writes).toContain("'bind_email'");            // control: the slice is the real set
    expect(writes).not.toContain(`'${READ}'`);
    expect(TOOLS[READ].annotations.readOnlyHint).toBe(true);
  });

  it('request_capacity_intro is a write: WRITE_TOOLS, readOnlyHint false, quota- and nudge-exempt', () => {
    expect(setLiteral('const WRITE_TOOLS = new Set([')).toContain(`'${WRITE}'`);
    const a = TOOLS[WRITE].annotations;
    expect(a.readOnlyHint).toBe(false);
    expect(a.idempotentHint).toBe(false);
    expect(a.destructiveHint).toBe(false);
    expect(S.QUOTA_EXEMPT_TOOLS.has(WRITE)).toBe(true);
    const nudge = setLiteral('const _RETURN_NUDGE_SKIP = new Set([');
    expect(nudge).toContain("'bind_email'");
    expect(nudge).toContain(`'${WRITE}'`);
  });

  // 2026-09-15: source_capacity was asked to carry ONE size example, and an
  // example is digits. It is cut out before the check and must be there exactly
  // once, so the rule still holds for everything else in all three descriptions.
  const SIZE_EXAMPLE = '"500 kW anywhere in Europe" → min_kw=500, region=europe';
  it("descriptions carry no digits, apart from source_capacity's one size example", () => {
    for (const n of [READ, WRITE, ACCEPT]) {
      const d = TOOLS[n].description;
      expect(d.length, `${n} description implausibly short`).toBeGreaterThan(300);
      const parts = d.split(SIZE_EXAMPLE);
      expect(parts.length - 1, `${n}: size example count`).toBe(n === READ ? 1 : 0);
      expect(parts.join(' '), n).not.toMatch(/\d/);
    }
  });

  it('declares no required argument, so {} passes schema validation and the handler decides', async () => {
    for (const n of [READ, WRITE, ACCEPT]) {
      expect((await TOOLS[n].inputSchema.safeParseAsync({})).success, n).toBe(true);
    }
  });
});

describe('outputSchema accepts every contract response verbatim', () => {
  const CASES = [
    [READ, 'list — program upcoming, no items', LIST_UPCOMING_EMPTY],
    [READ, 'list — live, with items and upgrade_for_pocket', listWithItems(5)],
    [READ, 'detail — locked teaser', DETAIL_LOCKED],
    [READ, 'detail — unlocked', DETAIL_UNLOCKED],
    [READ, 'detail — unlocked, price withheld', DETAIL_UNLOCKED_PRICE_WITHHELD],
    [WRITE, 'intro — pending email confirmation', INTRO_OK],
    [WRITE, 'intro — 401 identity_required body', E401_SIGN_IN],
    [WRITE, 'interest — registered', INTEREST_OK],
    [WRITE, 'interest — pending email confirmation', INTEREST_PENDING],
    [READ, 'detail — locked until the terms are accepted', DETAIL_LOCKED_TERMS],
    [ACCEPT, 'accept — recorded', ACCEPT_OK],
    [ACCEPT, 'accept — already accepted', ACCEPT_ALREADY],
    [ACCEPT, 'accept — 401 identity_required body', E401_SIGN_IN],
    [READ, 'list — filtered by size and region, cards with capacity_kw', LIST_FILTERED],
    [READ, 'detail — disclosure released after the provider accepted', DETAIL_RELEASED],
    [READ, 'detail — disclosure not released, deal registration pending', DETAIL_PENDING],
  ];
  for (const [tool, label, fixture] of CASES) {
    it(`${tool}: ${label}`, async () => {
      const r = await accepts(tool, fixture);
      expect(r.ok, r.issues).toBe(true);
    });
  }

  it('control: the schema really validates (a wrong-typed envelope key is rejected)', async () => {
    for (const n of [READ, WRITE, ACCEPT]) {
      expect((await accepts(n, { _entity: 42 })).ok, n).toBe(false);
    }
  });
});

describe('source_capacity', () => {
  it('browses with the filters as a GET to /api/v1/listings and returns the backend JSON', async () => {
    responder = () => json(200, LIST_UPCOMING_EMPTY);
    const r = await call(READ, { market: 'Dallas', state: 'TX', min_mw: 20, limit: 25 });
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(lc[0].method).toBe('GET');
    expect(lc[0].pathname).toBe('/api/v1/listings');
    const q = new URL(lc[0].url).searchParams;
    expect([q.get('market'), q.get('state'), q.get('min_mw'), q.get('limit')]).toEqual(['Dallas', 'TX', '20', '25']);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.program).toEqual(PROGRAM);
    expect(r.structuredContent.items).toEqual([]);
    const ok = await accepts(READ, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('an anonymous caller gets EVERY teaser row with capacity_mw intact (not the anon trim)', async () => {
    const n = S.TRIAL_PREVIEW_ROWS + 2;
    const fixture = listWithItems(n);
    // Premise: the anon trim WOULD cut rows and null capacity_mw on this payload.
    const trimmed = S.trimForTrial(JSON.parse(JSON.stringify(fixture)), READ);
    expect(trimmed.items.length).toBeLessThan(n);
    expect(trimmed.items[0].capacity_mw).toBeNull();

    responder = () => json(200, fixture);
    const r = await call(READ, {});
    expect(r.structuredContent.items).toHaveLength(n);
    expect(r.structuredContent.items[0].capacity_mw).toBe(40);
    expect(r.structuredContent._upgrade).toBeUndefined();
    const ok = await accepts(READ, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('a slug fetches one listing; the locked teaser and the unlocked detail both pass the schema as served', async () => {
    for (const fixture of [DETAIL_LOCKED, DETAIL_UNLOCKED]) {
      calls = [];
      responder = () => json(200, fixture);
      const r = await call(READ, { slug: 'dfw-40mw-powered-shell', market: 'ignored-when-slug-given' });
      const lc = listingCalls();
      expect(lc).toHaveLength(1);
      expect(lc[0].pathname).toBe('/api/v1/listings/dfw-40mw-powered-shell');
      expect(new URL(lc[0].url).search).toBe('');
      expect(r.structuredContent.locked).toBe(fixture.locked);
      expect(r.structuredContent.introduction.operator_contact).toBe('never_shared');
      const ok = await accepts(READ, r.structuredContent);
      expect(ok.ok, ok.issues).toBe(true);
    }
  });

  it('a numeric id is accepted as the slug', async () => {
    responder = () => json(200, DETAIL_LOCKED);
    await call(READ, { slug: 12 });
    expect(listingCalls()[0].pathname).toBe('/api/v1/listings/12');
  });

  it('a traversal slug stays URL-encoded inside /api/v1/listings/', async () => {
    // Premise: without encoding, this slug leaves the namespace (the two ".."
    // segments consume "listings" and "v1").
    const unencoded = new URL('/api/v1/listings/../../admin/listings', BASE).pathname;
    expect(unencoded).toBe('/api/admin/listings');
    expect(unencoded.startsWith('/api/v1/listings/')).toBe(false);
    responder = () => json(404, E404);
    await call(READ, { slug: '../../admin/listings' });
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(lc[0].pathname).toBe('/api/v1/listings/..%2F..%2Fadmin%2Flistings');
    expect(lc[0].url).not.toContain('/admin/listings');
  });

  it('a bare dot-segment slug is refused before any request', async () => {
    // Premise: encodeURIComponent does not encode dots, so ".." would resolve
    // out of the namespace even after encoding.
    expect(new URL('/api/v1/listings/' + encodeURIComponent('..'), BASE).pathname).toBe('/api/v1/');
    expect(new URL('/api/v1/listings/' + encodeURIComponent('..') + '/intro', BASE).pathname).toBe('/api/v1/intro');
    for (const slug of ['..', '.']) {
      calls = [];
      responder = () => json(200, DETAIL_UNLOCKED);
      const r = await call(READ, { slug });
      expect(listingCalls(), `slug ${slug}`).toHaveLength(0);
      expect(r.isError).toBe(true);
      expect(r.structuredContent.error).toBe('invalid_slug');
    }
  });

  it('404 is an error that keeps the backend body', async () => {
    responder = () => json(404, E404);
    const r = await call(READ, { slug: 'no-such-listing' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toBe('not_found');
    expect(r.structuredContent.http_status).toBe(404);
    expect(r.structuredContent._error_mitigation.deterministic_hint).toMatch(/source_capacity/);
  });
});

describe('request_capacity_intro — nothing leaves without accepted terms', () => {
  it('accept_terms=false never reaches the backend', async () => {
    responder = () => json(200, INTRO_OK);
    const r = await call(WRITE, { ...COMPLETE, slug: 'dfw-40mw-powered-shell', accept_terms: false }, identifiedSeat());
    expect(listingCalls()).toHaveLength(0);
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent;
    expect(sc.sent).toBe(false);
    expect(sc.missing).toEqual(['accept_terms']);
    expect(sc.terms_url).toBe('https://dchub.cloud/listings#terms');
    expect(sc.terms_api).toBe('/api/v1/listings/terms');
    expect(sc.message).toMatch(/must read and agree/i);
    const ok = await accepts(WRITE, sc);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('accept_terms omitted, or a truthy non-true value, never reaches the backend either', async () => {
    responder = () => json(200, INTRO_OK);
    const { accept_terms: _omit, ...noTerms } = COMPLETE;
    await call(WRITE, noTerms, identifiedSeat());
    expect(listingCalls()).toHaveLength(0);
    // A string "true" is not accepted by the schema at all.
    expect((await TOOLS[WRITE].inputSchema.safeParseAsync({ ...COMPLETE, accept_terms: 'true' })).success).toBe(false);
  });

  it('missing name/company never reaches the backend and names both', async () => {
    responder = () => json(200, INTEREST_OK);
    const r = await call(WRITE, { ...COMPLETE, name: '   ', company: undefined }, identifiedSeat());
    expect(listingCalls()).toHaveLength(0);
    expect(r.structuredContent.missing).toEqual(['name', 'company']);
    expect(r.structuredContent.terms_url).toBeUndefined();
  });

  it('MUST-FAIL CONTROL: a complete request DOES reach the stub, exactly once', async () => {
    responder = () => json(200, INTEREST_OK);
    await call(WRITE, COMPLETE, identifiedSeat());
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(lc[0].method).toBe('POST');
    expect(lc[0].pathname).toBe('/api/v1/listings/interest');
  });
});

describe('request_capacity_intro — the request as sent', () => {
  it('a slug POSTs the contract body to /intro with identity headers and client hints', async () => {
    responder = () => json(200, INTRO_OK);
    const r = await call(WRITE, { ...COMPLETE, slug: 'dfw-40mw-powered-shell' }, identifiedSeat());
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(lc[0].method).toBe('POST');
    expect(lc[0].pathname).toBe('/api/v1/listings/dfw-40mw-powered-shell/intro');
    expect(lc[0].body).toEqual({
      name: 'Jane Doe', company: 'Acme Capital', role: 'VP Development',
      requirement: { capacity_mw: 40, markets: ['Dallas'], states: ['TX'], timeline: 'Q2 2027',
                     use_case: 'AI inference', notes: 'Needs expansion rights.' },
      message: 'Interested in a tour.', accept_terms: true, terms_version: '2026-09-11',
      client: { name: 'claude-ai', platform: 'claude', source: 'glama' },
    });
    expect(lc[0].headers['X-API-Key']).toBe('dch_live_listing_test');
    expect(lc[0].headers['X-MCP-Session']).toBe('sess-capacity-source');
    expect(lc[0].headers['X-MCP-Platform']).toBe('claude');
    expect(lc[0].headers['X-Forwarded-For']).toBe('203.0.113.7');
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.lead_id).toBe('LD-7K2M9QXA');
    expect(r.structuredContent.verify_url).toBe('https://dchub.cloud/listings?verify=LD-7K2M9QXA');
    const ok = await accepts(WRITE, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('no slug POSTs to /interest; comma-separated markets and states become arrays', async () => {
    responder = () => json(200, INTEREST_PENDING);
    const r = await call(WRITE, { ...COMPLETE, markets: ' Dallas,  Phoenix , ', states: 'TX,AZ' }, identifiedSeat());
    const [sent] = listingCalls();
    expect(sent.pathname).toBe('/api/v1/listings/interest');
    expect(sent.body.requirement.markets).toEqual(['Dallas', 'Phoenix']);
    expect(sent.body.requirement.states).toEqual(['TX', 'AZ']);
    expect(r.structuredContent.kind).toBe('standing_requirement');
    const ok = await accepts(WRITE, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('client carries only the fields the request context has', async () => {
    responder = () => json(200, INTEREST_OK);
    await call(WRITE, COMPLETE, identifiedSeat({ source: '', client_name_raw: null }));
    expect(listingCalls()[0].body.client).toEqual({ platform: 'claude' });
    calls = [];
    await call(WRITE, COMPLETE);   // no request context at all
    expect(listingCalls()[0].body).not.toHaveProperty('client');
  });

  it('without terms_version it reads the published version first, then sends that', async () => {
    responder = (rec) => (rec.pathname === '/api/v1/listings/terms' ? json(200, TERMS_OK) : json(200, INTEREST_OK));
    const { terms_version: _omit, ...args } = COMPLETE;
    await call(WRITE, args, identifiedSeat());
    const lc = listingCalls();
    expect(lc.map((c) => `${c.method} ${c.pathname}`)).toEqual(['GET /api/v1/listings/terms', 'POST /api/v1/listings/interest']);
    expect(lc[1].body.terms_version).toBe('2026-09-11');
  });

  it('a traversal slug stays URL-encoded on the intro path too', async () => {
    responder = () => json(404, E404);
    await call(WRITE, { ...COMPLETE, slug: '../../admin/listings' }, identifiedSeat());
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(lc[0].pathname).toBe('/api/v1/listings/..%2F..%2Fadmin%2Flistings/intro');
  });
});

describe('walls come back as structured results an agent can act on', () => {
  it('premise: the stock upstream path would have flagged a 401 as an opaque error', () => {
    const old = S._upstreamError(401, JSON.stringify(E401_SIGN_IN));
    expect(old.error).toBe('API 401');
    expect(old.access).toBeUndefined();
    const flagged = S._flagUpstreamError({ content: [], structuredContent: old }, WRITE);
    expect(flagged.isError).toBe(true);
  });

  it('401 sign_in_required → next_steps claim_free_key, bind_email, request_capacity_intro', async () => {
    responder = () => json(401, E401_SIGN_IN);
    const r = await call(WRITE, COMPLETE);
    const sc = r.structuredContent;
    expect(r.isError).toBeFalsy();
    expect(sc.next_steps).toEqual(['claim_free_key', 'bind_email', 'request_capacity_intro']);
    expect(sc.error).toBe('identity_required');
    expect(sc.reason).toBe('sign_in_required');
    expect(sc.access).toEqual(ACCESS_LOCKED);
    expect(sc.message).toBe(E401_SIGN_IN.message);
    expect(sc.http_status).toBe(401);
    expect(sc.identity_note).toMatch(/OAuth/);
    expect(textOf(r)).not.toContain('API 401');
    const ok = await accepts(WRITE, sc);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('401 email_binding_required → next_steps bind_email, request_capacity_intro', async () => {
    responder = () => json(401, E401_BIND);
    const r = await call(WRITE, COMPLETE, identifiedSeat());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.next_steps).toEqual(['bind_email', 'request_capacity_intro']);
    expect(r.structuredContent.identity_note).toMatch(/OAuth/);
  });

  it('the wall adds no human CTA of its own', async () => {
    responder = () => json(401, E401_SIGN_IN);
    const r = await call(WRITE, COMPLETE);
    expect(S._hasHumanCta(textOf(r))).toBe(false);
    expect(r.structuredContent._upgrade).toBeUndefined();
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/dchub\.cloud\/go\/c\//);
    expect(all).not.toMatch(/buy\.stripe\.com/);
  });

  it('403, 409 and both 422s are structured results carrying the body and next_steps', async () => {
    const cases = [
      [E403, 403, ['unlock_more_data', 'request_capacity_intro'], 'access'],
      [E409, 409, ['request_capacity_intro'], 'terms'],
      [E422_TERMS, 422, ['request_capacity_intro'], 'terms'],
      [E422_INVALID, 422, ['request_capacity_intro'], 'fields'],
    ];
    for (const [body, status, steps, carried] of cases) {
      responder = () => json(status, body);
      const r = await call(WRITE, COMPLETE, identifiedSeat());
      const sc = r.structuredContent;
      expect(r.isError, `${status} ${body.error}`).toBeFalsy();
      expect(sc.error).toBe(body.error);
      expect(sc[carried]).toEqual(body[carried]);
      expect(sc.next_steps).toEqual(steps);
      expect(typeof sc.next_steps_note).toBe('string');
      const ok = await accepts(WRITE, sc);
      expect(ok.ok, ok.issues).toBe(true);
    }
  });

  it('409 tells the agent which terms version to retry with', async () => {
    responder = () => json(409, E409);
    const r = await call(WRITE, COMPLETE, identifiedSeat());
    expect(r.structuredContent.next_steps_note).toContain('2026-10-01');
  });

  it('429 and 503 are errors that keep the backend message', async () => {
    for (const [body, status] of [[E429, 429], [E503, 503]]) {
      responder = () => json(status, body);
      const r = await call(WRITE, COMPLETE, identifiedSeat());
      expect(r.isError, String(status)).toBe(true);
      expect(r.structuredContent.message).toBe(body.message);
      expect(r.structuredContent.error).toBe(body.error);
      expect(r.structuredContent._error_mitigation.severity).toBe('transient_backoff');
      expect(r.structuredContent._error_mitigation.deterministic_hint).toContain(body.message);
    }
  });

  it('a non-JSON gateway page and a dead connection are both errors', async () => {
    responder = () => new Response('<html>bad gateway</html>', { status: 502 });
    const html = await call(WRITE, COMPLETE, identifiedSeat());
    expect(html.isError).toBe(true);
    expect(html.structuredContent.error).toBe('API 502');

    responder = () => { throw new Error('connect ECONNREFUSED'); };
    const dead = await call(WRITE, COMPLETE, identifiedSeat());
    expect(dead.isError).toBe(true);
    expect(dead.structuredContent.error).toBe('upstream_unreachable');
    expect(dead.structuredContent.message).toContain('ECONNREFUSED');
  });
});

describe('initialize instructions mention the program', () => {
  it('names both tools, carries no digits, and sits before the scope section', () => {
    const inst = S._INSTRUCTIONS;
    const i = inst.indexOf('CAPACITY SOURCE:');
    expect(i).toBeGreaterThan(-1);
    const sentence = inst.slice(i, inst.indexOf('LIVENESS IS THE PRODUCT', i));
    expect(sentence).toContain('source_capacity');
    expect(sentence).toContain('request_capacity_intro');
    expect(sentence).toContain('accept_capacity_terms');
    expect(sentence).not.toMatch(/\d/);
    // 2026-09-15: a deal registration, not an introduction DC Hub makes up front.
    expect(sentence).toContain('`request_capacity_intro` registers a deal');
    expect(sentence).toContain("DC Hub sends the provider only your human's company name and requirement");
    expect(sentence).not.toMatch(/introduces them to the operator|operator contact is never exposed/);
    const scope = inst.indexOf(' IN SCOPE');
    if (scope > -1) expect(i).toBeLessThan(scope);
  });
});

// ── licence: the TWO halves of Capacity Source ───────────────────────────────
// Owner decision (2026-09-15; dchub-backend #4654): TEASER facts — the listings
// feed, the summary aggregate, and a listing card nobody has opened — are public
// and quotable WITH attribution, because an agent that may not quote the teaser
// cannot bring a buyer to it. FULL detail, a released provider identity and
// every terms/registration/ledger answer stay confidential.
//
// This server used to stamp BOTH halves confidential, overriding the backend.
// The shared stamps (withCitation's footer, _embedSourceInContent0's _cite,
// lib/attribution.mjs) each defer to attribution a result already carries, so
// run the WHOLE handler chain per result shape and search the WHOLE result.

// The generic whole-service footer withCitation appends to an UNSTAMPED result.
// It claims CC-BY over DC Hub as a whole and must ride NEITHER half: on the
// teaser half, CC-BY has to come from the listing's own citation, not from this
// footer sailing past a result that was never stamped at all.
const SERVICE_FOOTER = 'License CC-BY-4.0: cite this data as "DC Hub, dchub.cloud"';
const CONFIDENTIAL_LINE = 'confidential listing data shared under the introduction terms';
const TEASER_LINE = 'teaser listing facts under CC-BY-4.0';
const views = (r) => [JSON.parse(r.content[0].text), r.structuredContent];

describe('Capacity Source: the confidential half carries the confidential licence end to end', () => {
  const slug = 'dfw-40mw-powered-shell';
  const shapes = [
    ['unlocked detail', READ, { slug }, () => json(200, DETAIL_UNLOCKED)],
    ['released disclosure', READ, { slug }, () => json(200, DETAIL_RELEASED)],
    ['identity wall', WRITE, { ...COMPLETE, slug }, () => json(401, E401_SIGN_IN)],
    ['intro receipt', WRITE, { ...COMPLETE, slug }, () => json(200, INTRO_OK)],
    ['interest receipt', WRITE, { ...COMPLETE }, () => json(200, INTEREST_OK)],
    ['terms refusal', WRITE, { ...COMPLETE, accept_terms: false }, null],
    ['acceptance receipt', ACCEPT, { accept_terms: true, terms_version: '2026-09-11' }, () => json(200, ACCEPT_OK)],
    ['acceptance refusal', ACCEPT, {}, null],
  ];
  it.each(shapes)('%s', async (_label, tool, args, respond) => {
    responder = respond;
    const r = await call(tool, args, identifiedSeat());
    expect(r.isError).not.toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/CC-BY/i);
    for (const view of views(r)) {
      expect(view.citation.license).toBe(S.LISTING_LICENSE);
      expect(view.citation.redistribution).toBe('not_permitted');
      expect(view.provenance.license).toBe(S.LISTING_LICENSE);
      expect(view.provenance.redistribution).toBe('not_permitted');
    }
    // Not vacuous: the shared stamps DID run over this result — attribution.mjs
    // merged its retrieved_at in, and the source line the tools emit is present.
    expect(typeof r.structuredContent.citation.retrieved_at).toBe('string');
    expect(textOf(r)).toContain('Source: DC Hub Capacity Source');
    expect(textOf(r)).toContain(CONFIDENTIAL_LINE);
    expect(textOf(r)).not.toContain(TEASER_LINE);
  });
});

describe('Capacity Source: the teaser half stays public and quotable', () => {
  const slug = 'dfw-40mw-powered-shell';
  const shapes = [
    ['teaser feed', READ, {}, () => json(200, listWithItems(2))],
    ['teaser feed carrying the backend public citation', READ, {},
      () => json(200, { ...listWithItems(2), citation: CITATION_PUBLIC })],
    ['empty upcoming feed', READ, {}, () => json(200, LIST_UPCOMING_EMPTY)],
    ['locked detail', READ, { slug }, () => json(200, DETAIL_LOCKED)],
    ['terms-locked detail', READ, { slug }, () => json(200, DETAIL_LOCKED_TERMS)],
  ];
  it.each(shapes)('%s', async (_label, tool, args, respond) => {
    responder = respond;
    const r = await call(tool, args, identifiedSeat());
    expect(r.isError).not.toBe(true);
    for (const view of views(r)) {
      // The override this change removes: the confidential stamp is GONE, and
      // the answer is not rewritten to not_permitted.
      expect(view.citation.license).toBe(S.LISTING_TEASER_LICENSE);
      expect(view.citation.redistribution).toBe('permitted_with_attribution');
      expect(view.provenance.license).toBe(S.LISTING_TEASER_LICENSE);
      expect(view.provenance.redistribution).toBe('permitted_with_attribution');
    }
    expect(typeof r.structuredContent.citation.retrieved_at).toBe('string');
    // The rendered line matches the licence it rides beside — and CC-BY is here
    // because the listing's own citation says so, not because the generic
    // whole-service footer was appended to an unstamped result.
    expect(textOf(r)).toContain('Source: DC Hub Capacity Source');
    expect(textOf(r)).toContain(TEASER_LINE);
    expect(textOf(r)).not.toContain(CONFIDENTIAL_LINE);
    expect(textOf(r)).not.toContain(SERVICE_FOOTER);
  });
});

// ── the predicate itself, read off the RESPONSE ──────────────────────────────
// Derived from the body, never from which handler called: `source_capacity`
// alone answers a public feed, a locked card and a fully released listing.
describe('_listingIsTeaser classifies the response, not the caller', () => {
  it('names the teaser half', () => {
    for (const [label, body] of [
      ['listings feed', listWithItems(2)],
      ['empty upcoming feed', LIST_UPCOMING_EMPTY],
      ['filtered feed', LIST_FILTERED],
      ['cached summary read', SUMMARY_BODY],
      ['locked single listing', DETAIL_LOCKED],
      ['terms-locked single listing', DETAIL_LOCKED_TERMS],
      ['locked card with a pending disclosure', { ...DETAIL_LOCKED, disclosure: DISCLOSURE_PENDING }],
    ]) expect(S._listingIsTeaser(body), label).toBe(true);
  });

  it('names the confidential half', () => {
    for (const [label, body] of [
      ['full detail', DETAIL_UNLOCKED],
      ['full detail, price withheld', DETAIL_UNLOCKED_PRICE_WITHHELD],
      ['released disclosure', DETAIL_RELEASED],
      ['pending disclosure on an unlocked listing', DETAIL_PENDING],
      ['intro receipt', INTRO_OK],
      ['standing-requirement receipt', INTEREST_OK],
      ['acceptance receipt', ACCEPT_OK],
      ['already-accepted receipt', ACCEPT_ALREADY],
      ['terms read', TERMS_OK],
      ['identity wall', E401_SIGN_IN],
      ['upgrade wall', E403],
      ['terms-version mismatch', E409],
      ['terms not accepted', E422_TERMS],
    ]) expect(S._listingIsTeaser(body), label).toBe(false);
  });

  it('a released disclosure beside locked:true fails CLOSED', () => {
    // A contradictory body must not be readable as a teaser: the confidential
    // signals are tested first, so the provider's site never leaves quotable.
    expect(S._listingIsTeaser({ ...DETAIL_LOCKED, disclosure: DISCLOSURE_RELEASED })).toBe(false);
    expect(S._listingIsTeaser({ ...listWithItems(2), disclosure: DISCLOSURE_RELEASED })).toBe(false);
  });

  it('anything it cannot classify is confidential', () => {
    for (const bad of [null, undefined, 'a string', 42, true, [], [TEASER], {}, { ok: true },
                       { error: 'boom' }, { locked: 'true' }, { items: 'not an array' }]) {
      const label = String(JSON.stringify(bad));
      expect(S._listingIsTeaser(bad), label).toBe(false);
      const out = S._listingConfidential(bad);
      expect(out.citation.license, label).toBe(S.LISTING_LICENSE);
      expect(out.citation.cite_as, label).toBe(S.LISTING_CITE_AS);
      expect(out.provenance.redistribution, label).toBe('not_permitted');
      expect(out._cite, label).toBe(S.LISTING_CITE_AS);
    }
  });
});

describe('_listingConfidential stamps the half it classified', () => {
  it('a teaser with no citation gets the public one', () => {
    const out = S._listingConfidential(listWithItems(1));
    expect(out.citation.license).toBe('CC-BY-4.0');
    expect(out.citation.cite_as).toBe('DC Hub Capacity Source, dchub.cloud');
    expect(out.citation.redistribution).toBe('permitted_with_attribution');
    expect(out.provenance.redistribution).toBe('permitted_with_attribution');
    expect(out._cite).toBe('DC Hub Capacity Source, dchub.cloud');
  });

  it("a teaser PREFERS the backend's own citation", () => {
    const out = S._listingConfidential({
      ...listWithItems(1),
      citation: { ...CITATION_PUBLIC, cite_as: 'DC Hub Capacity Source (teaser), dchub.cloud' },
    });
    expect(out.citation.cite_as).toBe('DC Hub Capacity Source (teaser), dchub.cloud');
    expect(out.citation.license).toBe('CC-BY-4.0');
    expect(out._cite).toBe('DC Hub Capacity Source (teaser), dchub.cloud');
  });

  it('a teaser the backend still labels confidential stays confidential', () => {
    // dchub-backend #4654 had NOT deployed when this landed — the live feed was
    // measured still sending the confidential block. Deferring on the teaser
    // half is what makes the flip happen on the backend's deploy, not ours.
    const out = S._listingConfidential({ ...listWithItems(1), citation: CITATION_CONFIDENTIAL });
    expect(out.citation.license).toBe(S.LISTING_LICENSE);
    expect(out.citation.redistribution).toBe('not_permitted');
  });

  it('a confidential answer OVERRIDES a backend citation that says otherwise', () => {
    const out = S._listingConfidential({ ...DETAIL_UNLOCKED, citation: CITATION_PUBLIC });
    expect(out.citation.license).toBe(S.LISTING_LICENSE);
    expect(out.citation.redistribution).toBe('not_permitted');
    expect(out.provenance.redistribution).toBe('not_permitted');
    expect(out._cite).toBe(S.LISTING_CITE_AS);
  });

  it('keeps every other field the backend sent, on both halves', () => {
    expect(S._listingConfidential(LIST_FILTERED).filters).toEqual(FILTERS_EU);
    expect(S._listingConfidential(LIST_FILTERED).items).toEqual([TEASER_EU]);
    expect(S._listingConfidential(DETAIL_UNLOCKED).listing).toEqual(DETAIL_UNLOCKED.listing);
    expect(S._listingConfidential(DETAIL_RELEASED).disclosure).toEqual(DISCLOSURE_RELEASED);
  });
});

// ── the rename: the 2026-09-11 names keep working ────────────────────────────
// Pocket listings became Capacity Source on 2026-09-13. get_pocket_listings and
// request_listing_intro were REAL tool names for two days, and agents, saved
// prompts and the What's New history already carry them, so each must resolve
// to its renamed tool at call time. Neither may be registered again: that would
// advertise one program twice in tools/list and move the tool count.
describe('the 2026-09-11 names resolve to the renamed tools', () => {
  const RENAMED = [['get_pocket_listings', READ], ['request_listing_intro', WRITE]];

  it('TOOL_ALIASES maps each old name to its renamed, registered tool', () => {
    for (const [old, now] of RENAMED) {
      expect(S.TOOL_ALIASES[old], old).toBe(now);
      expect(TOOLS[now], now).toBeTruthy();
    }
  });

  it('the old names are aliases only, never registrations', () => {
    for (const [old] of RENAMED) {
      expect(TOOLS[old], old).toBeUndefined();
      expect(registration(old).count, old).toBe(0);
    }
    // Control: the same parser finds the renamed registration.
    expect(registration(READ).count).toBe(1);
  });
});

// ── the terms gate (2026-09-13): accepted once, at the first listing opened ──
describe('accept_capacity_terms — the one write the gate needs', () => {
  it('is a write: WRITE_TOOLS, readOnlyHint false, quota- and nudge-exempt, backend-gated', () => {
    expect(setLiteral('const WRITE_TOOLS = new Set([')).toContain(`'${ACCEPT}'`);
    expect(TOOLS[ACCEPT].annotations.readOnlyHint).toBe(false);
    expect(TOOLS[ACCEPT].annotations.destructiveHint).toBe(false);
    expect(S.QUOTA_EXEMPT_TOOLS.has(ACCEPT)).toBe(true);
    expect(S.FREE_FULL_TOOLS.has(ACCEPT)).toBe(true);
    expect(setLiteral('const _RETURN_NUDGE_SKIP = new Set([')).toContain(`'${ACCEPT}'`);
    // The gate did not turn browsing into a write.
    expect(TOOLS[READ].annotations.readOnlyHint).toBe(true);
  });

  it('without accept_terms exactly true, nothing reaches the backend', async () => {
    responder = () => json(200, ACCEPT_OK);
    for (const args of [{}, { accept_terms: false }]) {
      calls = [];
      const r = await call(ACCEPT, args, identifiedSeat());
      expect(listingCalls(), JSON.stringify(args)).toHaveLength(0);
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent.sent).toBe(false);
      expect(r.structuredContent.error).toBe('terms_not_accepted');
      expect(r.structuredContent.next_steps).toEqual([ACCEPT]);
      expect(r.structuredContent.terms_url).toBe('https://dchub.cloud/listings#terms');
    }
    expect((await TOOLS[ACCEPT].inputSchema.safeParseAsync({ accept_terms: 'true' })).success).toBe(false);
  });

  it('MUST-FAIL CONTROL: accept_terms=true POSTs the acceptance once, with the identity headers', async () => {
    responder = () => json(200, ACCEPT_OK);
    const r = await call(ACCEPT, { accept_terms: true, terms_version: '2026-09-11' }, identifiedSeat());
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(`${lc[0].method} ${lc[0].pathname}`).toBe('POST /api/v1/listings/terms/accept');
    expect(lc[0].body).toEqual({ accept_terms: true, terms_version: '2026-09-11' });
    expect(lc[0].headers['X-API-Key']).toBe('dch_live_listing_test');
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.accepted).toBe(true);
    const ok = await accepts(ACCEPT, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('without terms_version it reads the published version first, then sends that', async () => {
    responder = (rec) => (rec.pathname === '/api/v1/listings/terms' ? json(200, TERMS_OK) : json(200, ACCEPT_OK));
    await call(ACCEPT, { accept_terms: true }, identifiedSeat());
    const lc = listingCalls();
    expect(lc.map((c) => `${c.method} ${c.pathname}`)).toEqual(['GET /api/v1/listings/terms', 'POST /api/v1/listings/terms/accept']);
    expect(lc[1].body.terms_version).toBe('2026-09-11');
  });

  it('walls come back structured: 401 names the identity steps, 409 the version to retry with', async () => {
    responder = () => json(401, E401_SIGN_IN);
    const wall = await call(ACCEPT, { accept_terms: true, terms_version: '2026-09-11' });
    expect(wall.isError).toBeFalsy();
    expect(wall.structuredContent.next_steps).toEqual(['claim_free_key', 'bind_email', ACCEPT]);
    responder = () => json(409, E409);
    const moved = await call(ACCEPT, { accept_terms: true, terms_version: '2026-09-11' }, identifiedSeat());
    expect(moved.isError).toBeFalsy();
    expect(moved.structuredContent.next_steps).toEqual([ACCEPT]);
    expect(moved.structuredContent.next_steps_note).toContain('2026-10-01');
  });
});

describe('source_capacity — a listing locked until the terms are accepted', () => {
  it('names the next calls in order, and the result still passes the schema', async () => {
    responder = () => json(200, DETAIL_LOCKED_TERMS);
    const r = await call(READ, { slug: 'dfw-40mw-powered-shell' }, identifiedSeat());
    const sc = r.structuredContent;
    expect(r.isError).toBeFalsy();
    expect(sc.locked).toBe(true);
    expect(sc.next_steps).toEqual([ACCEPT, READ]);
    expect(sc.next_steps_note).toContain('terms_version="2026-09-11"');
    const ok = await accepts(READ, sc);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('control: a sign-in-locked listing comes back as before, with no next_steps added', async () => {
    responder = () => json(200, DETAIL_LOCKED);
    const r = await call(READ, { slug: 'dfw-40mw-powered-shell' });
    expect(r.structuredContent.locked).toBe(true);
    expect(r.structuredContent.next_steps).toBeUndefined();
  });
});

// ── deal registration (2026-09-15) ───────────────────────────────────────────
// Every text block after content[0], which is the confidential JSON. The
// rendered lines are judged here, never the payload, which carries whatever the
// backend sent.
const renderedLines = (r) => r.content.slice(1).map((c) => c.text || '').join('\n').split('\n');

describe('source_capacity — search by size and location', () => {
  it('passes min_kw, region, location, delivery_type and available_by through to /api/v1/listings', async () => {
    responder = () => json(200, LIST_FILTERED);
    const r = await call(READ, {
      market: 'Frankfurt', state: 'TX', min_mw: 1, min_kw: 500, region: 'europe, apac',
      location: 'Germany, Texas', delivery_type: 'colocation', available_by: '2027-06', limit: 10,
    });
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(`${lc[0].method} ${lc[0].pathname}`).toBe('GET /api/v1/listings');
    expect(Object.fromEntries(new URL(lc[0].url).searchParams)).toEqual({
      market: 'Frankfurt', state: 'TX', min_mw: '1', min_kw: '500', region: 'europe, apac',
      location: 'Germany, Texas', delivery_type: 'colocation', available_by: '2027-06', limit: '10',
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.filters).toEqual(FILTERS_EU);
    expect(r.structuredContent.items[0].capacity_kw).toBe(500);
    const ok = await accepts(READ, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('the description example maps as written, and nothing unasked is sent', async () => {
    responder = () => json(200, LIST_FILTERED);
    await call(READ, { min_kw: 500, region: 'europe' });
    expect(new URL(listingCalls()[0].url).search).toBe('?min_kw=500&region=europe');
  });

  it('delivery_type takes exactly the four backend values; anything else is refused by the schema', async () => {
    for (const v of ['land', 'powered_shell', 'turnkey', 'colocation']) {
      expect((await TOOLS[READ].inputSchema.safeParseAsync({ delivery_type: v })).success, v).toBe(true);
    }
    for (const v of ['powered shell', 'hyperscale', '']) {
      expect((await TOOLS[READ].inputSchema.safeParseAsync({ delivery_type: v })).success, v).toBe(false);
    }
  });

  it("renders the filters applied and each card's capacity in kW, and leaves the JSON as sent", async () => {
    responder = () => json(200, LIST_FILTERED);
    const r = await call(READ, { min_kw: 500, region: 'europe' });
    const lines = renderedLines(r);
    expect(lines).toContain('Filters applied: min_kw=500; region=europe; delivery_type=colocation; available_by=2027-06; limit=25');
    expect(lines).toContain('Capacity by listing:');
    expect(lines).toContain('- fra-500kw-colocation: 500 kW (0.5 MW) in Frankfurt, DE (europe)');
    const first = JSON.parse(r.content[0].text);
    expect(first.filters).toEqual(FILTERS_EU);
    expect(first.items[0]).toEqual(TEASER_EU);
    // A feed is teaser-level, so it keeps the public licence rather than the
    // confidential stamp this server used to force onto every listings answer.
    expect(first.provenance.redistribution).toBe('permitted_with_attribution');
    expect(lines.some((l) => l.startsWith('Source: DC Hub Capacity Source (dchub.cloud)'))).toBe(true);
  });

  it('a card with MW only still renders, and a body without filters renders no filters line', async () => {
    responder = () => json(200, listWithItems(1));
    const r = await call(READ, {});
    const lines = renderedLines(r);
    expect(lines).toContain('- dfw-40mw-powered-shell: 40 MW in Dallas, TX, US');
    expect(lines.some((l) => l.startsWith('Filters applied'))).toBe(false);
  });
});

// ── what a listing can ACTUALLY deliver (2026-09-16) ─────────────────────────
// A teaser or a detail may declare contiguous_kw (the largest single contiguous
// block available) and min_contract_kw (the smallest chunk the provider will
// contract). The backend matches a requested size against THEM, not against the
// headline total, so a card that shows only the total cannot explain its own
// hit or miss. Each half renders independently: both, either one, or neither,
// and neither must render exactly what it rendered before this existed.
describe('source_capacity — contiguous_kw and min_contract_kw beside the capacity', () => {
  const card = (over) => ({ ...TEASER_EU, ...over });
  const feed = (over) => ({ ...LIST_FILTERED, items: [card(over)] });
  const rowsOf = (lines) => lines.filter((l) => l.startsWith('- '));
  const FIT_NOTE_HEAD = 'Fit: a size search is matched against the block a listing can actually deliver';

  // A rendered line must never carry a separator with nothing on one side of it:
  // that is what a half-declared listing would produce if the halves were glued
  // together rather than composed.
  const noBrokenLine = (lines) => {
    for (const l of lines.filter((x) => x.startsWith('- ') || x.startsWith('Capacity: '))) {
      expect(l, `dangling separator in ${JSON.stringify(l)}`).not.toMatch(/—\s*$|—\s*—|:\s*$|\s\s|,\s*$|\bin\s+$/);
      expect(l, `empty value in ${JSON.stringify(l)}`).not.toMatch(/(^-\s+\S+:\s*(—|in\b))|:\s*$/);
    }
  };

  const render = async (body) => {
    responder = () => json(200, body);
    const r = await call(READ, {}, identifiedSeat());
    const lines = renderedLines(r);
    noBrokenLine(lines);
    return { r, lines };
  };

  it('both declared: the card names the contiguous block and the smallest contract', async () => {
    const { r, lines } = await render(feed({ contiguous_kw: 400, min_contract_kw: 100 }));
    expect(rowsOf(lines)).toEqual([
      '- fra-500kw-colocation: 500 kW (0.5 MW) in Frankfurt, DE (europe)'
      + ' — largest contiguous block 400 kW, smallest contract 100 kW',
    ]);
    expect(lines.filter((l) => l.startsWith(FIT_NOTE_HEAD))).toHaveLength(1);
    // The payload is the backend's, unchanged, and the wider fields still pass
    // the declared outputSchema.
    expect(JSON.parse(r.content[0].text).items[0].contiguous_kw).toBe(400);
    const ok = await accepts(READ, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('contiguous only: the contiguous block alone, no smallest-contract phrase', async () => {
    const { lines } = await render(feed({ contiguous_kw: 400 }));
    expect(rowsOf(lines)).toEqual([
      '- fra-500kw-colocation: 500 kW (0.5 MW) in Frankfurt, DE (europe) — largest contiguous block 400 kW',
    ]);
    expect(rowsOf(lines).some((l) => l.includes('smallest contract'))).toBe(false);
    expect(lines.filter((l) => l.startsWith(FIT_NOTE_HEAD))).toHaveLength(1);
  });

  it('smallest chunk only: the smallest contract alone, no contiguous phrase', async () => {
    const { lines } = await render(feed({ min_contract_kw: 100 }));
    expect(rowsOf(lines)).toEqual([
      '- fra-500kw-colocation: 500 kW (0.5 MW) in Frankfurt, DE (europe) — smallest contract 100 kW',
    ]);
    expect(rowsOf(lines).some((l) => l.includes('contiguous'))).toBe(false);
    expect(lines.filter((l) => l.startsWith(FIT_NOTE_HEAD))).toHaveLength(1);
  });

  it('neither declared: the line is what it was, and nothing explains a number that is not there', async () => {
    const { lines } = await render(feed({}));
    expect(rowsOf(lines)).toEqual(['- fra-500kw-colocation: 500 kW (0.5 MW) in Frankfurt, DE (europe)']);
    expect(lines.some((l) => /contiguous|smallest contract/.test(l)), 'the fit phrases leaked onto a card that declares neither').toBe(false);
    expect(lines.some((l) => l.startsWith(FIT_NOTE_HEAD))).toBe(false);
  });

  it('a card with no total but a declared block still renders, in the capacity slot', async () => {
    const { capacity_kw, capacity_mw, ...noTotal } = TEASER_EU;
    responder = () => json(200, { ...LIST_FILTERED, items: [{ ...noTotal, contiguous_kw: 400 }] });
    const r = await call(READ, {}, identifiedSeat());
    const lines = renderedLines(r);
    noBrokenLine(lines);
    expect(rowsOf(lines)).toEqual([
      '- fra-500kw-colocation: largest contiguous block 400 kW in Frankfurt, DE (europe)',
    ]);
  });

  it('an opened listing carries them on its Capacity line, beside the disclosure block', async () => {
    responder = () => json(200, {
      ...DETAIL_RELEASED,
      listing: { ...LISTING_KW, contiguous_kw: 10000, min_contract_kw: 1000 },
    });
    const r = await call(READ, { slug: 'dfw-40mw-powered-shell' }, identifiedSeat());
    const lines = renderedLines(r);
    noBrokenLine(lines);
    expect(lines).toContain('Capacity: 40,000 kW (40 MW) — largest contiguous block 10,000 kW, smallest contract 1,000 kW');
    expect(lines.filter((l) => l.startsWith(FIT_NOTE_HEAD))).toHaveLength(1);
    // Unchanged: the confidential citation behaviour and the disclosure lines.
    expect(lines).toContain('Provider: Northwind Data Centers');
    expect(JSON.parse(r.content[0].text).provenance.redistribution).toBe('not_permitted');
  });

  it('an opened listing that declares neither renders the capacity line it always did', async () => {
    responder = () => json(200, DETAIL_RELEASED);
    const r = await call(READ, { slug: 'dfw-40mw-powered-shell' }, identifiedSeat());
    const lines = renderedLines(r);
    noBrokenLine(lines);
    expect(lines).toContain('Capacity: 40,000 kW (40 MW)');
    expect(lines.some((l) => l.startsWith(FIT_NOTE_HEAD))).toBe(false);
  });
});

// ★ Asserted on the description string the RUNNING server built — TOOLS comes
// from a real createServer() — never on a copy of the literal kept here, which
// would go on passing after the shipped wording changed.
describe('the size copy names what a listing can actually deliver', () => {
  const argShape = () => {
    const s = TOOLS[READ].inputSchema.shape;
    expect(Object.keys(s), 'inputSchema.shape did not resolve').toContain('min_kw');
    return s;
  };

  // ★ ANCHORED, not merely present. A bare toContain passes on a description
  //   long enough to name the fields SOMEWHERE — measured: stripping both names
  //   out of the size clause left the two in the returns clause and the check
  //   stayed green. Each assertion pins the names to the clause that has to
  //   carry them.
  it("source_capacity's own description names both fields where it explains the size", () => {
    const d = TOOLS[READ].description;
    expect(d, 'the size clause does not name what the size is matched against')
      .toMatch(/Size is min_kw[\s\S]*?contiguous_kw[\s\S]*?min_contract_kw[\s\S]*?Location is region/);
    expect(d).toContain('ACTUALLY deliver');
    expect(d, 'the returns clause does not say the cards carry them')
      .toMatch(/Returns listing cards[\s\S]*?contiguous_kw[\s\S]*?min_contract_kw[\s\S]*?to any caller/);
  });

  it('min_kw and min_mw each name both fields, and neither still claims a plain total floor', () => {
    const shape = argShape();
    for (const arg of ['min_kw', 'min_mw']) {
      const d = String(shape[arg].description || '');
      expect(d, arg).toContain('contiguous_kw');
      expect(d, arg).toContain('min_contract_kw');
      expect(d, arg).not.toContain('only listings with at least this much capacity');
    }
    // Control: the reader resolves ONE property's own description rather than a
    // blob of the whole schema — a sibling filter says nothing about size.
    expect(String(shape.region.description || '')).not.toContain('contiguous_kw');
  });

  it('the find_capacity prompt and the buy/lease planner step name them too', async () => {
    const prompts = S.createServer()._registeredPrompts;
    const text = prompts.find_capacity.callback({ requirement: '40 MW powered shell in Dallas' })
      .messages.map((m) => m.content.text).join('\n');
    expect(text).toContain('contiguous_kw');
    expect(text).toContain('min_contract_kw');
    const step = S._capacityProcurementStep('lease 40 MW of colocation space in Dallas', {}, []);
    expect(step && step.tool).toBe('source_capacity');
    expect(step.why).toContain('contiguous_kw');
    expect(step.why).toContain('min_contract_kw');
  });
});

describe('source_capacity — the disclosure block', () => {
  const SLUG = 'dfw-40mw-powered-shell';
  const open = async (fixture) => {
    responder = () => json(200, fixture);
    const r = await call(READ, { slug: SLUG }, identifiedSeat());
    return { r, lines: renderedLines(r) };
  };
  const disclosureLines = (lines) => lines.filter((l) => /^(Provider|Site|Contact)\b/.test(l));

  it('released: provider, site and contact lines, beside the listing capacity in kW', async () => {
    const { r, lines } = await open(DETAIL_RELEASED);
    expect(disclosureLines(lines)).toEqual([
      'Provider: Northwind Data Centers',
      'Site: 1200 Industrial Blvd, Garland, TX; 32.91, -96.63; substation Garland 345 kV',
      'Contact: name: Sam Lee; email: sam.lee@northwind.example; phone: +1 214 555 0100',
    ]);
    expect(lines).toContain('Capacity: 40,000 kW (40 MW)');
    expect(r.structuredContent.disclosure).toEqual(DISCLOSURE_RELEASED);
    const ok = await accepts(READ, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('not released: ONE line with the status and the next step, and no provider, site or contact line', async () => {
    const { r, lines } = await open(DETAIL_PENDING);
    expect(disclosureLines(lines)).toEqual([
      'Provider identity, site and contact: not released (deal registration status: pending). Next: The provider has your deal registration and has not answered yet.',
    ]);
    expect(r.structuredContent.disclosure).toEqual(DISCLOSURE_PENDING);
    const ok = await accepts(READ, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('not released and no how from the backend: the next step names the tool and the slug', async () => {
    const cases = [
      ['none', `call request_capacity_intro with slug="${SLUG}" to register a deal; the provider sees only your human's company name and the requirement until they accept.`],
      ['pending', `wait for the provider to accept or decline; nothing has been shared yet, and source_capacity with slug="${SLUG}" shows their answer.`],
      ['declined', 'nothing was shared; call source_capacity for other listings, or request_capacity_intro without a slug to register the requirement.'],
    ];
    for (const [status, next] of cases) {
      calls = [];
      const { lines } = await open({ ...DETAIL_PENDING, disclosure: { ...DISCLOSURE_PENDING, status, how: null } });
      expect(disclosureLines(lines), status).toEqual([
        `Provider identity, site and contact: not released (deal registration status: ${status}). Next: ${next}`,
      ]);
    }
  });

  it('provider fields print only when released is exactly true, whatever else the body carries', async () => {
    // Control first: the same fixture with released:true DOES print them, so the
    // absence below is the released check, not a renderer that prints nothing.
    const control = await open(DETAIL_RELEASED);
    expect(control.lines.join('\n')).toContain('Northwind');
    for (const released of [false, 'true', 1, undefined]) {
      calls = [];
      const { lines } = await open({ ...DETAIL_RELEASED, disclosure: { ...DISCLOSURE_RELEASED, released } });
      const shown = disclosureLines(lines);
      expect(shown, String(released)).toHaveLength(1);
      expect(shown[0], String(released))
        .toMatch(/^Provider identity, site and contact: not released \(deal registration status: accepted\)\. Next: /);
      expect(lines.join('\n'), String(released)).not.toContain('Northwind');
      expect(lines.join('\n'), String(released)).not.toContain('sam.lee@northwind.example');
    }
  });

  it('a listing detail with disclosure still gets the caller identity stamp in structuredContent.identity', async () => {
    const seat = identifiedSeat({ auth_source: 'header' });
    const stamp = S._identitySource(seat);
    // Premise: this seat produces a stamp at all, so the assertions below cannot pass on an absent one.
    expect(stamp).toEqual({ credential_source: 'header', tier: 'free' });
    responder = () => json(200, DETAIL_RELEASED);
    const r = await call(READ, { slug: SLUG }, seat);
    expect(r.structuredContent.identity).toEqual(stamp);
    expect(r.structuredContent.disclosure).toEqual(DISCLOSURE_RELEASED);
    expect(JSON.parse(r.content[0].text).disclosure).toEqual(DISCLOSURE_RELEASED);
    expect(disclosureLines(renderedLines(r))).toHaveLength(3);
    const ok = await accepts(READ, r.structuredContent);
    expect(ok.ok, ok.issues).toBe(true);

    // Control, the collision the rename removed: the same block under `identity`
    // makes _stampIdentitySource skip the caller stamp, and nothing renders it.
    calls = [];
    const { disclosure, ...withoutDisclosure } = DETAIL_RELEASED;
    responder = () => json(200, { ...withoutDisclosure, identity: disclosure });
    const clash = await call(READ, { slug: SLUG }, seat);
    expect(clash.structuredContent.identity).toEqual(DISCLOSURE_RELEASED);
    expect(clash.structuredContent.identity).not.toEqual(stamp);
    expect(disclosureLines(renderedLines(clash))).toEqual([]);
  });
});

describe('request_capacity_intro — the requirement carries kW, regions and countries', () => {
  it('capacity_kw is sent as a number, and comma-separated regions and countries become arrays', async () => {
    responder = () => json(200, INTEREST_OK);
    await call(WRITE, { ...COMPLETE, capacity_kw: 500, regions: ' europe, apac ,', countries: 'Germany,  Netherlands' }, identifiedSeat());
    const lc = listingCalls();
    expect(lc).toHaveLength(1);
    expect(`${lc[0].method} ${lc[0].pathname}`).toBe('POST /api/v1/listings/interest');
    expect(lc[0].body.requirement).toEqual({
      capacity_mw: 40, capacity_kw: 500, markets: ['Dallas'], states: ['TX'],
      regions: ['europe', 'apac'], countries: ['Germany', 'Netherlands'],
      timeline: 'Q2 2027', use_case: 'AI inference', notes: 'Needs expansion rights.',
    });
  });

  it('the same fields ride on a listing deal registration, and blank lists are omitted', async () => {
    responder = () => json(200, INTRO_OK);
    const { capacity_mw: _mw, markets: _m, states: _s, ...rest } = COMPLETE;
    await call(WRITE, { ...rest, slug: 'fra-500kw-colocation', capacity_kw: 500, regions: 'emea', countries: 'DE' }, identifiedSeat());
    let [sent] = listingCalls();
    expect(sent.pathname).toBe('/api/v1/listings/fra-500kw-colocation/intro');
    expect(sent.body.requirement).toEqual({
      capacity_kw: 500, regions: ['emea'], countries: ['DE'],
      timeline: 'Q2 2027', use_case: 'AI inference', notes: 'Needs expansion rights.',
    });
    calls = [];
    await call(WRITE, { ...COMPLETE, regions: ' , ', countries: '' }, identifiedSeat());
    [sent] = listingCalls();
    expect(sent.body.requirement).not.toHaveProperty('regions');
    expect(sent.body.requirement).not.toHaveProperty('countries');
    expect(sent.body.requirement).not.toHaveProperty('capacity_kw');
    expect(sent.body.requirement.markets).toEqual(['Dallas']);   // control: the lists that were given still go
  });
});

describe('the descriptions state the deal registration', () => {
  it('source_capacity leads with size and location, and says when the provider identity is released', () => {
    const d = TOOLS[READ].description;
    expect(d.startsWith('Use when your human needs data-center CAPACITY to buy or lease: search DC Hub Capacity Source by size (kW or MW) and/or location (a region such as North America or Europe, a country, a state or a metro).')).toBe(true);
    expect(d).toContain('a signed-in human who has accepted the introduction terms sees its specs');
    expect(d).toContain("The provider's identity, site and contact are released only after the provider accepts a deal registration, which request_capacity_intro submits");
    expect(d).toContain("the listing's disclosure block says whether they have been");
    expect(d).not.toContain('identity block');
  });

  it('request_capacity_intro says what is shared, with whom, and when', () => {
    const d = TOOLS[WRITE].description;
    expect(d).toContain("sends the provider ONLY your human's company name and the requirement");
    expect(d).toContain('The provider accepts or declines.');
    expect(d).toContain('shows the deal status in the disclosure block');
    expect(d).not.toContain('identity block');
    expect(d).toContain("Only if the provider accepts does DC Hub share the provider's identity, site details and contact with your human, and your human's name, role and email with the provider; on a decline nothing is shared.");
  });

  it('neither description still says DC Hub introduces anyone', () => {
    for (const n of [READ, WRITE]) {
      expect(TOOLS[n].description, n).not.toMatch(/makes the introduction|introduces|introduction to the operator|operator contact/i);
    }
  });
});

// ── the browse path's caller-level access block ──────────────────────────────
// THE GAP this closes (measured live on the anonymous MCP surface, 2026-09-16):
// opening ONE locked listing returns next_steps and a note; BROWSING returned
// locked cards, prose in program.how_it_works and a viewer.sign_in_url, and no
// machine-readable move — so an agent that only browses had to INFER that its
// human should register. The backend's caller-level access block, same shape as
// the single listing's, is what these pin.
//
// ★ These fixtures are the CONTRACT, not the deployed body: GET /api/v1/listings
//   answered without an `access` key when this shipped. That is exactly why the
//   absent-block case below is pinned as unchanged — this code has to be inert
//   until the backend catches up, and stay inert for any caller it grants.
const BROWSE_ACCESS_SIGN_IN = {
  required: 'registered', granted: false, reason: 'sign_in_required',
  unlock: {
    web_sign_in_url: 'https://dchub.cloud/login?redirect=%2Flistings',
    mcp_steps: ['claim_free_key', 'bind_email'], pricing_url: null,
  },
};
const BROWSE_ACCESS_TERMS = {
  required: 'registered', granted: false, reason: 'terms_acceptance_required',
  unlock: { web_sign_in_url: null, mcp_steps: ['accept_capacity_terms'], pricing_url: null,
            terms: TERMS_V15, accept: { method: 'POST', path: '/api/v1/listings/terms/accept' } },
};
const browseWith = (access) => ({ ...listWithItems(2), ...(access ? { access } : {}) });

describe('browse-path access block → next_steps', () => {
  const browseResult = async (body) => { responder = () => json(200, body); return call(READ, {}); };
  // content[0] is the confidential JSON; content[1..] the rendered lines and the
  // source line. A granted body differs from a plain one by the `access` key it
  // carried IN, and by nothing this code added — so strip that one key and the
  // two payloads must be identical, with every other part of the result equal
  // as a string.
  // ★ citation.retrieved_at and provenance.retrieved_at are stamped from the
  //   CLOCK on every call, so two results taken a millisecond apart differ by
  //   those two fields and nothing else. Comparing them raw makes this a coin
  //   flip that reports a passing build as broken (and, worse, reports a real
  //   regression as "the clock again"). Blank them; everything else is compared
  //   literally.
  const stable = (v) => JSON.stringify(v).replace(/"retrieved_at":"[^"]*"/g, '"retrieved_at":"<stamped>"');
  const payloadWithoutAccess = (r) => { const p = JSON.parse(r.content[0].text); delete p.access; return stable(p); };
  const renderedTail = (r) => stable(r.content.slice(1));

  it('sign_in_required names claim_free_key and bind_email, then source_capacity again', async () => {
    responder = () => json(200, browseWith(BROWSE_ACCESS_SIGN_IN));
    const r = await call(READ, {});
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent;
    expect(sc.next_steps).toEqual(['claim_free_key', 'bind_email', READ]);
    // The note has to tell the agent what to do with its HUMAN, not just which
    // tool to call — a bare tool name is the inference this whole block removes.
    expect(sc.next_steps_note).toContain('claim_free_key, then bind_email, then ' + READ);
    expect(sc.next_steps_note).toMatch(/email your human explicitly gives you/);
    const ok = await accepts(READ, sc);
    expect(ok.ok, ok.issues).toBe(true);
  });

  it('email_binding_required names bind_email only', async () => {
    responder = () => json(200, browseWith({
      ...BROWSE_ACCESS_SIGN_IN, reason: 'email_binding_required',
      unlock: { ...BROWSE_ACCESS_SIGN_IN.unlock, mcp_steps: ['bind_email'] },
    }));
    const sc = (await call(READ, {})).structuredContent;
    expect(sc.next_steps).toEqual(['bind_email', READ]);
  });

  it('terms_acceptance_required names accept_capacity_terms and points at the terms', async () => {
    responder = () => json(200, browseWith(BROWSE_ACCESS_TERMS));
    const sc = (await call(READ, {})).structuredContent;
    expect(sc.next_steps).toEqual(['accept_capacity_terms', READ]);
    expect(sc.next_steps_note).toContain('access.unlock.terms');
    expect(sc.next_steps_note).toContain('terms_version="' + TERMS_V15.version + '"');
    expect(sc.next_steps_note).toContain('then call ' + READ + ' again.');
  });

  it('the steps are the BACKEND’s, never inferred: an unknown reason with no mcp_steps adds nothing', async () => {
    const access = {
      required: 'registered', granted: false, reason: 'some_reason_this_build_never_heard_of',
      unlock: { web_sign_in_url: null, mcp_steps: [], pricing_url: null },
    };
    const got = await browseResult(browseWith(access));
    // "Adds nothing" has to mean the SILENT result, not a broken one: a missing
    // next_steps key is equally true of a handler that threw, so the whole
    // payload is compared against the ungated browse answer.
    expect(got.isError).toBeFalsy();
    expect(payloadWithoutAccess(got)).toBe(payloadWithoutAccess(await browseResult(listWithItems(2))));
    expect(got.structuredContent.next_steps).toBeUndefined();
    expect(got.structuredContent.next_steps_note).toBeUndefined();
  });

  // ── the unchanged cases ────────────────────────────────────────────────────
  // Byte-for-byte, not "looks the same": the whole result is compared against
  // the same call made by the code path this change did not touch.
  it('a granted block and an absent block are both unchanged, byte for byte', async () => {
    const plain = await browseResult(listWithItems(2));
    for (const [label, access] of [
      ['granted', { required: 'registered', granted: true, reason: null, unlock: null }],
      ['granted with steps still listed', { ...BROWSE_ACCESS_SIGN_IN, granted: true }],
    ]) {
      const got = await browseResult(browseWith(access));
      expect(payloadWithoutAccess(got), label).toBe(payloadWithoutAccess(plain));
      expect(renderedTail(got), label).toBe(renderedTail(plain));
      expect(got.structuredContent.next_steps, label).toBeUndefined();
      expect(got.structuredContent.next_steps_note, label).toBeUndefined();
    }
    // No access key at all: the payload the backend serves TODAY.
    expect(plain.structuredContent.next_steps).toBeUndefined();
    expect(plain.structuredContent.next_steps_note).toBeUndefined();
    expect(plain.structuredContent.upgrade_for_pocket).toBeDefined();   // plan gate, reported separately
  });

  // ★ The comparison above is an AGREEMENT check: gated and ungated come out
  //   of the same function, so anything this change stamped on EVERY browse
  //   payload would sit on both sides and pass. (Measured: a mutant adding a
  //   stray key to every browse result survived that test.) So the ungated
  //   payload is also pinned ABSOLUTELY, against the fixture that went in.
  it('the ungated browse payload carries the fixture plus the citation stamps, and nothing else', async () => {
    const fixture = listWithItems(2);
    const payload = JSON.parse((await browseResult(fixture)).content[0].text);
    expect(Object.keys(payload)).toEqual(
      [...Object.keys(fixture), 'citation', 'provenance', '_source', '_cite']);
    for (const [i, item] of payload.items.entries()) {
      expect(Object.keys(item), 'item ' + i).toEqual(Object.keys(fixture.items[i]));
    }
  });

  it('adds no per-item next steps and leaves the teaser citation alone', async () => {
    const gated = await browseResult(browseWith(BROWSE_ACCESS_SIGN_IN));
    const plain = await browseResult(listWithItems(2));
    for (const it of gated.structuredContent.items) {
      expect(it.next_steps).toBeUndefined();
      expect(it.next_steps_note).toBeUndefined();
    }
    expect(stable(gated.structuredContent.citation)).toBe(stable(plain.structuredContent.citation));
    expect(stable(gated.structuredContent.provenance)).toBe(stable(plain.structuredContent.provenance));
    // The teaser's citation stays the PUBLIC one; the gate must not have
    // promoted it to the confidential licence.
    expect(gated.structuredContent.citation.license).toBe('CC-BY-4.0');
    expect(renderedTail(gated)).toBe(renderedTail(plain));   // rendered lines + source line unchanged
  });

  it('the single-listing wall is untouched', async () => {
    responder = () => json(200, DETAIL_LOCKED_TERMS);
    const sc = (await call(READ, { slug: TEASER.slug })).structuredContent;
    expect(sc.next_steps).toEqual(['accept_capacity_terms', READ]);
    expect(sc.next_steps_note).toBe(
      'This listing opens once your human accepts the introduction terms (access.unlock.terms). Show them the terms;'
      + ' only after they agree, call accept_capacity_terms with accept_terms=true'
      + ' and terms_version="' + TERMS_BLOCK.version + '", then call ' + READ + ' again.');

    responder = () => json(401, E401_SIGN_IN);
    const wall = (await call(READ, { slug: TEASER.slug })).structuredContent;
    expect(wall.next_steps).toEqual(['claim_free_key', 'bind_email', READ]);
    expect(wall.identity_note).toMatch(/OAuth/);
  });
});
