// planner-539-cross-domain.test.mjs — planner 5.39 (Grok cross-domain head-to-head, 2026-11-17 night): DC Hub lost
// the data center + energy set 35/60 to two colocation-only servers on two answer-writing bugs.
//   (a) "Where can I get 50 MW … in under 24 months in the US, and what do grid headroom and the interconnection
//       queue look like there?" routed to interconnection_queue and led "DC Hub ran 3 lookups": no market, no figure.
//   (b) "For new data center capacity in Northern Virginia, how do wholesale power prices, grid headroom and the PJM
//       queue affect it?" read no price, and its POWER SIDE line said "no figure … came back" while facts[] quoted
//       PJM demand from the same step.
// Fixtures are the live keyless payloads of 2026-11-18 (test/fixtures/cross-domain-1118.json). No network.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { pairLines, priceStepFor, figuresOf, WHOLESALE_SCOPE_NOTE } from '../lib/plan-pairs.mjs';
import { capacityGridEligible, buildCapacityGridAnswer, terse } from '../lib/cross-domain-answer.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';
import { factsFromExecuted } from '../lib/plan-step-facts.mjs';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/cross-domain-1118.json', import.meta.url), 'utf8'));
const QA = 'Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what do grid headroom and the interconnection queue look like there?';
const QB = 'For new data center capacity in Northern Virginia, how do wholesale power prices, grid headroom and the PJM queue affect it?';
const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint]));

