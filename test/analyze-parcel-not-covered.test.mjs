// analyze_parcel outside hosted parcel coverage (owner 2026-10-16): the backend's
// "no hosted parcel contains that point" 404 becomes status parcel_not_covered +
// analyze_site's PREVIEW at the point + the coverage list from
// /api/v1/parcels/coverage. Real server.mjs app on loopback, stub backend; no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { isParcelNotCovered, parcelCoverageBlock, scrubPreviewForParcel, parcelGapFrom, buildParcelNotCovered } from '../lib/parcel-not-covered.mjs';

const FREE_KEY = 'dch_trial_FREEparcel0123456789abcdef';
const UA = { 'user-agent': 'Claude-User' };
const PHX = { lat: 33.45, lon: -112.07 };          // no hosted parcel
const LOUDOUN = { lat: 39.04, lon: -77.48 };       // hosted parcel
const LOOP = { lat: 41.8819, lon: -87.6278 };      // street gap in covered Cook County IL
const SITE = {
  success: true, lat: 33.45, lon: -112.07, overall_score: 83.7, interpretation: 'Excellent site',
  scores: { power_infrastructure: 91, fiber_connectivity: 64, gas_pipeline_access: 40, market_conditions: 77, risk_resilience: 70 },
  nearby: { substations_50km: 7, facilities_100km: 12 },
  power_cost: { rate_cents_kwh: 7.42 },
  nearest_substations: { substations_in_radius: 7, search_radius_km: 50,
    substations: [{ name: 'Test Sub XYZ', hifld_id: 'H123', max_kv: 230, distance_km: 2.4 }] },
};
const PARCEL_OK = { _entity: 'parcel_analysis', ok: true, total_acres: 41.2, member_count: 1, contiguous: true,
  representative_point: { lat: 39.04, lng: -77.48 },
  hosted_parcel: { parcel_id: 'LOUD-1', county: 'Loudoun', state: 'VA', acres_per_source: 41.0, hosted_lookup: true } };
const COVERAGE = { markets: [{ state: 'VA', county: 'Loudoun', source: 'loudoun_parcels_latlong', parcels: 132104,
  last_ingest: '2026-07-11T00:00:00' }], total_parcels: 132104, note: 'x' };

let H, fence;
let parcelMode = 'auto', coverageDown = false, siteDown = false;

