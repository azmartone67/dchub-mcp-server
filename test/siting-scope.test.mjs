// siting-scope.test.mjs — Grok 2026-10-18 P0-1 / P0-2.
// A screen named for Phoenix / Dallas / Northern Virginia must return only in-state rows, say what it cut,
// and carry a land step; find_sites must report target_mw as unapplied and not serve UNKNOWN* names.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cutResultToState, rowState, landSiteStep, annotateFindSites, isLandSiteIntent } from '../lib/siting-scope.mjs';
import { _execIntentState, _execScopeOut, _planSignals, _sitesRawHint } from '../server.mjs';

const gen = (name, state) => ({ generator: { name, state }, queue_pressure: { county_state: `X, ${state}` } });
const RET = { data: [gen('Sherburne', 'MN'), gen('Alamitos', 'CA'), gen('Comanche', 'CO'), gen('Coronado', 'AZ')],
  count_returned: 4, total_retiring_mw: 9000 };

describe('state cut', () => {
  it('keeps only rows in the intent state and nulls the unscoped totals', () => {
    const { result, scope } = cutResultToState('get_retirement_headroom', RET, 'AZ');
    expect(result.data.map((r) => r.generator.name)).toEqual(['Coronado']);
    expect(result.count_returned).toBe(1);
    expect(result.total_retiring_mw).toBeNull();
    expect(scope.unscoped_totals.total_retiring_mw).toBe(9000);
    expect(scope.dropped_out_of_state).toBe(3);
  });
  it('withholds every unscoped total the intent answer could quote', () => {
    const r = { data: [gen('Coronado', 'AZ')], count_returned: 1, _total_available: 4, _data_total_in_pro: 9, total_retiring_mw: 5 };
    const { result, scope } = cutResultToState('get_retirement_headroom', r, 'AZ');
    expect(result._total_available).toBeNull();
    expect(result._data_total_in_pro).toBeNull();
    expect(scope.unscoped_totals._total_available).toBe(4);
    const q = cutResultToState('get_refined_queue', { results: [], count_total_matching: 3081, _results_total_in_pro: 3081, total_queued_mw: 1 }, 'AZ').result;
    expect(q.count_total_matching).toBeNull();
    expect(q._results_total_in_pro).toBeNull();
  });
  it('an empty cut says it is not proof of absence', () => {
    const { result, scope } = cutResultToState('get_retirement_headroom', RET, 'TX');
    expect(result.data).toEqual([]);
    expect(scope.note).toMatch(/not proof/);
  });
  it('a row whose state cannot be read is dropped, never assumed in-state', () => {
    const { result, scope } = cutResultToState('get_refined_queue', { results: [{ name: 'p' }, { state: 'AZ' }], count_returned: 2 }, 'AZ');
    expect(result.results).toHaveLength(1);
    expect(scope.dropped_state_unreadable).toBe(1);
  });
  it('reads state from every row shape the two tools use', () => {
    expect(rowState({ state: 'az' })).toBe('AZ');
    expect(rowState({ generator: { state: 'CA' } })).toBe('CA');
    expect(rowState({ queue_pressure: { county_state: 'Maricopa, AZ' } })).toBe('AZ');
    expect(rowState({ county_state: 'Los Angeles, CA' })).toBe('CA');
    expect(rowState({ state: 'Arizona' })).toBeNull();
    expect(rowState(null)).toBeNull();
  });
  it('leaves other tools and a missing state untouched', () => {
    expect(cutResultToState('get_market_dcpi_rank', RET, 'AZ').scope).toBeNull();
    expect(cutResultToState('get_retirement_headroom', RET, null).result).toBe(RET);
  });
});

describe('intent state', () => {
  it.each([
    ['live land + power screen for ~100 MW in Phoenix', 'AZ'],
    ['live land + power screen for ~100 MW in Dallas', 'TX'],
    ['find 100 MW of powered land in Northern Virginia', 'VA'],
  ])('%s -> %s', (t, st) => expect(_execIntentState(t, _planSignals(t, {}))).toBe(st));
  it('a two-state comparison resolves to no state, so nothing is cut', () => {
    const t = 'compare Phoenix vs Dallas for 100 MW';
    expect(_execIntentState(t, _planSignals(t, {}))).toBeNull();
  });
  it('_execScopeOut cuts both the slim and the full result for a Phoenix intent', () => {
    const out = { ok: true, result: { ...RET }, full: { ...RET } };
    const t = 'live land + power screen for ~100 MW in Phoenix';
    const scope = _execScopeOut('get_retirement_headroom', out, _planSignals(t, {}), t);
    expect(scope.state).toBe('AZ');
    expect(out.result.data).toHaveLength(1);
    expect(out.full.data).toHaveLength(1);
  });
  it('a failed step is never rewritten', () => {
    const out = { ok: false, result: { ...RET } };
    expect(_execScopeOut('get_retirement_headroom', out, {}, 'power in Phoenix')).toBeNull();
    expect(out.result.data).toHaveLength(4);
  });
});

