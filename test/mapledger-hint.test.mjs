// mapledger-hint.test.mjs — execute_plan names MapLedger for a plan in Austin or Nashville with a power or grid read
// (owner 2026-11-23, lib/mapledger-hint.mjs). Pure cases first, then execute_plan end to end on a real server.mjs with
// a stub backend. Same shape as test/parcel-gps-hint.test.mjs and test/daedalmap-wildfire-hint.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAPLEDGER_HINT, MAPLEDGER_MCP_URL, MAPLEDGER_DOCS_URL, MAPLEDGER_NAME, POWER_GRID_TOOLS,
  mapledgerHint, coveredPlace, hasPowerRead, mapledgerHintEnabled, cityAtPoint,
} from '../lib/mapledger-hint.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXACT = 'For parcel zoning, flood and tax context at this site, use MapLedger (https://mapledger.app/mcp; it covers Austin, TX and Nashville, TN). Agents call MapLedger directly; DC Hub does not proxy it.';
const ran = (tool, status = 'executed', args = {}) => ({ step: 1, tool, status, args, result: {} });
const AUS = { __citySlug: 'austin-tx', stateFromPlace: 'TX' };

describe('MapLedger hint: pure', () => {
  it('the sentence and constants', () => {
    expect(MAPLEDGER_HINT).toBe(EXACT);
    expect(MAPLEDGER_NAME).toBe('MapLedger');
    expect(MAPLEDGER_MCP_URL).toBe('https://mapledger.app/mcp');
    // MapLedger's cross-link, utm_medium=referral (owner, 2026-11-24; was partner as MapLedger sent it).
    expect(MAPLEDGER_DOCS_URL).toBe('https://mapledger.app/docs?utm_source=dchub&utm_medium=referral&utm_campaign=mcp_crosslink#agents');
  });

  it('Austin and Nashville, by slug or by point, with a power read, earn the hint', () => {
    for (const tool of ['get_grid_intelligence', 'get_interconnection_queue', 'get_power_availability_timeline']) {
      const h = mapledgerHint({ signals: AUS, executed: [ran(tool)] });
      expect(h, tool).not.toBeNull();
      expect(h.sentence).toBe(EXACT);
      expect(h.field).toMatchObject({ name: 'MapLedger', text: EXACT, mcp_url: MAPLEDGER_MCP_URL, city: 'Austin, TX',
        location: { kind: 'market', value: 'austin-tx' } });
    }
    const ex = [ran('get_grid_data')];
    expect(mapledgerHint({ signals: { __citySlug: 'nashville-tn' }, executed: ex }).field.city).toBe('Nashville (Davidson County), TN');
    expect(mapledgerHint({ signals: { market: 'nashville' }, executed: ex })).not.toBeNull();
    expect(mapledgerHint({ signals: { __outlook: { slug: 'austin' } }, executed: ex })).not.toBeNull();
    expect(mapledgerHint({ signals: { coords: { lat: 30.2672, lon: -97.7431 } }, executed: ex }).field.location)
      .toEqual({ kind: 'point', value: '30.2672,-97.7431' });
    expect(mapledgerHint({ signals: {}, executed: [ran('get_grid_intelligence', 'executed', { lat: 36.1627, lon: -86.7816 })] }).field.city)
      .toBe('Nashville (Davidson County), TN');
  });

  it('no hint outside the two cities: Dallas, Houston, a Texas state alone, Denver (map pages only), a point elsewhere', () => {
    const ex = [ran('get_grid_intelligence')];
    expect(mapledgerHint({ signals: { __citySlug: 'dallas-tx' }, executed: ex })).toBeNull();
    expect(mapledgerHint({ signals: { market: 'houston' }, executed: ex })).toBeNull();
    expect(mapledgerHint({ signals: { stateFromPlace: 'TX', state: 'TN' }, executed: ex })).toBeNull();
    expect(mapledgerHint({ signals: { market: 'denver' }, executed: ex })).toBeNull();
    expect(mapledgerHint({ signals: { coords: { lat: 32.78, lon: -96.8 } }, executed: ex })).toBeNull();     // Dallas point
    // A stated point outside both boxes wins over an Austin slug.
    expect(coveredPlace({ signals: { coords: { lat: 32.78, lon: -96.8 }, __citySlug: 'austin-tx' } })).toBeNull();
    expect(cityAtPoint(30.2672, -97.7431)).toBe('austin');
    expect(cityAtPoint(36.1627, -86.7816)).toBe('nashville');
    expect(cityAtPoint(29.76, -95.37)).toBeNull();
  });

  it('no hint without a power or grid read that returned data', () => {
    expect(mapledgerHint({ signals: AUS, executed: [ran('get_disaster_risk'), ran('search_facilities'), ran('get_metro_fiber')] })).toBeNull();
    expect(mapledgerHint({ signals: AUS, executed: [ran('get_grid_intelligence', 'gated_preview')] })).toBeNull();
    expect(mapledgerHint({ signals: AUS, executed: [ran('get_interconnection_queue', 'failed')] })).toBeNull();
    expect(mapledgerHint({ signals: AUS, executed: [ran('get_grid_data', 'no_data')] })).toBeNull();
    expect(mapledgerHint({ signals: AUS, executed: [] })).toBeNull();
    expect(hasPowerRead([ran('get_refined_queue')])).toBe(true);
    expect(POWER_GRID_TOOLS.has('get_metro_fiber')).toBe(false);
  });

  it('kill switch', () => {
    expect(mapledgerHintEnabled({ DCHUB_MAPLEDGER_HINT: '0' })).toBe(false);
    expect(mapledgerHintEnabled({})).toBe(true);
    expect(mapledgerHint({ signals: AUS, executed: [ran('get_grid_data')], env: { DCHUB_MAPLEDGER_HINT: 'off' } })).toBeNull();
  });

  it('routing only: no network code; no partner or pricing wording outside MapLedger\'s own link', () => {
    const raw = fs.readFileSync(path.join(HERE, '..', 'lib', 'mapledger-hint.mjs'), 'utf8');
    const code = raw.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toMatch(/\bfetch\s*\(|node:http|node:https|callAPI|XMLHttpRequest|\bimport\s*\(/);
    expect(raw.replace(/https?:\/\/[^\s'"]+/g, '')).not.toMatch(/partner/i);
    expect(raw).not.toMatch(/\$\d|\bpricing\b|\bper month\b|\bPro plan\b|\bfree\b/i);
  });
});

describe('MapLedger hint: execute_plan end to end', () => {
  let H, fence;
  const POINTS = { 'austin, tx': { lat: 30.2672, lng: -97.7431, label: 'Austin, Texas, United States' },
    'nashville, tn': { lat: 36.1627, lng: -86.7816, label: 'Nashville, Tennessee, United States' },
    'dallas, tx': { lat: 32.7767, lng: -96.797, label: 'Dallas, Texas, United States' } };
  const geocode = (p, _req, _body, u) => {
    if (p !== '/api/v1/geocode') return undefined;
    const q = String((u && u.searchParams.get('address')) || '').toLowerCase();
    return POINTS[q] ? { ...POINTS[q], source: 'stub' } : { status: 404, body: { error: 'not found' } };
  };
  beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({ extraRoutes: geocode }); }, 240_000);
  afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

  // Keyed (Pro), so the power reads return data in full rather than a gated preview (a gated read earns no hint).
  const plan = async (intent) => {
    const before = H.hits.length;
    const r = await H.call('/mcp', 'execute_plan', { intent }, { 'user-agent': 'test-client', 'x-api-key': PRO_KEY });
    const sc = r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
    const text = r.msg.result.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
    return { sc, text, hits: H.hits.slice(before) };
  };
  const powerRan = (sc) => sc.executed.filter((e) => e.status === 'executed' && POWER_GRID_TOOLS.has(e.tool)).map((e) => e.tool);

  it.each([
    ['Austin', 'power and interconnection queue for a 50 MW data center site in Austin, TX'],
    ['Nashville', 'power and interconnection queue for a 50 MW data center site in Nashville, TN'],
  ])('%s: the answer carries the MapLedger next step', async (_l, intent) => {
    const { sc, text, hits } = await plan(intent);
    expect(powerRan(sc).length, 'no power step ran: the hint would be absent for another reason ' + JSON.stringify(sc.executed.map((e) => [e.tool, e.status]))).toBeGreaterThan(0);
    expect(sc.answer_guide).toContain(EXACT);
    expect(sc.answer_guide.split(EXACT)).toHaveLength(2);                 // once
    expect(sc.parcel_zoning_next_step).toMatchObject({ name: 'MapLedger', text: EXACT, mcp_url: MAPLEDGER_MCP_URL });
    expect(text).toContain(EXACT);
    // Routing only: nothing went to MapLedger, and the stub backend saw no request for it.
    expect(fence.foreign.filter((u) => /mapledger/i.test(String(u)))).toEqual([]);
    expect(hits.map((h) => h.path).filter((p) => /mapledger/i.test(p))).toEqual([]);
  }, 120_000);

  it('Dallas: a power plan outside the two cities gets no MapLedger next step', async () => {
    const { sc, text } = await plan('power and interconnection queue for a 50 MW data center site in Dallas, TX');
    expect(powerRan(sc).length, 'no power step ran: the absence would be vacuous').toBeGreaterThan(0);
    expect(sc.parcel_zoning_next_step).toBeUndefined();
    expect(text).not.toMatch(/mapledger/i);
  }, 120_000);
});
