// phoenix-day-remaining-paths-1124.test.mjs — after 00:00 UTC (17:00 America/Phoenix) no execute_plan answer line says
// the NEXT day (Grok Brain note 2026-11-24, items 5, 6 and 10d; observed 17:37-17:42 Phoenix on 11-24):
//   * xd-a: "Capacity Source has no live listing of 50 MW or more in North America (checked 2026-11-25)";
//   * fiber: "PeeringDB ... read live on 2026-11-25", and the answer's as_of / Source / cite_as on three different dates;
//   * fact_header: "AS_OF: 2026-11-24T17:36-07:00 ... OLDEST_INPUT_AS_OF: 2026-11-25" (oldest input after AS_OF);
//   * p4 (ERCOT hub price): intent_answer.as_of 2026-11-25.
// Each path now says the America/Phoenix day (lib/cite-day.mjs), with the clock at 2026-11-25T00:40Z.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';
import { capacityFact } from '../lib/cross-domain-answer.mjs';
import { buildFiberAnswer } from '../lib/fiber-answer.mjs';
import { buildPriceNowAnswer } from '../lib/energy-answers.mjs';
import { buildPlanFactHeader } from '../lib/plan-fact-header.mjs';

const NOW = '2026-11-25T00:40:00Z';   // 17:40 on 2026-11-24 in America/Phoenix
const NEXT_DAY = /2026-11-25/;
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterAll(() => { vi.useRealTimers(); });

describe('Capacity Source "checked" date', () => {
  it('an empty check at 17:40 Phoenix says the Phoenix day', () => {
    const f = capacityFact({ tool: 'source_capacity', step: 3, p: { count: 0, items: [], retrieval_receipt: { retrieved_at: '2026-11-25T00:40:03.120Z' } } }, 50);
    expect(f.text).toContain('(checked 2026-11-24)');
    expect(JSON.stringify(f)).not.toMatch(NEXT_DAY);
  });
  it('a listing check says the Phoenix day too', () => {
    const f = capacityFact({ tool: 'source_capacity', step: 3, p: { count: 1, items: [{ market: 'Dallas', state: 'TX', contiguous_kw: 60000 }],
      retrieval_receipt: { retrieved_at: '2026-11-25T00:40:03Z' } } }, 50);
    expect(f.text).toContain('(checked 2026-11-24)');
    expect(JSON.stringify(f)).not.toMatch(NEXT_DAY);
  });
});

describe('fiber answer: one answer date, baseline labelled once', () => {
  const Q = 'Which carrier hotels in Dallas have the most fiber carriers?';
  const ex = () => [
    { step: 1, tool: 'get_metro_fiber', args: { market: 'Dallas-Fort Worth' }, status: 'executed', result: {
      market: 'Dallas-Fort Worth', baseline: { as_of: '2026-03-17', as_of_kind: 'seed_date' },
      summary: { total_carriers: 4, total_route_miles: 5300, key_carrier_hotels: ['Hotel Alpha', 'Hotel Beta'] },
      presence_carriers: { status: 'ok', total_carriers: 519, total_facilities: 450, as_of: '2026-11-25T00:38:47.963717' } } },
    { step: 2, tool: 'get_peering_intel', args: { lat: 32.7767, lon: -96.797 }, status: 'executed', result: {
      location: { radius_deg: 0.5 },
      connectivity: { facilities_nearby: 50, total_networks: 909, total_ix_presence: 78,
        top_facilities: [{ name: 'Facility A', city: 'Dallas', net_count: 210, ix_count: 9 }] },
      freshness: { live: true, served_at: '2026-11-25T00:40:12.792Z' } } },
  ];
  const ia = () => buildFiberAnswer({ intent: Q, intent_class: 'fiber' }, ex(), null);

  it('"read live on" and as_of say the Phoenix day', () => {
    const a = ia();
    expect(a.headline).toContain('read live on 2026-11-24');
    expect(a.as_of).toBe('2026-11-24');
    expect(JSON.stringify(a)).not.toMatch(NEXT_DAY);
  });
  it('cite_as and the Source line say the answer\'s as_of, not the baseline\'s', () => {
    const a = ia();
    const citeDay = /as of (\d{4}-\d{2}-\d{2})/.exec(a.cite_as)[1];
    const srcDay = /as of (\d{4}-\d{2}-\d{2})$/.exec(a.source)[1];
    expect(citeDay).toBe(a.as_of);
    expect(srcDay).toBe(a.as_of);
  });
  it('the curated baseline date is said once, labelled as the baseline', () => {
    const a = ia();
    const all = [a.headline, ...a.evidence].join(' ');
    expect(all.match(/curated metro baseline as of 2026-03-17/g)).toHaveLength(1);
    expect(all.match(/2026-03-17/g)).toHaveLength(1);
    expect(a.baseline_as_of).toBe('2026-03-17');
  });
  it('a baseline-only answer is dated by the baseline, and cites that same date', () => {
    const e = ex().slice(0, 1);
    const a = buildFiberAnswer({ intent: 'How deep is fiber in Dallas?', intent_class: 'fiber' }, e, null);
    expect(/as of (\d{4}-\d{2}-\d{2})/.exec(a.cite_as)[1]).toBe(a.as_of);
    expect(/as of (\d{4}-\d{2}-\d{2})$/.exec(a.source)[1]).toBe(a.as_of);
  });
});

