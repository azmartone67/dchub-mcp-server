// planner-528-named-towns.test.mjs — planner 5.28 (owner wave 2, 2026-11-14), pure functions, no network.
//
// B1: an Abilene / Sweetwater gas + air-permit plan skipped get_air_permit_context ("missing lon") and ran
//   nothing that reads a verdict or a time to power. A town named beside its state, or a DCPI market the
//   text names, is now NAMED on each step that waits on a point (`geocode`), and execute_plan fills the
//   point from the backend geocoder. The air-permit plan reads the market's DCPI card, else the state's
//   power timeline.
// B2: a Reno queue read that came back from CAISO's file says Reno is on NV Energy's grid (WECC), not CAISO.
// B9: a stateless call whose Mcp-Session-Id header is not a token (a header list, garbage) used to carry
//   that string into ctx.session_id and from there into redeem_url.
// D1: get_grid_scoreboard gets 5 s inside a plan; provenance once per plan (lib/plan-provenance-once.mjs).
//
// The execute_plan runs are in test/planner-528-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _planUnmatchedPlace, _planGeocodeTargets, _execGeocodePlan,
  _execDroppedFilters, _sessionIdToken, _execStepCapMs, _EXEC_SCOREBOARD_MS_DEFAULT, PLANNER_VERSION } from '../server.mjs';
import { planProvenanceOnceObject, planProvenanceOnceStep } from '../lib/plan-provenance-once.mjs';

const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint, s.geocode || null]));
const step = (p, tool) => p.recommended_sequence.find((s) => s.tool === tool);

describe('planner 5.28: named towns (B1)', () => {
  it('PLANNER_VERSION is 5.28 or later (5.29)', () => { expect(PLANNER_VERSION).toBe('5.31'); });

  it('_planUnmatchedPlace takes the capitalised run that ENDS at the state ("gas near Sweetwater TX")', () => {
    const t = 'Behind-the-meter gas near Sweetwater TX: what air permits apply?';
    expect(_planUnmatchedPlace(t, _planSignals(t, {}))).toEqual({ phrase: 'Sweetwater', state: 'TX' });
    const t2 = 'air permits for gas turbines at a site near Big Spring, Texas';
    expect(_planUnmatchedPlace(t2, _planSignals(t2, {}))).toEqual({ phrase: 'Big Spring', state: 'TX' });
  });

  it('Sweetwater TX air permits: the air-permit step is named for the geocoder, and a power step joins the plan', () => {
    const p = _planQuery('Behind-the-meter gas generation near Sweetwater TX: what air permits apply?', {});
    expect(p.intent_class).toBe('air_permits');
    const air = step(p, 'get_air_permit_context');
    expect(air, show(p)).toBeTruthy();
    expect(air.geocode, show(p)).toBe('Sweetwater, TX');
    expect(step(p, 'get_power_availability_timeline'), show(p)).toMatchObject({ args_hint: { state: 'TX' } });
  });

  it('Abilene TX air permits (a DCPI market): the plan reads the Abilene DCPI card', () => {
    const p = _planQuery('Behind-the-meter gas generation for a 300 MW data center near Abilene TX: what are the air permit constraints?', {});
    expect(p.intent_class).toBe('air_permits');
    expect(step(p, 'get_air_permit_context').args_hint).toEqual({ site: 'abilene' });
    expect(step(p, 'get_market_dcpi_rank'), show(p)).toMatchObject({ args_hint: { market_slug: 'abilene' } });
  });

  it('"how fast can I get power" is a time-to-power ask (the DCPI lead joins an air-permit plan)', () => {
    const p = _planQuery('How fast can I get 300 MW of power near Abilene, TX? Any nonattainment issues for gas turbines?', {});
    expect(p.intent_class).toBe('air_permits');
    expect(step(p, 'get_market_dcpi_rank'), show(p)).toMatchObject({ args_hint: { market_slug: 'abilene' } });
  });

  it('"how soon / how fast can I get power" beside another ask adds the market\'s DCPI card (time-to-power lead)', () => {
    for (const t of ['water risk near Abilene TX and how soon can I get power',
      'What are the gas prices near Abilene TX and how fast can I get power?']) {
      const p = _planQuery(t, {});
      expect(step(p, 'get_market_dcpi_rank'), t + ' ' + show(p)).toMatchObject({ args_hint: { market_slug: 'abilene' } });
    }
  });

  it('a DCPI market named in a capacity ask: analyze_site waits on the market point, named for the geocoder', () => {
    const p = _planQuery('How fast can a 300 MW data center near Abilene TX get power?', {});
    const as = step(p, 'analyze_site');
    expect(as, show(p)).toBeTruthy();
    expect(as.geocode, show(p)).toBe('Abilene, TX');
    expect(as.geocode_basis).toBe('market');
  });

  it('a bare town with no state, or a point in the text, is never geocoded', () => {
    const p = _planQuery('air permits for gas generation near Lubbock', {});
    expect(p.recommended_sequence.some((s) => s.geocode), show(p)).toBe(false);
    const q = _planQuery('air permits for gas turbines at 32.47,-100.41 near Sweetwater TX', {});
    expect(q.recommended_sequence.some((s) => s.geocode), show(q)).toBe(false);
  });

  it('_planGeocodeTargets names only steps whose lat AND lon are both placeholders', () => {
    const seq = [{ tool: 'a', args_hint: { lat: '<site lat>', lon: '<site lon>' } },
      { tool: 'b', args_hint: { lat: 32.1, lon: '<site lon>' } }, { tool: 'c', args_hint: { state: 'TX' } }];
    const t = 'air permits near Sweetwater TX';
    const r = _planGeocodeTargets(seq, t, _planSignals(t, {}));
    expect(r).toMatchObject({ query: 'Sweetwater, TX', steps: 1, basis: 'town' });
    expect(seq.map((s) => s.geocode || null)).toEqual(['Sweetwater, TX', null, null]);
  });
});

