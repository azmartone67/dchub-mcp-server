// /mcp/claude: an answer is cut to a prefix when it is larger than the
// directory's "reasonably sized" rule allows, and says so (G-1014-43).
//
// MEASURED LIVE 2026-10-16, Pro key, /mcp/claude, characters per answer:
//   get_refined_queue 567,411   get_fiber_intel 445,330 (3.2 MB for Ashburn)
//   search_facilities 163,591   get_infra_projects 138,797   get_news 127,907
//   list_transactions 104,055
// Each answer is sent twice (text block + structuredContent). The cut keeps
// the first N rows of the largest array(s) in the order the tool returned
// them, and names every cut in `size_cap`. Nothing under the cap changes.
import { describe, it, expect } from 'vitest';
import {
  capJsonValue, capClaudeResult, scrubClaudeToolResult, CLAUDE_RESULT_CAP_CHARS,
} from '../lib/claude-directory.mjs';

const MAX = CLAUDE_RESULT_CAP_CHARS;
const feature = (i) => ({
  type: 'Feature', id: i,
  properties: { carrier: 'Carrier ' + (i % 7), route_type: 'metro', name: 'Route ' + i },
  geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, k) => [-77.4 + k / 100, 39 + i / 1000]) },
});
const geojson = (n) => ({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => feature(i)), as_of: '2026-10-16' });
const size = (o) => JSON.stringify(o).length;

describe('capJsonValue', () => {
  it('a value under the cap is returned as is, same object', () => {
    const v = geojson(10);
    expect(size(v)).toBeLessThan(MAX);
    const r = capJsonValue(v);
    expect(r.cut).toBeNull();
    expect(r.value).toBe(v);
  });

  it('a 500-feature collection is cut to a prefix that fits, and the cut is named', () => {
    const v = geojson(500);
    expect(size(v)).toBeGreaterThan(MAX * 5);
    const { value, cut } = capJsonValue(v);
    expect(size(value)).toBeLessThanOrEqual(MAX);
    expect(cut).toHaveLength(1);
    expect(cut[0].path).toBe('features');
    expect(cut[0].of).toBe(500);
    expect(cut[0].shown).toBe(value.features.length);
    expect(cut[0].shown).toBeGreaterThan(0);
    expect(cut[0].shown).toBeLessThan(500);
    expect(value.size_cap.cut).toEqual(cut);
    expect(value.size_cap.note).toMatch(/shortened/i);
    // the rows kept are the FIRST ones, untouched and in order
    expect(value.features.map((f) => f.id)).toEqual(v.features.slice(0, cut[0].shown).map((f) => f.id));
    expect(value.features[0]).toEqual(v.features[0]);
    // the rest of the envelope is untouched; the input is not mutated
    expect(value.as_of).toBe('2026-10-16');
    expect(v.features).toHaveLength(500);
    expect('size_cap' in v).toBe(false);
  });

  it('a nested array is cut and named by its path', () => {
    const v = { data: { rows: Array.from({ length: 400 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) }, meta: { n: 400 } };
    const { value, cut } = capJsonValue(v);
    expect(cut[0].path).toBe('data.rows');
    expect(size(value)).toBeLessThanOrEqual(MAX);
    expect(value.meta).toEqual({ n: 400 });
  });

  it('two big arrays are each cut, largest first, until the whole fits', () => {
    const v = {
      a: Array.from({ length: 300 }, (_, i) => ({ i, pad: 'a'.repeat(150) })),
      b: Array.from({ length: 300 }, (_, i) => ({ i, pad: 'b'.repeat(150) })),
    };
    const { value, cut } = capJsonValue(v);
    expect(size(value)).toBeLessThanOrEqual(MAX);
    expect(cut.map((c) => c.path).sort()).toEqual(['a', 'b']);
    for (const c of cut) expect(c.shown).toBe(value[c.path].length);
  });

  it('a result with nothing to cut (one huge string) passes through untouched', () => {
    const v = { text: 'y'.repeat(MAX * 2) };
    const r = capJsonValue(v);
    expect(r.cut).toBeNull();
    expect(r.value).toBe(v);
  });
});

describe('capClaudeResult', () => {
  const big = geojson(500);
  const result = () => ({
    content: [{ type: 'text', text: JSON.stringify(big) }, { type: 'text', text: 'The full result needs a DC Hub plan. Plans: https://dchub.cloud/plans' }],
    structuredContent: big,
  });

  it('cuts both copies the same way and leaves the trailing prose block alone', () => {
    const r = capClaudeResult(result());
    const text = JSON.parse(r.content[0].text);
    expect(r.content[0].text.length).toBeLessThanOrEqual(MAX);
    expect(size(r.structuredContent)).toBeLessThanOrEqual(MAX);
    expect(text.features.length).toBe(r.structuredContent.features.length);
    expect(text.size_cap).toEqual(r.structuredContent.size_cap);
    expect(r.content[1].text).toMatch(/needs a DC Hub plan/);
  });

  it('an error result is returned untouched', () => {
    const e = { content: [{ type: 'text', text: JSON.stringify(big) }], structuredContent: big, isError: true };
    expect(capClaudeResult(e)).toBe(e);
  });

  it('a small result is returned as the same object', () => {
    const s = { content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 1 } };
    expect(capClaudeResult(s)).toBe(s);
  });

  it('non-JSON prose longer than the cap is not touched', () => {
    const prose = { content: [{ type: 'text', text: 'word '.repeat(MAX) }] };
    expect(capClaudeResult(prose)).toBe(prose);
  });

  it('runs on the real path: scrubClaudeToolResult returns a result under the cap with size_cap named', () => {
    const r = scrubClaudeToolResult(result(), 'get_fiber_intel');
    expect(size(r.structuredContent)).toBeLessThanOrEqual(MAX);
    expect(r.structuredContent.size_cap.cut[0].of).toBe(500);
    expect(JSON.parse(r.content[0].text).size_cap.cut[0].path).toBe('features');
  });
});
