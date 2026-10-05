// The keyless / free-key get_market_context and get_iso_context reach the caller through
// buildDepthTease (the backend sends `_free_preview`, not `_upgrade`), and that envelope
// carried no human link: keyless Phoenix 2026-10-05, tier free, gated sections, no
// for_your_human (Claude told the user no unlock link was returned). #752 attached the relay
// in the handler on a backend `_upgrade` key the keyless backend never sends, so its test
// passed and the live response did not change. This test feeds the REAL keyless shape.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'https://backend.context-pack-tease-human-link.test';
const RELAY = /^https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/;
const FREE_PREVIEW = { used_tokens: 800, sections: [{ id: 'hero', text: 'Phoenix headline' }], locked_sections: ['outlook', 'deals'] };
let S, TOOLS, realFetch, prevInternal, prevBase, n = 0;
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'context-pack-tease-human-link-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const p = new URL(String(input && input.url ? input.url : input)).pathname;
    if (p.startsWith('/api/v1/context/market/')) return json({ ok: true, market: 'phoenix', name: 'Phoenix', _cite: 'c',
      sections: [{ id: 'hero' }, { id: 'outlook' }, { id: 'deals' }], _free_preview: structuredClone(FREE_PREVIEW) });
    if (p.startsWith('/api/v1/context/iso/')) return json({ ok: true, iso: 'ERCOT', name: 'ERCOT', _cite: 'c',
      sections: [{ id: 'hero' }, { id: 'queue' }], _free_preview: structuredClone(FREE_PREVIEW) });
    if (p === '/api/v1/relay/short') return json({ ok: false });
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE; process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal; });

const seat = () => ({ tier: 'free', platform: 'cursor', client_name_raw: 'cursor',
  client_ip: '198.51.100.' + (60 + (n % 100)), session_id: 'sess-ctxpack-link-' + (++n) });
async function call(tool, args) {
  const T = TOOLS[tool] || TOOLS.get(tool);
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return S._ctxALS.run(seat(), () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const textJson = (r) => JSON.parse(r.content[0].text);

describe.each([['get_market_context', { market: 'phoenix' }], ['get_iso_context', { iso: 'ERCOT' }]])('keyless %s', (tool, args) => {
  it('control: the response is the depth tease (gated, no backend _upgrade)', async () => {
    const r = await call(tool, args);
    const j = textJson(r);
    expect(j.locked_sections, 'this is the tease envelope, so the checks below are not vacuous').toEqual(FREE_PREVIEW.locked_sections);
    expect(j._upgrade && j._upgrade.tier).toBe('anonymous');
  });
  it('carries the signed relay in for_your_human, in the JSON text AND structuredContent', async () => {
    const r = await call(tool, args);
    expect(textJson(r).for_your_human.url).toMatch(RELAY);
    expect(r.structuredContent.for_your_human.url).toMatch(RELAY);
    expect(r.structuredContent.for_your_human.url).toBe(textJson(r).for_your_human.url);
  });
});

describe('buildDepthTease directly', () => {
  const res = () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, market: 'phoenix', name: 'Phoenix', sections: [{}, {}], _free_preview: FREE_PREVIEW }) }] });
  it('a keyed free caller on a context pack gets the relay too', async () => {
    const t = await S.buildDepthTease('get_market_context', res(), { session_id: 'sess-ctxpack-keyed', api_key: 'dch_live_' + 'k'.repeat(32) }, 'free');
    expect(t.structuredContent.for_your_human.url).toMatch(RELAY);
  });
  it('a non-context tool is unchanged: no relay added by the tease', async () => {
    const r = { content: [{ type: 'text', text: JSON.stringify({ ok: true, items: [1, 2, 3, 4, 5, 6] }) }] };
    const t = await S.buildDepthTease('get_pipeline', r, { session_id: 'sess-ctxpack-other' }, 'anonymous');
    expect(t.structuredContent.for_your_human).toBeUndefined();
  });
});
