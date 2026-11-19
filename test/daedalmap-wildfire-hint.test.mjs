// daedalmap-wildfire-hint.test.mjs — execute_plan names DaedalMap Wildfires for a located plan with a hazard read
// (owner approved 2026-11-19, lib/daedalmap-wildfire-hint.mjs). Pure cases first, then execute_plan end to end on a
// real server.mjs with a stub backend (no static import of server.mjs: the harness sets the backend base before
// importing it). Same shape as test/parcel-gps-hint.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAEDALMAP_WILDFIRE_HINT, DAEDALMAP_MCP_URL, DAEDALMAP_NAME, DAEDALMAP_SITE_URL, DAEDALMAP_REGISTRY_NAME,
  HAZARD_CLIMATE_TOOLS, daedalmapWildfireHint, boundLocation, hasHazardRead, daedalmapHintEnabled,
} from '../lib/daedalmap-wildfire-hint.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXACT = 'For wildfire events and aggregates at this location, use DaedalMap (https://app.daedalmap.com/mcp/wildfires).';
const PARCEL = 'For the official parcel polygon and cadastral reference, use Parcel GPS (https://mcp.parcelgps.com/mcp).';
const ran = (tool, status = 'executed', args = {}) => ({ step: 1, tool, status, args, result: {} });
const SAC = { __citySlug: 'sacramento-ca', __outlook: { slug: 'sacramento' }, stateFromPlace: 'CA' };

describe('DaedalMap wildfire hint: pure', () => {
  it('the sentence and constants are the approved wording', () => {
    expect(DAEDALMAP_WILDFIRE_HINT).toBe(EXACT);
    expect(DAEDALMAP_NAME).toBe('DaedalMap Wildfires');
    expect(DAEDALMAP_MCP_URL).toBe('https://app.daedalmap.com/mcp/wildfires');
    expect(DAEDALMAP_SITE_URL).toBe('https://www.daedalmap.com');
    expect(DAEDALMAP_REGISTRY_NAME).toBe('com.daedalmap/wildfires');
  });

  it('each hazard/climate read with a bound place earns the hint', () => {
    for (const tool of ['get_climate_intel', 'get_disaster_risk', 'get_facility_risk_delta']) {
      const h = daedalmapWildfireHint({ signals: SAC, executed: [ran(tool)] });
      expect(h, tool).not.toBeNull();
      expect(h.sentence).toBe(EXACT);
      expect(h.field).toMatchObject({ name: DAEDALMAP_NAME, text: EXACT, mcp_url: DAEDALMAP_MCP_URL,
        registry_name: DAEDALMAP_REGISTRY_NAME, location: { kind: 'market', value: 'sacramento' } });
    }
  });

  it('every bound-place form counts: point, step point, market, state, country', () => {
    const ex = [ran('get_disaster_risk')];
    expect(boundLocation({ signals: { coords: { lat: 38.58, lon: -121.49 } }, executed: ex })).toEqual({ kind: 'point', value: '38.58,-121.49' });
    expect(boundLocation({ signals: {}, executed: [ran('get_disaster_risk', 'executed', { lat: 33.45, lon: -112.07 })] }))
      .toEqual({ kind: 'point', value: '33.45,-112.07' });
    expect(boundLocation({ signals: { market: 'phoenix' } })).toEqual({ kind: 'market', value: 'phoenix' });
    expect(boundLocation({ signals: { stateFromPlace: 'az' } })).toEqual({ kind: 'state', value: 'AZ' });
    expect(boundLocation({ geographyScope: { countries: [{ country: 'CA' }] } })).toEqual({ kind: 'country', value: 'CA' });
    expect(daedalmapWildfireHint({ geographyScope: { countries: [{ country: 'AU' }] }, executed: ex })).not.toBeNull();   // global
  });

  it('no hint without a hazard/climate read that returned data', () => {
    expect(daedalmapWildfireHint({ signals: SAC, executed: [ran('get_water_risk'), ran('get_grid_data'), ran('get_composite_site_score')] })).toBeNull();
    expect(daedalmapWildfireHint({ signals: SAC, executed: [ran('get_disaster_risk', 'gated_preview')] })).toBeNull();
    expect(daedalmapWildfireHint({ signals: SAC, executed: [ran('get_climate_intel', 'failed')] })).toBeNull();
    expect(daedalmapWildfireHint({ signals: SAC, executed: [ran('get_disaster_risk', 'skipped_unresolved')] })).toBeNull();
    expect(daedalmapWildfireHint({ signals: SAC, executed: [ran('get_disaster_risk', 'timed_out')] })).toBeNull();
    expect(daedalmapWildfireHint({ signals: SAC, executed: [] })).toBeNull();
    expect(hasHazardRead([ran('get_climate_intel')])).toBe(true);
    expect(HAZARD_CLIMATE_TOOLS.has('get_water_risk')).toBe(false);
  });

  it('no hint without a bound place (no place, a bare region, a placeholder step arg)', () => {
    const ex = [ran('get_disaster_risk', 'executed', { lat: '<site lat>', lon: '<site lon>' })];
    expect(daedalmapWildfireHint({ executed: ex })).toBeNull();
    expect(daedalmapWildfireHint({ signals: { coords: null, market: null, state: null }, executed: ex })).toBeNull();
    expect(daedalmapWildfireHint({ signals: {}, geographyScope: { countries: [], regions: [{ region: 'europe' }] }, executed: ex })).toBeNull();
    // A gated hazard step's point does not bind the place either.
    expect(boundLocation({ executed: [ran('get_disaster_risk', 'gated_preview', { lat: 33.4, lon: -112 })] })).toBeNull();
  });

  it('kill switch', () => {
    expect(daedalmapHintEnabled({ DCHUB_DAEDALMAP_HINT: '0' })).toBe(false);
    expect(daedalmapHintEnabled({})).toBe(true);
    expect(daedalmapWildfireHint({ signals: SAC, executed: [ran('get_disaster_risk')], env: { DCHUB_DAEDALMAP_HINT: '0' } })).toBeNull();
    expect(daedalmapWildfireHint({ signals: SAC, executed: [ran('get_disaster_risk')], env: { DCHUB_DAEDALMAP_HINT: 'off' } })).toBeNull();
  });

  it('routing only: no network code, no proxying; no partner or pricing wording', () => {
    const raw = fs.readFileSync(path.join(HERE, '..', 'lib', 'daedalmap-wildfire-hint.mjs'), 'utf8');
    const code = raw.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toMatch(/\bfetch\s*\(|node:http|node:https|callAPI|XMLHttpRequest|\bimport\s*\(/);
    expect(raw).not.toMatch(/partner/i);
    expect(raw).not.toMatch(/\$\d|\bpricing\b|\bper month\b|\bPro plan\b/i);
  });
});

describe('DaedalMap wildfire hint: execute_plan end to end', () => {
  let H, fence;
  // The backend geocoder (GET /api/v1/geocode) places a named market or town for steps that wait on a point
  // (server.mjs _execGeocodePlan). The stub answers it the way the backend does, for the places these tests name.
  const POINTS = { 'sacramento, ca': { lat: 38.5816, lng: -121.4944, label: 'Sacramento, California, United States' },
    'phoenix, az': { lat: 33.4484, lng: -112.074, label: 'Phoenix, Arizona, United States' } };
  const geocode = (p, _req, _body, u) => {
    if (p !== '/api/v1/geocode') return undefined;
    const q = String((u && u.searchParams.get('address')) || '').toLowerCase();
    return POINTS[q] ? { ...POINTS[q], source: 'stub' } : { status: 404, body: { error: 'not found' } };
  };
  beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({ extraRoutes: geocode }); }, 240_000);
  afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

  const plan = async (intent, context, maxSteps, key) => {
    const before = H.hits.length;
    const r = await H.call('/mcp', 'execute_plan', { intent, ...(context ? { context } : {}), ...(maxSteps ? { max_steps: maxSteps } : {}) },
      { 'user-agent': 'test-client', ...(key ? { 'x-api-key': key } : {}) });
    const sc = r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
    const text = r.msg.result.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
    return { sc, text, hits: H.hits.slice(before) };
  };
  const hazardRan = (sc) => sc.executed.filter((e) => e.status === 'executed' && HAZARD_CLIMATE_TOOLS.has(e.tool)).map((e) => e.tool);

  it.each([
    ['Sacramento', 'wildfire and climate risk for a 100 MW data center site near Sacramento, CA'],
    ['Phoenix', 'wildfire and climate risk for a 100 MW data center site near Phoenix, AZ'],
    ['a point', 'wildfire and hazard risk for a data center site at 38.58, -121.49'],
  ])('%s: the answer carries the DaedalMap next step', async (_l, intent) => {
    const { sc, text, hits } = await plan(intent);
    expect(hazardRan(sc).length, 'no hazard step ran: the hint would be absent for another reason').toBeGreaterThan(0);
    expect(sc.answer_guide).toContain(EXACT);
    expect(sc.answer_guide.split(EXACT)).toHaveLength(2);                  // once
    expect(sc.wildfire_next_step).toMatchObject({ name: DAEDALMAP_NAME, text: EXACT, mcp_url: DAEDALMAP_MCP_URL });
    expect(text).toContain(EXACT);
    // Routing only: nothing went to DaedalMap, and the stub backend saw no request for it.
    expect(fence.foreign.filter((u) => /daedalmap/i.test(String(u)))).toEqual([]);
    expect(hits.map((h) => h.path).filter((p) => /daedalmap/i.test(p))).toEqual([]);
  }, 120_000);

  it('a plan with no hazard read (power and fiber in Dallas): no DaedalMap next step', async () => {
    const { sc, text } = await plan('power and fiber for a 50 MW data center site in Dallas');
    expect(sc.executed.filter((e) => e.status === 'executed').length, 'nothing ran: the absence would be vacuous').toBeGreaterThan(0);
    expect(hazardRan(sc)).toEqual([]);
    expect(sc.wildfire_next_step).toBeUndefined();
    expect(text).not.toMatch(/daedalmap/i);
  }, 120_000);

  it('no place bound ("wildfire risk for European markets"): no hazard read runs and no DaedalMap next step', async () => {
    const { sc, text } = await plan('wildfire risk for European markets');
    expect(hazardRan(sc)).toEqual([]);
    expect(sc.wildfire_next_step).toBeUndefined();
    expect(text).not.toMatch(/daedalmap/i);
  }, 120_000);

  it('both hints on one plan (a German site with a grid read and a hazard read): Parcel GPS first, then DaedalMap', async () => {
    // Keyed (Pro), so the grid read returns data in full rather than a gated preview.
    const { sc } = await plan('grid power and seismic hazard for a site at 50.11, 8.68 in Germany', undefined, 8, PRO_KEY);
    expect(sc.parcel_next_step, 'Parcel GPS did not fire: the ordering check would be vacuous ' + JSON.stringify(sc.executed.map((e) => [e.tool, e.status]))).toBeTruthy();
    expect(sc.wildfire_next_step, 'DaedalMap did not fire').toBeTruthy();
    const ip = sc.answer_guide.indexOf(PARCEL), id = sc.answer_guide.indexOf(EXACT);
    expect(ip).toBeGreaterThanOrEqual(0);
    expect(id).toBeGreaterThan(ip);
    expect(sc.answer_guide.split(EXACT)).toHaveLength(2);
    expect(sc.answer_guide.split(PARCEL)).toHaveLength(2);
  }, 120_000);
});
