// facility-names-1119.test.mjs — planner 5.43, Grok's daily MCP leadership note (2026-11-18) item 10: facility rows are
// said as provider + name with the ", VA, United States" tail removed, and a city-only row ("Atlanta, GA") ranks below
// named rows in the answer and in the slug get_facility reads first.
import { describe, it, expect } from 'vitest';
import { facilityDisplayName, cityOnlyName, namedFirst, shortProvider } from '../lib/facility-names.mjs';
import { buildColocationAnswer } from '../lib/colocation-answer.mjs';
import { facilitySlugsFromSearch } from '../lib/colocation-plan.mjs';

// Live keyless search_facilities rows (2026-11-19 08:19Z), trimmed.
const ASHBURN = [
  { name: 'Level 3 Ashburn', provider: 'Lumen Technologies', city: 'Ashburn', state: 'VA', as_of: '2026-03-30', slug: 'lumen-technologies-level-3-ashburn-23a0d3a2' },
  { name: 'Ashburn II, VA, United States', provider: 'Vantage Data Centers', city: 'Ashburn', state: 'VA', as_of: '2026-03-30', slug: 'vantage-data-centers-ashburn-ii-va-united-states-54315501' },
  { name: 'Ashburn III, VA, United States', provider: 'Vantage Data Centers', city: 'Ashburn', state: 'VA', as_of: '2026-03-30', slug: 'vantage-data-centers-ashburn-iii-va-united-states-ddcf13f5' },
];
const ATLANTA = [
  { name: 'Atlanta, GA', provider: 'Flexential', city: 'Atlanta', state: 'GA', as_of: '2026-03-30', slug: 'flexential-atlanta-ga-3ae10fe1' },
  { name: 'QTS Atlanta 1 - DC1', provider: 'QTS Data Centers', city: 'Atlanta', state: 'GA', as_of: '2026-03-30', slug: 'qts-atlanta-1-dc1' },
  { name: 'Flexential Atlanta - Norcross', provider: 'Flexential', city: 'Norcross', state: 'GA', as_of: '2026-03-30', slug: 'flexential-atlanta-norcross' },
];
const metro = (label, slug) => ({ label, dcpi_slug: slug, query: label });
const run = (m, rows) => buildColocationAnswer({ intent: `colocation in ${m.label}`, intent_class: 'colocation', metro: m }, [
  { step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: m.dcpi_slug }, result: { verdict: 'AVOID', composite_score: 20 } },
  { step: 2, tool: 'search_facilities', status: 'executed', args: { query: m.label }, result: { total_matching: null, data: rows } },
], null);

describe('facilityDisplayName', () => {
  it('provider + name, the address tail and the corporate tail removed', () => {
    expect(facilityDisplayName(ASHBURN[1])).toBe('Vantage Ashburn II');
    expect(facilityDisplayName(ASHBURN[0])).toBe('Lumen Level 3 Ashburn');
    expect(facilityDisplayName(ATLANTA[2])).toBe('Flexential Atlanta - Norcross');
    expect(facilityDisplayName({ name: 'Equinix DC11', provider: 'Equinix, Inc.' })).toBe('Equinix DC11');
    expect(facilityDisplayName({ slug: 'x-1' })).toBe('x-1');
    expect(shortProvider('Digital Realty Trust')).toBe('Digital Realty Trust');
  });
  it('a city-only name is a place, a facility name is not', () => {
    expect(cityOnlyName(ATLANTA[0])).toBe(true);
    expect(cityOnlyName({ name: 'Ashburn', city: 'Ashburn' })).toBe(true);
    expect(cityOnlyName(ATLANTA[1])).toBe(false);
    expect(cityOnlyName(ASHBURN[1])).toBe(false);
    expect(cityOnlyName({ name: 'Ashburn 2', city: 'Ashburn' })).toBe(false);
    expect(namedFirst(ATLANTA).map((r) => r.slug)).toEqual(['qts-atlanta-1-dc1', 'flexential-atlanta-norcross', 'flexential-atlanta-ga-3ae10fe1']);
  });
});

describe('the colocation answer and the get_facility pick', () => {
  it('Q-a: the Ashburn rows read "Vantage Ashburn II", never "VA, United States"', () => {
    const ev = run(metro('Northern Virginia', 'northern-virginia'), ASHBURN).evidence.join(' ');
    expect(ev).toContain('e.g. Lumen Level 3 Ashburn, Vantage Ashburn II, Vantage Ashburn III (facility records as of 2026-03-30)');
    expect(ev).not.toMatch(/United States/);
  });
  it('Q-e: named Atlanta rows come first and no row shown is only "<City>, <ST>"', () => {
    const ev = run(metro('Atlanta', 'atlanta'), [...ATLANTA, { name: 'Atlanta Gateway', provider: 'DataBank', city: 'Atlanta' }]).evidence.join(' ');
    expect(ev).toContain('e.g. QTS Atlanta 1 - DC1, Flexential Atlanta - Norcross, DataBank Atlanta Gateway');
    expect(ev).not.toMatch(/Flexential Atlanta, GA/);
  });
  it('get_facility reads a named row before a city-only one; an address hit still comes first', () => {
    expect(facilitySlugsFromSearch({ data: ATLANTA }, 1)).toEqual(['qts-atlanta-1-dc1']);
    expect(facilitySlugsFromSearch({ data: [{ name: 'Atlanta, GA', slug: 'a', city: 'Atlanta', address: '56 Marietta St' }, ...ATLANTA.slice(1)] }, 1, 'colocation at 56 Marietta St Atlanta')).toEqual(['a']);
  });
});
