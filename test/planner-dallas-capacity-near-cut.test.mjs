// planner-dallas-capacity-near-cut.test.mjs — Grok 2026-11-20 P2 (QA 11-19), pure functions, no network.
//
// Live 2026-11-20 keyed, planner 5.52: "can I get 300 MW near Dallas within 36 months" and "find 300 MW of
// buildable capacity near Dallas within 36 months" route to capacity_search, not siting_search, and:
//   * get_retirement_headroom read every ERCOT retirement (region_iso only); the TX state cut kept O W Sommers and
//     J K Spruce, Bexar County (San Antonio), ~400 km from Dallas, as Dallas rows;
//   * the headline said "DCPI CAUTION (dallas-tx)": the planner's mint, not the canonical slug the card answered
//     under, and nothing about Dallas's own 37.9 months against the 36 asked;
//   * the siting lead said "past the 36-month deadline asked" without by how much.
import { describe, it, expect } from 'vitest';
import { _planNearMarketCut, _scrubDcpiProse } from '../server.mjs';
import { buildIntentAnswer, deadlineSentence } from '../lib/intent-answers.mjs';
import { cutResultNearPoint, NEAR_MARKET_KM } from '../lib/siting-scope.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const DALLAS = { lat: 32.80085, lon: -96.81941 };
const dcpi = (ttp = 37.9) => ex(1, 'get_market_dcpi_rank', { market_slug: 'dallas-tx' }, {
  market_slug: 'dallas', _requested_slug: 'dallas-tx', market_name: 'Dallas', verdict: 'CAUTION', composite_score: 42,
  time_to_power_months: ttp, latitude: DALLAS.lat, longitude: DALLAS.lon, computed_at: '2026-11-20T06:00:00Z' });
const gen = (name, county, lat, lng) => ({ generator: { name, county, state: 'TX', capacity_mw: 400 },
  representative_point: { lat, lng }, iso_context: 'ERCO' });
const retirements = () => ex(2, 'get_retirement_headroom', { target_mw: 300, horizon_months: 36, region_iso: 'ERCOT' }, {
  count_returned: 4, total_retiring_mw: 1600, meta: { baseline_age: '2026-10' },
  data: [
    gen('O W Sommers', 'Bexar', 29.308056, -98.3242),
    gen('J K Spruce', 'Bexar', 29.309722, -98.3203),
    gen('Mountain Creek', 'Dallas', 32.72, -96.94),
    { generator: { name: 'No Point', county: 'Ellis', state: 'TX' } },
  ] });
const sig = (over = {}) => ({ __namedMarkets: [], __citySlug: 'dallas-tx', ...over });
const INTENT = 'can I get 300 MW near Dallas within 36 months';
const ctx = (over = {}) => ({ intent: INTENT, intent_class: 'capacity_search', constraint_iso: ['ERCOT'], requested_mw: 300,
  deadline_months: 36, named_markets: ['dallas-tx'], state: 'TX', states: ['TX'], ...over });
const NOW = Date.parse('2026-11-20T18:00:00Z');

describe('deadline sentence says by how much', () => {
  it.each([[36, 37.9, 'past the 36-month deadline asked, by ~2 months.'], [18, 19.4, 'by ~1 month.'],
    [36, 36.2, 'by ~1 month.'], [36, 30, "That is within the 36-month deadline asked on DC Hub's modeled estimate, which the serving utility has to confirm."]])('%s vs %s', (d, t, want) => {
    expect(deadlineSentence(d, t)).toContain(want);
  });

  it('below Pro the scrub withholds the gap with the comparison', () => {
    const s = _scrubDcpiProse(`Dallas DCPI time-to-power 37.9 months (x). ${deadlineSentence(36, 37.9)}`);
    expect(s).not.toMatch(/~2 months|37\.9|past the/);
    expect(s).toContain('The 36-month deadline check is withheld at this access level.');
  });
});

