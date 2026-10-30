// Nearby site context on analyze_site (owner 2026-10-29): the Land & Power map's
// 14 blocks ride analyze_site as `site_context`, gated like the rest of Land & Power.
// Pro, or a free key on one of its monthly full runs: the full body (the backend is
// asked WITHOUT view). Everyone else: the backend's ?view=preview (which blocks have
// an answer, never a value), on the free-key preview and on the keyless wall alike.
// A full body that reaches a preview path is dropped, never trimmed: the LP preview
// trimmer keeps names, and a substation's or a carrier's name is Pro.
// Real server.mjs app on loopback, stub backend; no network, no disk writes.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
// server.mjs is imported by the harness (after it points DCHUB_API_BASE at the stub);
// a static import here would load it first, against the real base.
let _siteContextShape, _siteContextPreviewOnly, _withSiteContextPreview, _siteContextLine, _lpPreviewResult;

const FREE_KEY = 'dch_trial_SITECTXfree0123456789abcdef';
const UA = { 'user-agent': 'Claude-User' };
const ARGS = { lat: 41.8716, lon: -87.6395 };
const SCORE = {
  success: true, location: { lat: 41.8716, lon: -87.6395, state: 'IL' }, overall_score: 78.2, verdict: 'BUILD',
  nearby: { facilities_100km: 140, substations_50km: 90 },
};
// Values only the full body has: a substation name and kV, carrier names, a market rate.
const SECRETS = ['TAYLOR ST', '345 kV', 'Zayo Group', 'Lumen Technologies', '$165/kW'];
const FULL_SC = {
  ok: true, lat: 41.8716, lng: -87.6395, as_of: '2026-10-29T12:00:00Z', errors: {},
  substation: { name: 'TAYLOR ST', voltage: '345 kV', distance_km: 0.9, source: 'HIFLD' },
  carriers_in_building: { building: '350 E Cermak', carriers: ['Zayo Group', 'Lumen Technologies'], source: 'PeeringDB' },
  market: { name: 'Chicago', pricing: { rate: '$165/kW/mo', source: 'CBRE' } },
};
const PREVIEW_SC = {
  ok: true, view: 'preview', as_of: '2026-10-29T12:00:00Z',
  blocks: [
    { key: 'substation', title: 'Substation and queue', status: 'answered', sources: ['HIFLD Electric Substations'] },
    { key: 'carriers_in_building', title: 'Carriers in the building', status: 'answered', sources: ['PeeringDB'] },
    { key: 'rail', title: 'Rail', status: 'not_available', reason: 'not available: rail lines are mapped for the US only', sources: [] },
    { key: 'flood', title: 'Flood zone', status: 'no_answer', reason: 'the source did not answer in time', sources: [] },
  ],
  answered_count: 2, blocks_count: 4,
  note: 'Which blocks have an answer at this point. Their values are part of the full Land & Power result.',
};

let H, fence;
let used = 0, LIMIT = 3, scMode = 'honest';
const scAsks = [];

async function settle(quietMs = 300, maxMs = 6000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call(key) {
  const hdr = { ...UA, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init('/mcp', 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  const before = scAsks.length;
  const r = await H.call('/mcp', 'analyze_site', ARGS, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const res = r.msg && r.msg.result;
  return {
    res, sc: (res && res.structuredContent) || {},
    text: ((res && res.content) || []).map((x) => x.text || '').join('\n'),
    asks: scAsks.slice(before),
  };
}
const leaks = (r) => SECRETS.filter((s) => JSON.stringify(r.res || {}).includes(s));

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body, u) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        if (body.op === 'consume') {
          const allowed = used < LIMIT; if (allowed) used += 1;
          return { ok: true, allowed, used, limit: LIMIT, remaining: Math.max(0, LIMIT - used), resets_at: '2026-11-01T00:00:00Z' };
        }
        if (body.op === 'release') { used = Math.max(0, used - 1); return { ok: true, allowed: false, used, limit: LIMIT }; }
        return { ok: true, allowed: used < LIMIT, used, limit: LIMIT };
      }
      if (p === '/api/v1/land-power/site-context') {
        const view = u && u.searchParams ? u.searchParams.get('view') : null;
        scAsks.push({ view, lat: u && u.searchParams.get('lat'), lng: u && u.searchParams.get('lng') });
        if (scMode === 'down') return { status: 503, body: { error: 'down' } };
        // A misbehaving backend: the full body whatever was asked.
        if (scMode === 'always_full') return { ...FULL_SC };
        return view === 'preview' ? { ...PREVIEW_SC } : { ...FULL_SC };
      }
      if (p === '/api/site-score') return { ...SCORE };
      return undefined;
    },
  });
  ({ _siteContextShape, _siteContextPreviewOnly, _withSiteContextPreview, _siteContextLine, _lpPreviewResult } = await import('../server.mjs'));
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => {
  used = 0; LIMIT = 3; scMode = 'honest';
  delete process.env.DCHUB_SITE_CONTEXT; delete process.env.DCHUB_LP_FREE_RUNS;
});

