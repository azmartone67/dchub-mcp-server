// planner-548-market-lead-first.test.mjs — planner 5.51 (owner "fix the rest", 2026-11-20), pure functions, no network.
//
// Live keyless on 5.46/5.47, "fastest place to get 300 MW within 18 months near Dallas": the headline opened
// "Time to 300 MW of power for ERCOT (ISO): Dallas DCPI time-to-power …" and ended "dallas DCPI CAUTION.", which the
// 600-character lead text cut to "…". The named market now leads with its grid and its own verdict.
import { describe, it, expect } from 'vitest';
import { _scrubDcpiProse, PLANNER_VERSION } from '../server.mjs';
import { buildIntentAnswer, deadlineWithheld } from '../lib/intent-answers.mjs';
import { planLeadText, PLAN_LEAD_MAX } from '../lib/plan-lead-text.mjs';

const BARE = 'fastest place to get 300 MW within 18 months near Dallas';
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const NOW = Date.parse('2026-11-20T07:30:00Z');
const dcpi = (ttp) => ex(1, 'get_market_dcpi_rank', { market_slug: 'dallas' },
  { market_slug: 'dallas', verdict: 'CAUTION', composite_score: 42, time_to_power_months: ttp, computed_at: '2026-11-20T03:00:00Z' });
const canvas = ex(2, 'site_selection_canvas', { region: 'TX', capacity_mw: 300, max_months: 18 }, {
  applied_filters: { region: 'TX', max_months: null }, max_months_applied: false,
  shortlist: [{ market: 'Midland–Odessa', slug: 'midland-tx', verdict: 'BUILD' }, { market: 'El Paso', slug: 'el-paso', verdict: 'BUILD' },
    { market: 'The Woodlands', slug: 'the-woodlands', verdict: 'CAUTION' }] });
const timeline = ex(4, 'get_power_availability_timeline', { state: 'TX' }, { state: 'TX' });
const ctx = { intent: BARE, intent_class: 'siting_search', constraint_iso: ['ERCOT'], requested_mw: 300,
  deadline_months: 18, named_markets: ['dallas'], state: 'TX', states: ['TX'] };
const MARKETS = 'Midland–Odessa (BUILD), El Paso (BUILD), The Woodlands (CAUTION).';

describe('planner 5.51: a named market leads the time-to-power headline with its grid and verdict', () => {
  it('PLANNER_VERSION is 5.51', () => { expect(PLANNER_VERSION).toBe('5.52'); });

  it('keyless: Dallas, ERCOT and the verdict lead; no ISO-first lead and no trailing slug verdict', () => {
    const h = buildIntentAnswer(ctx, [dcpi(null), canvas, timeline], null, NOW).headline;
    expect(h.startsWith('Time to 300 MW of power near Dallas (ERCOT), DCPI verdict CAUTION: Dallas DCPI time-to-power is withheld')).toBe(true);
    expect(h).not.toContain('for ERCOT (ISO)');
    expect(h).not.toMatch(/dallas DCPI CAUTION\./);
    expect(h).toContain(deadlineWithheld(18));
    expect(h.endsWith(`${MARKETS} ${deadlineWithheld(18)}`)).toBe(true);   // the deadline line goes last when withheld
    expect(h).not.toContain('(get_market_dcpi_rank.time_to_power_months)');
    expect(_scrubDcpiProse(h)).toBe(h);
  });

  it('keyed: the figure and the deadline line follow the same lead, and the scrub still withholds both below Pro', () => {
    const h = buildIntentAnswer(ctx, [dcpi(37.9), canvas, timeline], null, NOW).headline;
    expect(h).toContain('near Dallas (ERCOT), DCPI verdict CAUTION: Dallas DCPI time-to-power 37.9 months');
    expect(h).toContain('That is past the 18-month deadline asked.');
    const scrubbed = _scrubDcpiProse(h);
    expect(scrubbed).not.toContain('37.9');
    expect(scrubbed).toContain(deadlineWithheld(18));
  });

  it('the 600-character lead text keeps every canvas market under the 5.47 two-date Source line (a cut takes the deadline line)', () => {
    const ia = buildIntentAnswer(ctx, [dcpi(null), canvas, timeline], null, NOW);
    const plan = { _entity: 'plan_execution', intent: BARE, intent_answer: ia, human_message: 'x', executed: [],
      fact_header: 'SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-10-31 | OLDEST_INPUT: TX power availability timeline\nENTITY: Dallas (market) | ERCOT (ISO)\nSUMMARY: DCPI 42/100 | Verdict: CAUTION' };
    const lead = planLeadText(plan);
    expect(lead.length).toBeLessThanOrEqual(PLAN_LEAD_MAX);
    expect(lead).toContain(MARKETS);
    expect(lead).toContain('as of 2026-10-31 (oldest input: TX power availability timeline)');
    // the deadline line goes last, so any cut lands there and never on a market name
    expect(lead.indexOf(MARKETS)).toBeLessThan(lead.indexOf('Source: DC Hub'));
  });

  it('a market lead with no verdict of its own keeps the old trailing verdict line', () => {
    const iso = ex(1, 'get_market_dcpi_rank', { market_slug: 'dallas' }, { market_slug: 'dallas', verdict: null, time_to_power_months: null });
    const h = buildIntentAnswer(ctx, [iso, canvas, timeline], null, NOW).headline;
    expect(h).not.toContain('DCPI verdict');
  });
});
