// planner-530-one-state-ttp.test.mjs — planner 5.30 (Grok QA v2.12.59, 2026-11-16), pure functions, no network.
//
// "100 MW data center in Eagle Mountain or Salt Lake City, Utah: what is the time to power and are there
// faster sites?" routed to capacity_search: it minted salt-lake-city alone (Eagle Mountain never read), ran
// no time-to-power step, and cut a national 3-row retirement slice to 0 UT rows. A one-state siting question
// that asks time to power and names two or more markets (or asks for faster sites) now routes to
// siting_search, which reads every named market's DCPI card first; a Utah retirement read takes PACE.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _planSitingEligible, _STATE_RETIREMENT_BA, PLANNER_VERSION } from '../server.mjs';

const UT = '100 MW data center in Eagle Mountain or Salt Lake City, Utah: what is the time to power and are there faster sites?';
const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint]));

describe('planner 5.30: one state, time to power', () => {
  it('PLANNER_VERSION is 5.30 or later (5.31)', () => { expect(PLANNER_VERSION).toBe('5.53'); });

  it('the Utah prompt reads both named markets, the state canvas, search areas and the timeline', () => {
    const p = _planQuery(UT, {});
    expect(p.intent_class, show(p)).toBe('siting_search');
    const dcpi = p.recommended_sequence.filter((s) => s.tool === 'get_market_dcpi_rank').map((s) => s.args_hint.market_slug);
    expect(dcpi, show(p)).toEqual(['eagle-mountain', 'salt-lake-city']);
    expect(tools(p)).toEqual(['get_market_dcpi_rank', 'get_market_dcpi_rank', 'site_selection_canvas', 'find_sites',
      'get_power_availability_timeline']);
    const canvas = p.recommended_sequence.find((s) => s.tool === 'site_selection_canvas');
    expect(canvas.args_hint.region).toBe('UT');
    expect(p.recommended_sequence.map((s) => s.step)).toEqual([1, 2, 3, 4, 5]);
    expect(tools(p)).not.toContain('get_retirement_headroom');
  });

  it('signals carry every named market, first-named first', () => {
    expect(_planSignals(UT, {}).__namedMarkets).toEqual(['eagle-mountain', 'salt-lake-city']);
    expect(_planSignals('time to power in Eagle Mountain, Utah', {}).__namedMarkets).toEqual(['eagle-mountain']);
  });

  it('"faster sites" with one market also qualifies, the state read from "Dallas, TX"', () => {
    const p = _planQuery('50 MW data center in Dallas, TX: time to power, any faster sites?', {});
    expect(p.intent_class, show(p)).toBe('siting_search');
    expect(p.recommended_sequence[0]).toMatchObject({ tool: 'get_market_dcpi_rank', args_hint: { market_slug: 'dallas' } });
    expect(p.recommended_sequence.find((s) => s.tool === 'site_selection_canvas').args_hint.region).toBe('TX');
  });

  it.each([
    ['one market, no faster ask', 'How fast can a 300 MW data center near Abilene TX get power?'],
    ['no time-to-power ask', 'find 100 MW in Eagle Mountain or Salt Lake City, Utah'],
    ['no size', 'Eagle Mountain or Salt Lake City, Utah: what is the time to power?'],
  ])('keeps its class: %s', (_label, q) => {
    expect(_planQuery(q, {}).intent_class).not.toBe('siting_search');
  });

  it('eligibility is pure and never throws', () => {
    expect(_planSitingEligible(UT, null)).toBe(false);
    expect(_planSitingEligible(UT, { mw: 100, states: ['UT'], __namedMarkets: ['a', 'b'] })).toBe(true);
    expect(_planSitingEligible(UT, { mw: 100, states: ['UT'], __namedMarkets: 'x' })).toBe(true);   // "faster" in text
    expect(_planSitingEligible('time to power', { mw: 100, states: ['UT'], __namedMarkets: ['a'] })).toBe(false);
  });

  it('a several-state fan-out reads no market cards (5.29 unchanged)', () => {
    const p = _planQuery('Texas or Arizona, 100 MW by 2028', {});
    expect(p.intent_class).toBe('siting_search');
    expect(tools(p)).not.toContain('get_market_dcpi_rank');
  });

  it('Utah and Wyoming retirement reads take PacifiCorp East; Nevada unchanged', () => {
    expect(_STATE_RETIREMENT_BA).toMatchObject({ NV: 'NEVP', UT: 'PACE', WY: 'PACE' });
  });
});