describe('near-market cut: retirement rows come from near the named market', () => {
  it('drops Bexar County and rows with no point, keeps Dallas County, nulls the unscoped total', () => {
    const { result, scope } = cutResultNearPoint('get_retirement_headroom', retirements().result, DALLAS, 'Dallas');
    expect(result.data.map((r) => r.generator.name)).toEqual(['Mountain Creek']);
    expect(result.count_returned).toBe(1);
    expect(result.total_retiring_mw).toBeNull();
    expect(scope).toMatchObject({ market: 'Dallas', radius_km: NEAR_MARKET_KM, kept: 1, dropped_far: 2, dropped_no_point: 1 });
    expect(scope.nearest_dropped.row).toMatch(/Bexar County, TX/);
    expect(scope.nearest_dropped.km).toBeGreaterThan(350);
  });

  it('a tool it does not cut, or no point, passes through untouched', () => {
    const r = retirements().result;
    expect(cutResultNearPoint('get_refined_queue', r, DALLAS).scope).toBeNull();
    expect(cutResultNearPoint('get_retirement_headroom', r, null).result).toBe(r);
  });

  it('_planNearMarketCut anchors on the named market\'s DCPI card and cuts result and full alike', () => {
    const executed = [dcpi(), retirements()];
    const full = new Map([[executed[1], JSON.stringify(retirements().result)]]);
    expect(_planNearMarketCut(executed, full, sig())).toMatchObject({ market: 'Dallas' });
    expect(executed[1].result.data.map((r) => r.generator.name)).toEqual(['Mountain Creek']);
    expect(JSON.parse(full.get(executed[1])).data).toHaveLength(1);
    expect(executed[1].near_scope.kept).toBe(1);
  });

  it('two named markets, or none, or a card for another market: nothing is cut', () => {
    for (const s of [sig({ __namedMarkets: ['dallas', 'houston'] }), sig({ __citySlug: null }), sig({ __citySlug: 'houston-tx' })]) {
      const executed = [dcpi(), retirements()];
      expect(_planNearMarketCut(executed, new Map(), s)).toBeNull();
      expect(executed[1].result.data).toHaveLength(4);
    }
  });
});

describe('capacity_search near a named market leads with its time to power and the canonical slug', () => {
  it('Dallas: canonical slug, its own figure, the miss by ~2 months, retirements within the radius only', () => {
    const executed = [dcpi(), retirements()];
    _planNearMarketCut(executed, new Map(), sig());
    const a = buildIntentAnswer(ctx(), executed, null, NOW);
    expect(a.headline).toContain('DCPI CAUTION (dallas)');
    expect(a.headline).not.toContain('dallas-tx');
    expect(a.headline).toContain('Dallas DCPI time-to-power 37.9 months');
    expect(a.headline).toContain('That is past the 36-month deadline asked, by ~2 months.');
    const all = [a.headline, ...a.evidence, ...a.not_established].join(' ');
    expect(all).toContain('1 filed generator retirement within 160 km of Dallas');
    expect(all).not.toMatch(/Bexar|retirements in TX/);
  });

  it('nothing in the radius says so and names the nearest dropped row', () => {
    const r = retirements();
    r.result.data = r.result.data.filter((x) => x.generator.county === 'Bexar');
    const executed = [dcpi(), r];
    _planNearMarketCut(executed, new Map(), sig());
    const a = buildIntentAnswer(ctx(), executed, null, NOW);
    expect(a.not_established.join(' ')).toMatch(/No filed generator retirement within 160 km of Dallas.*nearest dropped was J K Spruce \(Bexar County, TX\), \d+ km away/);
  });

  it('no deadline asked: the figure, no deadline line', () => {
    const a = buildIntentAnswer(ctx({ deadline_months: null }), [dcpi()], null, NOW);
    expect(a.headline).toContain('Dallas DCPI time-to-power 37.9 months');
    expect(a.headline).not.toContain('deadline');
  });
});