describe('land step', () => {
  it('a land intent with a state gets find_sites', () => {
    const s = landSiteStep('live land + power screen for ~100 MW in Phoenix', { state: 'AZ' }, ['get_retirement_headroom']);
    expect(s.tool).toBe('find_sites');
    expect(s.args_hint).toEqual({ state: 'AZ' });
  });
  it('no geography, no step (find_sites would 400)', () => {
    expect(landSiteStep('find me land', {}, [])).toBeNull();
  });
  it('"site" as a verb is not a land intent', () => {
    expect(isLandSiteIntent('site a 50 MW data center in central Illinois')).toBe(false);
    expect(isLandSiteIntent('find sites in Ohio')).toBe(true);
    expect(isLandSiteIntent('find a site for a 150 MW data center in Ohio')).toBe(true);
    expect(isLandSiteIntent('the best site near Dallas')).toBe(true);
    expect(isLandSiteIntent('we need to site 200 MW in Texas')).toBe(false);
    expect(isLandSiteIntent('powered land near Dallas')).toBe(true);
  });
  it('a power-only intent and an existing find_sites step add nothing', () => {
    expect(isLandSiteIntent('how much power is available in ERCOT')).toBe(false);
    expect(landSiteStep('power in Phoenix', { state: 'AZ' }, [])).toBeNull();
    expect(landSiteStep('land in Phoenix', { state: 'AZ' }, ['find_sites'])).toBeNull();
  });
  it('a point geography is used when there is no state', () => {
    expect(landSiteStep('sites near here', { coords: { lat: 33.4, lon: -112.1 } }, []).args_hint.lat).toBe(33.4);
  });
});

describe('find_sites honesty', () => {
  const P = { candidates: [{ anchor: { name: 'UNKNOWN302688' } }, { anchor: { name: 'Real Sub' } }], unapplied_constraints: [] };
  it('target_mw is reported unapplied with a warning', () => {
    const o = annotateFindSites(P, { state: 'TX', target_mw: 100 });
    expect(o.unapplied_constraints).toEqual(['target_mw']);
    expect(o.unapplied_constraints_warning).toMatch(/not sized/);
    expect(o.target_mw_note).toMatch(/100/);
  });
  it('no target_mw leaves unapplied_constraints alone', () => {
    expect(annotateFindSites(P, { state: 'TX' }).unapplied_constraints).toEqual([]);
  });
  it('UNKNOWN* anchor names are dropped, real names kept', () => {
    const o = annotateFindSites(P, {});
    expect(o.candidates[0].anchor.name).toBeNull();
    expect(o.candidates[1].anchor.name).toBe('Real Sub');
  });
  it('does not duplicate an already-listed constraint', () => {
    const o = annotateFindSites({ unapplied_constraints: ['target_mw'] }, { target_mw: 5 });
    expect(o.unapplied_constraints).toEqual(['target_mw']);
  });
});

describe('wiring in server.mjs', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  it('both execution paths cut by intent state and record state_scope', () => {
    expect(src).toContain('_execScopeOut(s.tool, out, _sig, a && a.intent)');
    expect(src).toContain('_execScopeOut(s.tool, out2, _sig, a && a.intent)');
    expect((src.match(/state_scope: scope/g) || []).length).toBe(2);
  });
  it('find_sites annotates its answer and does NOT declare target_mw (frozen + size-guarded catalogs)', () => {
    expect(src).toContain('_annotateFindSites(await _findSitesForCaller(');
    expect(src).not.toMatch(/target_mw: N\.describe\('NOT a screening input/);
    expect(src).toContain('const _sh = _sitesRawHint(req.body);');
    expect(src).toContain('_sitesArgHint.enterWith(_sh)');
  });
  it('the raw hint reads target_mw or capacity_mw from a find_sites call only', () => {
    const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
    expect(_sitesRawHint(call('find_sites', { state: 'TX', target_mw: 100 }))).toEqual({ target_mw: 100 });
    expect(_sitesRawHint(call('find_sites', { capacity_mw: '150' }))).toEqual({ target_mw: 150 });
    expect(_sitesRawHint(call('find_sites', { state: 'TX' }))).toBeNull();
    expect(_sitesRawHint(call('analyze_site', { target_mw: 100 }))).toBeNull();
    expect(_sitesRawHint(call('find_sites', { target_mw: 'lots' }))).toBeNull();
    expect(_sitesRawHint({ method: 'initialize' })).toBeNull();
  });
  it('the land step is appended for capacity_search only', () => {
    expect(src).toMatch(/top\.cls\.id === 'capacity_search' \? _landSiteStep\(/);
  });
});
