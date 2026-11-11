// comparison-primary-metro.test.mjs — A HEAD-TO-HEAD KEEPS ITS FIRST MARKET (2026-11-11).
//
// Live on keyless /mcp/chatgpt, execute_plan:
//   "200 MW in Atlanta (Georgia Power) vs Ashburn: time to power"
//     -> market_comparison, get_market_dcpi_rank ashburn-va TWICE, get_market_intel
//        ashburn-va TWICE; answer_guide "ashburn: AVOID (20) · ashburn: AVOID (20)".
//   "How soon can a 200 MW data center in Atlanta on Georgia Power get power,
//    compared with Northern Virginia?" -> facility_search over Virginia.
// Atlanta never ran. Three causes, each pinned below:
//   1. comparePair's word-pair regex needs a bare word before "vs", so "(Georgia
//      Power) vs" gave no pair, and "compared with" was no comparison wording;
//   2. with no pair, both sides' placeholders took the one constraint slug, which
//      was the first _CITY_ISO_META entry in TABLE order (ashburn sits above atlanta);
//   3. the answer guide dropped Atlanta's verdict: its DCPI record reports SOCO,
//      outside the SERC the city table constrains Atlanta to.
// End to end on the real server: test/comparison-primary-metro-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planComparedMarkets, _execConstraintSlug, _execComparisonDup, _execAnswerGuide } from '../server.mjs';
import { matchDcpiMarket } from '../lib/dcpi-market-match.mjs';

const ATL_VS_ASH = '200 MW in Atlanta (Georgia Power) vs Ashburn: time to power';
const ATL_VS_NOVA = 'How soon can a 200 MW data center in Atlanta on Georgia Power get power, compared with Northern Virginia?';

function marketsByTool(plan) {
  const out = {};
  for (const s of plan.recommended_sequence || []) {
    const a = s.args_hint || {};
    const v = a.market_slug || a.market;
    if (typeof v === 'string') (out[s.tool] = out[s.tool] || []).push(v);
  }
  return out;
}

describe('a comparison names its first market first, and reads each side once', () => {
  it('"Atlanta (Georgia Power) vs Ashburn": Atlanta is side A, Ashburn side B', () => {
    const p = _planQuery(ATL_VS_ASH, {});
    expect(p.intent_class).toBe('market_comparison');
    expect(marketsByTool(p)).toEqual({
      get_market_dcpi_rank: ['atlanta', 'ashburn'],
      get_market_intel: ['atlanta', 'ashburn'],
    });
  });

  it('"…in Atlanta…, compared with Northern Virginia?" is a comparison, Atlanta first', () => {
    const p = _planQuery(ATL_VS_NOVA, {});
    expect(p.intent_class).toBe('market_comparison');
    expect(marketsByTool(p)).toEqual({
      get_market_dcpi_rank: ['atlanta', 'northern-virginia'],
      get_market_intel: ['atlanta', 'northern-virginia'],
    });
  });

  it('the tracked-market pair follows text order, not table order, and joins compound names', () => {
    expect(_planComparedMarkets(ATL_VS_ASH)).toEqual({ a: 'atlanta', b: 'ashburn' });
    expect(_planComparedMarkets('Ashburn vs Atlanta')).toEqual({ a: 'ashburn', b: 'atlanta' });
    expect(_planComparedMarkets('compare Dallas-Fort Worth vs Phoenix')).toEqual({ a: 'dallas', b: 'phoenix' });
    // No comparison wording: two named metros are not a pair.
    expect(_planComparedMarkets('find 100 MW near Dallas or Houston')).toBeNull();
    // One tracked market: the caller falls back to the word-pair regex.
    expect(_planComparedMarkets('compare Phoenix vs Timbuktu')).toBeNull();
  });

  it('the intent\'s constraint slug is the metro named first', () => {
    expect(_execConstraintSlug(ATL_VS_ASH)).toBe('atlanta-ga');
    expect(_execConstraintSlug('Ashburn vs Atlanta')).toBe('ashburn-va');
    expect(_execConstraintSlug('find 50 MW in Dallas')).toBe('dallas-tx');
  });

  it('the executor refuses a second read of the same market in a comparison', () => {
    const seen = new Map();
    expect(_execComparisonDup('market_comparison', 'get_market_dcpi_rank', { market_slug: 'ashburn-va' }, seen)).toBeNull();
    expect(_execComparisonDup('market_comparison', 'get_market_dcpi_rank', { market_slug: 'ashburn' }, seen))
      .toEqual({ key: 'market_slug', value: 'ashburn' });
    expect(_execComparisonDup('market_comparison', 'get_market_intel', { market: 'ashburn' }, seen)).toBeNull();
    expect(_execComparisonDup('market_comparison', 'get_market_dcpi_rank', { market_slug: 'atlanta' }, seen)).toBeNull();
    // Only a comparison is held to this.
    const other = new Map();
    expect(_execComparisonDup('capacity_search', 'get_market_dcpi_rank', { market_slug: 'x' }, other)).toBeNull();
    expect(_execComparisonDup('capacity_search', 'get_market_dcpi_rank', { market_slug: 'x' }, other)).toBeNull();
  });

  it('the answer guide keeps a SOCO verdict when the constraint is SERC', () => {
    const executed = [
      { step: 1, tool: 'get_market_dcpi_rank', result: { market_slug: 'atlanta', iso: 'SOCO', verdict: 'AVOID', composite_score: 20.7 } },
      { step: 2, tool: 'get_market_dcpi_rank', result: { market_slug: 'ashburn', iso: 'PJM', verdict: 'AVOID', composite_score: 20 } },
    ];
    const g = _execAnswerGuide(executed, ['PJM', 'SERC']);
    expect(g).toMatch(/^LEAD WITH THE VERDICT — this run returned: atlanta: AVOID \(20\.7\) · ashburn: AVOID \(20\)\./);
    // A verdict from a grid outside the constraint is still dropped.
    expect(_execAnswerGuide([{ step: 1, tool: 'get_market_dcpi_rank',
      result: { market_slug: 'dallas', iso: 'ERCOT', verdict: 'BUILD' } }], ['SERC'])).not.toMatch(/dallas/);
  });
});

describe('Atlanta / Georgia Power asks route instead of falling to unknown', () => {
  for (const intent of ['Georgia Power 200MW data center Atlanta GA',
                        'Atlanta / Georgia Power: how soon can 200 MW get power?']) {
    it(intent, () => {
      const p = _planQuery(intent, {});
      expect(p.intent_class).toBe('capacity_search');
      expect(p.recommended_sequence.map((s) => s.tool)).toContain('get_market_dcpi_rank');
      expect(_execConstraintSlug(intent)).toBe('atlanta-ga');
    });
  }

  it('an ISO-named time-to-power ask still routes to grid_headroom', () => {
    const p = _planQuery('how soon can a 100 MW load get power in ERCOT', {});
    expect(p.intent_class).toBe('grid_headroom');
    expect(p.recommended_sequence[0].tool).toBe('get_grid_intelligence');
  });

  it('"Atlanta on Georgia Power" is Atlanta, GA, not Atlanta, Ontario', () => {
    const h = matchDcpiMarket('a 200 MW data center in Atlanta on Georgia Power');
    expect(h && h.kind).toBe('hit');
    expect(h.slug).toBe('atlanta');
  });
});
