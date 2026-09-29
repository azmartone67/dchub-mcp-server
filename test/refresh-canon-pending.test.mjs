// The backend withholds the facility count from /api/v1/canon/phrases
// (`facilities: "corroborated count pending"`, dchub-backend#5966). Once the
// MCP-side freeze lifts, refresh-canon-phrases must not refuse every canon key
// over it. Hermetic: pure functions only.
import { describe, it, expect } from 'vitest';
import { phrasesForSnapshot, selectPhrases } from '../scripts/refresh-canon-phrases.mjs';

const PREV = {
  tools: 92, facilities: '24,900+', deals: '1,600+', markets: '300+', countries: '170+',
  substations: '134,000+', assets: '330,000+',
};
const WITHHELD = {
  ok: true, source: 'resolve_public_floors (live)', tools: 92,
  facilities: 'corroborated count pending',
  facilities_count_status: 'corroboration_pending', facility_count_status: 'corroboration_pending',
  deals: '1,700+', markets: '310+', countries: '171+', substations: '135,000+', assets: '331,000+',
};

describe('a withheld facility count is an answer, not a corrupt source', () => {
  it('carries the committed phrase forward and refreshes every other key', () => {
    const { fields, bad } = phrasesForSnapshot(WITHHELD, PREV, {});
    expect(bad).toEqual([]);
    expect(fields.facilities).toBe('24,900+');
    expect(fields.deals).toBe('1,700+');
    expect(fields.markets).toBe('310+');
    expect(fields.substations).toBe('135,000+');
  });

  it('either status key is enough', () => {
    for (const k of ['facilities_count_status', 'facility_count_status']) {
      const b = { ...WITHHELD, facilities_count_status: undefined, facility_count_status: undefined, [k]: 'corroboration_pending' };
      expect(selectPhrases(b, PREV).bad, k).toEqual([]);
    }
  });

  it('still refuses without the status: prose in a quantity is a corrupt source', () => {
    const b = { ...WITHHELD }; delete b.facilities_count_status; delete b.facility_count_status;
    expect(selectPhrases(b, PREV).bad.join()).toMatch(/facilities/);
  });

  it('a different status value does not qualify', () => {
    const b = { ...WITHHELD, facilities_count_status: 'corroborated', facility_count_status: 'corroborated' };
    expect(selectPhrases(b, PREV).bad.join()).toMatch(/facilities/);
  });

  it('prose that carries a digit does not qualify even with the status', () => {
    const b = { ...WITHHELD, facilities: 'about 25 thousand' };
    expect(selectPhrases(b, PREV).bad.join()).toMatch(/facilities/);
  });

  it('with no committed phrase to carry it still refuses (never invents one)', () => {
    const { fields, bad } = selectPhrases(WITHHELD, { ...PREV, facilities: undefined });
    expect(bad).toContain('facilities');
    expect(fields.facilities).toBeUndefined();
  });

  it('only facilities is exempt: another quantity turning to prose still refuses', () => {
    const b = { ...WITHHELD, deals: 'many' };
    expect(selectPhrases(b, PREV).bad.join()).toMatch(/deals/);
  });

  it('a numeric live phrase still wins over the committed one (no status needed)', () => {
    const b = { ...WITHHELD, facilities: '25,000+' };
    expect(selectPhrases(b, PREV).fields.facilities).toBe('25,000+');
  });
});
