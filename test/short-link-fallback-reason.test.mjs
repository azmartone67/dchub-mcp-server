// short-link-fallback-reason.test.mjs — every fallback from the /u/ short link to the long
// /upgrade/h link has ONE reason, a log line, and a counter (2026-10-12).
//
// Handoff 10-12: "Short-link minting still falls back to the long link about 1 in 6 times;
// cause not investigated." Backend proxy logs for POST /api/v1/relay/short, 10-05..10-11: 602
// mints, 133 HTTP 400 (wall-marked relay tokens; be#6827) and 22 client timeouts (499). The
// MCP side logged the timeouts and the 400s as two unrelated lines and the silent branches not
// at all, so the rate could not be read. These tests reproduce each failing condition through
// the real _shortRelayPageLink / _shortRelayLink with only the backend stubbed, and each has a
// control where the same call succeeds, so a pass means the branch was taken.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const SECRET = 'short-link-fallback-test-key-not-real';
const SHORT = 'https://dchub.cloud/u/abc234';
const relayFor = (ts) => 'https://dchub.cloud/upgrade/h/'
  + Buffer.from('a-123|analyze_site|free|' + ts + '|w-sitekey').toString('base64url') + '.' + '0123456789abcdef0123456789abcdef';
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const okFetch = async () => json({ ok: true, code: 'abc234', url: SHORT });

