// colocation-h2h-round3-1117.test.mjs — Grok's midday colocation re-run (2026-11-17 19:29Z, server 2.12.59, planner
// 5.34, 138/180 vs Coloprice 127 and Colocation Scout 124): the gaps that are planner or answer code.
//   Q-f  an address + fiber ask fits the step budget, and a profile the budget cut says so (not "no row there")
//   Q-b  one record date per row: the lead and the evidence no longer disagree on a facility's date
//   Q-c  a lead whose figures each carry a date is not stamped with one step's older date
//   Q-d  "where in Texas" is TX on ERCOT, not the union of four grids, and names the queue rows' counties
//   Q-e  a plan's source_capacity step carries the teaser, not its introduction terms or unlock steps
import { describe, it, expect } from 'vitest';
import { buildIntentAnswer, queueCounties } from '../lib/intent-answers.mjs';
import { buildColocationAnswer } from '../lib/colocation-answer.mjs';
import { coloSignals, colocationSequence } from '../lib/colocation-plan.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';
import { compactReplay } from '../lib/plan-replay-id.mjs';
import { planCapacityTeaserOnly } from '../lib/plan-capacity-teaser.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const DEFAULT_MAX_STEPS = 6;   // server.mjs execute_plan: max_steps defaults to 6

describe('Q-f: an address with a fiber ask keeps its facility profile inside the step budget', () => {
  const q = 'Carrier-neutral colocation with strong fiber at 350 E Cermak, Chicago';
  const seq = colocationSequence({ __colo: coloSignals(q, {}) });

  it('the address search replaces the metro search; the RTO read goes; get_facility fits', () => {
    expect(seq.length).toBeLessThanOrEqual(DEFAULT_MAX_STEPS);
    const searches = seq.filter((s) => s.tool === 'search_facilities');
    expect(searches.map((s) => s.args_hint.query)).toEqual(['350 E Cermak']);
    expect(seq.some((s) => s.tool === 'get_grid_intelligence' || s.tool === 'get_power_availability_timeline')).toBe(false);
    const gf = seq.find((s) => s.tool === 'get_facility');
    expect(gf && gf.depends_on).toEqual([searches[0].step]);
    expect(seq.map((s) => s.step)).toEqual(seq.map((_, i) => i + 1));
  });
  it('control: a metro ask with no address keeps the metro search and the power read', () => {
    const m = colocationSequence({ __colo: coloSignals('Carrier-neutral colocation with strong fiber in Chicago', {}) });
    expect(m.find((s) => s.tool === 'search_facilities').args_hint.query).toBe('Chicago');
    expect(m.some((s) => s.tool === 'get_grid_intelligence')).toBe(true);
  });
  it('an address with no fiber ask keeps the power read (still within budget)', () => {
    const a = colocationSequence({ __colo: coloSignals('Colocation at 350 E Cermak in Chicago', {}) });
    expect(a.length).toBeLessThanOrEqual(DEFAULT_MAX_STEPS);
    expect(a.some((s) => s.tool === 'get_grid_intelligence')).toBe(true);
    expect(a.filter((s) => s.tool === 'search_facilities').map((s) => s.args_hint.query)).toEqual(['350 E Cermak']);
  });
  it('a profile the budget cut is said to be cut, not "no facility at that address"', () => {
    const cs = coloSignals(q, {});
    const a = buildColocationAnswer({ intent: q, intent_class: 'colocation', metro: cs.metro, metros: [], address: cs.address }, [
      ex(1, 'get_market_dcpi_rank', { market_slug: 'chicago' }, { verdict: 'AVOID', composite_score: 21.9 }),
      ex(2, 'search_facilities', { query: '350 E Cermak', state: 'IL', limit: 3 }, { data: [{ slug: 'dlr-chi-350', name: 'Digital Realty CHI (350 E Cermak)' }] }),
      { step: 3, tool: 'get_facility', status: 'not_run', args_hint: { slug: '<facility slug from step 2 search_facilities row>' }, note: 'max_steps reached' },
    ], null);
    const ne = a.not_established.join(' ');
    expect(ne).toMatch(/get_facility was not run because the plan reached its step limit \(max_steps reached\)/);
    expect(ne).toMatch(/not because no facility is at that address/);
  });
  it('control: no profile and no cut step keeps the plain line', () => {
    const cs = coloSignals(q, {});
    const a = buildColocationAnswer({ intent: q, intent_class: 'colocation', metro: cs.metro, metros: [], address: cs.address }, [
      ex(1, 'get_market_dcpi_rank', { market_slug: 'chicago' }, { verdict: 'AVOID', composite_score: 21.9 })], null);
    expect(a.not_established.join(' ')).toMatch(/No facility profile at 350 E Cermak was read; the facts below/);
  });
  it('the compact replay keeps the reason a step did not run', () => {
    const r = compactReplay({ schema_version: 1, planner_version: '5.36', decisions: [
      { id: 'D3', step: 3, kind: 'step', status: 'not_run', status_note: 'max_steps reached', decision: 'get_facility', rationale: 'x' },
      { id: 'D1', step: 1, kind: 'step', status: 'executed', decision: 'get_market_dcpi_rank', rationale: 'y' }] });
    expect(r.decisions[0]).toMatchObject({ status: 'not_run', status_note: 'max_steps reached' });
    expect(r.decisions[1].status_note).toBeUndefined();
  });
});

