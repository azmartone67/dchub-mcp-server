// G-1 part 3 (2026-10-04): get_refined_queue takes `developer`, and the anon preview trim
// never cuts the ERCOTQueue attribution (CC BY 4.0 credit must travel with the data).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
let S;
beforeAll(async () => { S = await import('../server.mjs'); });

const prov = () => ({ source: 'ERCOTQueue (Matt Prusak), ercotqueue.com', license: 'CC BY 4.0',
  as_of: '2026-09-08T12:48:24', fields: ['queue_entry_date', 'developer', 'completion_probability', 'funnel_stage',
  'ercotqueue_as_of', 'source_report', 'lifecycle'], basis_class: { a: 'filed', b: 'derived', c: 'modelled', d: 'filed' } });
const att = () => ({ source: 'ERCOTQueue', creator: 'Matt Prusak', citation: 'Prusak, M. (2026). ercotqueue.com, independent ERCOT queue dashboard.',
  license_url: 'https://creativecommons.org/licenses/by/4.0/', underlying_source: 'ERCOT Generation Interconnection Status report, August 2026',
  changes: 'Joined by INR; renamed fields.', fields: ['developer', 'queue_entry_date', 'funnel_stage', 'completion_probability'] });
const payload = () => ({
  results: Array.from({ length: 6 }, (_, i) => ({ queue_id: 'ERCOT-' + i, developer: 'Dev ' + i, ercotqueue_provenance: prov() })),
  ercotqueue: { rows_enriched: 6, ...prov(), credit: 'Prusak, M. (2026).' },
  attribution: [att(), att(), att(), att(), att()],
});

describe('anon preview trim keeps the ERCOTQueue attribution whole', () => {
  it('nothing under ercotqueue_provenance, ercotqueue or attribution is cut or counted', () => {
    const out = S.trimForTrial(payload(), 'get_refined_queue');
    expect(out.results.length).toBeLessThanOrEqual(S.TRIAL_PREVIEW_ROWS);       // control: the trim runs
    expect(out._results_total_in_pro).toBe(6);
    for (const r of out.results) {
      expect(r.ercotqueue_provenance.fields).toHaveLength(7);
      expect(r.ercotqueue_provenance._fields_total_in_pro).toBeUndefined();
    }
    expect(out.ercotqueue.fields).toHaveLength(7);
    expect(out.ercotqueue._fields_total_in_pro).toBeUndefined();
    expect(out.attribution).toHaveLength(5);
    expect(out.attribution[0].fields).toHaveLength(4);
    expect(JSON.stringify(out.attribution)).toBe(JSON.stringify(payload().attribution));
    expect(JSON.stringify(out.ercotqueue)).toBe(JSON.stringify(payload().ercotqueue));
  });
});

describe('get_refined_queue end to end (real handler, stubbed backend)', () => {
  const BASE = 'https://backend.refined-developer.test';
  let T, realFetch, prevBase, prevInternal; const seen = [];
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  beforeAll(async () => {
    prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'refined-developer-internal-key';
    realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input && input.url ? input.url : input);
      let u; try { u = new URL(url); } catch { return json({}); }
      if (u.pathname === '/api/v1/interconnection-queue/refined') { seen.push(u); return json(payload()); }
      if (u.pathname === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
      return json({});
    };
    prevBase = process.env.DCHUB_API_BASE; process.env.DCHUB_API_BASE = BASE;
    S = await import('../server.mjs');
    if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
    T = S.createServer()._registeredTools.get_refined_queue;
  }, 60_000);
  afterAll(() => { globalThis.fetch = realFetch;
    if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal; });
  const seat = () => ({ tier: 'anonymous', platform: 'cursor', client_name_raw: 'cursor', client_ip: '198.51.100.77', session_id: 'sess-refined-dev-1' });

  it('the input schema accepts developer and passes it to the backend as a query arg', async () => {
    const parsed = await T.inputSchema.safeParseAsync({ min_mw: 1, iso: 'ERCOT', developer: 'tenaska' });
    expect(parsed.success).toBe(true);
    expect(parsed.data.developer).toBe('tenaska');                 // a schema without the field strips it
    await S._ctxALS.run(seat(), () => T.handler(parsed.data, { signal: new AbortController().signal }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].searchParams.get('developer')).toBe('tenaska');
  });

  it('a keyless call returns the full attribution through the real handler and wrapper', async () => {
    const parsed = await T.inputSchema.safeParseAsync({ min_mw: 1, iso: 'ERCOT' });
    const r = await S._ctxALS.run(seat(), () => T.handler(parsed.data, { signal: new AbortController().signal }));
    const sc = r.structuredContent;
    // This harness seat is not trimmed (the backend tease already gated the rows); the trim itself
    // is exercised by the trimForTrial test above. This one pins that nothing on the normal path drops it.
    expect(sc.attribution).toHaveLength(5);
    expect(sc.attribution[0].citation).toMatch(/^Prusak, M\./);
    expect(sc.ercotqueue.fields).toHaveLength(7);
    for (const row of sc.results) expect(row.ercotqueue_provenance.fields).toHaveLength(7);
    const text = r.content.map((b) => b.text || '').join('\n');
    expect(text).toContain('Prusak, M.');
    expect(text).not.toMatch(/_fields_total_in_pro/);
  });
});
