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
    for (const n of [READ, WRITE]) {
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

  it('descriptions carry no digits', () => {
    for (const n of [READ, WRITE]) {
      expect(TOOLS[n].description.length, `${n} description implausibly short`).toBeGreaterThan(300);
      expect(TOOLS[n].description, n).not.toMatch(/\d/);
    }
  });

  it('declares no required argument, so {} passes schema validation and the handler decides', async () => {
    for (const n of [READ, WRITE]) {
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
  ];
  for (const [tool, label, fixture] of CASES) {
    it(`${tool}: ${label}`, async () => {
      const r = await accepts(tool, fixture);
      expect(r.ok, r.issues).toBe(true);
    });
  }

  it('control: the schema really validates (a wrong-typed envelope key is rejected)', async () => {
    for (const n of [READ, WRITE]) {
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
    expect(sentence).not.toMatch(/\d/);
    const scope = inst.indexOf(' IN SCOPE');
    if (scope > -1) expect(i).toBeLessThan(scope);
  });
});

// ── licence: listing answers are confidential, never CC-BY ───────────────────
// The shared stamps (withCitation's CC-BY footer, _embedSourceInContent0's _cite,
// lib/attribution.mjs) each defer to attribution a result already carries. Run
// the WHOLE handler chain per result shape and search the WHOLE result: a bare
// listing answer would leave labelled "CC-BY-4.0: cite this data".
describe('Capacity Source answers carry a confidential licence end to end', () => {
  const slug = 'dfw-40mw-powered-shell';
  const shapes = [
    ['teaser feed', READ, {}, () => json(200, listWithItems(2))],
    ['locked detail', READ, { slug }, () => json(200, DETAIL_LOCKED)],
    ['unlocked detail', READ, { slug }, () => json(200, DETAIL_UNLOCKED)],
    ['identity wall', WRITE, { ...COMPLETE, slug }, () => json(401, E401_SIGN_IN)],
    ['intro receipt', WRITE, { ...COMPLETE, slug }, () => json(200, INTRO_OK)],
    ['interest receipt', WRITE, { ...COMPLETE }, () => json(200, INTEREST_OK)],
    ['terms refusal', WRITE, { ...COMPLETE, accept_terms: false }, null],
  ];
  it.each(shapes)('%s', async (_label, tool, args, respond) => {
    responder = respond;
    const r = await call(tool, args, identifiedSeat());
    expect(r.isError).not.toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/CC-BY/i);
    const first = JSON.parse(r.content[0].text);
    for (const view of [first, r.structuredContent]) {
      expect(view.citation.license).toBe(S.LISTING_LICENSE);
      expect(view.provenance.license).toBe(S.LISTING_LICENSE);
      expect(view.provenance.redistribution).toBe('not_permitted');
    }
    // Not vacuous: the shared stamps DID run over this result — attribution.mjs
    // merged its retrieved_at in, and the source line the tools emit is present.
    expect(typeof r.structuredContent.citation.retrieved_at).toBe('string');
    expect(textOf(r)).toContain('Source: DC Hub Capacity Source');
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
