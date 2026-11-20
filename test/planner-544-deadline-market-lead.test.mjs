// planner-544-deadline-market-lead.test.mjs — planner 5.44 (Grok QA 2026-11-19), pure functions, no network.
//
// "fastest 300 MW data center site near Dallas Texas within 36 months" (keyed /mcp, planner 5.43):
//   * routed to capacity_search: no canvas shortlist, an unscoped ERCOT retirement slice (rows in Bexar County),
//     the fact header's "Queue rows sum 252,698 MW", and an analyze_site input dating the headline 2017;
//   * the headline led with ERCOT's queue-row figure (32.6 months, the same ISO-wide value on all 200 rows) while
//     the fact header said Dallas 37.9 months, past the 36-month deadline, and nothing said so.
// Now a speed superlative WITH a deadline is a one-state time-to-power siting question (siting_search), and a
// power-timing answer about a market the question named leads with that market's DCPI time to power, says which
// side of the deadline it falls, and names the canvas markets ranked for the state.
import { describe, it, expect } from 'vitest';
import { _planQuery, _scrubDcpiProse, PLANNER_VERSION } from '../server.mjs';
import { buildIntentAnswer, canvasMarkets, TTP_MARKET_FIELD } from '../lib/intent-answers.mjs';

const DAL = 'fastest 300 MW data center site near Dallas Texas within 36 months';
const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint]));
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });

const dcpi = (slug, ttp, verdict = 'CAUTION') => ex(1, 'get_market_dcpi_rank', { market_slug: slug },
  { market_slug: slug, verdict, composite_score: 42, time_to_power_months: ttp, computed_at: '2026-11-19T18:30:03Z' });
const canvas = ({ applied = true } = {}) => ex(2, 'site_selection_canvas', { region: 'TX', capacity_mw: 300, max_months: 36 }, {
  applied_filters: { region: 'TX', max_months: applied ? 36 : null }, max_months_applied: applied,
  shortlist: [
    { market: 'Midland–Odessa', slug: 'midland-tx', verdict: 'BUILD' },
    { market: 'Dallas', slug: 'dallas', verdict: 'CAUTION' },
    { market: 'El Paso', slug: 'el-paso', verdict: 'BUILD' },
    { market: 'The Woodlands', slug: 'the-woodlands', verdict: 'CAUTION' },
    { market: 'Odd', slug: 'odd', verdict: null },
  ] });
const queue = ex(3, 'get_refined_queue', { iso: 'ERCOT', state: 'TX', min_mw: 300 }, {
  count_total_matching: 460, source_as_of: '2026-10-31', results: [{ estimated_ttp_months: 32.6 }, { estimated_ttp_months: 32.6 }] });
const ctx = (over = {}) => ({ intent: DAL, intent_class: 'siting_search', constraint_iso: ['ERCOT'], requested_mw: 300,
  deadline_months: 36, named_markets: ['dallas'], state: 'TX', states: ['TX'], ...over });
const NOW = Date.parse('2026-11-19T23:00:00Z');

describe('planner 5.44: routing', () => {
  it('PLANNER_VERSION is 5.44', () => { expect(PLANNER_VERSION).toBe('5.47'); });

  it('the Dallas prompt reads Dallas, the TX canvas at 300 MW / 36 months, search areas and the timeline', () => {
    const p = _planQuery(DAL, {});
    expect(p.intent_class, show(p)).toBe('siting_search');
    expect(tools(p)).toEqual(['get_market_dcpi_rank', 'site_selection_canvas', 'find_sites', 'get_power_availability_timeline']);
    expect(p.recommended_sequence[0].args_hint.market_slug).toBe('dallas');
    const c = p.recommended_sequence.find((s) => s.tool === 'site_selection_canvas');
    expect(c.args_hint).toMatchObject({ region: 'TX', capacity_mw: 300, max_months: 36 });
    for (const t of ['get_retirement_headroom', 'get_refined_queue', 'analyze_site']) expect(tools(p)).not.toContain(t);
  });

  it.each([
    ['how fast can 300 MW near Abilene TX get power', 'capacity_search'],   // one market, no superlative: keeps its class
    ['Fastest grid power in Texas', 'grid_headroom'],                        // superlative, no deadline, no size
    ['fastest 300 MW data center site near Dallas Texas', 'capacity_search'], // superlative, no deadline
  ])('%s keeps %s', (t, cls) => { expect(_planQuery(t, {}).intent_class).toBe(cls); });
});

describe('planner 5.44: the answer leads with the named market and the deadline', () => {
  it('Dallas past the deadline: its own figure, the miss, and the TX canvas markets without Dallas', () => {
    const a = buildIntentAnswer(ctx(), [dcpi('dallas', 37.9), canvas(), queue], null, NOW);
    expect(a.headline).toContain('Dallas DCPI time-to-power 37.9 months');
    expect(a.headline).toContain('That is past the 36-month deadline asked.');
    expect(a.headline).toContain('Markets DCPI-ranked for TX within 36 months (site_selection_canvas): Midland–Odessa (BUILD), El Paso (BUILD), The Woodlands (CAUTION).');
    expect(a.headline).not.toContain('32.6');
    expect(a.time_to_power_basis).toEqual({ field: TTP_MARKET_FIELD, scope: 'market', market: 'dallas' });
    expect(a.evidence.join(' ')).toContain('That is a different series from the headline figure');
  });

  it('within the deadline says so', () => {
    const a = buildIntentAnswer(ctx(), [dcpi('dallas', 30.1), canvas()], null, NOW);
    expect(a.headline).toContain('That is within the 36-month deadline asked.');
  });

  it('a canvas that did not apply the cut is not called "within 36 months", and the answer says so', () => {
    const a = buildIntentAnswer(ctx(), [dcpi('dallas', 37.9), canvas({ applied: false })], null, NOW);
    expect(a.headline).toContain('Markets DCPI-ranked for TX (site_selection_canvas)');
    expect(a.headline).not.toContain('within 36 months');
    expect(a.not_established.join(' ')).toContain('36-month cut was not applied');
  });

  it('a DCPI read of a market the question did not name does not lead (queue figure as before)', () => {
    const a = buildIntentAnswer(ctx({ named_markets: [] }), [dcpi('dallas', 37.9), queue], null, NOW);
    expect(a.headline).toContain('estimated time-to-power 32.6 months');
    expect(a.headline).not.toContain('deadline asked');
  });

  it('below Pro the prose scrub withholds the figure AND the deadline comparison', () => {
    const a = buildIntentAnswer(ctx(), [dcpi('dallas', 37.9), canvas()], null, NOW);
    const s = _scrubDcpiProse(a.headline);
    expect(s).not.toContain('37.9');
    expect(s).not.toMatch(/\b(?:past|within) the 36-month deadline/);
    expect(s).toContain('Whether it meets the 36-month deadline asked is withheld at this access level.');
    expect(s).toContain('Midland–Odessa (BUILD)');
  });

  it('canvasMarkets: no canvas or no verdict rows is null', () => {
    expect(canvasMarkets([])).toBe(null);
    expect(canvasMarkets([{ tool: 'site_selection_canvas', args: {}, p: { shortlist: [{ market: 'X', verdict: null }] } }])).toBe(null);
  });
});