describe('_execGeocodePlan (B1)', () => {
  const seq = () => [{ tool: 'get_air_permit_context', geocode: 'Sweetwater, TX', args_hint: { lat: '<site lat>', lon: '<site lon>' } },
    { tool: 'get_permitting_intel', args_hint: { state: 'TX' } }];

  it('fills lat/lon (rounded) in a copy of args_hint from one geocoder read', async () => {
    const s = seq(); const orig = s[0].args_hint; const calls = [];
    const r = await _execGeocodePlan(s, async (q) => { calls.push(q); return { lat: 32.4706123, lng: -100.4073812, label: 'Sweetwater, Texas', source: 'arcgis' }; });
    expect(calls).toEqual(['Sweetwater, TX']);
    expect(s[0].args_hint).toEqual({ lat: 32.47061, lon: -100.40738 });
    expect(orig).toEqual({ lat: '<site lat>', lon: '<site lon>' });
    expect(r[0]).toMatchObject({ query: 'Sweetwater, TX', lat: 32.47061, lon: -100.40738, steps: 1, source: 'arcgis' });
    expect(s[1].args_hint).toEqual({ state: 'TX' });
  });

  it('a point whose label is in another state is refused and the placeholders stay', async () => {
    const s = seq();
    const r = await _execGeocodePlan(s, async () => ({ lat: 39.8, lng: -89.6, label: 'Springfield, Illinois' }));
    expect(s[0].args_hint).toEqual({ lat: '<site lat>', lon: '<site lon>' });
    expect(r[0].resolved).toBe(false);
    expect(r[0].note).toMatch(/outside TX/);
  });

  it('a miss, a throw and a timeout each leave the placeholders and say why', async () => {
    for (const [fn, re] of [[async () => null, /no point/], [async () => { throw new Error('x'); }, /failed/],
      [() => new Promise(() => {}), /did not answer within 50 ms/]]) {
      const s = seq();
      const r = await _execGeocodePlan(s, fn, 50);
      expect(s[0].args_hint.lat).toBe('<site lat>');
      expect(r[0].note).toMatch(re);
    }
  });

  it('no geocode target in the plan: null, and the geocoder is never called', async () => {
    let n = 0;
    expect(await _execGeocodePlan([{ tool: 'x', args_hint: {} }], async () => { n += 1; return null; })).toBe(null);
    expect(n).toBe(0);
  });
});

