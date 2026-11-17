// colocation-h2h-round2-1117.test.mjs — Grok's colocation head-to-head re-run (2026-11-17, server 2.12.59,
// 133/180 vs 124/180): the leads now use the facts the steps already returned, and the last allowance wording goes.
//
// Fixtures are trimmed from live keyless execute_plan payloads read 2026-11-17 ~08:47Z (field names and values as
// served; arrays cut to the rows the assertions need).
import { describe, it, expect } from 'vitest';
import { factsFromExecuted, factsFromStep, addressFromText, addressMatches } from '../lib/plan-step-facts.mjs';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';
import { buildColocationAnswer } from '../lib/colocation-answer.mjs';
import { coloSignals, coloFacilityPair, colocationSequence, COLO_PRICING_NOTE } from '../lib/colocation-plan.mjs';
import { planLeadText, PLAN_LEAD_MAX } from '../lib/plan-lead-text.mjs';
import { planCapacityTeaserOnly } from '../lib/plan-capacity-teaser.mjs';
import { wallFreeNext, WALL_FREE_NEXT_LEAD, freeNextAgentTail, EMAIL_NEXT_QUESTION } from '../lib/short-wall-link.mjs';
import { ANSWER_FIRST_LEAD } from '../lib/claim-handoff.mjs';

const TX_TIMELINE = {
  ok: true, _entity: 'pipeline', entity: 'power_availability_timeline', state: 'TX', as_of: '2026-11-17T08:47:18Z',
  queue_context: { active_projects: 1841, active_mw: null,
    iso_reported: [{ iso: 'ERCOT', gw: 461.4, mw: 461414, requests: 1847, as_of: '2026-10-31', primary: true,
      source: 'ERCOT GIS Report, October 2026 (posted 2026-11-02)', basis_class: 'published' }] },
  sources: { planned_generators: { feed: 'EIA-860M monthly', vintage: '2026-11-01T08:23:55.674418+00:00' } },
  timeline: [{ year: 2026, units: 89, cumulative_firm_signal_mw: 16796 }],
};
const TX_QUEUE = { ok: true, _entity: 'queue_results', count_total_matching: 1735, filters_applied: { geocoded_only: true },
  freshness_by_iso: { ERCOT: { source_as_of: '2026-10-31' } } };
const AZ_ENERGY = { ok: true, _entity: 'energy', as_of: '2026-08-31', filter: { state: 'AZ' },
  taste: { headline: { name: 'retail_rate_cents_kwh', value: 10.03, unit: 'cents/kWh', sector: 'all-sector average', window: '2026', as_of: '2026-08-31' } },
  _industrial_rate_kwh_withheld: true };
const AZ_TAX = { _entity: 'incentives', state: 'AZ', data: [{ abbr: 'AZ', name: 'Arizona', has_incentive: true, status: 'paused_new_applicants',
  status_as_of: '2026-07-01', last_verified: '2026-09-18' }] };
const PHX_DCPI = { market_slug: 'phoenix', verdict: 'CAUTION', composite_score: 43.5, computed_at: '2026-11-16T04:00:00Z' };
const CHI_METRO_FIBER = { success: true, market: 'Chicago', as_of: '2026-03-17',
  summary: { market: 'Chicago', key_carrier_hotels: ['350 E Cermak', '600 S Federal'] },
  carriers: [{ carrier: 'Zayo', key_endpoints: ['350 E Cermak', 'Elk Grove Village'] },
    { carrier: 'Lumen', key_endpoints: ['350 East Cermak Road', 'Franklin Park'] },
    { carrier: 'Crown Castle', key_endpoints: ['600 S Federal'] }] };
const CHI_READINESS = { _entity: 'fiber', lat: 41.853, lon: -87.618, near_net_bucket: 'on-net', nearest_carrier_km: 0.05,
  _carrier_count_withheld: true, _score_withheld: true, _top_carriers_withheld: true };
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });

