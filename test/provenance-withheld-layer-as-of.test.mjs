// Grok 2026-10-06 item 7: a layer the tier withheld must not date the citation.
import { describe, it, expect } from 'vitest';
import { buildProvenance } from '../lib/attribution.mjs';

const NOW = Date.parse('2026-10-07T05:00:00Z');
const base = () => ({
  demand_period: '2026-10-07T04:00:00Z',
  lmp_as_of: '2026-10-07T04:50:00Z',
  operating_reserves_mw: null,
  operating_reserves_as_of: '2025-12-05T00:00:00Z',
  _operating_reserves_mw_in_pro: true,
  extended_metrics: { reserves: { as_of: '2025-12-05T00:00:00Z', value: null }, lmp: { as_of: '2026-10-07T04:50:00Z', value: 39 } },
});

describe('as_of ignores withheld layers', () => {
  it('drops the withheld layer from the oldest-input date', () => {
    const p = buildProvenance(base(), { now: NOW });
    expect(String(p.as_of)).toMatch(/^2026-10-07/);
  });
  it('still uses a shown old layer', () => {
    const pl = base();
    pl.extended_metrics.capacity_price = { as_of: '2025-12-17T00:00:00Z', value: 333 };
    expect(String(buildProvenance(pl, { now: NOW }).as_of)).toMatch(/^2025-12-17/);
  });
  it('keeps the old date when nothing is withheld', () => {
    const pl = base(); delete pl._operating_reserves_mw_in_pro; pl.operating_reserves_mw = 5;
    expect(String(buildProvenance(pl, { now: NOW }).as_of)).toMatch(/^2025-12-05/);
  });
});
