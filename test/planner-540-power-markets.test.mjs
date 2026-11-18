// planner-540-power-markets.test.mjs — planner 5.40 follow-up (Grok 1118 item 2). Pure functions, no network.
//
// Keyless "Which US markets have the most available grid power for a 100 MW data center campus running Llama
// inference, and what does the interconnection queue look like?" routed to interconnection_queue (queue 6 vs
// grid_headroom 2.5): two ISO-wide queue reads, analyze_site skipped, no market named. A where-is-power-available
// ranking with no place named now takes the capacity_grid shortlist (DCPI-ranked markets, then each finalist grid's
// queue and headroom), without the Capacity Source step since nothing was asked to buy or lease.
import { describe, it, expect } from 'vitest';
import { _planQuery } from '../server.mjs';
import { powerMarketsAsk, capacityGridSequence } from '../lib/cross-domain-answer.mjs';

const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint]));

const Q_GROK = 'Which US markets have the most available grid power for a 100 MW data center campus running Llama inference, and what does the interconnection queue look like?';

describe('planner: markets with the most available power', () => {
  it('Grok 1118: ranks markets by DCPI first, then reads each finalist grid\'s queue and headroom', () => {
    const p = _planQuery(Q_GROK, {});
    expect(p.intent_class, show(p)).toBe('capacity_grid');
    expect(tools(p)).toEqual(['site_selection_canvas', 'get_interconnection_queue', 'get_grid_intelligence']);
    expect(p.recommended_sequence[0].args_hint).toMatchObject({ capacity_mw: 100 });
    expect(p.recommended_sequence[1].depends_on).toEqual([1]);
  });

  it('no size and no queue words still ranks markets, not ISOs', () => {
    expect(_planQuery('Which markets have the most available power for a data center?', {}).intent_class).toBe('capacity_grid');
    expect(_planQuery('Where is power available for a 200 MW AI campus?', {}).intent_class).toBe('capacity_grid');
  });

  it('a capacity ask keeps its Capacity Source step', () => {
    const p = _planQuery('Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what do grid headroom and the interconnection queue look like there?', {});
    expect(p.intent_class).toBe('capacity_grid');
    expect(tools(p)).toContain('source_capacity');
    expect(capacityGridSequence({ mw: 50 }).map((s) => s.tool)).toContain('source_capacity');
    expect(capacityGridSequence({ mw: 50, __powerMarkets: true }).map((s) => s.tool)).not.toContain('source_capacity');
  });

  it('leaves the neighbouring asks where they were', () => {
    expect(_planQuery('What does the PJM interconnection queue look like?', {}).intent_class).toBe('interconnection_queue');
    expect(_planQuery('How much power is available in ERCOT?', {}).intent_class).toBe('grid_headroom');
    expect(_planQuery('rank markets for a 200MW AI campus', {}).intent_class).toBe('market_ranking');
    expect(_planQuery('What grid headroom and interconnection queue is there for a 100 MW data center campus near Columbus, Ohio?', {}).intent_class).toBe('dc_power_place');
  });

  it('powerMarketsAsk needs an availability ask, a data-center load and a "where", and no place', () => {
    expect(powerMarketsAsk(Q_GROK, {})).toBe(true);
    expect(powerMarketsAsk('Which states have the most available power plants for a data center?', {})).toBe(false);
    expect(powerMarketsAsk('Which markets have the most available power?', {})).toBe(false);          // no data-center load
    expect(powerMarketsAsk('Is power available for a data center campus?', {})).toBe(false);          // no "where"
    expect(powerMarketsAsk(Q_GROK, { state: 'TX' })).toBe(false);                                      // a place is bound
    expect(powerMarketsAsk(Q_GROK, { iso: 'PJM' })).toBe(false);
  });
});
