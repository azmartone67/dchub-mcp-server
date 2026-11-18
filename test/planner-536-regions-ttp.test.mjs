// planner-536-regions-ttp.test.mjs — planner 5.36 (Grok QA 2026-11-17, western PA), pure functions, no network.
//
// "where in western Pennsylvania can I get 300 MW of power for a data center, and how soon" minted iso PJM
// alone: capacity_search ran the retirement and queue reads, its market step stayed on the
// "<the market named in the intent>" placeholder (skipped_unresolved) and no time-to-power step ran.
// A region of one state now routes to siting_search with the region's market card and find_sites over the
// region; "how soon" after the size counts; an unbound market placeholder covers no constraint.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _planRegionScope, PLANNER_VERSION } from '../server.mjs';

const WPA = 'where in western Pennsylvania can I get 300 MW of power for a data center, and how soon';
const seq = (p) => p.recommended_sequence.map((s) => [s.tool, s.args_hint]);
const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const show = (p) => JSON.stringify(seq(p));

describe('planner 5.36: regions and time to power', () => {
  it('PLANNER_VERSION is 5.37', () => { expect(PLANNER_VERSION).toBe('5.37'); });

  it('western Pennsylvania reads PA, PJM, Pittsburgh and the region point', () => {
    for (const q of [WPA, 'how soon can I get 300 MW in western PA']) {
      const d = _planSignals(q, {});
      expect(d.stateFromPlace, q).toBe('PA');
      expect(d.isoFromPlace, q).toBe('PJM');
      expect(d.__namedMarkets, q).toEqual(['pittsburgh-pa']);
      expect(d.placeScope, q).toMatchObject({ basis: 'corridor_table', radius_km: 150 });
      expect(_planRegionScope(d), q).toBe(true);
    }
    // "PA" alone, or "Pennsylvania", is not the western region.
    expect(_planSignals('300 MW in Pennsylvania', {}).placeScope || null).toBeNull();
    expect(_planSignals('upgrade the pa system', {}).__namedMarkets || []).toEqual([]);
  });

  it('the Grok prompt routes to siting_search: Pittsburgh card, PA canvas, region find_sites, PA timeline', () => {
    const p = _planQuery(WPA, {});
    expect(p.intent_class, show(p)).toBe('siting_search');
    expect(tools(p), show(p)).toEqual(['get_market_dcpi_rank', 'site_selection_canvas', 'find_sites',
      'get_power_availability_timeline']);
    expect(p.recommended_sequence[0].args_hint).toEqual({ market_slug: 'pittsburgh-pa' });
    expect(p.recommended_sequence.find((s) => s.tool === 'site_selection_canvas').args_hint.region).toBe('PA');
    expect(p.recommended_sequence.find((s) => s.tool === 'find_sites').args_hint).toEqual({ lat: 40.7, lon: -79.7, radius_km: 150 });
    expect(p.recommended_sequence.find((s) => s.tool === 'get_power_availability_timeline').args_hint.state).toBe('PA');
    expect(JSON.stringify(seq(p))).not.toMatch(/<the market named/);
  });

  it('a state-wide time-to-power ask adds the power timeline (no market to bind)', () => {
    for (const q of ['how soon can I get 100 MW in Pennsylvania', '300 MW data center in Pennsylvania, time to power?']) {
      const p = _planQuery(q, {});
      const tl = p.recommended_sequence.find((s) => s.tool === 'get_power_availability_timeline');
      expect(tl, q + ' ' + show(p)).toBeTruthy();
      expect(tl.args_hint.state).toBe('PA');
    }
  });

  it('a named market still covers time to power: no extra timeline step', () => {
    const p = _planQuery('how soon can I get 100 MW in Pittsburgh', {});
    expect(tools(p).filter((t) => t === 'get_power_availability_timeline'), show(p)).toEqual([]);
    const d = _planSignals('how soon can I get 100 MW in Pittsburgh', {});
    expect(d.__outlook && d.__outlook.slug).toBe('pittsburgh');      // the placeholder binds at execution
  });

  it('Southern Nevada (a 50 km region) with time to power also routes to siting_search', () => {
    const p = _planQuery('where can I build 100 MW in Southern Nevada and how soon', {});
    expect(p.intent_class, show(p)).toBe('siting_search');
    expect(p.recommended_sequence.find((s) => s.tool === 'find_sites').args_hint).toMatchObject({ radius_km: 50 });
  });

  it('a city corridor (under 50 km) is not a region; an operator-phrased ERCOT ask is unchanged', () => {
    expect(_planRegionScope(_planSignals('100 MW in Secaucus, NJ, how soon', {}))).toBe(false);
    expect(_planQuery('how soon can a 100 MW load get power in ERCOT', {}).intent_class).toBe('grid_headroom');
  });
});
