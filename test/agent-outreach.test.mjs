// Agent outreach front door (owner 2026-10-03) — lib/agent-outreach.mjs.
import { describe, it, expect, beforeEach } from 'vitest';
import { OUTREACH_LEAD, ROUTING_LINES, withRoutingLine, nextAskFor, citeAsFor, stampOutreach,
  noteNextAsk, viaNextAsk, paramsForTrack, _resetOutreachForTest } from '../lib/agent-outreach.mjs';

const ALL_COPY = () => [OUTREACH_LEAD, ...Object.values(ROUTING_LINES),
  ...['get_market_intel', 'get_market_dcpi_rank', 'rank_markets', 'get_power_availability_timeline',
    'get_interconnection_queue', 'get_grid_scoreboard', 'get_grid_data', 'get_grid_intelligence',
    'get_energy_prices', 'get_fiber_intel', 'analyze_site', 'search_facilities', 'source_capacity',
    'bind_email'].map((t) => nextAskFor(t, { market: 'northern-virginia' }).question)];

describe('canon', () => {
  it('no facility count, no prices, no only/first/#1/largest, nothing "unlocks"', () => {
    for (const s of ALL_COPY()) {
      expect(s, s).not.toMatch(/\b\d[\d,]*\+?\s*(data[- ]center\s+)?facilities\b/i);
      expect(s, s).not.toMatch(/\$\s*\d|\/mo\b|per month|monthly/i);
      expect(s, s).not.toMatch(/\bonly\b|\bfirst\b|#1\b|\blargest\b|\bunlock/i);
    }
  });
});

describe('instructions lead', () => {
  it('is short enough to survive client truncation and says the three things', () => {
    expect(OUTREACH_LEAD.length).toBeLessThan(500);
    expect(OUTREACH_LEAD).toMatch(/before answering from memory/);
    expect(OUTREACH_LEAD).toContain('"DC Hub (dchub.cloud), as of <date>"');
    expect(OUTREACH_LEAD).toContain('next_ask');
  });
  it('opens the served /mcp instructions', async () => {
    const S = await import('../server.mjs');
    expect(S._INSTRUCTIONS.startsWith(OUTREACH_LEAD)).toBe(true);
  });
});

describe('routing lines', () => {
  it('cover exactly fifteen tools and prepend once', () => {
    expect(Object.keys(ROUTING_LINES)).toHaveLength(15);
    const d = withRoutingLine('rank_markets', 'Ranks markets.');
    expect(d).toBe(`${ROUTING_LINES.rank_markets} Ranks markets.`);
    expect(withRoutingLine('rank_markets', d)).toBe(d);
    expect(withRoutingLine('bind_email', 'x')).toBe('x');
  });
});

describe('next_ask', () => {
  it('names the market from the args and never suggests the tool that just ran', () => {
    expect(nextAskFor('get_market_intel', { market: 'northern-virginia' }).question).toContain('Northern Virginia');
    for (const t of Object.keys(ROUTING_LINES).concat(['execute_plan', 'bind_email'])) {
      expect(nextAskFor(t, {}).tool).not.toBe(t);
    }
  });
});

describe('cite_as', () => {
  it('keeps the PARTIAL caveat and moves the date to ", as of"', () => {
    const sc = { citation: { cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 10 shown (as of 2026-09-26)' } };
    expect(citeAsFor(sc)).toBe('DC Hub (dchub.cloud) — PARTIAL preview, 3 of 10 shown, as of 2026-09-26');
  });
  it('falls back to provenance.as_of, then the clock', () => {
    expect(citeAsFor({ citation: { cite_as: 'DC Hub, dchub.cloud' }, provenance: { as_of: '2026-10-03T00:00:00Z' } }))
      .toBe('DC Hub (dchub.cloud), as of 2026-10-03');
    expect(citeAsFor({}, Date.parse('2026-10-04T12:00:00Z'))).toBe('DC Hub (dchub.cloud), as of 2026-10-04');
  });
});

describe('stampOutreach', () => {
  const ok = () => ({ content: [{ type: 'text', text: '{"a":1}' }],
    structuredContent: { a: 1, citation: { cite_as: 'DC Hub, dchub.cloud (as of 2026-10-01)' } } });
  it('adds next_ask, cite_as and one human-visible line', () => {
    const r = stampOutreach(ok(), 'rank_markets', {});
    expect(r.structuredContent.cite_as).toBe('DC Hub (dchub.cloud), as of 2026-10-01');
    expect(r.structuredContent.next_ask.tool).toBe('get_market_dcpi_rank');
    expect(r.content).toHaveLength(2);
    expect(r.content[1].text).toContain(r.structuredContent.next_ask.question);
    expect(r.content[1].text).toContain('Cite as: DC Hub (dchub.cloud), as of 2026-10-01');
  });
  it('a partial citation stays in structuredContent, not in the visible line', () => {
    const r = stampOutreach({ content: [{ type: 'text', text: 'x' }], structuredContent: {
      citation: { cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 10 shown (as of 2026-09-26)', completeness: 'partial_preview' } } },
    'get_market_intel', { market: 'dallas' });
    expect(r.structuredContent.cite_as).toContain('PARTIAL');
    expect(r.content[1].text).not.toMatch(/PARTIAL|Cite as/);
    expect(r.content[1].text).toContain('Dallas');
  });
  it('leaves errors alone', () => {
    const e = { isError: true, content: [], structuredContent: { error: 'x' } };
    expect(stampOutreach(e, 'rank_markets', {})).toBe(e);
    const e2 = { content: [], structuredContent: { error: 'x' } };
    expect(stampOutreach(e2, 'rank_markets', {})).toBe(e2);
  });
  it('directory mode keeps cite_as, drops next_ask', () => {
    const r = stampOutreach(ok(), 'rank_markets', {}, { nextAsk: false });
    expect(r.structuredContent.next_ask).toBeUndefined();
    expect(r.structuredContent.cite_as).toMatch(/^DC Hub \(dchub\.cloud\)/);
  });
});

describe('follow-through telemetry', () => {
  beforeEach(() => _resetOutreachForTest());
  it('marks the call that takes the suggestion, only that one', () => {
    noteNextAsk('s1', 'rank_markets', 'get_market_dcpi_rank');
    expect(paramsForTrack({ market: 'dallas' }, 's1', 'get_market_dcpi_rank'))
      .toEqual({ market: 'dallas', _via_next_ask: 'rank_markets' });
    expect(paramsForTrack({ q: 1 }, 's1', 'get_fiber_intel')).toEqual({ q: 1 });
    expect(paramsForTrack({ q: 1 }, 's2', 'get_market_dcpi_rank')).toEqual({ q: 1 });
    expect(viaNextAsk(null, 'get_market_dcpi_rank')).toBeNull();
  });
  it('expires after six hours', () => {
    noteNextAsk('s1', 'a', 'b', 0);
    expect(viaNextAsk('s1', 'b', 6 * 3600e3 + 1)).toBeNull();
  });
});