describe('Q-b: one record date per row', () => {
  const cs = coloSignals('Compare Equinix DA11 vs Digital Realty DFW18 for colocation', {});
  const run = (rows) => buildColocationAnswer({ intent: 'x', intent_class: 'colocation', metro: cs.metro, metros: [], pair: cs.pair }, [
    ex(1, 'search_facilities', { query: 'Equinix DA11', limit: 5 }, { data: rows }),
    ex(3, 'get_facility', { slug: 'equinix-da11' }, { data: { name: 'Equinix DA11 - Dallas', provider: 'Equinix', city: 'Dallas', state: 'TX' } }),
  ], null);

  it('mixed dates: each row carries its own; the set is not stamped with the oldest', () => {
    const a = run([{ slug: 'equinix-da11', name: 'Equinix DA11 - Dallas', as_of: '2026-11-17' }, { slug: 'equinix-da1', name: 'Equinix DA1', as_of: '2026-03-30' }]);
    const ev = a.evidence.join(' ');
    expect(ev).toContain('Equinix DA11 - Dallas (record as of 2026-11-17), Equinix DA1 (record as of 2026-03-30)');
    expect(ev).not.toMatch(/facility records as of 2026-03-30/);
    expect(a.headline).toContain('Equinix DA11 - Dallas (Equinix, Dallas, TX, record as of 2026-11-17)');
  });
  it('one shared date stays one stamp', () => {
    const a = run([{ slug: 'equinix-da11', name: 'Equinix DA11 - Dallas', as_of: '2026-11-17' }, { slug: 'equinix-da1', name: 'Equinix DA1', as_of: '2026-11-17' }]);
    expect(a.evidence.join(' ')).toContain('e.g. Equinix DA11 - Dallas, Equinix DA1 (facility records as of 2026-11-17)');
  });
});

describe('Q-c: per-figure dates, not one stamp', () => {
  const cs = coloSignals('What does colocation cost per kW in Phoenix?', {});
  const a = buildColocationAnswer({ intent: 'x', intent_class: 'pricing_out_of_scope', metro: cs.metro, metros: [], kw: null }, [
    ex(1, 'get_market_dcpi_rank', { market_slug: 'phoenix' }, { verdict: 'CAUTION', composite_score: 43.5, citation: { as_of: '2026-11-17' } }),
    ex(2, 'get_energy_prices', { state: 'AZ' }, { ok: true, _entity: 'energy', as_of: '2026-08-31', filter: { state: 'AZ' },
      taste: { headline: { name: 'retail_rate_cents_kwh', value: 10.03, unit: 'cents/kWh', sector: 'all-sector average', window: '2026', as_of: '2026-08-31' } } }),
  ], null);

  it('the DCPI verdict carries its own date', () => {
    expect(a.headline).toMatch(/DCPI\) for Phoenix: CAUTION, composite 43\.5\/100 \(as of 2026-11-17\)\./);
    expect(a.headline).toContain('(2026 average, EIA, as of 2026-08-31)');
  });
  it('the lead\'s Source line does not stamp the older step date over the dated figures', () => {
    const lead = planLeadText({ _entity: 'plan_execution', intent: 'x', executed: [], intent_answer: a,
      fact_header: 'SOURCE: DC Hub | AS_OF: 2026-08-31\nENTITY: phoenix\nSUMMARY: x' });
    expect(lead).toContain('Source: DC Hub (dchub.cloud), each figure dated in the line.');
    expect(lead).not.toMatch(/Source: DC Hub \(dchub\.cloud\), as of 2026-08-31/);
  });
  it('control: an undated headline keeps the AS_OF stamp', () => {
    const lead = planLeadText({ _entity: 'plan_execution', intent: 'x', executed: [], intent_answer: { headline: 'Phoenix: CAUTION.' },
      fact_header: 'SOURCE: DC Hub | AS_OF: 2026-08-31\nENTITY: phoenix\nSUMMARY: x' });
    expect(lead).toContain('Source: DC Hub (dchub.cloud), as of 2026-08-31.');
  });
});