describe('plan-step-facts: dated facts from what a step returned', () => {
  it('Texas timeline: ERCOT\'s own queue total and the year\'s firm-supply signal, each dated', () => {
    const f = factsFromStep('get_power_availability_timeline', TX_TIMELINE, { state: 'TX' });
    expect(f.map((x) => x.text)).toEqual([
      "ERCOT's own reported generation queue: 461.4 GW across 1,847 requests (ERCOT report, as of 2026-10-31).",
      'TX 2026 firm-supply signal: 16,796 MW (EIA-860M, as of 2026-11-01).',
    ]);
  });
  it('a withheld figure is not a fact (active_mw null, no firm signal on the row)', () => {
    const f = factsFromStep('get_power_availability_timeline', { ...TX_TIMELINE, queue_context: { active_mw: null }, timeline: [{ year: 2026, units: 89 }] }, {});
    expect(f).toEqual([]);
  });
  it('Phoenix drivers: the visible AZ rate and the AZ incentive status, dated', () => {
    expect(factsFromStep('get_energy_prices', AZ_ENERGY, { state: 'AZ' })[0].text)
      .toBe('AZ all-sector average retail electricity rate: 10.03 cents/kWh (2026 average, EIA, as of 2026-08-31).');
    expect(factsFromStep('get_tax_incentives', AZ_TAX, { state: 'AZ' })[0].text)
      .toBe('Arizona data-center tax incentive: paused new applicants (as of 2026-07-01).');
  });
  it('350 E Cermak: key endpoint for the carriers whose profile names it, and on-net at the point', () => {
    const f = factsFromExecuted([ex(1, 'get_metro_fiber', { market: 'chicago' }, CHI_METRO_FIBER),
      ex(2, 'get_fiber_readiness', { lat: 41.853, lon: -87.618 }, CHI_READINESS)], null, { address: '350 E Cermak Rd' });
    expect(f.map((x) => x.text)).toEqual([
      "350 E Cermak Rd is a key fiber endpoint for Zayo, Lumen and a key carrier hotel in Chicago's curated carrier profiles (DC Hub baseline as of 2026-03-17, not a live feed).",
      'Fiber at 350 E Cermak Rd: on-net, nearest carrier 0.05 km (PeeringDB carrier presence + FCC fiber coverage).',
    ]);
    // no address asked: the metro profile is not turned into an address claim
    expect(factsFromStep('get_metro_fiber', CHI_METRO_FIBER, {}, {})).toEqual([]);
  });
  it('addresses: found in text, never a size; matched across spellings', () => {
    expect(addressFromText('Colocation in Chicago near 350 E Cermak Rd with strong fiber')).toBe('350 E Cermak Rd');
    expect(addressFromText('Colocation near 60 Hudson St in New York')).toBe('60 Hudson St');
    expect(addressFromText('Colocation in Ashburn for about 500 kW')).toBeNull();
    expect(addressFromText('100 MW in Texas')).toBeNull();
    expect(addressMatches('Digital Realty 350 E. Cermak', '350 East Cermak Road')).toBe(true);
    expect(addressMatches('600 S Federal', '350 E Cermak')).toBe(false);
  });
});

describe('Q-d: "Fastest grid power in Texas" leads with dated supply facts', () => {
  const executed = [ex(1, 'get_power_availability_timeline', { state: 'TX' }, TX_TIMELINE),
    ex(2, 'get_refined_queue', { state: 'TX', geocoded_only: true }, TX_QUEUE)];
  it('"fastest" is a timing ask; the headline names the queue total and firm signal with a state-grain caveat', () => {
    const ia = buildIntentAnswer({ intent: 'Fastest grid power in Texas for a data center', intent_class: 'grid_headroom', constraint_iso: ['ERCOT'] }, executed, null);
    expect(ia && ia.kind).toBe('power_timing');
    expect(ia.headline).toContain('461.4 GW');
    expect(ia.headline).toContain('as of 2026-10-31');
    expect(ia.headline).toContain('16,796 MW');
    expect(ia.headline).toMatch(/TX-wide supply signals, not a time to power for a specific load\./);
    const lead = planLeadText({ _entity: 'plan_execution', intent: 'Fastest grid power in Texas', executed, intent_answer: ia });
    expect(lead.length).toBeLessThanOrEqual(PLAN_LEAD_MAX);
    expect(lead).toContain('461.4 GW');
    expect(lead).not.toMatch(/^DC Hub ran \d+ lookups?/);
  });
  it('with no answer block at all, the lead still states a step fact, not a lookup count', () => {
    const lead = planLeadText({ _entity: 'plan_execution', intent: 'Where in Texas can I get grid power?', executed });
    expect(lead.startsWith("ERCOT's own reported generation queue: 461.4 GW")).toBe(true);
    // control: nothing to state -> the lookup count, as before
    expect(planLeadText({ _entity: 'plan_execution', intent: 'x', executed: [ex(1, 'get_refined_queue', {}, {})] })).toMatch(/^DC Hub ran 1 lookup/);
  });
});

