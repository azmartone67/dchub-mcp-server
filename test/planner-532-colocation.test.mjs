// planner-532-colocation.test.mjs — planner 5.32, the colocation intent class (Brain note 2026-11-16,
// colocation head-to-head). Pure functions: routing, metro resolution, kW, the named facility pair, the
// get_facility market-slug guard (planner and executor resolver), dropped_filters, and the first answer.
// The end-to-end half (real server, stub backend) is planner-532-colocation-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { _planQuery, _execResolveArgs, _execDroppedFilters, PLANNER_VERSION } from '../server.mjs';
import { isMarketSlug, facilitySlugGuard, guardPlanFacilitySteps, resolveColoMetro, coloKw, coloFacilityPair,
  coloPriceIntent, facilitySlugsFromSearch, FACILITY_SLUG_PLACEHOLDER } from '../lib/colocation-plan.mjs';
import { buildColocationAnswer } from '../lib/colocation-answer.mjs';

const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const step = (p, tool) => p.recommended_sequence.find((s) => s.tool === tool);

describe('5.32 routing: the head-to-head colocation asks', () => {
  it('PLANNER_VERSION is 5.32', () => { expect(PLANNER_VERSION).toBe('5.34'); });

  it('NoVA 500 kW (context market + state): colocation, the asked market\'s DCPI first, metro search with the kW, no canvas', () => {
    const p = _planQuery('Colocation options in Northern Virginia (Ashburn) for about 500 kW', { market: 'Northern Virginia', state: 'VA' });
    expect(p.intent_class).toBe('colocation');
    expect(p.recommended_sequence[0]).toMatchObject({ tool: 'get_market_dcpi_rank', args_hint: { market_slug: 'northern-virginia' } });
    expect(step(p, 'search_facilities').args_hint).toMatchObject({ query: 'Northern Virginia', state: 'VA', min_capacity_mw: 0.5 });
    expect(step(p, 'get_grid_intelligence').args_hint).toEqual({ iso: 'PJM' });
    expect(tools(p)).not.toContain('site_selection_canvas');
    expect(step(p, 'get_facility').args_hint.slug).toMatch(/^<facility slug/);
  });

  it('Ashburn, Sterling and Loudoun all read as the Northern Virginia metro', () => {
    for (const t of ['colo cage in Ashburn', 'need a cabinet in Sterling', 'retail colocation in Loudoun County']) {
      const p = _planQuery(t, {});
      expect(p.intent_class, t).toBe('colocation');
      expect(step(p, 'search_facilities').args_hint, t).toMatchObject({ query: 'Northern Virginia', state: 'VA' });
    }
  });

  it('Dallas is DFW; Atlanta and Chicago are their metros, never only the state', () => {
    const cases = [['colocation in Dallas for 1 MW', 'Dallas', 'TX', 'dallas'], ['colocation space available now in Atlanta for 300 kW', 'Atlanta', 'GA', 'atlanta'],
      ['carrier-neutral colocation with strong fiber in Chicago', 'Chicago', 'IL', 'chicago']];
    for (const [t, q, st, slug] of cases) {
      const p = _planQuery(t, {});
      expect(p.intent_class, t).toBe('colocation');
      expect(step(p, 'search_facilities').args_hint, t).toMatchObject({ query: q, state: st });
      expect(step(p, 'get_market_dcpi_rank').args_hint.market_slug, t).toBe(slug);
    }
  });

  it('Atlanta (no RTO) reads the GA power timeline; the availability ask keeps source_capacity last with the kW', () => {
    const p = _planQuery('Colocation space available now in Atlanta for 300 kW', {});
    expect(step(p, 'get_power_availability_timeline').args_hint).toEqual({ state: 'GA' });
    expect(tools(p)).not.toContain('get_grid_intelligence');
    const last = p.recommended_sequence[p.recommended_sequence.length - 1];
    expect(last).toMatchObject({ tool: 'source_capacity', args_hint: { min_kw: 300 } });
  });

  it('a fiber/carrier colocation ask adds metro fiber and the connectivity read at the metro core', () => {
    const p = _planQuery('Carrier-neutral colocation with strong fiber in Chicago', {});
    expect(step(p, 'get_metro_fiber').args_hint).toEqual({ market: 'chicago' });
    expect(step(p, 'get_peering_intel').args_hint).toMatchObject({ lat: expect.any(Number), lon: expect.any(Number) });
  });

  it('two named facilities: each resolved by its own search, get_facility x2 from those rows', () => {
    const p = _planQuery('Compare Equinix DC2 vs CoreSite VA1 for colocation in Ashburn', {});
    expect(p.intent_class).toBe('colocation');
    const s = p.recommended_sequence;
    expect(s.filter((x) => x.tool === 'search_facilities').map((x) => x.args_hint.query)).toEqual(['Equinix DC2', 'CoreSite VA1']);
    const gf = s.filter((x) => x.tool === 'get_facility');
    expect(gf.map((x) => x.args_hint.slug)).toEqual(['<facility slug from step 1 search_facilities row>', '<facility slug from step 2 search_facilities row>']);
    expect(tools(p)).toEqual(expect.arrayContaining(['get_market_dcpi_rank', 'get_peering_intel']));
    expect(tools(p)).not.toContain('get_market_intel');
  });

  it('two colocation metros compared: DCPI, facilities and power for each side', () => {
    const p = _planQuery('Compare colocation in Dallas vs Northern Virginia for 1 MW', {});
    expect(p.intent_class).toBe('colocation');
    expect(p.recommended_sequence.filter((x) => x.tool === 'get_market_dcpi_rank').map((x) => x.args_hint.market_slug)).toEqual(['dallas', 'northern-virginia']);
    expect(p.recommended_sequence.filter((x) => x.tool === 'search_facilities').map((x) => x.args_hint.min_capacity_mw)).toEqual([1, 1]);
    expect(p.recommended_sequence.filter((x) => x.tool === 'get_grid_intelligence').map((x) => x.args_hint.iso)).toEqual(['ERCOT', 'PJM']);
  });

  it('a colocation price ask is pricing_out_of_scope: the drivers DC Hub covers, no price tool', () => {
    const p = _planQuery('What does colocation cost per kW in Dallas?', {});
    expect(p.intent_class).toBe('pricing_out_of_scope');
    expect(tools(p)).toEqual(['get_market_dcpi_rank', 'get_energy_prices', 'get_grid_intelligence', 'get_tax_incentives']);
    expect(p.planner_rationale).toMatch(/doesn't publish colocation prices/);
    expect(JSON.stringify(p)).not.toMatch(/\$\s?\d/);
  });

  it('controls: energy prices, MW siting and markets without a colocation word are unchanged', () => {
    expect(_planQuery('what does power cost in ERCOT', {}).intent_class).toBe('price');
    expect(_planQuery('find 100 MW of buildable capacity near Dallas', {}).intent_class).toBe('capacity_search');
    expect(_planQuery('compare Phoenix vs Columbus', {}).intent_class).not.toBe('colocation');
    expect(_planQuery('how much colocation capacity is in Phoenix', {}).intent_class).toBe('colocation');
    expect(coloPriceIntent('colocation vacancy in Dallas')).toBe(false);
  });

  it('facility_search names the metro too (was search_facilities {})', () => {
    const p = _planQuery('Equinix facilities in Dallas', {});
    expect(p.intent_class).toBe('facility_search');
    expect(p.recommended_sequence[0].args_hint).toMatchObject({ query: 'Dallas', state: 'TX' });
    expect(p.recommended_sequence[1].args_hint.slug).toBe(FACILITY_SLUG_PLACEHOLDER);
  });
});

describe('5.32 signals', () => {
  it('metro aliases: longest first, context.market wins', () => {
    expect(resolveColoMetro('colo in Dallas-Fort Worth').metro.id).toBe('dallas');
    expect(resolveColoMetro('colo near Dulles', null).metro.id).toBe('northern-virginia');
    expect(resolveColoMetro('colo please', 'Northern Virginia').metro.id).toBe('northern-virginia');
    expect(resolveColoMetro('colo in Boise', null)).toBeNull();
  });
  it('kW from the text, else the MW signal in kW', () => {
    expect(coloKw('about 500 kW', null)).toBe(500);
    expect(coloKw('for 1 MW', 1)).toBe(1000);
    expect(coloKw('a cage', null)).toBeNull();
  });
  it('a facility pair needs both sides to look like facilities', () => {
    expect(coloFacilityPair('Compare Equinix DC2 vs CoreSite VA1')).toEqual({ a: 'Equinix DC2', b: 'CoreSite VA1' });
    expect(coloFacilityPair('350 E Cermak vs Equinix CH1 for colo')).toEqual({ a: '350 E Cermak', b: 'Equinix CH1' });
    expect(coloFacilityPair('compare Dallas vs Northern Virginia')).toBeNull();
  });
});

describe('5.32 get_facility never takes a market slug', () => {
  it('isMarketSlug: ^[a-z-]+-[a-z]{2}$ and the known market slugs; facility slugs pass', () => {
    for (const m of ['dallas-tx', 'atlanta-ga', 'chicago-il', 'northern-virginia', 'ashburn', 'dallas']) expect(isMarketSlug(m), m).toBe(true);
    for (const f of ['equinix-dc1-ashburn', 'flexential-dallas-tx-fde06269', 'lumen-technologies-level-3-ashburn-23a0d3a2', 'digital-realty-dfw36-dallas-38386734']) {
      expect(isMarketSlug(f), f).toBe(false);
    }
  });
  it('facilitySlugGuard blocks get_facility on a market slug and nothing else', () => {
    expect(facilitySlugGuard('get_facility', { slug: 'northern-virginia' })).toMatchObject({ missing: 'slug', value: 'northern-virginia' });
    expect(facilitySlugGuard('get_facility', { facility_id: 'dallas-tx' })).toMatchObject({ missing: 'facility_id' });
    expect(facilitySlugGuard('get_facility', { slug: 'equinix-dc1-ashburn' })).toBeNull();
    expect(facilitySlugGuard('get_market_dcpi_rank', { market_slug: 'dallas-tx' })).toBeNull();
  });
  it('planner guard: a concrete market slug on a get_facility step becomes the facility placeholder', () => {
    const seq = [{ step: 1, tool: 'get_facility', args_hint: { slug: 'atlanta-ga' } }];
    guardPlanFacilitySteps(seq);
    expect(seq[0].args_hint.slug).toBe(FACILITY_SLUG_PLACEHOLDER);
    expect(seq[0].guarded).toMatchObject({ value: 'atlanta-ga' });
  });
  it('no plan the router builds sends a market slug to get_facility', () => {
    for (const t of ['Colocation options in Northern Virginia (Ashburn) for about 500 kW', 'colo in Dallas', 'Colocation space available now in Atlanta',
      'Carrier-neutral colocation with strong fiber in Chicago', 'data centers in Chicago', 'facilities in Atlanta', 'Equinix facilities in Dallas']) {
      for (const s of _planQuery(t, {}).recommended_sequence) {
        if (s.tool === 'get_facility') expect(facilitySlugGuard('get_facility', s.args_hint), t).toBeNull();
      }
    }
  });
  it('the resolver never falls back to the intent\'s market for a facility placeholder (was get_facility{slug:"northern-virginia"})', () => {
    const minted = { slug: ['northern-virginia', 'equinix-dc1-ashburn'], __constraint_slug: 'northern-virginia' };
    const r = _execResolveArgs({ slug: FACILITY_SLUG_PLACEHOLDER }, minted, {}, false);
    expect(r.unresolved).toBe('slug');
    expect(r.args.slug).toBeUndefined();
    const m2 = { ...minted, facility_slug: ['equinix-dc1-ashburn'], __facility_by_step: { 2: ['ntt-va7-0809b12f', 'cyrusone-nva9-a1e6f66f'] } };
    expect(_execResolveArgs({ slug: FACILITY_SLUG_PLACEHOLDER }, m2, {}, false).args.slug).toBe('equinix-dc1-ashburn');
    expect(_execResolveArgs({ slug: '<facility slug from step 2 search_facilities row>' }, m2, {}, false).args.slug).toBe('ntt-va7-0809b12f');
    expect(_execResolveArgs({ slug: '<facility slug #2 from step 2 search_facilities row>' }, m2, {}, false).args.slug).toBe('cyrusone-nva9-a1e6f66f');
    expect(_execResolveArgs({ slug: '<facility slug #3 from step 2 search_facilities row>' }, m2, {}, false).unresolved).toBe('slug');
  });
  it('facility slugs are read from search rows, skipping anything market-shaped', () => {
    expect(facilitySlugsFromSearch({ data: [{ slug: 'dallas-tx' }, { slug: 'equinix-equinix-infomart-a9d628bb' }, { slug: 'digital-realty-dfw36-dallas-38386734' }] }))
      .toEqual(['equinix-equinix-infomart-a9d628bb', 'digital-realty-dfw36-dallas-38386734']);
  });
});

describe('5.32 a capacity filter that was not applied is named in dropped_filters', () => {
  it('search_facilities _params_not_applied', () => {
    const e = { step: 2, tool: 'search_facilities', status: 'executed', args: { query: 'Northern Virginia', min_capacity_mw: 0.5 },
      result: { data: [], _params_not_applied: ['min_capacity_mw'], _params_note: 'Capacity and facility-tier filters apply to callers who can read those fields; they were not applied to this search.' } };
    const d = _execDroppedFilters([e], null);
    expect(d).toEqual([expect.objectContaining({ step: 2, tool: 'search_facilities', param: 'min_capacity_mw', asked: 0.5, kind: 'not_applied' })]);
  });
});

describe('5.32 the colocation answer leads with the asked market', () => {
  const NOVA = { label: 'Northern Virginia', dcpi_slug: 'northern-virginia' };
  const executed = [
    { step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: 'northern-virginia' },
      result: { market_slug: 'ashburn', verdict: 'AVOID', composite_score: 20, computed_at: '2026-11-17T00:39:23Z' } },
    { step: 2, tool: 'search_facilities', status: 'executed', args: { query: 'Northern Virginia', state: 'VA', min_capacity_mw: 0.5 },
      result: { total_matching: 669, data: [{ name: 'Level 3 Ashburn', as_of: '2026-03-30' }, { name: 'NTT Ashburn VA7 Data Center', as_of: '2026-03-30' }],
        _params_not_applied: ['min_capacity_mw'] } },
    { step: 3, tool: 'get_grid_intelligence', status: 'executed', args: { iso: 'PJM' }, result: { iso: 'PJM', avg_time_to_power_months: 44.9 } },
    { step: 4, tool: 'site_selection_canvas', status: 'executed', args: { region: 'VA' },
      result: { markets: [{ market_name: 'Culpeper', verdict: 'AVOID' }, { market_name: 'Aldie', verdict: 'AVOID' }] } },
  ];
  const ia = buildColocationAnswer({ intent: 'Colocation options in Northern Virginia (Ashburn) for about 500 kW', intent_class: 'colocation', metro: NOVA, kw: 500 }, executed, null);

  it('headline: Northern Virginia\'s DCPI verdict, then the metro facility count', () => {
    expect(ia.kind).toBe('colocation');
    expect(ia.headline).toMatch(/^Data Center Power Index \(DCPI\) for Northern Virginia: AVOID, composite 20\/100\. 669 facilities/);
    expect(ia.headline).not.toMatch(/Culpeper|Aldie/);
    expect(ia.verdict).toMatchObject({ scope: 'market', value: 'AVOID', subject: 'northern-virginia' });
  });
  it('canvas markets are nearby alternatives, never the lead', () => {
    expect(ia.nearby_alternatives.map((a) => a.name)).toEqual(['Culpeper', 'Aldie']);
  });
  it('the 500 kW size that was not applied is said, with the record date and the grid time to power', () => {
    expect(ia.not_established.join(' ')).toMatch(/500 kW size was not applied/);
    expect(ia.evidence.join(' ')).toMatch(/facility records as of 2026-03-30/);
    expect(ia.evidence.join(' ')).toMatch(/PJM average time to power: 44\.9 months/);
  });
  it('a price ask says DC Hub does not publish colocation pricing, with no figure, plan or credit wording', () => {
    const p = buildColocationAnswer({ intent: 'colocation cost per kW in Northern Virginia', intent_class: 'pricing_out_of_scope', metro: NOVA }, executed.slice(0, 1), null);
    expect(p.headline).toMatch(/^DC Hub doesn't publish colocation prices\./);
    expect(p.out_of_scope).toBe('colocation_pricing');
    expect(JSON.stringify(p)).not.toMatch(/\$\s?\d|credits?|free key|per day|\/day|higher limits|free tier|\bPro\b/i);
  });
  it('another class gets nothing from this builder', () => {
    expect(buildColocationAnswer({ intent: 'x', intent_class: 'market_outlook', metro: NOVA }, executed, null)).toBeNull();
  });
});

describe('owner 2026-11-17: get_peering_intel runs inside execute_plan', async () => {
  const S = await import('../server.mjs');
  const CHI = { label: 'Chicago', dcpi_slug: 'chicago' };
  const dcpi = { step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: 'chicago' },
    result: { market_slug: 'chicago', verdict: 'CAUTION', composite_score: 55 } };
  const peer = (connectivity) => ({ step: 4, tool: 'get_peering_intel', status: 'executed', args: { lat: 41.85, lon: -87.62 },
    result: { source: 'PeeringDB', connectivity } });
  const ask = { intent: 'Carrier hotel and cross-connect options at 350 E Cermak in Chicago', intent_class: 'colocation', metro: CHI };

  it('is on the read-only allowlist and allowed on the default, Claude and ChatGPT directory profiles', async () => {
    expect(S._EXEC_ALLOWED_TOOLS).toContain('get_peering_intel');
    expect(S._execStepAllowed('get_peering_intel', undefined)).toBe(true);
    const { isClaudeTool } = await import('../lib/claude-directory.mjs');
    const { isDirectoryTool } = await import('../lib/chatgpt-directory.mjs');
    expect(!!isClaudeTool('get_peering_intel')).toBe(true);
    expect(!!isDirectoryTool('get_peering_intel')).toBe(true);
  });
  it('keyless preview: facilities nearby and the leading facility names; withheld counts are left out, not zero', () => {
    const ia = buildColocationAnswer(ask, [dcpi, peer({ facilities_nearby: 50, level: 'Excellent', score: null, _score_withheld: true,
      total_ix_presence: null, total_networks: null,
      top_facilities: [{ name: 'Equinix CH1/CH2/CH4 - Chicago', ix_count: null }, { name: 'Digital Realty CHI (350 E Cermak)' }] })], null);
    const line = ia.evidence.find((e) => /get_peering_intel/.test(e));
    expect(line).toBe('Peering at the metro core (PeeringDB): 50 facilities nearby; led by Equinix CH1/CH2/CH4 - Chicago, Digital Realty CHI (350 E Cermak) (get_peering_intel).');
    expect(line).not.toMatch(/\bnull\b|\b0 (IX|networks)/);
  });
  it('full read: PeeringDB counts are cited, never the derived score', () => {
    const ia = buildColocationAnswer(ask, [dcpi, peer({ facilities_nearby: 50, score: 92, total_ix_presence: 12, total_networks: 410, top_facilities: [] })], null);
    const line = ia.evidence.find((e) => /get_peering_intel/.test(e));
    expect(line).toBe('Peering at the metro core (PeeringDB): 50 facilities nearby, 12 IX presences, 410 networks (get_peering_intel).');
    expect(line).not.toMatch(/92/);
  });
});
