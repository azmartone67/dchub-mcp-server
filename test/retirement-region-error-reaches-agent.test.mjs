// get_retirement_headroom region_iso=WECC: the backend's 400 carries a note, the grid names, the ignored tokens
// and the balancing authorities in the data (be#6423); _upstreamError kept only code/hint/suggestions/id/path,
// so through MCP an agent saw "unknown region_iso 'WECC'" and a generic hint (Grok 2026-10-06; a direct GET had
// the explanation). Real registered handler, stubbed backend, no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'https://backend.retirement-region-error.test';
const WECC_BODY = {
  ok: false, _entity: 'error', error: "unknown region_iso 'WECC'", ignored: ['WECC'],
  known: ['CAISO', 'ERCOT', 'ISONE', 'MISO', 'NYISO', 'PJM', 'SPP'],
  also_accepted: 'any EIA balancing-authority code present in the retirement data',
  balancing_authorities_in_data: ['MISO', 'PJM', 'TVA', 'SWPP', 'NYIS', 'CISO'],
  note: 'WECC is an interconnection, not a balancing authority: pass the balancing-authority codes inside it, e.g. AZPS, SRP, WALC, PACE, BPAT.',
};
let S, T, realFetch, prevBase, prevInternal, backendPaths = [];

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'retirement-region-error-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = new URL(String(input && input.url ? input.url : input));
    backendPaths.push(u.pathname);
    if (u.pathname === '/api/v1/retirement-headroom') {
      return new Response(JSON.stringify(WECC_BODY), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  prevBase = process.env.DCHUB_API_BASE; process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  T = S.createServer()._registeredTools.get_retirement_headroom;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});

describe('get_retirement_headroom region_iso=WECC through the MCP tool', () => {
  it('the agent gets the backend explanation, not just the bare 400', async () => {
    const parsed = await T.inputSchema.safeParseAsync({ target_mw: 50, horizon_months: 24, region_iso: 'WECC' });
    expect(parsed.success).toBe(true);
    const seat = { tier: 'free', platform: 'cursor', client_name_raw: 'cursor', client_ip: '198.51.100.77', session_id: 'sess-retirement-region-error' };
    const r = await S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
    expect(backendPaths, 'control: the handler reached the stubbed retirement route').toContain('/api/v1/retirement-headroom');
    const all = JSON.stringify(r.structuredContent || {}) + (r.content || []).map((b) => b.text).join('\n');
    expect(all, 'control: this is the upstream 400').toMatch(/unknown region_iso 'WECC'/);
    expect(all).toMatch(/interconnection, not a balancing authority/);
    expect(all).toMatch(/balancing_authorities_in_data/);
    expect(all).toMatch(/"TVA"/);
  });
});
