// 2026-10-10 — Capacity Source discovery fixes, MCP slice.
//  1. GET /api/v1/listings/<slug> answers keyless with `"quota": null`; the
//     envelope's object-only quota arm made the SDK reject the whole result.
//  2. url / tracked_url / citation.url from the backend reach the agent
//     (citation.url wins even on the confidential half; a Link: line is printed).
//  3. request_capacity_intro sends the session's latest retrieval receipt.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'http://127.0.0.1:1';
const READ = 'source_capacity';
const WRITE = 'request_capacity_intro';
const SLUG = 'phoenix-2-mw-colocation-available-now';
const URL_ = `https://dchub.cloud/listings/${SLUG}`;
const TRACKED = `https://dchub.cloud/go/l/${SLUG}?rcpt=RC-1&src=mcp&platform=claude`;
const TERMS = { version: '2026-09-11', url: 'https://dchub.cloud/listings#terms', summary: '…' };
const ACCESS_OPEN = { required: 'public', granted: true, reason: null,
  unlock: { web_sign_in_url: null, mcp_steps: [], pricing_url: null } };
const CARD = { id: 7, slug: SLUG, title: '2 MW colocation', market: 'Phoenix', state: 'AZ',
  capacity_mw: 2, capacity_kw: 2000, region: 'north_america', locked: true,
  url: URL_, tracked_url: TRACKED };
const detail = (over = {}) => ({
  ok: true, locked: true, listing: CARD, access: ACCESS_OPEN, quota: null,
  retrieval_receipt: { reference: 'RC-DETAIL-1' },
  citation: { source: 'DC Hub Capacity Source', url: URL_, license: 'CC-BY-4.0',
              cite_as: 'DC Hub Capacity Source, dchub.cloud' },
  caller_tier: 'anonymous', ...over,
});
const browse = () => ({
  ok: true, count: 1, items: [CARD], quota: null, caller_tier: 'anonymous',
  retrieval_receipt: { reference: 'RC-BROWSE-1' },
  citation: { source: 'DC Hub Capacity Source', url: URL_, license: 'CC-BY-4.0', cite_as: 'DC Hub Capacity Source, dchub.cloud' },
});

let S, TOOLS, realFetch, calls = [], responder = null;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let pathname = ''; try { pathname = new URL(url).pathname; } catch { /* */ }
    let body; if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    const rec = { url, pathname, method: String(init.method || 'GET').toUpperCase(), body };
    calls.push(rec);
    if (pathname.startsWith('/api/v1/listings')) {
      if (!responder) throw new Error(`unexpected listings call: ${url}`);
      return responder(rec);
    }
    return json(200, {});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; responder = null; });

const seat = (over = {}) => ({ platform: 'claude', client_name_raw: 'claude-ai', source: 'glama',
  client_ip: '203.0.113.7', session_id: 'sess-links-receipt', ...over });
async function call(name, args, s) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const accepts = async (name, payload) => {
  const r = await TOOLS[name].outputSchema.safeParseAsync(payload);
  return { ok: r.success, issues: JSON.stringify(r.error?.issues) };
};
const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const first = (r) => JSON.parse(r.content[0].text);
const COMPLETE = { name: 'Jane Doe', company: 'Acme Capital', accept_terms: true, terms_version: TERMS.version };

describe('quota:null does not reject the result', () => {
  it('keyless single listing with quota:null is not an error and passes output validation', async () => {
    responder = () => json(200, detail());
    const r = await call(READ, { slug: SLUG }, seat({ session_id: 'sess-q-null' }));
    expect(r.isError).not.toBe(true);
    const v = await accepts(READ, r.structuredContent);
    expect(v.ok, v.issues).toBe(true);
  });
  it('browse with quota:null passes too, and the other envelope keys accept null', async () => {
    responder = () => json(200, { ...browse(), provenance: null, _return_loop: null, _front_door: null });
    const r = await call(READ, {}, seat({ session_id: 'sess-q-null-2' }));
    expect(r.isError).not.toBe(true);
    const v = await accepts(READ, r.structuredContent);
    expect(v.ok, v.issues).toBe(true);
    for (const k of ['quota', 'provenance', '_return_loop', '_front_door']) {
      expect(r.structuredContent[k], k).not.toBeNull();
    }
  });
});