describe('analyze_site site_context: who gets what', () => {
  it('Pro gets the full body; the backend is asked without view, at the point', async () => {
    const r = await call(PRO_KEY);
    expect(r.asks).toHaveLength(1);
    expect(r.asks[0].view).toBe(null);
    expect(Number(r.asks[0].lat)).toBeCloseTo(41.8716, 4);
    expect(Number(r.asks[0].lng)).toBeCloseTo(-87.6395, 4);
    expect(r.sc.site_context && r.sc.site_context.view).toBe('full');
    expect(r.sc.site_context.substation.name).toBe('TAYLOR ST');
    expect(r.sc.overall_score).toBe(78.2);
  });

  it('a free key on a monthly full run gets the full body too', async () => {
    const r = await call(FREE_KEY);
    expect(r.asks.map((a) => a.view)).toEqual([null]);
    expect(r.sc.site_context && r.sc.site_context.view).toBe('full');
    expect(JSON.stringify(r.sc.site_context)).toContain('Zayo Group');
  });

  it('a free key past its runs gets only the preview: no name, kV, carrier or rate', async () => {
    LIMIT = 0;
    const r = await call(FREE_KEY);
    expect(r.asks.map((a) => a.view)).toEqual(['preview']);
    expect(r.sc.site_context).toEqual(PREVIEW_SC);
    expect(leaks(r)).toEqual([]);
  });

  it('a full body that reaches the free-key preview is dropped, not trimmed', async () => {
    LIMIT = 0; scMode = 'always_full';
    const r = await call(FREE_KEY);
    expect(r.asks.map((a) => a.view)).toEqual(['preview']);
    expect(r.sc.site_context).toBeUndefined();
    expect(leaks(r)).toEqual([]);
  });

  it('keyless: the wall carries the preview as data, its v15 copy untouched, no value', async () => {
    const r = await call(null);
    expect(r.asks.map((a) => a.view)).toEqual(['preview']);
    expect(r.sc.status).toBe('gated_preview');
    expect(r.sc.site_context).toEqual(PREVIEW_SC);
    // lib/gated-preview.mjs rebuilds the wall's text (owner copy v15); the preview rides as data only.
    expect(r.text).toContain('This is a preview, not the full site report.');
    expect(leaks(r)).toEqual([]);
  });

  it('keyless with a misbehaving backend: nothing of the full body reaches the wall', async () => {
    scMode = 'always_full';
    const r = await call(null);
    expect(r.sc.site_context).toBeUndefined();
    expect(r.text).not.toContain('Nearby site context');
    expect(leaks(r)).toEqual([]);
  });

  it('a backend failure leaves the score answer as it was', async () => {
    scMode = 'down';
    const r = await call(PRO_KEY);
    expect(r.sc.site_context).toBeUndefined();
    expect(r.sc.overall_score).toBe(78.2);
  });

  it('kill switch DCHUB_SITE_CONTEXT=0: the backend is not asked', async () => {
    process.env.DCHUB_SITE_CONTEXT = '0';
    const r = await call(PRO_KEY);
    expect(r.asks).toHaveLength(0);
    expect(r.sc.site_context).toBeUndefined();
    expect(r.sc.overall_score).toBe(78.2);
  });
});

describe('site_context shape checks', () => {
  it('_siteContextShape keeps only the view that was asked for', () => {
    expect(_siteContextShape(FULL_SC, 'full')).toMatchObject({ view: 'full', substation: { name: 'TAYLOR ST' } });
    expect(_siteContextShape(FULL_SC, 'preview')).toBe(null);
    expect(_siteContextShape(PREVIEW_SC, 'full')).toBe(null);
    expect(_siteContextShape(PREVIEW_SC, 'preview')).toEqual(PREVIEW_SC);
    expect(_siteContextShape({ ok: true, gated: true, human_url: 'x' }, 'full')).toBe(null);
    // A gate answer is never content, even one that also carries an errors map.
    expect(_siteContextShape({ ok: true, gated: true, errors: {}, human_url: 'x' }, 'full')).toBe(null);
    expect(_siteContextShape({ ok: false, errors: {} }, 'full')).toBe(null);
    expect(_siteContextShape([FULL_SC], 'full')).toBe(null);
  });

  it('the Land & Power preview drops a full site_context and keeps the backend preview', () => {
    const wrap = (sc) => ({ content: [{ type: 'text', text: JSON.stringify({ ...SCORE, site_context: sc }) }] });
    const dropped = _lpPreviewResult('analyze_site', wrap(FULL_SC));
    expect(dropped.structuredContent.site_context).toBeUndefined();
    expect(SECRETS.filter((x) => JSON.stringify(dropped).includes(x))).toEqual([]);
    const kept = _lpPreviewResult('analyze_site', wrap(PREVIEW_SC));
    expect(kept.structuredContent.site_context).toEqual(PREVIEW_SC);
  });

  it('_siteContextPreviewOnly refuses a full body', () => {
    expect(_siteContextPreviewOnly(FULL_SC)).toBeUndefined();
    expect(_siteContextPreviewOnly({ ...FULL_SC, view: 'full' })).toBeUndefined();
    expect(_siteContextPreviewOnly({ view: 'preview' })).toBeUndefined();
    expect(_siteContextPreviewOnly(PREVIEW_SC)).toBe(PREVIEW_SC);
  });

  it('_withSiteContextPreview adds nothing for a full body, and keeps the wall otherwise', () => {
    const wall = { content: [{ type: 'text', text: 'wall' }], structuredContent: { human_url: 'u' } };
    expect(_withSiteContextPreview(wall, FULL_SC)).toBe(wall);
    const out = _withSiteContextPreview(wall, PREVIEW_SC);
    expect(out.structuredContent).toMatchObject({ human_url: 'u', site_context: PREVIEW_SC });
    expect(out.content).toHaveLength(2);
    expect(wall.content).toHaveLength(1);
  });

  it('the added line names no plan and no price', () => {
    const line = _siteContextLine(PREVIEW_SC);
    expect(line).not.toMatch(/\$\d/);
    expect(line).not.toMatch(/\b(Pro|Developer|Starter|Enterprise|Founding)\b/);
    expect(line).not.toMatch(/\/mo\b|per month|price/i);
  });
});
