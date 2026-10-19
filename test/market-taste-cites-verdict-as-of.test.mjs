// market-taste-cites-verdict-as-of.test.mjs — Grok C12 / G-1019-01 (2026-10-19).
//
// MEASURED live on get_market_intel dallas (anonymous), 2026-10-19T17:41Z:
//   taste.headline.as_of  2026-10-19T14:02:42Z   (the DCPI verdict's own computed_at)
//   taste.cite_as         "DC Hub (dchub.cloud), as of 2026-09-26"
//   citation.cite_as      "... (as of 2026-09-26)"
// 2026-09-26 is the backend's top-level as_of = MAX(discovered_at) over the facilities
// the WITHHELD sections count; Phoenix, Chicago and Ashburn carry the same date, so it is
// the last discovery batch, not a Dallas ingest stall. The preview publishes one figure,
// the verdict, and its citation must carry that figure's date.
import { describe, it, expect } from 'vitest';
import { buildFreeDecisionTaste } from '../lib/free-decision-taste.mjs';

const FACILITY_DATE = '2026-09-26';
const VERDICT_TS = '2026-10-19T14:02:42.929343+00:00';

function payload({ verdictAsOf = VERDICT_TS } = {}) {
  return {
    market: { id: 'dallas', name: 'Dallas' },
    stats: { facility_count: 259, total_power_mw: 1000, avg_power_mw: 5, provider_count: 10, mw_reporting_count: 9 },
    as_of: FACILITY_DATE,
    as_of_basis: 'MAX(discovered_at) over the facilities this response counts - the newest observation in this cut.',
    top_providers: [{ provider: 'X', count: 3 }],
    siting: {
      dcpi: { verdict: 'CAUTION', band: 'excess-power score at least 50 and grid-constraint score at most 70',
        ...(verdictAsOf ? { as_of: verdictAsOf } : {}), method_url: 'https://dchub.cloud/dcpi/methodology' },
      iso: { code: 'ERCOT', operator: 'ERCOT', class: 'RTO' },
    },
    provenance: { source: 'DC Hub' },
  };
}

describe('get_market_intel free taste cites the verdict, not the facility-discovery date', () => {
  it('taste.cite_as carries the verdict as_of date', () => {
    const { envelope } = buildFreeDecisionTaste('get_market_intel', payload());
    expect(envelope.taste.headline.as_of).toBe(VERDICT_TS);
    expect(envelope.taste.cite_as).toContain('2026-10-19');
    expect(envelope.taste.cite_as).not.toContain(FACILITY_DATE);
  });

  it('top-level as_of is the verdict date and its basis no longer names MAX(discovered_at)', () => {
    const { envelope } = buildFreeDecisionTaste('get_market_intel', payload());
    expect(envelope.as_of).toBe(VERDICT_TS);
    expect(envelope.as_of_basis).toMatch(/verdict/i);
    expect(envelope.as_of_basis).not.toMatch(/MAX\(discovered_at\)/);
  });

  it('a verdict with no date of its own falls back to the response as_of (unchanged)', () => {
    const { envelope } = buildFreeDecisionTaste('get_market_intel', payload({ verdictAsOf: null }));
    expect(envelope.taste.cite_as).toContain(FACILITY_DATE);
    expect(envelope.as_of).toBe(FACILITY_DATE);
    expect(envelope.as_of_basis).toMatch(/MAX\(discovered_at\)/);
  });
});
