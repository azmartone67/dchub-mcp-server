// planner-dcpi-one-market-1122.test.mjs — DCHUB_PLANNER_DCPI_CLASSIFY_FIX (default OFF; lib/dcpi-one-market.mjs).
//
// Live 2026-11-22 (planner 5.61): "What is the Data Center Power Index for Ashburn, Virginia?" routed to unknown
// and ran discover_tools only; "What is the DCPI for Ashburn?" routed to market_ranking with an unbound slug.
// With the flag on, a DCPI ask about one named market reads that market's card; rankings and comparisons keep
// their class. Off: unchanged.
import { describe, it, expect, afterEach } from 'vitest';

process.env.DCHUB_API_BASE = process.env.DCHUB_API_BASE || 'http://127.0.0.1:9';
const S = await import('../server.mjs');
const prev = process.env.DCHUB_PLANNER_DCPI_CLASSIFY_FIX;
afterEach(() => { if (prev === undefined) delete process.env.DCHUB_PLANNER_DCPI_CLASSIFY_FIX; else process.env.DCHUB_PLANNER_DCPI_CLASSIFY_FIX = prev; });
const plan = (q, on) => {
  if (on) process.env.DCHUB_PLANNER_DCPI_CLASSIFY_FIX = '1'; else delete process.env.DCHUB_PLANNER_DCPI_CLASSIFY_FIX;
  return S._planQuery(q, {});
};
const dcpiSlugs = (p) => (p.recommended_sequence || []).filter((s) => s.tool === 'get_market_dcpi_rank').map((s) => s.args_hint && s.args_hint.market_slug);

describe('DCPI ask about one named market', () => {
  const cases = [
    ['What is the Data Center Power Index for Ashburn, Virginia?', 'ashburn'],
    ['What is the DCPI for Ashburn?', 'ashburn'],
    ['DCPI score for Northern Virginia', 'northern-virginia'],
    ['What is the Data Center Power Index for Phoenix?', 'phoenix'],
  ];
  for (const [q, slug] of cases) {
    it(`flag on: "${q}" reads ${slug}'s DCPI card first`, () => {
      const p = plan(q, true);
      expect(p.intent_class).toBe('market_outlook');
      expect(p.recommended_sequence[0].tool).toBe('get_market_dcpi_rank');
      expect(dcpiSlugs(p)).toEqual([slug]);
    });
  }

  it('flag off: the 5.61 routing is unchanged (the spelled-out ask stays unknown)', () => {
    expect(plan('What is the Data Center Power Index for Ashburn, Virginia?', false).intent_class).toBe('unknown');
    expect(plan('What is the DCPI for Ashburn?', false).intent_class).toBe('market_ranking');
  });

  it('flag on: rankings and comparisons keep their class', () => {
    expect(plan('Rank markets by DCPI', true).intent_class).toBe('market_ranking');
    expect(plan('Top 10 markets by Data Center Power Index', true).intent_class).toBe('market_ranking');
    expect(plan('What is DCPI?', true).intent_class).toBe('market_ranking');
    const c = plan('Compare the DCPI for Ashburn vs Dallas', true);
    expect(c.intent_class).toBe('market_comparison');
    expect(dcpiSlugs(c)).toEqual(['ashburn', 'dallas']);
  });

  it('flag on: an untracked place is not swapped for a ranked market', () => {
    const p = plan('What is the DCPI for Atlantis?', true);
    expect(p.intent_class).toBe('market_outlook');
    expect(p.recommended_sequence.map((s) => s.tool)).not.toContain('rank_markets');
  });
});
