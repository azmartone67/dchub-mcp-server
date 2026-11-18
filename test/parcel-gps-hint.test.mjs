// parcel-gps-hint.test.mjs — execute_plan names Parcel GPS for a European site's parcel polygon
// (owner agreed 2026-11-18, lib/parcel-gps-hint.mjs). Pure cases first, then execute_plan end to end on a
// real server.mjs with a stub backend (no static import of server.mjs: the harness sets the backend base
// before importing it).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PARCEL_GPS_HINT, PARCEL_GPS_MCP_URL, PARCEL_GPS_COUNTRIES, parcelGpsHint, europeanSiteCountry,
  hasPowerOrFiberRead, parcelGpsHintEnabled,
} from '../lib/parcel-gps-hint.mjs';
import { isNonUsMarket } from '../lib/country-scope.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXACT = 'For the official parcel polygon and cadastral reference, use Parcel GPS (https://mcp.parcelgps.com/mcp).';
const ran = (tool, status = 'executed') => ({ step: 1, tool, status, result: {} });

describe('parcel GPS hint: pure', () => {
  it('the sentence is the owner\'s exact wording', () => {
    expect(PARCEL_GPS_HINT).toBe(EXACT);
    expect(PARCEL_GPS_MCP_URL).toBe('https://mcp.parcelgps.com/mcp');
  });

  it('a European country scope with a power or fiber read earns the hint', () => {
    for (const [cc, tool] of [['ES', 'get_metro_fiber'], ['DE', 'get_grid_data'], ['FR', 'get_fiber_intel'], ['SE', 'get_energy_prices']]) {
      const h = parcelGpsHint({ geographyScope: { countries: [{ country: cc }] }, executed: [ran(tool)] });
      expect(h, cc).not.toBeNull();
      expect(h.sentence).toBe(EXACT);
      expect(h.field).toMatchObject({ name: 'Parcel GPS', mcp_url: PARCEL_GPS_MCP_URL, country: cc, text: EXACT });
    }
  });

  it('a tracked non-US market (Frankfurt, Madrid) is read as its country', () => {
    expect(europeanSiteCountry({ outlook: { slug: 'frankfurt', iso: 'ENTSOE-DE', state: 'DE' }, isNonUsMarket })).toBe('DE');
    expect(europeanSiteCountry({ outlook: { slug: 'madrid', iso: 'ENTSOE-ES', state: ['ES'] }, isNonUsMarket })).toBe('ES');
    // Delaware is DE too, on a US grid: not Germany.
    expect(europeanSiteCountry({ outlook: { slug: 'wilmington-de', iso: 'PJM', state: 'DE' }, isNonUsMarket })).toBeNull();
  });

  it('no hint without a power or fiber read that returned data', () => {
    const scope = { countries: [{ country: 'ES' }] };
    expect(parcelGpsHint({ geographyScope: scope, executed: [ran('search_facilities'), ran('source_capacity')] })).toBeNull();
    expect(parcelGpsHint({ geographyScope: scope, executed: [ran('get_grid_data', 'no_data')] })).toBeNull();
    expect(parcelGpsHint({ geographyScope: scope, executed: [ran('get_metro_fiber', 'gated_preview')] })).toBeNull();
    expect(parcelGpsHint({ geographyScope: scope, executed: [] })).toBeNull();
    expect(hasPowerOrFiberRead([ran('get_fiber_readiness')])).toBe(true);
  });

  it('no hint for a US site, a country outside the coverage list, or a region with no site', () => {
    const ex = [ran('get_grid_intelligence')];
    expect(parcelGpsHint({ executed: ex, intent: 'power and fiber for a 50 MW site in Dallas' })).toBeNull();
    expect(parcelGpsHint({ geographyScope: { countries: [{ country: 'JP' }] }, executed: ex })).toBeNull();
    expect(parcelGpsHint({ geographyScope: { countries: [], regions: [{ region: 'europe' }] }, executed: ex })).toBeNull();
  });

  it('the UK counts only for Scotland (partial coverage there, none elsewhere)', () => {
    const scope = { countries: [{ country: 'GB' }] };
    const ex = [ran('get_grid_data')];
    expect(parcelGpsHint({ geographyScope: scope, executed: ex, intent: 'power for a site near London, UK' })).toBeNull();
    expect(parcelGpsHint({ geographyScope: scope, executed: ex, intent: 'power for a site near Glasgow, Scotland' })).not.toBeNull();
    expect(PARCEL_GPS_COUNTRIES.has('GB')).toBe(false);
    expect(PARCEL_GPS_COUNTRIES.has('SE')).toBe(true);
  });

  it('kill switch', () => {
    expect(parcelGpsHintEnabled({ DCHUB_PARCEL_GPS_HINT: '0' })).toBe(false);
    expect(parcelGpsHintEnabled({})).toBe(true);
    expect(parcelGpsHint({ geographyScope: { countries: [{ country: 'ES' }] }, executed: [ran('get_metro_fiber')],
      env: { DCHUB_PARCEL_GPS_HINT: 'off' } })).toBeNull();
  });

  it('routing only: the module makes no network call and never proxies', () => {
    const src = fs.readFileSync(path.join(HERE, '..', 'lib', 'parcel-gps-hint.mjs'), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(src).not.toMatch(/\bfetch\s*\(|node:http|node:https|callAPI|XMLHttpRequest|\bimport\s*\(/);
  });
});

describe('parcel GPS hint: execute_plan end to end', () => {
  let H, fence;
  beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({}); }, 240_000);
  afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

  const plan = async (intent) => {
    const before = H.hits.length;
    const r = await H.call('/mcp', 'execute_plan', { intent }, { 'user-agent': 'test-client' });
    const sc = r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
    const text = r.msg.result.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
    return { sc, text, hits: H.hits.slice(before) };
  };
  const powerOrFiberRan = (sc) => sc.executed.filter((e) => e.status === 'executed'
    && /grid|fiber|energy|power/.test(e.tool)).map((e) => e.tool);

  it.each([
    ['Madrid', 'power and fiber for a 50 MW data center site in Madrid'],
    ['Frankfurt', 'power and fiber for a 50 MW data center site in Frankfurt'],
  ])('%s: the answer carries the Parcel GPS next step', async (_l, intent) => {
    const { sc, text, hits } = await plan(intent);
    expect(powerOrFiberRan(sc).length, 'no power or fiber step ran: the hint would be absent for another reason')
      .toBeGreaterThan(0);
    expect(sc.answer_guide).toContain(EXACT);
    expect(sc.answer_guide.split(EXACT)).toHaveLength(2);                 // once
    expect(sc.parcel_next_step).toMatchObject({ name: 'Parcel GPS', text: EXACT, mcp_url: PARCEL_GPS_MCP_URL });
    expect(text).toContain(EXACT);
    // Routing only: nothing went to Parcel GPS, and the stub backend saw no parcel request for it.
    expect(fence.foreign.filter((u) => /parcelgps/i.test(String(u)))).toEqual([]);
    expect(hits.map((h) => h.path).filter((p) => /parcelgps/i.test(p))).toEqual([]);
  }, 120_000);

  it('US site (Dallas): no Parcel GPS next step', async () => {
    const { sc, text } = await plan('power and fiber for a 50 MW data center site in Dallas');
    expect(powerOrFiberRan(sc).length, 'no power or fiber step ran: the absence would be vacuous').toBeGreaterThan(0);
    expect(sc.parcel_next_step).toBeUndefined();
    expect(text).not.toMatch(/parcelgps|Parcel GPS/i);
  }, 120_000);
});
