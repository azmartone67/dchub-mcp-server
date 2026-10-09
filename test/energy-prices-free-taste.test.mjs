// get_energy_prices free taste (Grok 10-08 item 1): one labelled rate, as_of = the EIA
// period, the rest listed in withheld[] with counts, no plan name or price in the copy.
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
    expect(env.taste.headline).toMatchObject({ name: 'retail_rate_cents_kwh', value: 7.64, unit: 'cents/kWh', sector: 'all-sector average', as_of: '2026', window: '2026' });
    expect(env.taste.headline.basis).toMatch(/all-sector average/);
    expect(env.taste.source).toMatch(/EIA/);
    expect(env.as_of).toBe('2026');
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
