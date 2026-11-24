// answer-noniso-twin-ttp-1123.test.mjs — three answer bugs from the keyless head-to-head of 2026-11-23 (server 2.12.63,
// planner 5.62). Pure: the answer builders in-process with fixture step results, no network.
//   item 2  a state off the US ISOs never reads "0 active generation requests"; rows from an ISO that does not serve the
//           state's load are named by their source file, never as the state's grid
//   item 5  a named facility picks the fresh, filled twin (QTS Atlanta-Metro (ATL1)) over a stale exact-name row
//   item 7  a time-to-power ask on a no-RTO place (Phoenix) says the time to power is withheld, or gives the served figure
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { factsFromStep } from '../lib/plan-step-facts.mjs';
import { queueCoverageLine } from '../lib/state-queue-coverage.mjs';
import { buildCrossDomainAnswer, ttpAsk, TTP_WITHHELD_LINE } from '../lib/cross-domain-answer.mjs';
import { rankByFacilityName, buildNamedFacilityAnswer } from '../lib/named-facility.mjs';
import { facilitySlugsFromSearch } from '../lib/colocation-plan.mjs';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/xd-energy-1118/${n}.json`, import.meta.url), 'utf8'));
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));

// get_power_availability_timeline for a state DC Hub holds no queue rows for (GA read keyless 2026-11-24).
const timelineZero = (st) => ({ state: st, iso_context: ['SOCO'], timeline: [{ year: 2026, cumulative_firm_signal_mw: null, units: 4 }],
  queue_context: { active_mw: null, active_projects: 0, as_of: null, by_iso: [] }, preview_is_partial: true });
const refinedZero = (st) => ({ ok: true, count_returned: 0, count_total_matching: 0, filters_applied: { iso: null, state: st, status: 'active' }, results: [] });
// get_refined_queue state=AZ (keyless 2026-11-24, trimmed): 26 rows, all from the CAISO file.
const REFINED_AZ = { ok: true, count_returned: 2, count_total_matching: 26, filters_applied: { iso: null, state: 'AZ', status: 'active' },
  freshness_by_iso: { CAISO: { source_as_of: '2026-07-16T21:57:50+00:00' } }, summary: { by_fuel_class: { intermittent: 2 }, by_iso: { CAISO: 2 } },
  results: [{ iso: 'CAISO', state: 'AZ', county: 'LA PAZ' }, { iso: 'CAISO', state: 'AZ', county: 'LA PAZ' }], preview_is_partial: true };

describe('item 2: non-ISO states and the queue count', () => {
  for (const st of ['GA', 'AL', 'SC', 'NC']) {
    it(`${st}: no "0 active generation requests", and the coverage gap is said`, () => {
      const t = factsFromStep('get_power_availability_timeline', timelineZero(st), { state: st });
      const q = factsFromStep('get_refined_queue', refinedZero(st), { state: st });
      for (const f of [...t, ...q]) {
        expect(f.text).not.toMatch(/\b0 active generation requests?/);
        expect(f.text).toMatch(new RegExp(`^${st} is (?:mostly )?outside ISO queue coverage \\(`));
        expect(f.text).toMatch(/DC Hub has no queue rows/);
      }
      expect(t.length + q.length).toBe(2);
    });
  }
  it('GA names Southern Company / Georgia Transmission', () => {
    const [f] = factsFromStep('get_power_availability_timeline', timelineZero('GA'), { state: 'GA' });
    expect(f.text).toMatch(/^GA is outside ISO queue coverage \(Southern Company \/ Georgia Transmission\); DC Hub has no queue rows for it/);
  });
  it('an ISO state keeps its count, zero included', () => {
    const [f] = factsFromStep('get_power_availability_timeline', { ...timelineZero('OH'), queue_context: { active_projects: 175, by_iso: [{ iso: 'PJM' }] } }, { state: 'OH' });
    expect(f.text).toMatch(/^OH: 175 active generation requests located in the state \(PJM queue rows\)/);
    expect(queueCoverageLine('OH', 0, [])).toBeNull();
  });
  it('AZ rows are named by their source file, never as CAISO queue rows of the state', () => {
    const [t] = factsFromStep('get_power_availability_timeline', fx('timeline-az-keyless'), { state: 'AZ' });
    expect(t.text).not.toMatch(/CAISO queue rows/);
    expect(t.text).toMatch(/^AZ: 26 active generation requests from the CAISO queue file located in AZ \(AZ load is served by APS \/ SRP \/ TEP, WECC, not by CAISO/);
    const [q] = factsFromStep('get_refined_queue', REFINED_AZ, { state: 'AZ' });
    expect(q.text).toMatch(/^26 active generation requests from the CAISO queue file located in AZ \(AZ load is served by APS \/ SRP \/ TEP/);
  });
  it('a GA named-facility answer carries the coverage line as its power context, never "0"', () => {
    const a = buildNamedFacilityAnswer({ intent: 'details for QTS Atlanta Metro data center', intent_class: 'facility_search', facility: { name: 'QTS Atlanta Metro' } }, [
      ex(1, 'search_facilities', { query: 'QTS Atlanta Metro' }, { success: true, data: [{ name: 'QTS Atlanta-Metro (ATL1)', provider: 'QTS', city: 'Atlanta', state: 'GA', slug: 'a' }] }),
      ex(2, 'get_power_availability_timeline', { state: 'GA' }, timelineZero('GA')),
    ]);
    expect(a.headline).not.toMatch(/\b0 active generation requests/);
    expect(a.headline).toMatch(/Power context for GA \(not this facility's own supply\): GA is outside ISO queue coverage/);
  });
  it('the Phoenix dc_power_place lead says the rows are not AZ\'s own queue', () => {
    const rows = [
      ex(1, 'get_market_dcpi_rank', { market_slug: 'phoenix-az' }, { verdict: 'CAUTION', market_name: 'Phoenix', composite_score: 43.5, computed_at: '2026-11-18T00:30:00Z' }),
      ex(2, 'get_refined_queue', { state: 'AZ' }, REFINED_AZ),
      ex(3, 'get_power_availability_timeline', { state: 'AZ', mw: 100 }, fx('timeline-az-keyless')),
    ];
    const a = buildCrossDomainAnswer({ intent: 'What does the grid look like for a 100 MW data center in Phoenix?', intent_class: 'dc_power_place', requested_mw: 100,
      place: { label: 'Phoenix', state: 'AZ', iso: null, market: 'phoenix' } }, rows, asMap(rows));
    expect(a.headline).toMatch(/Power: 26 requests from the CAISO queue file located in AZ \(not AZ's own queue\)/);
    expect(a.headline).not.toMatch(/Queue \(AZ\)|CAISO queue rows/);
  });
});

const QTS_Q = 'Give me the details for QTS Atlanta Metro data center: address, operator, power capacity and status.';
// The stale exact-name twin (no address, MW or status; as of 2026-03-30) ahead of the verified ATL1 record.
const STALE = { name: 'QTS Atlanta Metro', provider: 'QTS', city: 'Atlanta', state: 'GA', slug: 'qts-atlanta-metro-atlanta-2b897c0b', as_of: '2026-03-30' };
const ATL1 = { name: 'QTS Atlanta-Metro (ATL1)', provider: 'QTS Data Centers', city: 'Atlanta', state: 'GA', status: 'operational',
  address: '1033 Jefferson St NW, Atlanta, GA 30318', slug: 'qts-qts-atlanta-metro-atl1-5e6f7a8b', last_verified: '2026-11-20' };
const SUWANEE = { name: 'QTS Suwanee', provider: 'QTS Data Centers', city: 'Suwanee', state: 'GA', status: 'operational', slug: 'qts-qts-suwanee-1a2b3c4d' };

describe('item 5: the fresh, filled twin wins the name match', () => {
  it('get_facility reads ATL1, not the stale exact-name row listed first', () => {
    const r = { success: true, data: [SUWANEE, STALE, ATL1] };
    expect(facilitySlugsFromSearch(r, 3, 'QTS Atlanta Metro', 'QTS Atlanta Metro')[0]).toBe(ATL1.slug);
  });
  it('with equal dates the row with more of address / status / MW leads; a trailing code is still a name match', () => {
    const bare = { ...STALE, as_of: null };
    const coded = { ...ATL1, last_verified: null };
    expect(rankByFacilityName([bare, coded], 'QTS Atlanta Metro')[0].slug).toBe(ATL1.slug);
    // a code never matches a longer code: DA1 is not DA11
    expect(rankByFacilityName([{ name: 'Equinix DA11', slug: 'a' }, { name: 'Equinix DA1', slug: 'b' }], 'Equinix DA1')[0].slug).toBe('b');
  });
  it('the answer lead begins "QTS Atlanta-Metro (ATL1)" even when get_facility read the stale twin', () => {
    for (const read of [ATL1, STALE]) {
      const a = buildNamedFacilityAnswer({ intent: QTS_Q, intent_class: 'facility_search', facility: { name: 'QTS Atlanta Metro' } }, [
        ex(1, 'search_facilities', { query: 'QTS Atlanta Metro', state: 'GA' }, { success: true, data: [STALE, ATL1] }),
        ex(2, 'get_facility', { slug: read.slug }, { success: true, data: read }),
      ]);
      expect(a.headline.startsWith('QTS Atlanta-Metro (ATL1)'), a.headline).toBe(true);
      expect(a.headline).toMatch(/address 1033 Jefferson St NW/);
      expect(a.headline).toMatch(/record as of 2026-11-20/);
    }
  });
});

const Q_PHX = 'How soon can a 100 MW data center get power in Phoenix, and what does the grid look like?';
const phxRows = (dcpi) => [
  ex(1, 'get_market_dcpi_rank', { market_slug: 'phoenix-az' }, dcpi),
  ex(2, 'get_retirement_headroom', { target_mw: 100, horizon_months: 36, region_iso: 'AZPS,SRP,TEPC' }, fx('retirement-headroom-az')),
  ex(3, 'get_power_availability_timeline', { state: 'AZ', mw: 100 }, fx('timeline-az-keyless')),
  ex(4, 'get_refined_queue', { state: 'AZ' }, REFINED_AZ),
];
const PLACE = { label: 'Phoenix', state: 'AZ', iso: null, market: 'phoenix' };

describe('item 7: time to power on a no-RTO place', () => {
  it('the ask is recognised', () => {
    expect(ttpAsk(Q_PHX)).toBe(true);
    expect(ttpAsk('How long would it take to get power for a 100 MW data center in Phoenix?')).toBe(true);
    expect(ttpAsk('When can a 50 MW load get power in Reno?')).toBe(true);
    expect(ttpAsk('What does the grid look like for a data center in Phoenix?')).toBe(false);
  });
  it('no served figure: the lead and not_established say time to power is withheld', () => {
    const rows = phxRows({ verdict: 'CAUTION', market_name: 'Phoenix', composite_score: 43.5, computed_at: '2026-11-18T00:30:00Z', _time_to_power_months_withheld: true });
    const a = buildCrossDomainAnswer({ intent: Q_PHX, intent_class: 'dc_power_place', requested_mw: 100, place: PLACE }, rows, asMap(rows));
    expect(a.not_established[0]).toBe(TTP_WITHHELD_LINE);
    expect(a.headline).toMatch(/Not established: Time to power is withheld at this access level\.$/);
  });
  it('a served DCPI figure is given with its source field and date, and no withheld line', () => {
    const rows = phxRows({ verdict: 'CAUTION', market_name: 'Phoenix', composite_score: 43.5, time_to_power_months: 30, computed_at: '2026-11-18T00:30:00Z' });
    const a = buildCrossDomainAnswer({ intent: Q_PHX, intent_class: 'dc_power_place', requested_mw: 100, place: PLACE }, rows, asMap(rows));
    expect(a.facts.some((f) => /^Phoenix time to power: 30 months \(DC Hub DCPI, get_market_dcpi_rank\.time_to_power_months, as of 2026-11-18\)/.test(f.text))).toBe(true);
    expect(a.not_established.join(' ')).not.toMatch(/time to power/i);
  });
  it('no time asked: no time-to-power line is added', () => {
    const rows = phxRows({ verdict: 'CAUTION', market_name: 'Phoenix', composite_score: 43.5, computed_at: '2026-11-18T00:30:00Z' });
    const a = buildCrossDomainAnswer({ intent: 'What does the grid look like for a 100 MW data center in Phoenix?', intent_class: 'dc_power_place', requested_mw: 100, place: PLACE }, rows, asMap(rows));
    expect(a.not_established.join(' ')).not.toMatch(/time to power/i);
  });
});

describe('item 2: an ISO-filtered slice of a non-ISO state', () => {
  it('NC read with iso=PJM and no rows: the coverage line, never "0"', () => {
    const [f] = factsFromStep('get_refined_queue', { ok: true, count_total_matching: 0, filters_applied: { iso: 'PJM', state: 'NC', status: 'active' }, results: [] }, { state: 'NC', iso: 'PJM' });
    expect(f.text).not.toMatch(/\b0 active generation requests?/);
    expect(f.text).toMatch(/^NC is mostly outside ISO queue coverage \(Duke Energy; PJM serves only part of the state\)/);
  });
  it('NC rows from PJM, which serves part of NC: the count stands', () => {
    const [f] = factsFromStep('get_refined_queue', { ok: true, count_total_matching: 12, filters_applied: { iso: 'PJM', state: 'NC', status: 'active' }, results: [] }, { state: 'NC', iso: 'PJM' });
    expect(f.text).toMatch(/^PJM interconnection queue, NC slice: 12 active generation requests/);
  });
});