describe('Q-c: colocation price ask says "doesn\'t publish" and shows a dated driver figure', () => {
  it('the note and one driver figure lead; the incentive status is evidence', () => {
    expect(COLO_PRICING_NOTE.startsWith("DC Hub doesn't publish colocation prices.")).toBe(true);
    const cs = coloSignals('What does 1 MW of colocation cost per kW per month in Phoenix?', {});
    const a = buildColocationAnswer({ intent: 'x', intent_class: 'pricing_out_of_scope', metro: cs.metro, metros: [], kw: cs.kw },
      [ex(1, 'get_market_dcpi_rank', { market_slug: 'phoenix' }, PHX_DCPI), ex(2, 'get_energy_prices', { state: 'AZ' }, AZ_ENERGY),
        ex(3, 'get_tax_incentives', { state: 'AZ' }, AZ_TAX)], null);
    expect(a.headline).toMatch(/^DC Hub doesn't publish colocation prices\. .* AZ all-sector average retail electricity rate: 10\.03 cents\/kWh \(2026 average, EIA, as of 2026-08-31\)\. Data Center Power Index \(DCPI\) for Phoenix: CAUTION/);
    expect(a.evidence).toContain('Arizona data-center tax incentive: paused new applicants (as of 2026-07-01).');
    expect(JSON.stringify(a)).not.toMatch(/\$\s?\d|doesn't quote/);
  });
});

describe('Q-b: a named facility pair is a side-by-side lead with clean queries', () => {
  it('the lead-in before the colon is not part of the facility name', () => {
    expect(coloFacilityPair('Compare two Dallas colocation facilities: Equinix DA11 vs Digital Realty DFW Richardson'))
      .toEqual({ a: 'Equinix DA11', b: 'Digital Realty DFW Richardson' });
    const seq = colocationSequence({ __colo: coloSignals('Compare two Dallas colocation facilities: Equinix DA11 vs Digital Realty DFW Richardson', {}) });
    expect(seq.filter((s) => s.tool === 'search_facilities').map((s) => s.args_hint.query)).toEqual(['Equinix DA11', 'Digital Realty DFW Richardson']);
  });
  it('each side: name, operator, place, record date; what neither read carries is not established', () => {
    const cs = coloSignals('Compare two Dallas colocation facilities: Equinix DA11 vs Digital Realty DFW Richardson', {});
    const a = buildColocationAnswer({ intent: 'x', intent_class: 'colocation', metro: cs.metro, metros: [], pair: cs.pair }, [
      ex(1, 'search_facilities', { query: 'Equinix DA11', state: 'TX', limit: 5 }, { data: [{ slug: 'equinix-da11', name: 'Equinix DA11 - Dallas', as_of: '2026-11-17' }] }),
      ex(2, 'search_facilities', { query: 'Digital Realty DFW Richardson', state: 'TX', limit: 5 }, { data: [{ slug: 'dlr-dfw18', name: 'Digital Realty DFW18', as_of: '2026-03-30' }] }),
      ex(3, 'get_facility', { slug: 'equinix-da11' }, { data: { name: 'Equinix DA11 - Dallas', provider: 'Equinix', city: 'Dallas', state: 'TX', status: 'Operational' } }),
      ex(4, 'get_facility', { slug: 'dlr-dfw18' }, { data: { name: 'Digital Realty DFW18', provider: 'Digital Realty', city: 'Richardson', state: 'TX', status: 'Operational', fiber_carrier_count: 9 } }),
      ex(5, 'get_market_dcpi_rank', { market_slug: 'dallas' }, { verdict: 'CAUTION', composite_score: 42 }),
    ], null);
    expect(a.headline).toBe('Equinix DA11 - Dallas (Equinix, Dallas, TX, Operational, record as of 2026-11-17) vs Digital Realty DFW18 '
      + '(Digital Realty, Richardson, TX, Operational, record as of 2026-03-30; 9 fiber carriers on record). '
      + 'Data Center Power Index (DCPI) for Dallas-Fort Worth: CAUTION, composite 42/100.');
    expect(a.not_established).toContain('Equinix DA11 - Dallas: power capacity, fiber carrier count, available space not in this read.');
    expect(a.not_established).toContain('Digital Realty DFW18: power capacity, available space not in this read.');
  });
});

describe('Q-f: a named address is the facility asked about; fiber facts lead', () => {
  const q = 'Colocation in Chicago near 350 E Cermak with strong fiber connectivity';
  it('the plan searches the address and profiles that row, not the metro\'s first row', () => {
    const seq = colocationSequence({ __colo: coloSignals(q, {}) });
    const addr = seq.find((s) => s.tool === 'search_facilities' && s.args_hint.query === '350 E Cermak');
    expect(addr).toBeTruthy();
    const gf = seq.filter((s) => s.tool === 'get_facility');
    expect(gf).toHaveLength(1);
    expect(gf[0].depends_on).toEqual([addr.step]);
    expect(seq.map((s) => s.tool)).toEqual(expect.arrayContaining(['get_metro_fiber', 'get_fiber_readiness']));
  });
  it('the headline is the key-endpoint and on-net facts, then the DCPI verdict', () => {
    const cs = coloSignals(q, {});
    const a = buildColocationAnswer({ intent: q, intent_class: 'colocation', metro: cs.metro, metros: [], address: cs.address }, [
      ex(1, 'get_market_dcpi_rank', { market_slug: 'chicago' }, { verdict: 'AVOID', composite_score: 21.9 }),
      ex(4, 'get_metro_fiber', { market: 'chicago' }, CHI_METRO_FIBER),
      ex(5, 'get_fiber_readiness', { lat: 41.853, lon: -87.618 }, CHI_READINESS),
      ex(7, 'get_facility', { slug: 'dlr-350-e-cermak' }, { data: { name: 'Digital Realty 350 E Cermak', provider: 'Digital Realty' } }),
    ], null);
    expect(a.headline.startsWith("350 E Cermak is a key fiber endpoint for Zayo, Lumen and a key carrier hotel in Chicago's curated carrier profiles")).toBe(true);
    expect(a.headline).toContain('Fiber at 350 E Cermak: on-net, nearest carrier 0.05 km');
    expect(a.headline).toMatch(/Data Center Power Index \(DCPI\) for Chicago: AVOID/);
    expect(a.not_established.join(' ')).not.toMatch(/No facility profile at 350 E Cermak/);
  });
});

describe('Q-e: Capacity Source in a plan is the teaser only, seller terms included', () => {
  it('program.sellers and a seller-terms sentence go; the buyer program stays', () => {
    const plan = { _entity: 'plan_execution', executed: [{ step: 5, tool: 'source_capacity', result: {
      count: 0, program_status: 'upcoming',
      program: { buyers: { note: 'Search listings by size and location.' },
        sellers: { list_free: { terms: 'Free to list; a 2% service fee only if a deal closes.' } } },
      note: 'Listings are onboarding. Free to list; a 2% service fee only if a deal closes.' } }] };
    const out = planCapacityTeaserOnly(plan, {});
    const r = out.executed[0].result;
    expect(r.program.sellers).toBeUndefined();
    expect(r.program.buyers).toEqual({ note: 'Search listings by size and location.' });
    expect(r.note).toBe('Listings are onboarding.');
    expect(JSON.stringify(out)).not.toMatch(/service fee|free to list/i);
  });
});

describe('residual wording: no price or allowance words in next_ask and its tails', () => {
  it('the next_ask lead names the call, not "a free answer"', () => {
    expect(WALL_FREE_NEXT_LEAD).toBe('Show your human the link in human_url. Meanwhile, ');
    for (const a of [wallFreeNext('get_grid_data', {}), wallFreeNext('get_fiber_intel', { siteFree: true }), wallFreeNext('rank_markets', { market: 'dallas' })]) {
      expect(a.question).not.toMatch(/\bfree\b/i);
      expect(a.question.startsWith(WALL_FREE_NEXT_LEAD + 'call ')).toBe(true);
    }
    expect(freeNextAgentTail('get_grid_data', 'rank_markets')).not.toMatch(/\bfree\b/i);
    expect(EMAIL_NEXT_QUESTION).not.toMatch(/free answer/);
    expect(ANSWER_FIRST_LEAD).toBe('Give your user this answer first: ');
  });
});
