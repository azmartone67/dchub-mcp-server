// planner-540-xd-energy.test.mjs — planner 5.40 (Grok energy + cross-domain round 2, 2026-11-17 night). Pure functions,
// no network. Fixtures are live keyless payloads read 2026-11-18 ~05:10Z, trimmed (test/fixtures/xd-energy-1118).
//
// Note 1 (cross-domain 45/60): one place, both sides; the power side quotes every power step's dated fact, narrowest
// queue first; utility feeder hosting capacity near a covered place; "Phoenix (APS/SRP/TEP, WECC)", never "WECC (ISO)";
// the capacity_grid lead says the cut was not applied; a step fact the answer already states is not listed twice.
// Note 2 (energy 132/240): a grid's price now leads with the price; a gas answer leads with the gas price (or withheld)
// and the DCGI verdict; withdrawals read status=withdrawn and say plainly when they are not held.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { buildCrossDomainAnswer, HEADLINE_MAX } from '../lib/cross-domain-answer.mjs';
import { buildPriceNowAnswer, buildGasPriceAnswer, buildQueueWithdrawalsAnswer, NOT_LMP_NOTE, WITHDRAWALS_NOT_HELD } from '../lib/energy-answers.mjs';
import { gridLabel, dcPowerPlaceAsk, dcPowerPlaceTakes, priceNowAsk, queueWithdrawalsAsk } from '../lib/dc-power-place.mjs';
import { factsFromExecuted } from '../lib/plan-step-facts.mjs';
import { compactPlanObject } from '../lib/plan-compact.mjs';
import { withPriceAndDcpi } from '../lib/keyless-first-full.mjs';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/xd-energy-1118/${n}.json`, import.meta.url), 'utf8'));
const steps = (p) => p.recommended_sequence;
const show = (p) => JSON.stringify(steps(p).map((s) => [s.step, s.tool, s.args_hint]));
const step = (p, tool) => steps(p).find((s) => s.tool === tool);
const ex = (n, tool, args, result) => ({ step: n, tool, args, status: 'executed', result });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));

const Q_CMH = 'What grid headroom and interconnection queue is there for a 100 MW data center campus near Columbus, Ohio?';
const Q_PHX = 'How long would it take to get power for a 100 MW data center in Phoenix, and what does the grid look like there?';
const Q_DAL = 'How soon could a 50 MW data center in Dallas get power, and what do electricity prices look like there?';

describe('planner 5.40 routing', () => {
  it('is planner 5.40', () => { expect(PLANNER_VERSION).toBe('5.47'); });

  it('Columbus: dc_power_place reads the market, PJM headroom, the OH queue slice, AEP Ohio feeders and the OH timeline', () => {
    const p = _planQuery(Q_CMH, {});
    expect(p.intent_class, show(p)).toBe('dc_power_place');
    expect(step(p, 'get_market_intel').args_hint).toEqual({ market: 'columbus' });
    expect(step(p, 'get_grid_intelligence').args_hint).toEqual({ iso: 'PJM' });
    expect(step(p, 'get_refined_queue').args_hint).toEqual({ iso: 'PJM', state: 'OH' });
    expect(step(p, 'get_hosting_capacity').args_hint).toMatchObject({ lat: 39.9612, lon: -82.9988, capacity_type: 'load' });
    expect(step(p, 'get_power_availability_timeline').args_hint).toMatchObject({ state: 'OH' });
    expect(step(p, 'get_energy_prices')).toBeUndefined();   // no price words
    expect(steps(p).every((s) => s.depends_on.length === 0)).toBe(true);
  });

  it('Phoenix: no RTO, so filed retirements in AZPS/SRP/TEPC replace headroom; no feeder step (no load-side publisher)', () => {
    const p = _planQuery(Q_PHX, {});
    expect(p.intent_class, show(p)).toBe('dc_power_place');
    expect(step(p, 'get_grid_intelligence')).toBeUndefined();
    expect(step(p, 'get_retirement_headroom').args_hint).toMatchObject({ region_iso: 'AZPS,SRP,TEPC', target_mw: 100 });
    expect(step(p, 'get_refined_queue').args_hint).toEqual({ state: 'AZ' });
    expect(step(p, 'get_hosting_capacity')).toBeUndefined();
  });

  it('Dallas: the price step reads Texas, never the US average', () => {
    const p = _planQuery(Q_DAL, {});
    expect(p.intent_class, show(p)).toBe('dc_power_place');
    expect(step(p, 'get_energy_prices').args_hint).toEqual({ state: 'TX' });
    expect(step(p, 'get_refined_queue').args_hint).toEqual({ iso: 'ERCOT', state: 'TX' });
  });

  it('a market named without its state binds the state on the price class too', () => {
    const p = _planQuery('What do electricity prices look like for data centers in Dallas?', {});
    const ep = step(p, 'get_energy_prices');
    expect(ep && ep.args_hint, show(p)).toEqual({ state: 'TX' });
  });

  it('price_now: a grid price ask reads the price for the grid and its live demand', () => {
    const p = _planQuery('What is the price of electricity in ERCOT right now?', {});
    expect(p.intent_class, show(p)).toBe('price_now');
    expect(steps(p).map((s) => [s.tool, s.args_hint])).toEqual([
      ['get_energy_prices', { iso: 'ERCOT' }], ['get_grid_data', { iso: 'ERCOT', metric: 'demand' }]]);
  });

  it('queue_withdrawals: status=withdrawn by ISO', () => {
    const p = _planQuery('How many projects withdrew from the PJM interconnection queue this year?', {});
    expect(p.intent_class, show(p)).toBe('queue_withdrawals');
    expect(step(p, 'get_refined_queue').args_hint).toMatchObject({ iso: 'PJM', status: 'withdrawn' });
  });

  it('gas: get_gas_economics resolves its market from the state', () => {
    const p = _planQuery('What is the natural gas price for on-site generation for a data center in Texas?', {});
    expect(p.intent_class, show(p)).toBe('gas_price');
    expect(step(p, 'get_gas_economics').args_hint).toEqual({ market: 'dallas' });
  });

  it('controls: outlook, sized time-to-power without a grid word, colocation and a pure price ask keep their class', () => {
    expect(_planQuery('What is the power and interconnection outlook for data centers in Phoenix?', {}).intent_class).toBe('market_outlook');
    expect(_planQuery('How fast can a 300 MW data center near Abilene TX get power?', {}).intent_class).toBe('capacity_search');
    expect(_planQuery('colocation in Dallas for 2 MW', {}).intent_class).toBe('colocation');
    expect(_planQuery('power prices in Arizona for a data center', {}).intent_class).toBe('price');
    expect(_planQuery('Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what do grid headroom and the interconnection queue look like there?', {}).intent_class).toBe('capacity_grid');
  });
});

describe('detection helpers', () => {
  it('dcPowerPlaceAsk needs a data-center noun, a power noun and one place', () => {
    expect(dcPowerPlaceAsk(Q_CMH, {}, { state: 'OH' })).toBe(true);
    expect(dcPowerPlaceAsk(Q_CMH, {}, { state: null })).toBe(false);
    expect(dcPowerPlaceAsk('grid headroom in Ohio', {}, { state: 'OH' })).toBe(false);
    expect(dcPowerPlaceAsk(Q_CMH, { states: ['OH', 'IN'] }, { state: 'OH' })).toBe(false);
    expect(dcPowerPlaceAsk(Q_CMH, { coords: { lat: 1, lon: 2 } }, { state: 'OH' })).toBe(false);
  });
  it('dcPowerPlaceTakes keeps capacity_search and price unless the grid is asked', () => {
    expect(dcPowerPlaceTakes('capacity_search', 'how fast can 300 MW get power near Abilene')).toBe(false);
    expect(dcPowerPlaceTakes('capacity_search', Q_PHX)).toBe(true);
    expect(dcPowerPlaceTakes('price', 'power prices in Arizona for a data center')).toBe(false);
    expect(dcPowerPlaceTakes('price', Q_DAL)).toBe(true);
    expect(dcPowerPlaceTakes('market_outlook', Q_CMH)).toBe(false);
  });
  it('priceNowAsk: no data-center noun, no gas, one grid', () => {
    expect(priceNowAsk('What is the price of electricity in ERCOT right now?', { iso: 'ERCOT' })).toBe(true);
    expect(priceNowAsk('What is the price of electricity in ERCOT for a data center?', { iso: 'ERCOT' })).toBe(false);
    expect(priceNowAsk('natural gas price in ERCOT', { iso: 'ERCOT' })).toBe(false);
    expect(priceNowAsk('What is the price of electricity right now?', {})).toBe(false);
  });
  it('queueWithdrawalsAsk', () => {
    expect(queueWithdrawalsAsk('How many projects withdrew from the PJM queue?')).toBe(true);
    expect(queueWithdrawalsAsk('PJM queue depth')).toBe(false);
  });
  it('gridLabel: utilities and region off an RTO, the RTO on one', () => {
    expect(gridLabel({ label: 'Phoenix', market: 'phoenix', state: 'AZ' }, 'WECC')).toBe('Phoenix (APS/SRP/TEP, WECC)');
    expect(gridLabel({ label: 'Phoenix', market: 'phoenix', state: 'AZ' }, null)).toBe('Phoenix (APS/SRP/TEP, WECC)');
    expect(gridLabel({ label: 'Columbus', state: 'OH' }, 'PJM')).toBe('Columbus (PJM)');
    expect(gridLabel({}, 'WECC')).toBe('');
  });
});

// ---- answers ----
const INTEL = (name, n, mw, rep, verdict) => ({ success: true, market: { id: name.toLowerCase(), name }, as_of: '2026-10-13T00:00:00',
  stats: { facility_count: n, total_power_mw: mw, mw_reporting_count: rep }, siting: { dcpi: { verdict, as_of: '2026-11-18T00:34:29Z' } } });
const GRID_WITHHELD = (iso) => ({ ok: true, tool: 'get_grid_intelligence', iso, as_of: '2026-11-18T03:00:00Z',
  taste: { headline: { name: 'demand_mw', value: 101234, unit: 'MW', as_of: '2026-11-18T03:00:00Z' } }, _build_rate_pct_withheld: true });

describe('cross-domain answer, one place (gaps 2, 3, 4, 6)', () => {
  const cmh = [
    ex(1, 'get_market_intel', { market: 'columbus' }, INTEL('Columbus', 112, 2111, 12, 'AVOID')),
    ex(2, 'get_grid_intelligence', { iso: 'PJM' }, GRID_WITHHELD('PJM')),
    ex(3, 'get_refined_queue', { iso: 'PJM', state: 'OH' }, fx('refined-queue-pjm-oh')),
    ex(4, 'get_hosting_capacity', { lat: 39.9612, lon: -82.9988, radius_km: 25, capacity_type: 'load' }, fx('hosting-capacity-columbus')),
  ];
  const ia = buildCrossDomainAnswer({ intent: Q_CMH, intent_class: 'dc_power_place', requested_mw: 100,
    place: { label: 'Columbus', state: 'OH', iso: 'PJM', market: 'columbus' } }, cmh, asMap(cmh));

  it('leads with the OH slice of the queue, then headroom withheld, then the AEP Ohio feeders, inside the headline budget', () => {
    expect(ia.headline).toMatch(/^Columbus \(PJM\)\. Data centers: 112 facilities, 2,111 MW tracked/);
    expect(ia.headline).toContain('Power: PJM queue (OH): 175 active requests (as of 2026-11-17); PJM headroom withheld');
    expect(ia.headline).toContain('utility feeder hosting capacity 307 feeders, best 7.5 MW');
    expect(ia.headline.indexOf('queue (OH)')).toBeLessThan(ia.headline.indexOf('headroom withheld'));
    expect(ia.headline.length).toBeLessThanOrEqual(HEADLINE_MAX + 120);   // + the one honest gap, when it fits
  });
  it('the feeder fact says not binding and names the utility; every fact is dated or says why not', () => {
    const hc = ia.facts.find((f) => f.tool === 'get_hosting_capacity');
    expect(hc.text).toMatch(/near Columbus: 307 feeders, best 7\.5 MW \(AEP Ohio & I&M\); distribution grain, not binding: verify with the utility/);
    for (const f of ia.facts) expect(Object.keys(f).some((k) => k.startsWith('_')), JSON.stringify(f)).toBe(false);
  });
  it('never says no power figure came back when a power fact exists', () => {
    expect(ia.headline).not.toMatch(/no figure this caller can read came back/);
  });

  it('Phoenix: utilities + region label; the timeline and retirement facts are the power side', () => {
    const phx = [
      ex(1, 'get_market_dcpi_rank', { market_slug: 'phoenix-az' }, { verdict: 'CAUTION', market_name: 'Phoenix', composite_score: 43.5, computed_at: '2026-11-18T00:30:00Z' }),
      ex(2, 'get_retirement_headroom', { target_mw: 100, horizon_months: 36, region_iso: 'AZPS,SRP,TEPC' }, fx('retirement-headroom-az')),
      ex(3, 'get_power_availability_timeline', { state: 'AZ', mw: 100 }, fx('timeline-az-keyless')),
    ];
    const a = buildCrossDomainAnswer({ intent: Q_PHX, intent_class: 'dc_power_place', requested_mw: 100,
      place: { label: 'Phoenix', state: 'AZ', iso: null, market: 'phoenix' } }, phx, asMap(phx));
    expect(a.geography).toBe('Phoenix (APS/SRP/TEP, WECC)');
    expect(a.headline).toMatch(/^Phoenix \(APS\/SRP\/TEP, WECC\)\./);
    expect(a.headline).not.toMatch(/WECC \(ISO\)|no figure this caller can read came back/);
    expect(a.headline).toMatch(/Power: filed retirement: Springerville unit 1/);
    expect(a.facts.some((f) => f.tool === 'get_power_availability_timeline' && /26 active generation requests located in the state/.test(f.text))).toBe(true);
  });

  it('gap 4: compact facts[] carry one PJM queue fact, not the answer\'s and the step\'s', () => {
    const q = { ok: true, tool: 'get_interconnection_queue', iso: 'PJM', as_of: '2026-11-17', last_refreshed: '2026-11-17T06:03:39Z',
      taste: { headline: { name: 'queued_generation_gw', value: 373.5, unit: 'GW' }, project_count: { value: 1241 } }, queued_generation_gw: 373.5 };
    const rows = [ex(1, 'get_interconnection_queue', { iso: 'PJM' }, q), ex(2, 'get_market_intel', { market: 'columbus' }, INTEL('Columbus', 112, 2111, 12, 'AVOID'))];
    const a = buildCrossDomainAnswer({ intent: Q_CMH, intent_class: 'interconnection_queue', place: { label: 'Columbus', state: 'OH', iso: 'PJM' } }, rows, asMap(rows));
    const c = compactPlanObject({ _entity: 'plan_execution', ok: true, intent: Q_CMH, intent_class: 'interconnection_queue', executed: rows, intent_answer: a });
    expect(c.facts.filter((f) => f.tool === 'get_interconnection_queue' && f.entity === 'PJM')).toHaveLength(1);
  });
});

describe('energy answers (Note 2 items 1-3)', () => {
  const ERCOT_EP = { ...fx('energy-prices-tx'), filter: { iso: 'ERCOT', sector: 'all', state: null } };
  const DEMAND = { ok: true, iso: 'ERCOT', metrics: { demand_mw: { value: 51597, timestamp: '2026-11-18T04:00:00Z' } }, as_of: '2026-11-18T04:00:00Z' };

  it('price_now leads with the price and its basis, says it is not real-time LMP, then live demand', () => {
    const rows = [ex(1, 'get_energy_prices', { iso: 'ERCOT' }, ERCOT_EP), ex(2, 'get_grid_data', { iso: 'ERCOT', metric: 'demand' }, DEMAND)];
    const a = buildPriceNowAnswer({ intent_class: 'price_now' }, rows, asMap(rows));
    expect(a.headline).toMatch(/^ERCOT: .*retail electricity rate: 7\.68 cents\/kWh/);
    expect(a.headline).toContain(NOT_LMP_NOTE);
    expect(a.headline).not.toMatch(/queue|GW/);
    expect(a.not_established).toContain(NOT_LMP_NOTE);
  });
  it('price_now leads with a served real-time LMP when get_energy_prices carries one', () => {
    const ep = { ...ERCOT_EP, wholesale_lmp: { iso: 'ERCOT', hub: 'HB_HOUSTON', source: 'ERCOT',
      real_time: { lmp_usd_mwh: 27.41, interval_ending: '2026-11-18T05:15:00Z', as_of: '2026-11-18T05:16:00Z', market: 'RTM', stale: false } } };
    const rows = [ex(1, 'get_energy_prices', { iso: 'ERCOT' }, ep)];
    const a = buildPriceNowAnswer({ intent_class: 'price_now' }, rows, asMap(rows));
    expect(a.headline).toMatch(/^ERCOT HB_HOUSTON real-time LMP: \$27\.41\/MWh/);
    expect(a.not_established).not.toContain(NOT_LMP_NOTE);
  });
  it('gas_price leads with the gas price (withheld here) and the DCGI verdict, never a pipeline count', () => {
    const rows = [ex(1, 'get_gas_index', { state: 'TX' }, fx('gas-index-tx')),
      ex(3, 'get_pipeline', { state: 'TX' }, { ok: true, projects: [{ name: 'x' }], total: 1 })];
    const a = buildGasPriceAnswer({ intent_class: 'gas_price' }, rows, asMap(rows));
    expect(a.headline).toMatch(/^TX natural-gas price: withheld at this access level \(EIA trailing-12-month mean, 2025-09 to 2026-08\)\./);
    expect(a.headline).toContain('TX Data Center Gas Index (DCGI) verdict: GAS-ADVANTAGED (gas access BUILD, gas cost CAUTION) (as of 2026-08-01).');
    expect(a.headline).not.toMatch(/pipeline/i);
  });
  it('gas_price quotes the state EIA price when served and says Henry Hub is not shown', () => {
    const g = fx('gas-index-tx');
    const served = { ...g, score: { ...g.score, gas_price: 3.12, _gas_price_withheld: false, gas_price_sector: 'electric power' } };
    const rows = [ex(1, 'get_gas_index', { state: 'TX' }, served), ex(2, 'get_gas_economics', { market: 'dallas' }, { ok: true, market: 'dallas', delivered_electric_usd_mmbtu: 3.4, as_of: '2026-08-01' })];
    const a = buildGasPriceAnswer({ intent_class: 'gas_price' }, rows, asMap(rows));
    expect(a.headline).toMatch(/^TX natural-gas price: \$3\.12\/MMBtu \(EIA electric power, trailing 12 months 2025-09 to 2026-08/);
    expect(a.not_established.join(' ')).toMatch(/Henry Hub spot is not shown/);
  });
  it('queue_withdrawals says withdrawals are not held when the count is zero, then the active queue', () => {
    const rq = { ...fx('refined-queue-pjm-oh'), count_total_matching: 0, filters_applied: { iso: 'PJM', state: null, status: 'withdrawn' } };
    const iq = { ok: true, iso: 'PJM', queued_generation_gw: 373.5, project_count: 1241, as_of: '2026-11-17' };
    const rows = [ex(1, 'get_refined_queue', { iso: 'PJM', status: 'withdrawn' }, rq), ex(2, 'get_interconnection_queue', { iso: 'PJM' }, iq)];
    const a = buildQueueWithdrawalsAnswer({ intent_class: 'queue_withdrawals' }, rows, asMap(rows));
    expect(a.headline.startsWith(`PJM withdrawals: ${WITHDRAWALS_NOT_HELD}`)).toBe(true);
    expect(a.headline).toContain('PJM active interconnection queue: 373.5 GW');
  });
  it('other classes get no energy answer', () => {
    expect(buildPriceNowAnswer({ intent_class: 'price' }, [], new Map())).toBeNull();
    expect(buildGasPriceAnswer({ intent_class: 'price' }, [], new Map())).toBeNull();
  });
});

describe('step facts for the new power steps', () => {
  it('refined queue, hosting, retirements, keyless timeline and gas index each give a dated fact; facts[] carries no internal marks', () => {
    const rows = [ex(1, 'get_refined_queue', { iso: 'PJM', state: 'OH' }, fx('refined-queue-pjm-oh')),
      ex(2, 'get_hosting_capacity', {}, fx('hosting-capacity-columbus')),
      ex(3, 'get_retirement_headroom', {}, fx('retirement-headroom-az')),
      ex(4, 'get_power_availability_timeline', { state: 'AZ' }, fx('timeline-az-keyless')),
      ex(5, 'get_gas_index', { state: 'TX' }, fx('gas-index-tx'))];
    const f = factsFromExecuted(rows);
    expect(f.map((x) => x.tool)).toEqual(['get_refined_queue', 'get_hosting_capacity', 'get_retirement_headroom', 'get_power_availability_timeline', 'get_gas_index', 'get_gas_index']);
    expect(f[0].text).toBe('PJM interconnection queue, OH slice: 175 active generation requests (59 firm or baseload-capable) (PJM queue file, as of 2026-11-17; a request count, not MW or headroom).');
    for (const x of f) expect(Object.keys(x).filter((k) => k.startsWith('_'))).toEqual([]);
  });
});

describe('first full answer keeps the price asked and the DCPI verdict (gap 5)', () => {
  const ep = fx('energy-prices-tx');
  const rank = { verdict: 'CAUTION', market_name: 'Dallas', computed_at: '2026-11-18T00:30:00Z' };
  const rows = [ex(1, 'get_energy_prices', { state: 'TX' }, ep), ex(2, 'get_market_dcpi_rank', { market_slug: 'dallas' }, rank)];
  const full = (e) => (e ? e.result : null);
  it('appends the TX rate and the DCPI verdict to a time-to-power answer', () => {
    const out = withPriceAndDcpi('Time to power for 50 MW in Dallas: not measurable here.', rows, full, Q_DAL);
    expect(out).toContain('Power price: TX retail rate 7.68 cents/kWh (EIA 2026 average, as of 2026-08-31; not real-time LMP).');
    expect(out).toContain('Dallas Data Center Power Index (DCPI) verdict: CAUTION (as of 2026-11-18).');
  });
  it('adds nothing the answer already states, and no price when the question has no price words', () => {
    const said = 'Dallas: TX 7.68 cents/kWh; DCPI CAUTION.';
    expect(withPriceAndDcpi(said, rows, full, Q_DAL)).toBe(said);
    expect(withPriceAndDcpi('Time to power for 50 MW in Dallas.', rows, full, 'How soon can 50 MW in Dallas get power?')).not.toMatch(/cents\/kWh/);
  });
});
