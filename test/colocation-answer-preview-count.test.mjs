// A keyless facility search returns preview rows and total_matching: null. Live 2026-11-17 the colocation headline
// read "3 facilities in the Northern Virginia metro search" from those 3 preview rows, and printed the same count on a
// named-facility comparison whose searches were "Equinix CH1" / "Digital Realty ORD10", not a metro search.
import { describe, it, expect } from 'vitest';
import { buildColocationAnswer } from '../lib/colocation-answer.mjs';

const NOVA = { label: 'Northern Virginia', dcpi_slug: 'northern-virginia', query: 'Northern Virginia' };
const CHI = { label: 'Chicago', dcpi_slug: 'chicago', query: 'Chicago' };
const dcpi = (slug, v, c) => ({ step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: slug },
  result: { verdict: v, composite_score: c } });
const preview = [{ name: 'Level 3 Ashburn', as_of: '2026-03-30' }, { name: 'NTT Ashburn VA7' }, { name: 'Vantage Ashburn II' }];

describe('colocation answer: preview rows are not a facility count', () => {
  it('keyless metro search (total_matching null): no count in the headline, and the answer says the count is not in it', () => {
    const ia = buildColocationAnswer({ intent: 'colocation in Ashburn', intent_class: 'colocation', metro: NOVA }, [
      dcpi('northern-virginia', 'AVOID', 20),
      { step: 2, tool: 'search_facilities', status: 'executed', args: { query: 'Northern Virginia', state: 'VA' },
        result: { total_matching: null, count: null, data: preview, _data_total_available: 5 } },
    ], null);
    expect(ia.headline).toBe('Data Center Power Index (DCPI) for Northern Virginia: AVOID, composite 20/100.');
    expect(JSON.stringify(ia)).not.toMatch(/\b3 facilities\b/);
    expect(ia.evidence.join(' ')).toMatch(/"Northern Virginia" facility search returned preview rows, e\.g\. Level 3 Ashburn/);
    expect(ia.not_established.join(' ')).toMatch(/number of matching facilities is not in this answer/);
  });
  it('a search that returned a total still leads with it', () => {
    const ia = buildColocationAnswer({ intent: 'colocation in Ashburn', intent_class: 'colocation', metro: NOVA }, [
      dcpi('northern-virginia', 'AVOID', 20),
      { step: 2, tool: 'search_facilities', status: 'executed', args: { query: 'Northern Virginia', state: 'VA' },
        result: { total_matching: 669, data: preview } },
    ], null);
    expect(ia.headline).toMatch(/composite 20\/100\. 669 facilities in the Northern Virginia metro search\.$/);
    expect(ia.not_established.join(' ')).not.toMatch(/not in this answer/);
  });
  it('named-facility searches are not the metro search: no metro count in the headline', () => {
    const ia = buildColocationAnswer({ intent: 'Equinix CH1 vs Digital Realty ORD10', intent_class: 'colocation', metro: CHI }, [
      { step: 1, tool: 'search_facilities', status: 'executed', args: { query: 'Equinix CH1', state: 'IL' },
        result: { total_matching: 2, data: [{ name: 'Equinix CH1' }] } },
      { step: 2, tool: 'search_facilities', status: 'executed', args: { query: 'Digital Realty ORD10', state: 'IL' },
        result: { total_matching: 1, data: [{ name: 'Digital Realty ORD10' }] } },
      { ...dcpi('chicago', 'AVOID', 21.9), step: 5 },
    ], null);
    expect(ia.headline).toBe('Data Center Power Index (DCPI) for Chicago: AVOID, composite 21.9/100.');
  });
});
