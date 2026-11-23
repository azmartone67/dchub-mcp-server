// Brain 2026-11-23 item 4: every tool's answer carries a dated cite_as, a Source line inside the first 300
// characters of content[0] and as the last text item, one date, and no price or plan name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withCiteFirst, resolveCiteStamp, CITE_AS_RE, SOURCE_LINE_RE } from '../lib/cite-first.mjs';

const TOOLS = JSON.parse(readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8')).map((t) => t.name);
const NOW = new Date('2026-11-23T12:00:00Z');
const ON = { DCHUB_CITE_FIRST: '1' };
const PLAN_WORDS = /\$|\b(free|starter|developer|pro|professional|enterprise|business|team) (plan|tier)\b|\bper month\b/i;

const json = (o, pretty = false) => ({ type: 'text', text: JSON.stringify(o, null, pretty ? 2 : undefined) });
const SHAPES = {
  provenance: () => { const sc = { provenance: { as_of: '2026-11-20' }, as_of: '2026-11-22', rows: [{ as_of: '2026-11-21' }] }; return { content: [json(sc, true)], structuredContent: sc }; },
  top_as_of: () => { const sc = { as_of: '2026-11-19T04:00:00Z', citation: { as_of: '2026-11-01' } }; return { content: [json(sc)], structuredContent: sc }; },
  rows_only: () => { const sc = { results: [{ as_of: '2026-03-30' }, { as_of: '2026-05-02' }] }; return { content: [json(sc)], structuredContent: sc }; },
  undated: () => { const sc = { note: 'none on file', retrieved_at: '2026-11-23T08:00:00Z' }; return { content: [json(sc)], structuredContent: sc }; },
  partial: () => { const sc = { as_of: '2026-11-18', completeness: { status: 'partial' }, cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 10 shown' };
    return { content: [{ type: 'text', text: 'Preview: 3 of 10 shown. ' + 'x'.repeat(400) }, json(sc)], structuredContent: sc }; },
  text_lead: () => { const sc = { as_of: '2026-11-21' }; return { content: [{ type: 'text', text: 'Lead sentence. '.repeat(40) + '\nSource: DC Hub (dchub.cloud), as of 2026-11-02' }], structuredContent: sc }; },
};

const lines = (r) => r.content.filter((it) => it.type === 'text').map((it) => it.text);
const dateOf = (s) => (s.match(/as of (\d{4}-\d{2}-\d{2})/) || [])[1];

describe('cite_as and the Source line on every toolspec tool', () => {
  it('reads the tool list', () => { expect(TOOLS.length).toBeGreaterThan(50); expect(TOOLS).toContain('execute_plan'); });
  for (const tool of TOOLS) {
    it(tool, () => {
      for (const [shape, make] of Object.entries(SHAPES)) {
        const out = withCiteFirst(make(), tool, {}, { now: NOW, env: ON });
        const cite = out.structuredContent.cite_as;
        expect(cite, `${tool}/${shape}`).toMatch(CITE_AS_RE);
        const texts = lines(out);
        const last = texts[texts.length - 1];
        expect(last, `${tool}/${shape} last`).toMatch(SOURCE_LINE_RE);
        expect(texts[0].slice(0, 300), `${tool}/${shape} lead`).toContain(last);
        expect(dateOf(cite)).toBe(dateOf(last));
        expect(texts.filter((t) => t.includes('Source: DC Hub (dchub.cloud')).length, `${tool}/${shape} lead + last, no third`).toBe(2);
        for (const t of [cite, last]) expect(t).not.toMatch(PLAN_WORDS);
        if (texts[0].trim().startsWith('{')) expect(Object.keys(JSON.parse(texts[0]))[0]).toBe('_source_line');
      }
    });
  }
});

describe('resolve order (item a)', () => {
  it('provenance first', () => expect(resolveCiteStamp({ provenance: { as_of: '2026-01-02' }, as_of: '2026-05-05' }, NOW)).toEqual({ stamp: '2026-01-02', retrieved: false }));
  it('then the top-level as_of', () => expect(resolveCiteStamp({ as_of: '2026-05-05', citation: { as_of: '2026-04-04' } }, NOW).stamp).toBe('2026-05-05'));
  it('then citation.as_of', () => expect(resolveCiteStamp({ citation: { as_of: '2026-04-04' } }, NOW).stamp).toBe('2026-04-04'));
  it('then the newest row', () => expect(resolveCiteStamp({ data: { rows: [{ as_of: '2026-02-01' }, { as_of: '2026-03-01' }] } }, NOW).stamp).toBe('2026-03-01'));
  it('else the retrieval time, labelled', () => {
    expect(resolveCiteStamp({ retrieved_at: '2026-11-20T01:00:00Z' }, NOW)).toEqual({ stamp: '2026-11-20', retrieved: true });
    const out = withCiteFirst({ content: [json({ a: 1 })], structuredContent: { a: 1 } }, 'get_news', {}, { now: NOW, env: ON });
    expect(out.structuredContent.cite_as).toBe('DC Hub (dchub.cloud), as of 2026-11-23 (retrieved)');
  });
  it('an UNMEASURED provenance never shows the load date as the data date', () => {
    const r = resolveCiteStamp({ as_of: '2026-10-06', provenance: { as_of: null }, retrieved_at: '2026-10-07T05:00:00Z' }, NOW);
    expect(r).toEqual({ stamp: '2026-10-07', retrieved: true });
  });
  it('keeps a cite_as that is already dated, hour and partial note included', () => {
    const sc = { cite_as: 'DC Hub (dchub.cloud), as of 2026-11-20T17:00Z', as_of: '2026-01-01' };
    const out = withCiteFirst({ content: [json(sc)], structuredContent: sc }, 'get_grid_data', { iso: 'PJM' }, { now: NOW, env: ON });
    expect(out.structuredContent.cite_as).toBe(sc.cite_as);
    expect(lines(out).at(-1)).toBe('Source: DC Hub (dchub.cloud/grid/pjm), as of 2026-11-20T17:00Z');
  });
  it('marks a preview partial', () => {
    const sc = { as_of: '2026-11-18', _upgrade: { tier: 'free' } };
    const out = withCiteFirst({ content: [json(sc)], structuredContent: sc }, 'get_market_intel', {}, { now: NOW, env: ON });
    expect(out.structuredContent.cite_as).toBe('DC Hub (dchub.cloud), as of 2026-11-18 — partial preview');
  });
});

describe('what it leaves alone', () => {
  const sc = { as_of: '2026-11-18', citation: { as_of: '2026-11-18', x: 1 }, provenance: { as_of: '2026-11-18' } };
  it('citation{} and provenance{} unchanged', () => {
    const out = withCiteFirst({ content: [json(sc)], structuredContent: sc }, 'get_news', {}, { now: NOW, env: ON });
    expect(out.structuredContent.citation).toBe(sc.citation);
    expect(out.structuredContent.provenance).toBe(sc.provenance);
  });
  it('errors, skip and the kill switch', () => {
    const err = { content: [json({ error: 'not found' })], isError: true };
    expect(withCiteFirst(err, 'get_facility', {}, { now: NOW, env: ON })).toBe(err);
    const ok = { content: [json(sc)], structuredContent: sc };
    expect(withCiteFirst(ok, 'get_news', {}, { now: NOW, env: ON, skip: true })).toBe(ok);
    expect(withCiteFirst(ok, 'get_news', {}, { now: NOW, env: { DCHUB_CITE_FIRST: '0' } })).toBe(ok);
    expect(withCiteFirst(ok, 'get_news', {}, { now: NOW, env: {} })).toBe(ok);   // default OFF
  });
  it('is idempotent', () => {
    const once = withCiteFirst({ content: [json(sc)], structuredContent: sc }, 'get_news', {}, { now: NOW, env: ON });
    const twice = withCiteFirst(once, 'get_news', {}, { now: NOW, env: ON });
    expect(twice.content).toEqual(once.content);
  });
});