describe('listing links', () => {
  it('locked single listing: url and tracked_url survive, citation.url is the listing, Link line printed', async () => {
    responder = () => json(200, detail());
    const r = await call(READ, { slug: SLUG }, seat({ session_id: 'sess-l1' }));
    const p = first(r);
    expect(p.listing.url).toBe(URL_);
    expect(p.listing.tracked_url).toBe(TRACKED);
    expect(r.structuredContent.citation.url).toBe(URL_);
    expect(textOf(r)).toContain('Link: ' + TRACKED);
  });
  it('confidential (unlocked) answer keeps its licence but the backend citation.url wins', async () => {
    responder = () => json(200, detail({ locked: false, listing: { ...CARD, locked: false } }));
    const r = await call(READ, { slug: SLUG }, seat({ session_id: 'sess-l2' }));
    const c = first(r).citation;
    expect(c.url).toBe(URL_);
    expect(c.license).toBe('LicenseRef-DCHub-Capacity-Source-Confidential');
  });
  it('a non-dchub citation.url from the backend never replaces ours', async () => {
    responder = () => json(200, detail({ locked: false, listing: { ...CARD, locked: false },
      citation: { url: 'https://evil.example/x', license: 'CC-BY-4.0' } }));
    const r = await call(READ, { slug: SLUG }, seat({ session_id: 'sess-l3' }));
    expect(first(r).citation.url).toBe('https://dchub.cloud/listings');
  });
  it('browse: every card line carries its link; pocket provider stays unprinted', async () => {
    responder = () => json(200, browse());
    const r = await call(READ, {}, seat({ session_id: 'sess-l4' }));
    expect(textOf(r)).toContain('Link: ' + TRACKED);
    expect(S._listingLines({ items: [{ ...CARD, provider: 'Secret DC Inc' }] }).join('\n')).not.toContain('Secret');
    expect(S._listingLines({ listing: CARD, disclosure: { released: false, provider: 'Secret DC Inc', status: 'pending' } })
      .join('\n')).not.toContain('Secret');
  });
});

describe('receipt attribution on request_capacity_intro', () => {
  const intro = async (s, extra = {}) => {
    responder = (rec) => (rec.method === 'POST' ? json(200, { ok: true, lead_id: 'LD-1', status: 'pending_email_confirmation' }) : json(200, TERMS_OK));
    await call(WRITE, { ...COMPLETE, ...extra }, s);
    return calls.filter((c) => c.method === 'POST' && c.pathname.includes('/intro'))[0]
      || calls.filter((c) => c.method === 'POST').pop();
  };
  const TERMS_OK = { ok: true, terms: TERMS };
  it('sends the latest receipt seen on this session, plus the client hint', async () => {
    const s = seat({ session_id: 'sess-r1' });
    responder = () => json(200, browse());
    await call(READ, {}, s);
    const post = await intro(s, { slug: SLUG });
    expect(post.body.receipt_reference).toBe('RC-BROWSE-1');
    expect(post.body.client.platform).toBe('claude');
  });
  it('prefers the receipt of that slug over a later browse', async () => {
    const s = seat({ session_id: 'sess-r2' });
    responder = () => json(200, detail());
    await call(READ, { slug: SLUG }, s);
    responder = () => json(200, browse());
    await call(READ, {}, s);
    const post = await intro(s, { slug: SLUG });
    expect(post.body.receipt_reference).toBe('RC-DETAIL-1');
  });
  it('is session-scoped and absent when the session never read a listing', async () => {
    responder = () => json(200, detail());
    await call(READ, { slug: SLUG }, seat({ session_id: 'sess-r3-a' }));
    const post = await intro(seat({ session_id: 'sess-r3-b' }), { slug: SLUG });
    expect(post.body.receipt_reference).toBeUndefined();
  });
  it('the memo is bounded', () => {
    for (let i = 0; i < 6000; i++) S._listingNoteReceipt({ retrieval_receipt: { reference: 'R' + i } }, { session_id: 'bound-' + i });
    expect(S._listingReceiptFor({ session_id: 'bound-0' }, '')).toBe('');
    expect(S._listingReceiptFor({ session_id: 'bound-5999' }, '')).toBe('R5999');
  });
});
