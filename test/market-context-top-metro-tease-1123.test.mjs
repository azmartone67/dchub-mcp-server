// market-context-top-metro-tease-1123.test.mjs — keyless get_market_context on a top-20 metro
// served the full pack, DCPI sub-scores and time to power included (live 2026-11-23, Dallas:
// tier "full", "DCPI scores: excess-power 55.8/100, constraint 56.3/100", "Time to power: ~30
// months").
//
// Why: get_market_context was in lib/top-metros.mjs TOP_METRO_FREE_TOOLS, so a top-20 market
// skipped every wall and tease. The two other tools in that set rely on the backend to withhold
// the sub-scores from the forwarded caller tier (be#8229); the context-pack route
// (routes/context_packs.py, _dcpi_pro_access) reads this server's internal key as full access and
// withholds nothing, so the open path handed the Pro pack to a keyless caller. get_iso_context was
// never in the set and was teased correctly.
//
// The stub backend returns the FULL pack (the internal-key shape, `_free_preview` attached), as
// production does. No network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'https://backend.market-context-top-metro-tease.test';
const FULL_PACK = (slug) => ({
  ok: true, market: slug, name: 'Dallas', tier: 'full', max_tokens: 4000, used_tokens: 1183, as_of: '2026-11-23T01:00:00Z',
  _cite: 'https://dchub.cloud/markets/' + slug,
  sections: [
    { id: 'hero', title: 'Market & DCPI verdict', tokens: 60, as_of: '2026-11-23T01:00:00Z',
      text: 'Dallas (TX, ERCOT) — DCPI verdict: CAUTION. DCPI scores: excess-power 55.8/100, constraint 56.3/100.' },
    { id: 'grid', title: 'Power & grid', tokens: 20, as_of: '2026-11-23T01:00:00Z', text: 'Grid: ERCOT. queue wait ~28 months.' },
    { id: 'ttp', title: 'Time to power', tokens: 20, as_of: '2026-11-23T01:00:00Z',
      text: 'Time to power: ~30 months (as of 2026-11-23). Basis: DCPI modelled months to energize a new large load.' },
    { id: 'risk', title: 'Risk factors', tokens: 8, as_of: null, text: 'Risk factors: water-stress score 55.9.' },
  ],
  _free_preview: {
    used_tokens: 120,
    sections: [{ id: 'hero', title: 'Market & DCPI verdict', tokens: 40,
      text: 'Dallas (TX, ERCOT) — DCPI verdict: CAUTION. The DCPI verdict describes the outlook for new power in this market.' }],
    locked_sections: ['grid', 'ttp', 'risk'],
  },
});

let S, TOOLS, realFetch, prevInternal, prevBase, prevTop, n = 0;
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  prevTop = process.env.DCHUB_TOP_METROS_FREE; delete process.env.DCHUB_TOP_METROS_FREE;   // the open path ON, as in prod
  prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'market-context-top-metro-tease-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const p = new URL(String(input && input.url ? input.url : input)).pathname;
    let m;
    if ((m = /^\/api\/v1\/context\/market\/([^/]+)$/.exec(p))) return json(FULL_PACK(decodeURIComponent(m[1])));
    if (p === '/api/v1/relay/short') return json({ ok: false });
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE; process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
  if (prevTop === undefined) delete process.env.DCHUB_TOP_METROS_FREE; else process.env.DCHUB_TOP_METROS_FREE = prevTop;
});

const keyless = () => ({ tier: 'free', platform: 'claude', client_name_raw: 'claude-code',
  client_ip: '203.0.113.' + (20 + (n % 200)), session_id: 'sess-mctx-tease-' + (++n) });
const paid = () => ({ tier: 'pro', api_key: 'dch_live_mctx_tease_paid_' + (++n), platform: 'claude',
  client_name_raw: 'claude-code', client_ip: '203.0.113.250', session_id: 'sess-mctx-paid-' + n });
async function call(args, seat) {
  const T = TOOLS.get_market_context;
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
// Everything the caller can read: every content block and structuredContent.
const allText = (r) => (r.content || []).map((c) => c.text || '').join('\n') + '\n' + JSON.stringify(r.structuredContent || {});
const PRO_LEAKS = [/excess-power/i, /constraint \d+(\.\d+)?\/100/i, /Time to power: ~\d+ months/i];

describe('keyless get_market_context on a top-20 metro is the depth tease, not the full pack', () => {
  for (const market of ['dallas', 'DFW', 'northern-virginia']) {
    it(`keyless ${market}: no DCPI sub-scores, no time-to-power months, not tier full`, async () => {
      const r = await call({ market }, keyless());
      const text = allText(r);
      for (const re of PRO_LEAKS) expect(text, `${market} leaked ${re}`).not.toMatch(re);
      const j = JSON.parse(r.content[0].text);
      expect(j.tier).not.toBe('full');
      expect(r.structuredContent && r.structuredContent.tier).not.toBe('full');
      expect(j.access).not.toBe('full');
      // the tease itself: the verdict headline stays, the locked sections are named, an upgrade path rides it
      expect(j.sections.map((s) => s.id)).toEqual(['hero']);
      expect(j.sections[0].text).toMatch(/DCPI verdict: CAUTION/);
      expect(j.locked_sections).toEqual(['grid', 'ttp', 'risk']);
      expect(j._upgrade && j._upgrade.locked).toBe('full_depth');
    });
  }

  it('a free key (no email) on dallas: the same tease, no sub-scores, not tier full', async () => {
    const r = await call({ market: 'dallas' }, { ...keyless(), api_key: 'dch_live_mctx_tease_free_' + n });
    const text = allText(r);
    for (const re of PRO_LEAKS) expect(text, `free key leaked ${re}`).not.toMatch(re);
    const j = JSON.parse(r.content[0].text);
    expect(j.tier).not.toBe('full');
    expect(j.locked_sections).toEqual(['grid', 'ttp', 'risk']);
  });

  it('a paid (Pro) key still gets the full pack with the sub-scores and time to power', async () => {
    const r = await call({ market: 'dallas' }, paid());
    const text = allText(r);
    for (const re of PRO_LEAKS) expect(text, `paid lost ${re}`).toMatch(re);
    const j = JSON.parse(r.content[0].text);
    expect(j.tier).toBe('full');
    expect(j.sections.map((s) => s.id)).toEqual(['hero', 'grid', 'ttp', 'risk']);
  });
});
