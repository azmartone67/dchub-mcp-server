// get_energy_prices free taste (Grok 10-08 item 1): one labelled rate, the EIA period as
// averaging_period (not an as_of), the rest listed in withheld[] with counts, no plan name or price in the copy.
import { describe, it, expect } from 'vitest';
import * as T from '../lib/free-decision-taste.mjs';

const FULL = {
  success: true, scope: 'iso_footprint_avg', filter: { iso: 'ERCOT', sector: 'all', state: null },
  avg_rate_kwh: 0.0764, retail_rate_kwh: 0.0764, industrial_rate_kwh: 0.0764,
  retail_rates: { avg_cents_kwh: 7.64, latest_period: '2026', max_cents_kwh: 9.9, min_cents_kwh: 6.1, states_covered: 1 },
};

describe('energy taste', () => {
  const out = T.buildFreeDecisionTaste('get_energy_prices', FULL);
  const env = out && out.envelope;

  it('headline is one rate, sector-labelled, dated by the EIA period', () => {
    expect(env.taste.headline).toMatchObject({ name: 'retail_rate_cents_kwh', value: 7.64, unit: 'cents/kWh', sector: 'all-sector average', as_of: null, averaging_period: '2026', window: '2026' });
    expect(env.taste.headline.basis).toMatch(/all-sector average/);
    expect(env.taste.source).toMatch(/EIA/);
    expect(env.as_of).toBeNull();
    expect(env.averaging_period).toBe('2026');
    // the period must never be minted into a date: no provenance as_of, no "as of 2026-01-01"
    expect(JSON.stringify(env)).not.toMatch(/2026-01-01/);
    expect(env.taste.cite_as).not.toMatch(/as of/);
  });
  it('carries the backend EIA provenance block and its month-end data date (agent QA 10-20 item 6)', () => {
    const PROV = { source: 'U.S. Energy Information Administration (EIA), retail sales of electricity',
      source_url: 'https://www.eia.gov/opendata/browser/electricity/retail-sales', basis_class: 'measured',
      averaging_period: '2026', data_through_month: '2026-07', as_of: '2026-07-31',
      as_of_basis: 'last EIA month included in the 2026 average (2026-07)' };
    const e = T.buildFreeDecisionTaste('get_energy_prices', { ...FULL, provenance: PROV }).envelope;
    expect(e.as_of).toBe('2026-07-31');
    expect(e.as_of_basis).toMatch(/last EIA month/);
    expect(e.provenance).toMatchObject({ source: PROV.source, as_of: '2026-07-31', basis_class: 'measured' });
    expect(e.taste.headline.as_of).toBe('2026-07-31');
    expect(e.taste.source_url).toMatch(/^https:\/\/www\.eia\.gov\//);
    expect(e.taste.cite_as).toMatch(/as of 2026-07-31/);
    expect(JSON.stringify(e)).not.toMatch(/UNMEASURED - EIA|2026-01-01/);
  });
  it('a provenance block without a valid date stays UNMEASURED', () => {
    const e = T.buildFreeDecisionTaste('get_energy_prices', { ...FULL, provenance: { source: 'EIA', as_of: '2026' } }).envelope;
    expect(e.as_of).toBeNull();
    expect(e.as_of_basis).toMatch(/^UNMEASURED/);
  });
  it('lists what it withholds with counts and never nulls in place', () => {
    const secs = Object.fromEntries(env.withheld.map((w) => [w.section, w.count]));
    expect(secs.rate_range).toBe(2);
    expect(secs.iso_footprint).toBe(1);
    expect(JSON.stringify(env)).not.toMatch(/9\.9|6\.1/);
    expect(env.retail_rates).toBeUndefined();
  });
  it('does not claim the preview-only rule (a free key keeps its full answers) and names no plan or price', () => {
    expect(env.free_preview_only).toBe(false);
    expect('full_unlocks_at' in env).toBe(false);
    expect(env._taste_note).not.toMatch(/\$|Developer|Pro\b/);
  });
  it('is not in the preview-only list, so who gets the full answer is unchanged', () => {
    expect(T.FREE_PREVIEW_ONLY_TOOLS).not.toContain('get_energy_prices');
    expect(T.TASTE_SHAPED_ONLY_TOOLS).toContain('get_energy_prices');
  });
  it('returns null (generic trim) when there is no rate or on an error', () => {
    expect(T.buildFreeDecisionTaste('get_energy_prices', { success: true, retail_rates: { avg_cents_kwh: null } })).toBeNull();
    expect(T.buildFreeDecisionTaste('get_energy_prices', { error: 'API 404' })).toBeNull();
  });
  it('a state-scoped answer is not labelled an ISO footprint average', () => {
    const o = T.buildFreeDecisionTaste('get_energy_prices', { ...FULL, scope: 'state', filter: { iso: null, sector: 'industrial', state: 'TX' } });
    expect(o.envelope.taste.headline.sector).toBe('industrial');
    expect(o.envelope.taste.headline.basis).not.toMatch(/ISO footprint/);
  });
});

describe('queue taste: a live feed fetch date is not a source date (Grok 10-12)', () => {
  const Q = { iso: 'CAISO', as_of: '2026-10-12', queued_generation_gw: 73.8, queued_generation_gw_as_of: '2026-10-12',
    project_count: 261, source_as_of: '2026-10-12', source_as_of_basis: 'live_feed_fetch_date',
    source_name: 'CAISO Public Queue Report', projects: [{ id: 1 }] };
  it('source.as_of is null for a live feed and the report date for a published report', () => {
    const live = T.buildFreeDecisionTaste('get_interconnection_queue', Q).envelope;
    expect(live.taste.source.as_of).toBeNull();
    const rep = T.buildFreeDecisionTaste('get_interconnection_queue',
      { ...Q, iso: 'ERCOT', source_as_of: '2026-08-31', source_as_of_basis: 'published_report' }).envelope;
    expect(rep.taste.source.as_of).toBe('2026-08-31');
  });
});
