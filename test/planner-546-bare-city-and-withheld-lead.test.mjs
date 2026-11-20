// planner-546-bare-city-and-withheld-lead.test.mjs — planner 5.46 (conductor live check 2026-11-20), pure functions, no network.
//
// Two gaps in 5.44 (planner-544-deadline-market-lead.test.mjs), found live on 5.45:
//   1. "fastest place to get 300 MW within 18 months near Dallas" names no state, so _planOneStateTtpSiting had no
//      state and the plan fell to capacity_search (ERCOT-wide headline, retirement slice, queue rows). Only wordings
//      that named Texas reached siting_search. The state now comes from the one market the text binds (dallas -> TX).
//   2. A keyless get_market_dcpi_rank withholds time_to_power_months, and the market lead required that figure, so a
//      keyless answer led "Time to 300 MW of power for ERCOT (ISO): no time-to-power figure in this read" with no
//      canvas markets and no deadline line. The named market now leads with its figure withheld.
import { describe, it, expect } from 'vitest';
import { _planQuery, _scrubDcpiProse, PLANNER_VERSION } from '../server.mjs';
import { buildIntentAnswer, deadlineWithheld, TTP_MARKET_FIELD } from '../lib/intent-answers.mjs';

const BARE = 'fastest place to get 300 MW within 18 months near Dallas';
const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const show = (p) => JSON.stringify([p.intent_class, p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint])]);
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const NOW = Date.parse('2026-11-20T04:30:00Z');

describe('planner 5.46: a bare city with a deadline and a speed superlative is a one-state siting question', () => {
  it('PLANNER_VERSION is 5.48', () => { expect(PLANNER_VERSION).toBe('5.48'); });

  it.each([
    BARE,
    'where is the quickest 300 MW site near Dallas within 18 months',
    'fastest place to get 300 MW within 18 months near Dallas, TX',
  ])('%s: Dallas card, the TX canvas, TX search areas and the TX timeline', (t) => {
    const p = _planQuery(t, {});
    expect(p.intent_class, show(p)).toBe('siting_search');
    expect(tools(p), show(p)).toEqual(['get_market_dcpi_rank', 'site_selection_canvas', 'find_sites', 'get_power_availability_timeline']);
    expect(p.recommended_sequence[0].args_hint.market_slug).toBe('dallas');
    expect(p.recommended_sequence[1].args_hint).toMatchObject({ region: 'TX', capacity_mw: 300, max_months: 18 });
    expect(p.recommended_sequence[2].args_hint).toMatchObject({ state: 'TX' });
    expect(p.recommended_sequence[3].args_hint).toMatchObject({ state: 'TX', mw: 300 });
    for (const x of ['get_retirement_headroom', 'get_refined_queue', 'analyze_site']) expect(tools(p)).not.toContain(x);
  });

  it.each([
    'fastest place to get 300 MW near Dallas',        // no deadline: keeps its class
    'how fast can 300 MW near Abilene TX get power',  // one market, no superlative
  ])('%s does not become siting_search', (t) => {
    expect(_planQuery(t, {}).intent_class).not.toBe('siting_search');
  });
});

describe('planner 5.46: a named market leads even when its time to power is withheld', () => {
  const dcpi = (ttp) => ex(1, 'get_market_dcpi_rank', { market_slug: 'dallas' },
    { market_slug: 'dallas', verdict: 'CAUTION', composite_score: null, time_to_power_months: ttp, computed_at: '2026-11-20T03:00:00Z' });
  const canvas = ex(2, 'site_selection_canvas', { region: 'TX', capacity_mw: 300, max_months: 18 }, {
    applied_filters: { region: 'TX', max_months: null }, max_months_applied: false,
    shortlist: [{ market: 'Midland–Odessa', slug: 'midland-tx', verdict: 'BUILD' }, { market: 'El Paso', slug: 'el-paso', verdict: 'BUILD' },
      { market: 'The Woodlands', slug: 'the-woodlands', verdict: 'CAUTION' }] });
  const timeline = ex(4, 'get_power_availability_timeline', { state: 'TX' }, { state: 'TX' });
  const ctx = { intent: BARE, intent_class: 'siting_search', constraint_iso: ['ERCOT'], requested_mw: 300,
    deadline_months: 18, named_markets: ['dallas'], state: 'TX', states: ['TX'] };

  it('keyless: Dallas leads with its figure withheld, the deadline line, and the canvas markets', () => {
    const a = buildIntentAnswer(ctx, [dcpi(null), canvas, timeline], null, NOW);
    expect(a.headline).toContain(`Dallas DCPI time-to-power is withheld at this access level (${TTP_MARKET_FIELD}).`);
    expect(a.headline).toContain(deadlineWithheld(18));
    expect(a.headline).toContain('Markets DCPI-ranked for TX (site_selection_canvas): Midland–Odessa (BUILD), El Paso (BUILD), The Woodlands (CAUTION).');
    expect(a.headline).not.toContain('no time-to-power figure in this read');
    expect(a.headline).not.toMatch(/\bThat is (?:past|within)\b/);
    expect(a.time_to_power_basis).toEqual({ field: TTP_MARKET_FIELD, scope: 'market', market: 'dallas', withheld: true });
    expect(a.not_established.join(' ')).toContain('18-month cut was not applied');
  });

  it('the withheld wording is what the prose scrub turns the keyed wording into', () => {
    const keyed = buildIntentAnswer(ctx, [dcpi(19.4), canvas, timeline], null, NOW).headline;
    expect(keyed).toContain('That is past the 18-month deadline asked.');
    expect(_scrubDcpiProse(keyed)).toContain(deadlineWithheld(18));
    const keyless = buildIntentAnswer(ctx, [dcpi(null), canvas, timeline], null, NOW).headline;
    expect(_scrubDcpiProse(keyless)).toBe(keyless);
  });
});