describe('price answer as_of (p4, ERCOT hub)', () => {
  const ex = [{ step: 1, tool: 'get_energy_prices', args: { iso: 'ERCOT', hub: 'HB_HUBAVG' }, status: 'executed', result: {
    wholesale_lmp: { iso: 'ERCOT', hub: 'HB_HUBAVG', source: 'ERCOT',
      real_time: { lmp_usd_mwh: 24.1, interval_ending: '2026-11-24T18:35:00-06:00', as_of: '2026-11-25T00:36:02Z', stale: false } } } }];
  it('intent_answer.as_of is the Phoenix day of the reading', () => {
    const a = buildPriceNowAnswer({ intent_class: 'price_now', intent: 'ERCOT hub price right now', iso: 'ERCOT' }, ex, null);
    expect(a.as_of).toBe('2026-11-24');
    expect(JSON.stringify(a)).not.toMatch(NEXT_DAY);
  });
  it('the price header prints that day', () => {
    const ia = buildPriceNowAnswer({ intent_class: 'price_now', intent: 'ERCOT hub price right now', iso: 'ERCOT' }, ex, null);
    const h = buildPlanFactHeader({ _entity: 'plan_execution', intent_class: 'price_now', intent_answer: ia, executed: ex,
      provenance: { as_of: '2026-11-24' } });
    expect(h.split('\n')[0]).toContain('AS_OF: 2026-11-24');
    expect(h).not.toMatch(NEXT_DAY);
  });
});

describe('fact_header OLDEST_INPUT_AS_OF never after AS_OF', () => {
  const plan = () => ({
    _entity: 'plan_execution', intent_class: 'colocation', constraint_iso: ['ERCOT'],
    // a plain date that is a UTC day (an intent_answer layer dated off the serve clock before this fix)
    provenance: { as_of: '2026-11-25' },
    dcpi_verdict: { verdict: 'CAUTION', composite_score: 55, market_slug: 'dallas' },
    executed: [
      { step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: 'dallas' },
        result: { verdict: 'CAUTION', composite_score: 55, market_slug: 'dallas', computed_at: '2026-11-25T00:36:10Z' } },
    ],
  });
  it('the oldest input is clamped to AS_OF\'s day', () => {
    const l0 = buildPlanFactHeader(plan()).split('\n')[0];
    const asOf = /\| AS_OF: (\S+)/.exec(l0)[1];
    const oldest = /OLDEST_INPUT_AS_OF: (\S+)/.exec(l0)[1];
    expect(asOf).toBe('2026-11-24T17:36-07:00');
    expect(oldest.slice(0, 10) <= asOf.slice(0, 10)).toBe(true);
    expect(l0).not.toMatch(NEXT_DAY);
  });
  it('an oldest input already before AS_OF prints unchanged', () => {
    const p = plan();
    p.provenance.as_of = '2026-11-20';
    const l0 = buildPlanFactHeader(p).split('\n')[0];
    expect(l0).toContain('OLDEST_INPUT_AS_OF: 2026-11-20');
  });
});