async function settle(quietMs = 250, maxMs = 5000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call(key, args, extraHdr = {}) {
  const hdr = { ...UA, ...extraHdr, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init('/mcp', 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  const before = H.hits.length;
  const r = await H.call('/mcp', 'analyze_parcel', args, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const hits = H.hits.slice(before);
  const res = (r.msg && r.msg.result) || {};
  return {
    res, sc: res.structuredContent || {},
    text: (res.content || []).map((x) => x.text || '').join('\n'),
    paths: hits.map((h) => h.path),
  };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/analyze-parcel') {
        if (parcelMode === 'down') return { status: 503, body: { error: 'parcel lookup unavailable' } };
        if (body && body.geometry) return { ...PARCEL_OK, hosted_parcel: undefined };
        if (body && body.lat === LOUDOUN.lat) return { ...PARCEL_OK };
        if (body && body.lat === LOOP.lat) return { status: 404, body: { ok: false, _entity: 'error',
          error: 'no hosted parcel contains that point, but it is inside hosted parcel coverage',
          coverage_url: '/api/v1/parcels/coverage', in_hosted_coverage: true,
          nearest_parcel: { county: 'Cook', state: 'IL', distance_m: 13.2 } } };
        return { status: 404, body: { ok: false, _entity: 'error',
          error: 'no hosted parcel contains that point — coverage is rolling out by market (GET /api/v1/parcels/coverage); pass an explicit GeoJSON geometry to analyze any boundary',
          coverage_url: '/api/v1/parcels/coverage' } };
      }
      if (p === '/api/v1/parcels/coverage') {
        if (coverageDown) return { status: 503, body: { error: 'coverage unavailable' } };
        return { ...COVERAGE };
      }
      if (p === '/api/site-score') {
        if (siteDown) return { status: 503, body: { error: 'down' } };
        return { ...SITE };
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        return { ok: true, allowed: true, used: 1, limit: 3, remaining: 2, resets_at: '2026-11-01T00:00:00Z' };
      }
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { parcelMode = 'auto'; coverageDown = false; siteDown = false; delete process.env.DCHUB_PARCEL_FALLBACK; });

const NO_PLAN = /\b(Pro|Starter|Developer|Enterprise|Founding)\b|\$\s?\d|\/mo\b|per month/;

describe('analyze_parcel: covered point is unchanged', () => {
  it('a hosted parcel returns the parcel analysis, no preview, no site read', async () => {
    const r = await call(FREE_KEY, LOUDOUN);
    expect(r.res.isError).toBeFalsy();
    expect(r.sc.total_acres).toBe(41.2);
    expect(r.sc.hosted_parcel.parcel_id).toBe('LOUD-1');
    expect(r.sc.status).toBeUndefined();
    expect(r.sc.site_preview).toBeUndefined();
    expect(r.paths).not.toContain('/api/site-score');
    expect(r.paths).not.toContain('/api/v1/parcels/coverage');
  });
  it('a caller geometry is unchanged', async () => {
    const r = await call(FREE_KEY, { geometry: { type: 'Polygon', coordinates: [[[-112, 33], [-112.01, 33], [-112.01, 33.01], [-112, 33]]] } });
    expect(r.sc.total_acres).toBe(41.2);
    expect(r.sc.status).toBeUndefined();
  });
});

describe('analyze_parcel: uncovered point -> preview + coverage list', () => {
  it('free key: parcel_not_covered, keyed preview with figures withheld, coverage list, no free run spent', async () => {
    const r = await call(FREE_KEY, PHX);
    expect(r.res.isError).toBeFalsy();
    expect(r.sc.status).toBe('parcel_not_covered');
    expect(r.sc.parcel_found).toBe(false);
    expect(r.sc.message).toMatch(/No hosted parcel boundary contains this point/);
    expect(r.sc.site_preview_basis).toMatchObject({ tool: 'analyze_site', access: 'key' });
    const pv = r.sc.site_preview;
    expect(pv).toBeTruthy();
    // No full field: every score and figure is withheld, substation detail gone.
    expect(pv.overall_score ?? null).toBe(null);
    expect(pv.scores.power_infrastructure ?? null).toBe(null);
    expect(pv.power_cost.rate_cents_kwh ?? null).toBe(null);
    expect(pv.nearby.substations_50km).toBe(7);           // counts stay, as in analyze_site's preview
    expect(pv.site_teaser).toMatchObject({ verdict: 'BUILD', power_infrastructure: 'BUILD' });
    const all = JSON.stringify(r.sc) + r.text;
    expect(all).not.toContain('Test Sub XYZ');
    expect(all).not.toContain('83.7');
    expect(all).not.toContain('7.42');
    expect(all).not.toContain('Excellent site');
    // Coverage comes from the backend endpoint.
    expect(r.sc.parcel_coverage).toMatchObject({ available: true, market_count: 1, total_parcels: 132104 });
    expect(r.sc.parcel_coverage.markets[0]).toMatchObject({ state: 'VA', county: 'Loudoun', parcels: 132104 });
    // The monthly free full runs are never asked.
    expect(r.paths).not.toContain('/api/v1/mcp/lp-free-runs');
    expect(r.sc.free_full_runs).toBeUndefined();
    // Provenance and citation as on any served answer.
    expect(typeof r.sc.cite_as).toBe('string');
    expect(r.sc.provenance || r.sc.citation).toBeTruthy();
    expect(r.sc.next_calls[0]).toMatchObject({ tool: 'analyze_site', args: { lat: 33.45, lon: -112.07 } });
  });

  it('agent-facing payload names no plan and no price', async () => {
    const r = await call(FREE_KEY, PHX);
    const own = JSON.stringify({ message: r.sc.message, site_preview: r.sc.site_preview,
      basis: r.sc.site_preview_basis, cov: r.sc.parcel_coverage, next: r.sc.next_calls });
    expect(own).not.toMatch(NO_PLAN);
    expect(own).not.toMatch(/upgrade_url|required_plan|checkout|\/go\/c\//);
  });

  it('keyless: only the keyless teaser, never the keyed preview', async () => {
    const r = await call(null, PHX, { 'x-forwarded-for': '203.0.113.77' });
    expect(r.sc.status).toBe('parcel_not_covered');
    expect(r.sc.site_preview_basis.access).toBe('keyless');
    const pv = r.sc.site_preview;
    expect(pv && pv.site_teaser).toMatchObject({ verdict: 'BUILD', power_infrastructure: 'BUILD' });
    expect(pv.scores).toBeUndefined();
    expect(pv.nearby).toBeUndefined();
    expect(JSON.stringify(r.sc)).not.toContain('83.7');
    expect(r.paths).not.toContain('/api/v1/mcp/lp-free-runs');
  });

  it('Pro key gets the preview too (no full run, no credit path)', async () => {
    const r = await call(PRO_KEY, PHX);
    expect(r.sc.status).toBe('parcel_not_covered');
    expect(r.sc.site_preview.overall_score ?? null).toBe(null);
    expect(JSON.stringify(r.sc)).not.toContain('Test Sub XYZ');
  });

  it('coverage endpoint down: says so, still serves the preview', async () => {
    coverageDown = true;
    const r = await call(FREE_KEY, { lat: 33.46, lon: -112.08 });
    expect(r.sc.status).toBe('parcel_not_covered');
    // a cached success from an earlier test may answer; either way never a guess
    if (r.sc.parcel_coverage.available === false) expect(r.sc.parcel_coverage.reason).toMatch(/unavailable/);
    else expect(r.sc.parcel_coverage.markets[0].county).toBe('Loudoun');
  });

  it('site read down: preview null with a reason, coverage still listed', async () => {
    siteDown = true;
    const r = await call(FREE_KEY, PHX);
    expect(r.sc.status).toBe('parcel_not_covered');
    expect(r.sc.site_preview).toBe(null);
    expect(r.sc.site_preview_basis.unavailable_reason).toBeTruthy();
  });
});

describe('analyze_parcel: a gap between parcels in a covered county (Grok #117020)', () => {
  it('says the point is inside coverage, names the county and distance, keeps the preview', async () => {
    const r = await call(FREE_KEY, LOOP);
    expect(r.res.isError).toBeFalsy();
    expect(r.sc.status).toBe('no_parcel_at_point');
    expect(r.sc.in_hosted_coverage).toBe(true);
    expect(r.sc.nearest_parcel).toEqual({ county: 'Cook', state: 'IL', distance_m: 13.2 });
    expect(r.sc.message).toMatch(/inside hosted parcel coverage \(Cook County, IL\)/);
    expect(r.sc.message).toMatch(/13 m away/);
    expect(r.sc.message).not.toMatch(/market by market/);
    expect(r.sc.site_preview).toBeTruthy();
    expect(r.sc.parcel_coverage.available).toBe(true);
  });
  it('a truly uncovered point keeps parcel_not_covered and in_hosted_coverage false', async () => {
    const r = await call(FREE_KEY, PHX);
    expect(r.sc.status).toBe('parcel_not_covered');
    expect(r.sc.in_hosted_coverage).toBe(false);
    expect(r.sc.nearest_parcel).toBeUndefined();
  });
});

describe('analyze_parcel: errors and bad input keep their behaviour', () => {
  it('missing coordinates is still invalid_args (missing_coordinates)', async () => {
    const r = await call(FREE_KEY, { lat: 33.45 });
    expect(r.res.isError).toBe(true);
    expect(r.text).toContain('missing_coordinates');
  });
  it('out-of-range coordinate keeps the error, no preview', async () => {
    const r = await call(FREE_KEY, { lat: 133.45, lon: -112.07 });
    expect(r.sc.status).not.toBe('parcel_not_covered');
    expect(r.text).toContain('API 404');
    expect(r.paths).not.toContain('/api/site-score');
  });
  it('a backend 5xx is still an error', async () => {
    parcelMode = 'down';
    const r = await call(FREE_KEY, PHX);
    expect(r.sc.status).not.toBe('parcel_not_covered');
    expect(r.text).toContain('API 503');
    expect(r.paths).not.toContain('/api/site-score');
  });
  it('kill switch DCHUB_PARCEL_FALLBACK=0 restores the 404 error', async () => {
    process.env.DCHUB_PARCEL_FALLBACK = '0';
    const r = await call(FREE_KEY, PHX);
    expect(r.sc.status).not.toBe('parcel_not_covered');
    expect(r.text).toContain('API 404');
    expect(r.paths).not.toContain('/api/site-score');
  });
});

describe('lib/parcel-not-covered unit', () => {
  const nf = { http_status: 404, ok: false, body: { error: 'no hosted parcel contains that point', coverage_url: '/x' } };
  it('isParcelNotCovered matches only the point-lookup 404', () => {
    expect(isParcelNotCovered(nf, { lat: 33.4, lon: -112 })).toBe(true);
    expect(isParcelNotCovered(nf, { lat: 33.4, lon: -112, geometry: { type: 'Polygon' } })).toBe(false);
    expect(isParcelNotCovered({ ...nf, http_status: 503 }, { lat: 33.4, lon: -112 })).toBe(false);
    expect(isParcelNotCovered({ ...nf, body: { error: 'route not found' } }, { lat: 33.4, lon: -112 })).toBe(false);
    expect(isParcelNotCovered(nf, { lat: 95, lon: -112 })).toBe(false);
    expect(isParcelNotCovered(nf, { lat: 33.4 })).toBe(false);
  });
  it('coverage block never invents a list', () => {
    expect(parcelCoverageBlock(null).available).toBe(false);
    expect(parcelCoverageBlock({ ok: true, body: { markets: [] } })).toMatchObject({ available: true, market_count: 0 });
  });
  it('scrub drops plan fields and pitch notes', () => {
    const s = scrubPreviewForParcel({ required_plan: 'pro', upgrade_url: 'u', a: { tier_required: 'pro', note: 'needs a paid plan (7-day trial)', x: 1 } });
    expect(s).toEqual({ a: { note: 'Locked in the preview.', x: 1 } });
  });
});

describe('lib/parcel-not-covered gap unit', () => {
  it('parcelGapFrom reads only a well-formed in-coverage body', () => {
    expect(parcelGapFrom({ in_hosted_coverage: true, nearest_parcel: { county: 'Dallas', state: 'TX', distance_m: 0.94 } }))
      .toEqual({ county: 'Dallas', state: 'TX', distance_m: 0.9 });
    expect(parcelGapFrom({ in_hosted_coverage: false, nearest_parcel: { county: 'Dallas', state: 'TX', distance_m: 1 } })).toBeNull();
    expect(parcelGapFrom({ in_hosted_coverage: true })).toBeNull();
    expect(parcelGapFrom({ in_hosted_coverage: true, nearest_parcel: { county: '', distance_m: 1 } })).toBeNull();
    expect(parcelGapFrom({ in_hosted_coverage: true, nearest_parcel: { county: 'Cook', distance_m: 'x' } })).toBeNull();
    expect(parcelGapFrom(null)).toBeNull();
  });
  it('a sub-metre gap reads 1 m, never 0 m', () => {
    const out = buildParcelNotCovered({ lat: 32.9, lon: -96.6, preview: null, coverage: { available: false },
      gap: { county: 'Dallas', state: 'TX', distance_m: 0.9 } });
    expect(out.message).toMatch(/1 m away/);
    expect(out.status).toBe('no_parcel_at_point');
  });
});
