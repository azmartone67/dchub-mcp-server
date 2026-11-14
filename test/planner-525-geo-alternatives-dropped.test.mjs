// planner-525-geo-alternatives-dropped.test.mjs — Grok QA v2.12.48 (2026-11-13), items 2 and 3.
//
// Item 2 (P2): "Behind-the-meter gas ... near Abilene TX: air permit constraints, DCPI and time to power".
//   - The air-permit step must carry a place the tool can read (lat/lon, or the DCPI market slug the
//     intent named), never the '<lat>'/'<lon>' placeholders, also when it is a named-constraint lead.
//   - "Abilene TX" / "Sweetwater, TX" name the state: the permitting, gas and timeline steps get TX.
//   - An intent that asks for the DCPI or time to power gets a DCPI step for the named market.
//   - A DCPI market outside the US (Frankfurt DE, Mumbai IN) never lends its country code as a US state.
// Item 3 (P2, /mcp/chatgpt): "I need 200 MW in Reno within 24 months ... faster alternatives?"
//   - An intent that asks for alternatives gets one site_selection_canvas step (region us, the MW, the
//     deadline), so the answer names places other than Reno.
//   - What a step did not apply (canvas max_months on a keyless read, capacity_mw unsized, a one-ISO
//     state queue read) is listed with the step's own reason and named in answer_guide.
import { describe, it, expect } from 'vitest';
import {
  _planQuery, _planSignals, _constraintLeadSteps, _planAirPermitWhere, _planStateAfterPlace, _planUsMarketState, _planLeadState, _planDeadlineMonths,
  _alternativesStep, _execDroppedFilters, _execDroppedSentence,
} from '../server.mjs';

const ABILENE = 'Behind-the-meter gas generation for a 300 MW data center near Abilene TX: what are the air permit constraints, and what is the DCPI and time to power?';
const SWEETWATER = 'Behind-the-meter gas turbines for a 300 MW data center in Sweetwater, TX: air permit constraints, DCPI verdict and time to power';
const RENO = 'I need 200 MW in Reno within 24 months. Can I get power there in time, and what are faster alternatives?';

const seq = (q) => _planQuery(q, {}).recommended_sequence;
const step = (q, tool) => seq(q).find((s) => s.tool === tool);
const PLACEHOLDER = /^<.*>$/;

describe('item 2: the Abilene behind-the-meter gas air-permit plan', () => {
  it('the air-permit step reads Abilene (its DCPI market), not placeholders', () => {
    const s = step(ABILENE, 'get_air_permit_context');
    expect(s, JSON.stringify(seq(ABILENE).map((x) => x.tool))).toBeTruthy();
    const vals = Object.values(s.args_hint || {});
    expect(vals.some((v) => typeof v === 'string' && PLACEHOLDER.test(v)), JSON.stringify(s.args_hint)).toBe(false);
    expect(s.args_hint.site || (s.args_hint.lat != null && s.args_hint.lon != null)).toBeTruthy();
  });

  it('as a named-constraint lead (another class won), the air-permit step reads the market too', () => {
    const t = 'how soon can a 300 MW load get power in Abilene TX, and what air permit limits apply to on-site gas turbines?';
    const lead = _constraintLeadSteps(t, _planSignals(t), ['get_power_availability_timeline'], ['get_power_availability_timeline'])
      .find((x) => x.tool === 'get_air_permit_context');
    expect(lead && lead.args_hint).toEqual({ site: 'abilene' });   // main: {lat:'<site lat>', lon:'<site lon>'}
    expect(_planAirPermitWhere({ coords: { lat: 32.45, lon: -99.73 }, __outlook: { slug: 'abilene' } })).toEqual({ lat: 32.45, lon: -99.73 });
  });

  it('the state the text names reaches the permitting and gas steps', () => {
    for (const q of [ABILENE, SWEETWATER]) {
      const st = seq(q);
      const stateArgs = st.filter((x) => ['get_permitting_intel', 'get_gas_index', 'get_power_availability_timeline'].includes(x.tool))
        .map((x) => x.args_hint && (x.args_hint.state || x.args_hint.region));
      expect(stateArgs.length, q).toBeGreaterThan(0);
      for (const v of stateArgs) expect(v, q).toBe('TX');
    }
  });

  it('a DCPI / time-to-power ask gets a DCPI step for the named market', () => {
    const s = step(ABILENE, 'get_market_dcpi_rank');
    expect(s).toBeTruthy();
    expect(s.args_hint.market_slug).toBe('abilene');
  });

  it('"City ST" and "City, ST" give the state; ambiguous or word codes do not', () => {
    expect(_planStateAfterPlace('a site near Abilene TX for gas')).toBe('TX');
    expect(_planStateAfterPlace('turbines in Sweetwater, TX')).toBe('TX');
    expect(_planStateAfterPlace('Columbus OH or Austin TX')).toBe(null);           // two states: none
    expect(_planStateAfterPlace('Is Phoenix OK for 100 MW')).toBe(null);            // bare word code
    expect(_planStateAfterPlace('Portland, OR')).toBe('OR');                        // comma form is a code
    expect(_planStateAfterPlace('power in Ohio')).toBe(null);
  });

  it('a non-US DCPI market never lends its country code as a US state', () => {
    expect(_planUsMarketState({ slug: 'frankfurt', state: 'DE', iso: 'ENTSO-E' })).toBe(null);
    expect(_planUsMarketState({ slug: 'mumbai', state: 'IN', iso: 'POSOCO' })).toBe(null);
    expect(_planUsMarketState({ slug: 'abilene', state: 'TX', iso: 'ERCOT', rto: 'ERCOT' })).toBe('TX');
    expect(_planLeadState({ __outlook: { slug: 'frankfurt', state: 'DE', iso: 'ENTSO-E' } })).toBe(null);
    for (const q of ['power outlook for Frankfurt', 'power and interconnection outlook for Mumbai']) {
      const t = step(q, 'get_power_availability_timeline');
      expect(t && t.args_hint && ['DE', 'IN'].includes(t.args_hint.state), q).toBeFalsy();
    }
  });
});

