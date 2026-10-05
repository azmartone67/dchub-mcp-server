// get_market_intel, keyless (Grok 2026-10-04 9:36 PM PT): content[0].text was the JSON plus the
// agent header and the human line in one block, so json.loads failed (char 8243). Same split as
// #744: block 0 is exactly the JSON; the prose that followed it is in the blocks after.
// Real registered handler, stubbed backend, no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'https://backend.market-intel-block.test';
const MARKET = { ok: true, slug: 'ashburn', name: 'Ashburn', facility_count: 412, total_mw: 5123.4,
  stats: { total_mw: 5123.4, operator_count: 61, facility_count: 412 },
  by_status: { operational: 380, planned: 32 },
  top_providers: Array.from({ length: 10 }, (_, i) => ({ name: 'Provider ' + i, facilities: 40 - i, mw: 500 - i * 10 })),
  recent_facilities: Array.from({ length: 5 }, (_, i) => ({ name: 'Facility ' + i, city: 'Ashburn', mw: 20 + i })),
  as_of: '2026-10-04' };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, T, realFetch, prevBase, prevInternal;
beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'market-intel-block-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (p.startsWith('/api/v1/markets/')) return json(structuredClone(MARKET));
    if (p === '/api/v1/relay/short') return json({ ok: true, code: 'abc234', url: 'https://dchub.cloud/u/abc234' });
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE; process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  T = S.createServer()._registeredTools.get_market_intel;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal; });

let n = 0;
const seat = (sid) => ({ tier: 'free', platform: 'cursor', client_name_raw: 'cursor',
  client_ip: '198.51.100.' + (60 + (n % 100)), session_id: sid || 'sess-mi-block-' + (++n) });
async function call(s) {
  const parsed = await T.inputSchema.safeParseAsync({ market: 'ashburn' });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}

describe('keyless get_market_intel', () => {
  it('block 0 is exactly parseable JSON; the agent header and human line follow in their own blocks', async () => {
    const r = await call(seat());
    expect(r.content.length, 'no trailer was produced: the checks below would be vacuous').toBeGreaterThanOrEqual(2);
    expect(() => JSON.parse(r.content[0].text)).not.toThrow();
    const rest = r.content.slice(1).map((b) => b.text).join('\n');
    expect(rest).toMatch(/Your agent just answered|For your human/);          // the trailer is still delivered
    expect(r.content[0].text).not.toMatch(/Your agent just answered|→ \*\*For your human:\*\*/);
    expect(r.content[1].text.startsWith('---')).toBe(false);                     // the separator is not left dangling
  });

  it('a repeat call in the same session keeps block 0 parseable too', async () => {
    const s = seat('sess-mi-block-repeat');
    await call(s);
    const r = await call(s);
    expect(() => JSON.parse(r.content[0].text)).not.toThrow();
    expect(r.structuredContent && typeof r.structuredContent).toBe('object');   // structuredContent untouched
  });
});