describe('Reno queue coverage names NV Energy (B2)', () => {
  const e = { step: 2, tool: 'get_refined_queue', status: 'executed', args: { state: 'NV', min_mw: 200 },
    result: { freshness_by_iso: { CAISO: '2026-11-13' }, results: [] } };

  it('with the bound market (Reno, NV, WECC) the sentence says Reno is on NV Energy\'s grid, not CAISO', () => {
    const t = 'I need 200 MW in Reno within 24 months. Can I get power there in time, and what are faster alternatives?';
    const place = _planSignals(t, {}).__outlook;
    expect(place && place.state).toBe('NV');
    const d = _execDroppedFilters([e], new Map(), place);
    const row = d.find((x) => x.param === 'state');
    expect(row.kind).toBe('coverage');
    expect(row.reason).toMatch(/Reno is on NV Energy's grid \(WECC\), not CAISO/);
    expect(row.reason).toMatch(/does not read NV Energy's queue/);
  });

  it('without a bound market the generic coverage sentence stays', () => {
    const d = _execDroppedFilters([e], new Map());
    const row = d.find((x) => x.param === 'state');
    expect(row.reason).toMatch(/come only from CAISO's queue/);
    expect(row.reason).not.toMatch(/NV Energy/);
  });
});

describe('_sessionIdToken (B9)', () => {
  it('keeps a session token (uuid, oai- id) and refuses a header list, spaces, or a URL', () => {
    expect(_sessionIdToken('3f2b6c1e-8a4d-4f7a-9d2e-0b1c2d3e4f5a')).toBe('3f2b6c1e-8a4d-4f7a-9d2e-0b1c2d3e4f5a');
    expect(_sessionIdToken('oai-' + 'a1b2'.repeat(8))).toBe('oai-' + 'a1b2'.repeat(8));
    expect(_sessionIdToken('abc, def')).toBe(null);
    expect(_sessionIdToken('content-type, accept, mcp-session-id')).toBe(null);
    expect(_sessionIdToken('https://evil.example/x')).toBe(null);
    expect(_sessionIdToken('')).toBe(null);
    expect(_sessionIdToken(undefined)).toBe(null);
    expect(_sessionIdToken('a'.repeat(201))).toBe(null);
  });
});

describe('get_grid_scoreboard step cap (D1)', () => {
  it('5 s for the scoreboard, the default for every other tool; env override inside 1-20 s only', () => {
    expect(_EXEC_SCOREBOARD_MS_DEFAULT).toBe(5000);
    expect(_execStepCapMs('get_grid_scoreboard', {})).toBe(5000);
    expect(_execStepCapMs('get_grid_intelligence', {})).toBe(20000);
    expect(_execStepCapMs('get_grid_scoreboard', { DCHUB_PLAN_SCOREBOARD_MS: '8000' })).toBe(8000);
    expect(_execStepCapMs('get_grid_scoreboard', { DCHUB_PLAN_SCOREBOARD_MS: '50' })).toBe(5000);
    expect(_execStepCapMs('get_grid_scoreboard', { DCHUB_PLAN_SCOREBOARD_MS: '99999' })).toBe(5000);
  });
});

describe('provenance once per plan (D1)', () => {
  const ident = { tier: 'anonymous', key: null };
  const quota = { used: 1, limit: 25 };
  const stepProv = (i) => ({ as_of: '2026-11-13', completeness: 'partial_preview', preview: { withheld_fields: ['mw'], shown: 3, total: 9 },
    evidence: { layers: [{ name: 'x', source: 'EIA', licence: 'public', detail: 'y'.repeat(800) }] }, source: 'EIA', step_marker: i });
  const ns = { come_back: { why: 'w'.repeat(300) }, tool: 'get_changes' };
  const plan = () => ({
    _entity: 'plan_execution', identity: ident, quota, citation: { source: 'DC Hub', url: 'https://dchub.cloud' },
    provenance: { as_of: '2026-11-13', evidence: { layers: [{ step_index: 0, source: 'EIA' }, { step_index: 1, source: 'ISO' }] } },
    executed: [
      { step: 1, tool: 'a', status: 'executed', result: { rows: [{ v: 1 }], provenance: stepProv(0), identity: ident, quota, next_session: ns,
        citation: { cite_as: 'DC Hub', source: 'DC Hub', url: 'https://dchub.cloud', retrieved_at: '2026-11-14T00:00:00Z' } } },
      { step: 2, tool: 'b', status: 'executed', result: { rows: [{ v: 2 }], provenance: stepProv(1), identity: { tier: 'other' }, next_session: ns } },
      { step: 3, tool: 'c', status: 'executed', result: { rows: [{ v: 3 }], provenance: stepProv(2) } },
    ],
  });

  it('compacts a step\'s provenance to a pointer that keeps as_of, completeness and the preview counts', () => {
    const { value, steps } = planProvenanceOnceObject(plan());
    expect(steps).toBe(2);   // step 3 has no layer in the plan block and nothing else to drop
    const p0 = value.executed[0].result.provenance;
    expect(p0).toEqual({ as_of: '2026-11-13', completeness: 'partial_preview', withheld_fields: ['mw'], shown: 3, total: 9,
      see: expect.stringMatching(/step_index=0/) });
  });

  it('a step with no layer in the plan block keeps its provenance whole', () => {
    const src = plan();
    const { value } = planProvenanceOnceObject(src);
    expect(value.executed[2].result.provenance).toEqual(src.executed[2].result.provenance);
  });

  it('identity / quota go only when equal to the top level; data rows untouched; next_session once at the top', () => {
    const src = plan();
    // D1 alone (DCHUB_PLAN_ENVELOPE_ONCE=0): a differing identity stays on its step.
    expect(planProvenanceOnceObject(src, { envelopeOnce: false }).value.executed[1].result.identity).toEqual({ tier: 'other' });
    const { value } = planProvenanceOnceObject(src);
    expect(value.executed[0].result.identity).toBeUndefined();
    expect(value.executed[0].result.quota).toBeUndefined();
    // Note K item 9 (envelope once, the default): identity is emitted once, at the top; a step served under a
    // different tier keeps only that tier as `served_as`.
    expect(value.executed[1].result.identity).toBeUndefined();
    expect(value.executed[1].result.served_as).toBe('other');
    for (let i = 0; i < 3; i++) expect(value.executed[i].result.rows).toEqual(src.executed[i].result.rows);
    expect(value.executed[0].result.next_session).toBeUndefined();
    expect(value.executed[1].result.next_session).toBeUndefined();
    expect(value.next_session).toEqual(ns);
    expect(value.executed[0].result.citation).toEqual({ cite_as: 'DC Hub' });
    expect(JSON.stringify(value).length).toBeLessThan(JSON.stringify(src).length);
  });

  it('not a plan envelope: returned as is; kill switch DCHUB_PLAN_PROVENANCE_ONCE=0 and loopback skip', () => {
    const x = { _entity: 'other', executed: [] };
    expect(planProvenanceOnceObject(x).value).toBe(x);
    const r = { content: [{ type: 'text', text: JSON.stringify(plan()) }], structuredContent: plan() };
    expect(planProvenanceOnceStep(r, { env: { DCHUB_PLAN_PROVENANCE_ONCE: '0' } })).toBe(r);
    expect(planProvenanceOnceStep(r, { skip: true, env: {} })).toBe(r);
    const on = planProvenanceOnceStep(r, { env: {} });
    expect(on.structuredContent.executed[0].result.provenance.see).toMatch(/step_index=0/);
    expect(JSON.parse(on.content[0].text).executed[0].result.provenance.see).toMatch(/step_index=0/);
  });
});