describe('item 3: an intent that asks for alternatives gets them', () => {
  it('Reno gets one site_selection_canvas step: region us, 200 MW, 24 months', () => {
    const s = seq(RENO).filter((x) => x.tool === 'site_selection_canvas');
    expect(s).toHaveLength(1);
    expect(s[0].args_hint).toEqual({ region: 'us', capacity_mw: 200, max_months: 24 });
    expect(s[0].constraint).toBe('alternatives');
  });

  it('no alternatives step without the ask, or when the plan already ranks places', () => {
    expect(step('I need 200 MW in Reno within 24 months. Can I get power there in time?', 'site_selection_canvas')).toBeFalsy();
    expect(_alternativesStep(RENO, { mw: 200 }, ['rank_markets'])).toBe(null);
    expect(_alternativesStep('what is the weather', {}, [])).toBe(null);
  });

  it('deadline parsing: months and years, bounded', () => {
    expect(_planDeadlineMonths('within 24 months')).toBe(24);
    expect(_planDeadlineMonths('in 2 years')).toBe(24);
    expect(_planDeadlineMonths('under 18 mos')).toBe(18);
    expect(_planDeadlineMonths('within 500 months')).toBe(null);
    expect(_planDeadlineMonths('200 MW')).toBe(null);
  });
});

// The keyless canvas body as served live 2026-11-13 (trimmed to the fields read here).
const CANVAS_KEYLESS = {
  ok: true, matched: 124, applied_filters: { max_months: null, region: 'us' },
  constraint_coverage: {
    capacity_mw: { applied: false, status: 'unavailable',
      reason: 'The shortlist is NOT sized to this target. Ranking uses region, time-to-power, DCPI verdict and composite score.' },
    max_months: { applied: false, status: 'locked',
      reason: "max_months was not applied: it filters on time to power, which this caller's access does not open. This answer ranks without it." },
    region: { applied: true },
  },
  shortlist: [{ market: 'Midland–Odessa', slug: 'midland-tx', state: 'TX', iso: 'ERCOT', verdict: 'BUILD' }],
};

describe('item 3: what a step dropped is named, with its reason', () => {
  const executed = [
    { step: 1, tool: 'get_refined_queue', status: 'executed', args: { state: 'NV' },
      result: { ok: true, freshness_by_iso: { CAISO: '2026-11-12' } } },
    { step: 2, tool: 'site_selection_canvas', status: 'executed', args: { region: 'us', capacity_mw: 200, max_months: 24 },
      result: CANVAS_KEYLESS },
    { step: 3, tool: 'find_sites', status: 'executed', args: { state: 'NV', min_mw: 200 },
      result: { _ignored_params: { min_mw: 'min_mw=200 was asked and NOT applied: the threshold is a paid filter; this preview uses the default 50' } } },
    { step: 4, tool: 'get_market_dcpi_rank', status: 'not_run', args: {}, result: { _ignored_params: { x: 'y' } } },
  ];

  it('collects the queue coverage, the canvas dispositions and _ignored_params', () => {
    const d = _execDroppedFilters(executed, null);
    expect(d.map((x) => `${x.step}|${x.tool}|${x.param}|${x.kind}`)).toEqual([
      '1|get_refined_queue|state|coverage',
      '2|site_selection_canvas|capacity_mw|not_applied',
      '2|site_selection_canvas|max_months|locked',
      '3|find_sites|min_mw|not_applied',
    ]);
    const mm = d.find((x) => x.param === 'max_months');
    expect(mm.asked).toBe(24);
    expect(mm.reason).toMatch(/^it filters on time to power/);   // own reason, prefix not doubled
    expect(d.find((x) => x.param === 'min_mw').reason).toMatch(/^the threshold is a paid filter/);
  });

  it('the sentence says each one plainly', () => {
    const s = _execDroppedSentence(_execDroppedFilters(executed, null));
    expect(s).toMatch(/^DROPPED — step 1 get_refined_queue: queue rows for NV come only from CAISO's queue/);
    expect(s).toContain('step 2 site_selection_canvas: max_months=24 was not applied (it filters on time to power');
    expect(s).toContain('step 3 find_sites: min_mw=200 was not applied (the threshold is a paid filter');
    expect(s).toMatch(/Say this plainly in the answer/);
    expect(_execDroppedSentence([])).toBe('');
  });

  it('an argument the step was not asked for is not reported; a broken result never throws', () => {
    const d = _execDroppedFilters([{ step: 1, tool: 'site_selection_canvas', status: 'executed', args: { region: 'us' }, result: CANVAS_KEYLESS }], null);
    expect(d).toEqual([]);
    expect(_execDroppedFilters(null, null)).toEqual([]);
    expect(_execDroppedFilters([{ step: 1, tool: 'x', status: 'executed', result: { constraint_coverage: ['a list'] } }], null)).toEqual([]);
  });
});
