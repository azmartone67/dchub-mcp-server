// top-metro-scores-definition.test.mjs -- on the 20 open markets the DCPI scores are open
// (lib/top-metros.mjs header), so siting.dcpi.definition must not call them "a paid field".
//
// A keyless get_market_intel on northern-virginia said "The scores are a paid field." while
// get_market_dcpi_rank on phoenix returned the same scores to an anonymous caller (2026-10-30).
// The reword is on the open path only: the taste (non-open) answer keeps the sentence, because
// there the scores really are withheld.
import { describe, it, expect, beforeAll } from 'vitest';
import { openScoresDefinition } from '../lib/top-metros.mjs';

const PAID = 'The scores are a paid field.';
const DEF = "Thresholds are the published DCPI method, not this market's scores. " + PAID;
const body = () => ({
  ok: true, market: { id: 'northern virginia' },
  siting: { available: true, dcpi: { verdict: 'AVOID', definition: DEF, method_url: 'https://dchub.cloud/dcpi/methodology' } },
});

let S;
beforeAll(async () => {
  S = await import('../server.mjs');
}, 60_000);

describe('openScoresDefinition', () => {
  it('replaces the paid-field sentence and keeps the rest of the definition', () => {
    const out = openScoresDefinition(body());
    expect(out.siting.dcpi.definition).not.toContain('paid field');
    expect(out.siting.dcpi.definition).toContain("Thresholds are the published DCPI method, not this market's scores.");
    expect(out.siting.dcpi.definition).toContain('get_market_dcpi_rank');
    expect(out.siting.dcpi.verdict).toBe('AVOID');
  });
  it('does not mutate its input', () => {
    const b = body();
    openScoresDefinition(b);
    expect(b.siting.dcpi.definition).toBe(DEF);
  });
  it('passes through a body without the sentence, or without a siting block', () => {
    const noDef = { ok: true, siting: { dcpi: { verdict: 'CAUTION' } } };
    expect(openScoresDefinition(noDef)).toBe(noDef);
    const noSiting = { ok: true };
    expect(openScoresDefinition(noSiting)).toBe(noSiting);
    expect(openScoresDefinition(null)).toBe(null);
  });
});

describe('the open top-metro answer', () => {
  it('serves no "paid field" sentence beside open scores', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify(body()) }] };
    const out = S._topMetroFullResult(result, 'get_market_intel');
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.access).toBe('full');
    expect(parsed.siting.dcpi.definition).not.toContain('paid field');
    expect(out.structuredContent.siting.dcpi.definition).not.toContain('paid field');
  });
});

// Since be#8229 (2026-11-03) the backend can gate a top-20 answer itself. Keyless
// get_market_dcpi_rank dallas then came back `access: "full"` with "detailed scores ... is free"
// beside its own `_gated: true`, `locked: true` and every sub-score null (2026-11-14).
describe('a top-metro answer the backend gated', () => {
  const gated = () => ({
    market_slug: 'dallas', verdict: 'CAUTION', composite_score: 42,
    excess_power_score: null, constraint_score: null, time_to_power_months: null,
    locked: true, _gated: true, _locked_fields: ['constraint_score', 'excess_power_score'],
    siting: { dcpi: { definition: DEF } },
  });
  it('is labelled partial, says the sub-scores are withheld, and keeps "a paid field"', () => {
    const out = S._topMetroFullResult({ content: [{ type: 'text', text: JSON.stringify(gated()) }] }, 'get_market_dcpi_rank');
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.access).toBe('partial');
    expect(out.structuredContent.access).toBe('partial');
    expect(parsed.access_basis).toMatch(/withheld/);
    expect(parsed.access_basis).not.toMatch(/scores\) is free|\bPro\b|Developer|\$\d/);
    expect(parsed.siting.dcpi.definition).toContain(PAID);
  });
  it('backendWithheld reads only the gate envelope', async () => {
    const { backendWithheld } = await import('../lib/top-metros.mjs');
    expect(backendWithheld(gated())).toBe(true);
    expect(backendWithheld({ _locked_fields: ['x'] })).toBe(true);
    expect(backendWithheld({ _locked_fields: [] })).toBe(false);
    expect(backendWithheld(body())).toBe(false);
    expect(backendWithheld(null)).toBe(false);
  });
});
