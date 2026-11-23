// Brain 2026-11-23 items 5 and 6: the 3 closest facility slugs on a 404, and the per-call answer-quality marks.
import { describe, it, expect } from 'vitest';
import { slugWords, closestSlugs, notFoundSuggestions } from '../lib/facility-ref.mjs';
import { answerQualityMarks, markHeldRows, answerQualityMarksOn } from '../lib/answer-quality.mjs';

const ROWS = [
  { slug: 'equinix-dc1-ashburn', name: 'Equinix DC1', city: 'Ashburn' },
  { slug: 'equinix-dc2-ashburn', name: 'Equinix DC2', city: 'Ashburn' },
  { slug: 'equinix-dc11-ashburn', name: 'Equinix DC11', city: 'Ashburn' },
  { slug: 'vantage-ashburn-i-3f9a12bc', name: 'Vantage Ashburn I', city: 'Ashburn' },
  { slug: 'qts-richmond', name: 'QTS Richmond', city: 'Richmond' },
];

describe('closest facility slugs (item 5)', () => {
  it('drops the hash and repeated words', () => {
    expect(slugWords('digital-realty-digital-realty-iad38-ashburn-5754e62d')).toEqual(['digital', 'realty', 'iad38', 'ashburn']);
  });
  it('ranks by shared words and returns 3', () => {
    const got = closestSlugs('equinix-dc1-ashburn-x', ROWS);
    expect(got).toHaveLength(3);
    expect(got[0].slug).toBe('equinix-dc1-ashburn');
    expect(got.map((g) => g.slug)).not.toContain('qts-richmond');
  });
  it('never suggests the slug that just failed, nor a row sharing no word', () => {
    expect(closestSlugs('qts-richmond', ROWS).map((g) => g.slug)).not.toContain('qts-richmond');
    expect(closestSlugs('zzz-nowhere', ROWS)).toEqual([]);
  });
  it('searches the slug words, widening until it has 3', async () => {
    const asked = [];
    const search = async (q) => { asked.push(q); return { data: q === 'equinix ashburn' || q === 'equinix' ? ROWS : [] }; };
    const got = await notFoundSuggestions('equinix-ashburn-dc-nonexistent', search);
    expect(got).toHaveLength(3);
    expect(asked[0]).toBe('equinix ashburn dc nonexistent');
  });
  it('fails soft', async () => {
    expect(await notFoundSuggestions('equinix-x', async () => { throw new Error('down'); })).toEqual([]);
  });
});

const json = (o) => ({ type: 'text', text: JSON.stringify(o) });
describe('answer-quality marks (item 6)', () => {
  it('wall_ms on every call, dated cite', () => {
    const sc = { cite_as: 'DC Hub (dchub.cloud), as of 2026-11-20', rows: [{ a: 1 }] };
    const m = answerQualityMarks('get_news', { content: [json(sc)], structuredContent: sc }, { startedAt: 1000, now: 1250 });
    expect(m).toMatchObject({ wall_ms: 250, error: false, empty: false, partial: false, unresolved: false, dated_cite: true });
    expect(m).not.toHaveProperty('intent_class');
  });
  it('empty, partial, error and not-found', () => {
    const empty = { results: [], data: { rows: [] } };
    expect(answerQualityMarks('search_facilities', { content: [json(empty)], structuredContent: empty }).empty).toBe(true);
    const prev = { _preview_only: true, rows: [{}] };
    expect(answerQualityMarks('get_market_intel', { content: [json(prev)], structuredContent: prev }).partial).toBe(true);
    const nf = { error: 'API 404', _error_mitigation: { error_code: 'upstream_not_found' } };
    expect(answerQualityMarks('get_facility', { isError: true, content: [json(nf)] })).toMatchObject({ error: true, unresolved: true, dated_cite: false });
  });
  it('execute_plan: intent_class and lead_match', () => {
    const sc = { intent_class: 'facility_search' };
    const good = answerQualityMarks('execute_plan', { content: [{ type: 'text', text: '2 facilities in Ashburn on record.' }], structuredContent: sc });
    expect(good).toMatchObject({ intent_class: 'facility_search', lead_match: true });
    const bad = answerQualityMarks('execute_plan', { content: [{ type: 'text', text: 'PJM load is 90 GW.' }], structuredContent: sc });
    expect(bad.lead_match).toBe(false);
    const unk = answerQualityMarks('execute_plan', { content: [{ type: 'text', text: 'x' }], structuredContent: { intent_class: 'unknown' } });
    expect(unk).toMatchObject({ intent_class: 'unknown', unresolved: true, lead_match: null });
  });
  it('stamps only this tool\'s unsent held rows', () => {
    const c = { _heldTrackRows: [{ row: { tool: 'execute_plan', params: { q: 1 } } }, { row: { tool: 'get_news', params: {} } },
      { sent: true, row: { tool: 'execute_plan', params: {} } }] };
    expect(markHeldRows(c, 'execute_plan', { wall_ms: 5 })).toBe(1);
    expect(c._heldTrackRows[0].row.params).toEqual({ q: 1, _aq: { wall_ms: 5 } });
    expect(c._heldTrackRows[1].row.params).toEqual({});
  });
  it('kill switch', () => {
    expect(answerQualityMarksOn({ DCHUB_ANSWER_QUALITY_MARKS: '0' })).toBe(false);
    expect(answerQualityMarksOn({})).toBe(true);
  });
});
