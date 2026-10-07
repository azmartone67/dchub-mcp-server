// Grok 2026-10-06 item 8: cite_as must not take its date from a top-level
// as_of when the provenance block says the collection date is UNMEASURED.
import { describe, it, expect, afterEach } from 'vitest';
import { citeAsFor } from '../lib/agent-outreach.mjs';

const partial = { cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 10 shown', completeness: 'partial_preview', retrieved_at: '2026-10-07T05:00:00Z' };
afterEach(() => { delete process.env.DCHUB_PAID_SELL_LINE; });

describe('citeAsFor with an UNMEASURED collection date', () => {
  it('drops the load-date as_of beside a null provenance.as_of', () => {
    process.env.DCHUB_PAID_SELL_LINE = '1';
    const c = citeAsFor({ as_of: '2026-10-06', provenance: { as_of: null }, citation: partial });
    expect(c).not.toMatch(/as of/);
  });
  it('still uses the top-level as_of when provenance is silent', () => {
    const c = citeAsFor({ as_of: '2026-10-06', provenance: {}, citation: partial });
    expect(c).toMatch(/as of 2026-10-06$/);
  });
  it('prefers a stated provenance date', () => {
    const c = citeAsFor({ as_of: '2026-10-06', provenance: { as_of: '2026-08-31' }, citation: partial });
    expect(c).toMatch(/as of 2026-08-31$/);
  });
});
