// Grok 2026-10-07: keyless get_dchub_recommendation listed 3 of 4 categories behind
// `_available_categories_total_in_pro`, hiding `technical`. The menu is DC Hub's own description.
// Grok QA 2026-11-13: `next_tools` (the tools to call instead, with example arguments) was
// trimmed the same way. Live keyless, context "where should I build 100 MW in Texas":
//   next_tools[0].example = {capacity_mw: null, max_months: null, _max_months_withheld: true, region: 'TX'}
//   3 rows shown, `_next_tools_total_available: 4` (analyze_site hidden)
// The backend sends {capacity_mw: 100, region: 'TX', max_months: 24} and four rows. An example
// call is guidance, not data: the agent needs the whole of it to make the call.
import { describe, it, expect } from 'vitest';
import { trimForTrial } from '../server.mjs';

const body = () => ({ available_categories: ['general', 'investment', 'site-selection', 'technical'], other: ['a', 'b', 'c', 'd'] });

// The backend's next_tools, verbatim (dchub-backend main.py api_agents_recommend).
const NEXT_TOOLS = () => [
  { tool: 'site_selection_canvas', use_for: 'an end-to-end ranked shortlist from capacity + geography + deadline',
    example: { capacity_mw: 100, region: 'TX', max_months: 24 } },
  { tool: 'rank_markets', use_for: 'markets ranked by a named criterion', example: { limit: 10 } },
  { tool: 'get_market_dcpi_rank', use_for: 'the DCPI verdict and score for one named market', example: { market: 'dallas' } },
  { tool: 'analyze_site', use_for: 'one specific parcel, when you already have coordinates', example: { lat: 32.78, lon: -96.80 } },
];
const missBody = () => ({ context_understood: false, is_generic_answer: true, next_tools: NEXT_TOOLS() });

describe('trimForTrial on get_dchub_recommendation', () => {
  it('keeps all four categories and adds no paywall marker for them', () => {
    const r = trimForTrial(body(), 'get_dchub_recommendation');
    expect(r.available_categories).toHaveLength(4);
    expect(r._available_categories_total_in_pro).toBeUndefined();
  });
  it('still trims other long lists (the carve-out is one key on one tool)', () => {
    expect(trimForTrial(body(), 'get_dchub_recommendation').other).toHaveLength(3);
    expect(trimForTrial(body(), 'rank_markets').available_categories).toHaveLength(3);
  });
  it('keeps every next_tools row and every example argument, with no withheld marker', () => {
    const r = trimForTrial(missBody(), 'get_dchub_recommendation');
    expect(r.next_tools).toEqual(NEXT_TOOLS());
    expect(r._next_tools_total_in_pro).toBeUndefined();
    expect(r.next_tools[0].example).toEqual({ capacity_mw: 100, region: 'TX', max_months: 24 });
    expect(JSON.stringify(r)).not.toMatch(/_withheld|_in_pro/);
  });
  it('control: the same list on another tool is trimmed and its figures withheld', () => {
    // Without the carve-out this is what the agent got: proves the test above can fail.
    const r = trimForTrial(missBody(), 'rank_markets');
    expect(r.next_tools).toHaveLength(3);
    expect(r._next_tools_total_in_pro).toBe(4);
    const ex = r.next_tools[0].example;
    expect(ex.capacity_mw === 100 && ex.max_months === 24).toBe(false);
  });
});