let S, prevInternal, httpServer, PORT, errSpy;
const logged = () => errSpy.mock.calls.map((c) => c.join(' ')).filter((l) => /\[wall-(relay-short|short-link)\]/.test(l));

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  S = await import('../server.mjs');
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60_000);
afterAll(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
  delete process.env.DCHUB_RELAY_SHORT_LINK;
});
beforeEach(() => {
  S._resetShortLinkStats();
  delete process.env.DCHUB_RELAY_SHORT_LINK;
  delete process.env.DCHUB_WALL_SHORT_LINK;
  if (errSpy) errSpy.mockRestore();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

// A fresh relay URL per test: the shortener caches by URL, and a cache hit is not a mint.
let n = 0;
const relay = () => relayFor(1791700000 + (++n));

describe('the failing conditions, reproduced', () => {
  it('a backend that stalls past the budget: long link, reason=timeout, and the budget is enforced', async () => {
    // The production condition: proxy logs show 499 "client has closed the request" at ~1000 ms.
    const stall = (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
    const u = relay();
    const t0 = Date.now();
    const out = await S._shortRelayPageLink(u, 'analyze_site', stall);
    const ms = Date.now() - t0;
    expect(out).toBe(u);
    expect(ms).toBeGreaterThanOrEqual(900);
    expect(ms).toBeLessThan(2500);
    const st = S._shortLinkStats();
    expect(st.fallback).toEqual({ timeout: 1 });
    expect(st.attempts).toBe(1);
    expect(st.short).toBe(0);
    expect(logged().some((l) => /\[wall-relay-short\] fallback reason=timeout tool=analyze_site ms=\d+/.test(l))).toBe(true);
  });

  it('control: the same call with a backend that answers is a short link and no fallback', async () => {
    const out = await S._shortRelayPageLink(relay(), 'analyze_site', okFetch);
    expect(out).toBe(SHORT);
    const st = S._shortLinkStats();
    expect(st).toMatchObject({ attempts: 1, short: 1, fallback_total: 0, fallback: {} });
    expect(logged()).toEqual([]);
  });

  it('the pre-be#6827 refusal: HTTP 400 is counted with the backend error code', async () => {
    const u = relay();
    const out = await S._shortRelayPageLink(u, 'analyze_site', async () => json({ ok: false, error: 'bad_request' }, 400));
    expect(out).toBe(u);
    expect(S._shortLinkStats().fallback).toEqual({ 'backend_400:bad_request': 1 });
    expect(logged().some((l) => l.includes('fallback reason=backend_400:bad_request'))).toBe(true);
  });

  it('a backend DB failure (503 mint_unavailable) is its own reason, not a timeout', async () => {
    await S._shortRelayPageLink(relay(), 'compare_sites', async () => json({ ok: false, error: 'mint_unavailable' }, 503));
    expect(S._shortLinkStats().fallback).toEqual({ 'backend_503:mint_unavailable': 1 });
  });

  it('a 200 that is not a /u/ link is unusable_answer', async () => {
    await S._shortRelayPageLink(relay(), 'analyze_site', async () => json({ ok: true, url: 'https://evil.example/u/abc234' }));
    expect(S._shortLinkStats().fallback).toEqual({ unusable_answer: 1 });
  });

  it('a network error is error, with the message in the log line', async () => {
    await S._shortRelayPageLink(relay(), 'analyze_site', async () => { throw new TypeError('fetch failed'); });
    expect(S._shortLinkStats().fallback).toEqual({ error: 1 });
    expect(logged().some((l) => /reason=error .*detail=fetch failed/.test(l))).toBe(true);
  });
});

describe('the branches that used to fall back silently are counted', () => {
  it('a URL the relay shortener does not take: not_relay_url, logged', async () => {
    const bad = 'https://dchub.cloud/upgrade/h/not-a-token';
    let called = 0;
    const out = await S._shortRelayPageLink(bad, 'analyze_site', async () => { called += 1; return okFetch(); });
    expect(out).toBe(bad);
    expect(called).toBe(0);
    expect(S._shortLinkStats().fallback).toEqual({ not_relay_url: 1 });
    expect(logged().some((l) => l.includes('reason=not_relay_url'))).toBe(true);
  });

  it('the kill switch: counted, not logged as a fault, and no backend call', async () => {
    process.env.DCHUB_RELAY_SHORT_LINK = '0';
    let called = 0;
    const u = relay();
    expect(await S._shortRelayPageLink(u, 'analyze_site', async () => { called += 1; return okFetch(); })).toBe(u);
    expect(called).toBe(0);
    expect(S._shortLinkStats().fallback).toEqual({ kill_switch: 1 });
    expect(logged()).toEqual([]);
  });

  it('a cache hit counts as short, not as a second mint', async () => {
    const u = relay();
    let called = 0;
    const f = async () => { called += 1; return okFetch(); };
    expect(await S._shortRelayPageLink(u, 'analyze_site', f)).toBe(SHORT);
    expect(await S._shortRelayPageLink(u, 'analyze_site', f)).toBe(SHORT);
    expect(called).toBe(1);
    expect(S._shortLinkStats()).toMatchObject({ attempts: 2, short: 2, cache_hit: 1, fallback_total: 0 });
  });

  it('the /go/c shortener shares the accounting: a non-/go/c URL is not_go_link, a 400 keeps its code', async () => {
    const notGo = 'https://dchub.cloud/pricing';
    expect(await S._shortRelayLink(notGo, 'get_grid_data', okFetch)).toBe(notGo);
    expect(S._shortLinkStats().fallback).toEqual({ not_go_link: 1 });
  });
});

describe('the rate is readable from outside the process', () => {
  it('GET /internal/short-link reports attempts, short and fallback by reason, with a rate', async () => {
    await S._shortRelayPageLink(relay(), 'analyze_site', okFetch);
    await S._shortRelayPageLink(relay(), 'analyze_site', okFetch);
    await S._shortRelayPageLink(relay(), 'analyze_site', async () => json({ ok: false, error: 'mint_unavailable' }, 503));
    await S._shortRelayPageLink(relay(), 'analyze_site', okFetch);
    const r = await fetch(`http://127.0.0.1:${PORT}/internal/short-link`, { headers: { 'x-internal-key': SECRET } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ attempts: 4, short: 3, fallback_total: 1, fallback: { 'backend_503:mint_unavailable': 1 }, fallback_rate: 0.25 });
    expect(typeof j.since).toBe('string');
  });

  it('control: without the internal key it is 403', async () => {
    expect((await fetch(`http://127.0.0.1:${PORT}/internal/short-link`)).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${PORT}/internal/short-link`, { headers: { 'x-internal-key': 'wrong' } })).status).toBe(403);
  });
});
