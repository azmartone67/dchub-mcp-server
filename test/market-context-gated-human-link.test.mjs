// A gated get_market_context pack carries the signed /upgrade/h relay in
// structuredContent.for_your_human (keyless Phoenix had none, 2026-10-05).
// Real registered handler under a real caller seat; only the backend is stubbed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'https://backend.market-context-gated-human-link.test';
const RELAY = /^https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/;
let S, TOOLS, realFetch, prevInternal, prevBase, backend;
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'market-context-gated-human-link-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const p = new URL(String(input && input.url ? input.url : input)).pathname;
    if (p.startsWith('/api/v1/context/market/')) return json(structuredClone(backend));
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});

const seat = (n) => ({ tier: 'anonymous', platform: 'cursor', client_name_raw: 'cursor',
  client_ip: '198.51.100.' + (40 + n), session_id: 'sess-mcgl-' + n });
async function call(s) {
  const T = TOOLS.get_market_context;
  const parsed = await T.inputSchema.safeParseAsync({ market: 'phoenix' });
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}

describe('get_market_context human link', () => {
  it('a gated pack carries the signed relay in for_your_human', async () => {
    backend = { market: 'phoenix', sections: [{ id: 'verdict', text: 'x' }], _upgrade: { message: 'more on paid plans' } };
    const r = await call(seat(1));
    expect(r.structuredContent.for_your_human.url).toMatch(RELAY);
  });
  it('an ungated pack gets no relay', async () => {
    backend = { market: 'phoenix', sections: [{ id: 'verdict', text: 'x' }] };
    const r = await call(seat(2));
    expect(r.structuredContent.for_your_human).toBeUndefined();
  });
});
