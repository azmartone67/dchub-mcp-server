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