describe('Q-d: "where in Texas" is TX on ERCOT, with the queue rows\' counties', () => {
  const TX_TIMELINE = { ok: true, state: 'TX', as_of: '2026-11-17T08:47:18Z',
    queue_context: { iso_reported: [{ iso: 'ERCOT', gw: 461.4, requests: 1847, as_of: '2026-10-31', primary: true }] },
    sources: { planned_generators: { feed: 'EIA-860M monthly', vintage: '2026-11-01T08:23:55Z' } },
    timeline: [{ year: 2026, units: 89, cumulative_firm_signal_mw: 16796 }] };
  const TX_QUEUE = { ok: true, count_total_matching: 1735, filters_applied: { geocoded_only: true },
    freshness_by_iso: { ERCOT: { source_as_of: '2026-10-31' } },
    results: [
      { project: 'A', county: 'Ector', state: 'TX' }, { project: 'B', county: 'Brazoria County', state: 'TX' },
      { project: 'C', county: 'Ector', state: 'TX' }, { project: 'D', county: 'Lea', state: 'NM' },
      { project: 'E', county: 'Reeves', state: 'TX' }, { project: 'F', county: 'Brazoria', state: 'TX' }, { project: 'G', state: 'TX' }] };
  const executed = [ex(1, 'get_power_availability_timeline', { state: 'TX' }, TX_TIMELINE),
    ex(2, 'get_refined_queue', { state: 'TX', geocoded_only: true }, TX_QUEUE)];
  const ctx = { intent: 'Where in Texas can I get grid power fastest for a data center?', intent_class: 'grid_headroom',
    constraint_iso: ['ERCOT', 'SPP', 'MISO', 'WECC'], states: [], state: 'TX' };

  it('the lead says TX (mostly ERCOT), not the union of four grids, and names the split', () => {
    const ia = buildIntentAnswer(ctx, executed, null);
    expect(ia.kind).toBe('power_timing');
    expect(ia.headline.startsWith('Time to power for TX (mostly ERCOT): ')).toBe(true);
    expect(ia.headline).not.toMatch(/ERCOT\/SPP\/MISO\/WECC/);
    expect(ia.evidence).toContain('Texas is mostly ERCOT; the Panhandle is SPP, far-east Texas MISO and El Paso WECC.');
  });
  it('the counties the returned queue rows sit in, labelled as the rows shown', () => {
    const ia = buildIntentAnswer(ctx, executed, null);
    expect(ia.headline).toContain('Queue projects returned sit in Brazoria County (2), Ector County (2), Reeves County (1) (the rows shown, not a TX count).');
  });
  it('queueCounties: out-of-state and county-less rows are left out; " County" is not doubled', () => {
    expect(queueCounties(TX_QUEUE.results, 'TX')).toEqual([{ county: 'Brazoria', n: 2 }, { county: 'Ector', n: 2 }, { county: 'Reeves', n: 1 }]);
    expect(queueCounties([], 'TX')).toEqual([]);
    expect(queueCounties(null, 'TX')).toEqual([]);
  });
  it('control: one ISO asked (no state) keeps the ISO scope', () => {
    const ia = buildIntentAnswer({ ...ctx, constraint_iso: ['ERCOT'], state: null }, executed, null);
    expect(ia.headline.startsWith('Time to power for ERCOT (ISO): ')).toBe(true);
  });
  it('a split state with no primary grid names its grids', () => {
    const ia = buildIntentAnswer({ ...ctx, intent: 'How fast can I get power in Illinois?', constraint_iso: ['PJM', 'MISO'], state: 'IL' },
      [ex(1, 'get_power_availability_timeline', { state: 'IL' }, { ...TX_TIMELINE, state: 'IL' })], null);
    expect(ia.headline.startsWith('Time to power for IL (PJM/MISO): ')).toBe(true);
  });
});

describe('Q-e: a plan\'s source_capacity step is the teaser only', () => {
  it('terms and caller_access go from the step; a "lead register" sentence goes', () => {
    const plan = { _entity: 'plan_execution', executed: [{ step: 4, tool: 'source_capacity', status: 'executed', result: {
      count: 0, program_status: 'upcoming',
      terms: { version: 3, summary: 'DC Hub records your registration in its lead register before an introduction.' },
      caller_access: { level: 'anonymous', unlock: { mcp_steps: ['claim_free_key', 'bind_email'] } },
      note: 'Listings are onboarding. DC Hub records your registration in its lead register.' } }] };
    const r = planCapacityTeaserOnly(plan, {}).executed[0].result;
    expect(r.terms).toBeUndefined();
    expect(r.caller_access).toBeUndefined();
    expect(r.note).toBe('Listings are onboarding.');
    expect(r.count).toBe(0);
  });
  it('control: another step\'s terms block is untouched', () => {
    const plan = { _entity: 'plan_execution', executed: [{ step: 1, tool: 'get_tax_incentives', status: 'executed', result: { terms: { a: 1 } } }] };
    expect(planCapacityTeaserOnly(plan, {}).executed[0].result.terms).toEqual({ a: 1 });
  });
});
