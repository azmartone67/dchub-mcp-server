// Pack canon (Jonathan, 2026-10-04): the $10 pack is API capacity and is never named as what
// returns gated fields, for ANY tool (mcp#744 did get_market_dcpi_rank only; this is the rest).
// Pure builders: no network.
import { describe, it, expect } from 'vitest';
import { relayMissedClause, rungSentence } from '../lib/upgrade-missed.mjs';
import { marketIntelSellLine, compareIsosSellLine, rankMarketsSellLine } from '../lib/paid-sell-line.mjs';
import { fiberSellLine } from '../lib/grid-sell-line.mjs';

const PACK = /\$10|pack|1,000 API credits/i;
const U = 'https://dchub.cloud/upgrade/h/x.y?buy=1';
describe('no pack-returns-fields wording anywhere a rung or sell line is built', () => {
  it('pack rung: relay clause and rung sentence point at the plans page', () => {
    const mu = { missed: { labels: ['MW', 'scores'] }, rung: 'pack' };
    const c = relayMissedClause(mu);
    expect(c, 'control: the clause was built').toMatch(/^this answer hid MW and scores; /);
    expect(c).not.toMatch(PACK);
    expect(rungSentence('pack')).not.toMatch(PACK);
    expect(rungSentence('developer'), 'control: other rungs still describe their plan (v14: unnamed)').toBe('They come with a paid DC Hub plan');
  });
  it('keyless sell lines never price the pack as the unlock', () => {
    const all = { _avg_time_to_power_months_in_pro: true, _queue_depth_gw_in_pro: true };
    const lines = [
      marketIntelSellLine({ market: 'dallas', hid: ['total mw'], url: U }),
      compareIsosSellLine({ isos: ['PJM', 'ERCOT'], perIso: [all, all], url: U }),
      rankMarketsSellLine({ criteria: 'best_overall', region: 'us', total: 10, shown: 3, scoreHidden: true, mwHidden: true, url: U }),
      fiberSellLine({ place: 'ashburn', hid: 'the total', url: U }),
      fiberSellLine({ place: 'ashburn', url: U, shown: 3, total: 12, geom: true }),
    ];
    for (const l of lines) {
      expect(l, 'control: a line was produced').toBeTruthy();
      expect(l).not.toMatch(PACK);
      expect(l.endsWith(U)).toBe(true);
    }
  });
});