describe('planner 5.39: cross-domain answers', () => {
  it('PLANNER_VERSION is 5.39', () => { expect(PLANNER_VERSION).toBe('5.39'); });

  describe('(a) the 50 MW question reads markets, then the grid and the queue behind them', () => {
    const p = _planQuery(QA, {});
    it('routes to capacity_grid, not interconnection_queue', () => { expect(p.intent_class, show(p)).toBe('capacity_grid'); });
    it('ranks US markets for the size and the deadline first', () => {
      expect(p.recommended_sequence[0]).toMatchObject({ tool: 'site_selection_canvas', args_hint: { region: 'us', capacity_mw: 50, max_months: 24 } });
    });
    it('reads the grid and the queue of the finalists\' ISOs, and capacity at that size', () => {
      expect(tools(p)).toEqual(expect.arrayContaining(['get_grid_intelligence', 'get_interconnection_queue', 'source_capacity']));
      for (const t of ['get_grid_intelligence', 'get_interconnection_queue']) {
        const s = p.recommended_sequence.find((x) => x.tool === t);
        expect(s.args_hint.iso).toMatch(/^<ISO serving the finalist/);
        expect(s.depends_on).toContain(1);
      }
      expect(p.recommended_sequence.find((x) => x.tool === 'source_capacity').args_hint).toMatchObject({ min_mw: 50 });
      expect(p.recommended_sequence.length).toBeLessThanOrEqual(6);
    });
  });

  describe('capacity_grid takes only an open US ask', () => {
    for (const q of [
      'interconnection queue in ERCOT near Dallas', 'how soon can 100 MW get power in Texas',
      'find 100 MW near Ashburn with fiber and grid headroom', 'where can I get 200 MW with grid headroom in Europe',
      'where can I find 100 MW with power in ERCOT', 'what does the PJM interconnection queue look like',
      'where in the US is there grid headroom for a 100 MW data center',
    ]) {
      it(`not: ${q}`, () => { expect(_planQuery(q, {}).intent_class).not.toBe('capacity_grid'); });
    }
    it('needs a size and a grid word', () => {
      expect(capacityGridEligible('where can I get colocation with grid headroom', { mw: null })).toBe(false);
      expect(capacityGridEligible('where can I get 50 MW', { mw: 50 })).toBe(false);
      expect(capacityGridEligible('where can I get 50 MW with grid headroom', { mw: 50 })).toBe(true);
      expect(capacityGridEligible('where can I get 50 MW with grid headroom', { mw: 50 }, { nonUsRegion: true })).toBe(false);
    });
  });

  describe('(a) the answer names three markets and each finalist ISO\'s figures, dated', () => {
    const ex = [
      { step: 1, tool: 'site_selection_canvas', status: 'gated_preview', args: { region: 'us', capacity_mw: 50, max_months: 24 }, result: F.canvas_us_50mw_24mo },
      { step: 2, tool: 'get_grid_intelligence', status: 'gated_preview', args: { iso: 'ERCOT' }, result: F.grid_ercot },
      { step: 3, tool: 'get_interconnection_queue', status: 'gated_preview', args: { iso: 'ERCOT' }, result: F.queue_ercot },
      { step: 4, tool: 'source_capacity', status: 'executed', args: { min_mw: 50 }, result: F.capacity_50mw_na },
    ];
    const ia = buildCapacityGridAnswer({ intent_class: 'capacity_grid', requested_mw: 50, deadline_months: 24 }, ex, null);
    it('names the top three markets with ISO and verdict', () => {
      for (const m of F.canvas_us_50mw_24mo.shortlist.slice(0, 3)) {
        expect(ia.headline).toContain(m.market);
        expect(ia.headline).toContain(m.iso);
      }
      expect(ia.markets).toHaveLength(3);
    });
    it('gives the ISO grid and queue figures, each with its own as_of', () => {
      expect(ia.headline).toMatch(/ERCOT: demand [\d,]+ MW \(as of 2026-11-18\); queued generation 461\.4 GW \(as of 2026-10-31\)/);
    });
    it('every figure in the headline is one facts[] also carries (no claim outside the facts)', () => {
      const facts = factsFromExecuted(ex, null).map((f) => f.text).join(' ');
      // "50 MW" is the size the question asked for, not a figure a step returned.
      const figs = (ia.headline.match(/\d[\d,.]*\s*(?:MW|GW)/g) || []).filter((n) => n !== '50 MW');
      expect(figs.length).toBeGreaterThanOrEqual(2);
      for (const n of figs) expect(facts).toContain(n.replace(/\s+/g, ' '));
    });
    it('says the 24-month cut was not applied when time to power is not readable', () => {
      expect(F.canvas_us_50mw_24mo.max_months_applied).toBe(false);
      expect(ia.evidence[0]).toMatch(/24-month cut was NOT applied/);
    });
    it('never stamps the run time as a data date', () => {
      expect(ia.headline).not.toMatch(/read \d{4}-\d{2}-\d{2}/);
      expect(ia.as_of).toBe('2026-10-31');
    });
    it('says an ISO with no figure plainly', () => {
      expect(ia.headline).toMatch(/MISO: no grid or queue figure this access level shows came back/);
    });
    it('the plain-language lead opens on the markets, never "DC Hub ran"', () => {
      const lead = planLeadText({ _entity: 'plan_execution', intent: QA, intent_answer: ia, executed: ex, fact_header: 'SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-10-31' });
      expect(lead).toMatch(/^Top 3 US markets for 50 MW/);
      expect(lead).not.toMatch(/DC Hub ran/);
      expect(lead.length).toBeLessThanOrEqual(600);
    });
    it('terse() keeps the figure and the step date only', () => {
      expect(terse('ERCOT queued generation: 461.4 GW (generation interconnection queue, DC Hub, as of 2026-10-31).', 'ERCOT', '2026-10-31'))
        .toBe('queued generation 461.4 GW (as of 2026-10-31)');
    });
  });

  describe('(b) Northern Virginia reads the price, and the power side never contradicts facts[]', () => {
    const p = _planQuery(QB, {});
    it('adds get_energy_prices for VA', () => {
      const s = p.recommended_sequence.find((x) => x.tool === 'get_energy_prices');
      expect(s, show(p)).toBeTruthy();
      expect(s.args_hint).toEqual({ state: 'VA' });
      expect(s.why).toMatch(/not serve wholesale \(LMP\)/);
    });
    it('keeps the grid, queue and data-center reads', () => {
      expect(tools(p)).toEqual(expect.arrayContaining(['get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel']));
    });
    it('a keyless grid read (taste only) gives a figure, not "no figure"', () => {
      const f = figuresOf('get_grid_intelligence', F.grid_pjm, { iso: 'PJM' });
      expect(f.parts[0]).toMatch(/PJM demand: 98,081 MW/);
    });
    const ex = [
      { step: 1, tool: 'get_grid_intelligence', status: 'gated_preview', args: { iso: 'PJM' }, result: F.grid_pjm },
      { step: 5, tool: 'get_energy_prices', status: 'gated_preview', args: { state: 'VA' }, result: F.energy_va },
    ];
    const pl = pairLines(ex, null, { intent: QB });
    it('the power line carries demand and the VA retail rate, each dated', () => {
      expect(pl.power.line).not.toMatch(/no figure/);
      expect(pl.power.line).toMatch(/98,081 MW .*as of 2026-11-18/);
      expect(pl.power.line).toMatch(/10\.63 cents\/kWh .*as of 2026-08-31/);
    });
    it('a wholesale ask is told DC Hub serves retail rates, not LMP', () => {
      expect(pl.lines).toContain(WHOLESALE_SCOPE_NOTE);
      expect(pl.price_scope_note).toBe(WHOLESALE_SCOPE_NOTE);
      expect(pairLines(ex, null, { intent: 'power prices in Virginia' }).price_scope_note).toBeUndefined();
    });
    it('every power figure the line states is in facts[]', () => {
      const facts = factsFromExecuted(ex, null).map((f) => f.text).join(' ');
      for (const n of ['98,081 MW', '10.63 cents/kWh']) { expect(pl.power.line).toContain(n); expect(facts).toContain(n); }
    });
    it('the lead names the power side from paired_sides when there is no headline', () => {
      const lead = planLeadText({ _entity: 'plan_execution', intent: QB, executed: ex, paired_sides: pl,
        fact_header: 'SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-09-30\nENTITY: Ashburn (market) | PJM (ISO)\nSUMMARY: Tracked 11,313 MW' });
      expect(lead).toMatch(/^Ashburn \(market\) \| PJM \(ISO\)\. Power: PJM demand: 98,081 MW/);
      expect(lead).toContain('10.63 cents/kWh');
    });
  });

  describe('priceStepFor', () => {
    const h = { rtos: new Set(['PJM', 'ERCOT']), stateIso: { VA: ['PJM'], TX: ['ERCOT'] }, usMarketState: () => null, stateScope: (d) => d.state || null, multiState: false };
    it('a price phrase with a bound state adds the step once', () => {
      expect(priceStepFor('electricity cost in Texas', { state: 'TX' }, [], h)).toMatchObject({ tool: 'get_energy_prices', args_hint: { state: 'TX' } });
      expect(priceStepFor('electricity cost in Texas', { state: 'TX' }, [{ tool: 'get_energy_prices' }], h)).toBeNull();
    });
    it('no price phrase, no state, or several states: no step', () => {
      expect(priceStepFor('grid headroom in Texas', { state: 'TX' }, [], h)).toBeNull();
      expect(priceStepFor('power prices', {}, [], h)).toBeNull();
      expect(priceStepFor('power prices in Texas or Virginia', { states: ['TX', 'VA'] }, [], h)).toBeNull();
    });
  });

  it('a lead with no figure at all never says "DC Hub ran"', () => {
    const lead = planLeadText({ _entity: 'plan_execution', intent: 'x', executed: [{ step: 1, tool: 'get_refined_queue', status: 'gated_preview', result: {} }] });
    expect(lead).not.toMatch(/DC Hub ran/);
    expect(lead).toMatch(/^No figure this access level shows came back from get_refined_queue/);
  });
});
