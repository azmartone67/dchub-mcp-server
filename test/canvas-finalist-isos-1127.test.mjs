// 2026-11-27 xd-a live: site_selection_canvas returns excluded_by_max_months (Garden City and three other NY markets, all
// over the 24-month deadline) BEFORE shortlist, and the generic harvest minted NYISO from it first, so the plan ran a
// NYISO queue and headroom step for a market the answer dropped. Excluded rows never mint; a canvas's ISOs are its top
// shortlist rows' grids, in rank order.
import { describe, it, expect } from 'vitest';
import { _execHarvest, _canvasFinalistIsos } from '../server.mjs';

const row = (market, iso, state, ttp) => ({ market, iso, state, slug: market.toLowerCase(), time_to_power_months: ttp });
const CANVAS = {
  applied_filters: { max_months: 24 },
  excluded_by_max_months: { count: 58, markets: [row('Garden City', 'NYISO', 'NY', 24.5), row('Commack', 'NYISO', 'NY', 24.5)] },
  shortlist: [row('Midland–Odessa', 'ERCOT', 'TX', 9.6), row('Upper Peninsula MI', 'MISO', 'MI', 9.6),
    row('Williston, ND', 'MISO', 'ND', 8.4), row('Cheyenne', 'PACE', 'WY', 10.8), row('North Kansas City', 'SPP', 'MO', 12.8)],
};

describe('canvas ISO mints follow the finalists', () => {
  it('the generic harvest never mints from an excluded list', () => {
    const minted = {};
    _execHarvest(CANVAS, minted, 3);
    expect(minted.iso || []).not.toContain('NYISO');
    expect(minted.iso).toEqual(['ERCOT', 'MISO', 'SPP']);
  });

  it('a canvas mints the distinct grids of its top rows, in rank order', () => {
    expect(_canvasFinalistIsos(CANVAS, 3)).toEqual(['ERCOT', 'MISO']);
    expect(_canvasFinalistIsos(CANVAS, 5)).toEqual(['ERCOT', 'MISO', 'SPP']);   // PACE is not an ISO-shaped mint
  });

  it('no shortlist array: null, so the generic harvest stands', () => {
    expect(_canvasFinalistIsos({ markets: [] }, 3)).toBeNull();
    expect(_canvasFinalistIsos(null, 3)).toBeNull();
  });
});

describe('the executor uses it', () => {
  it('a site_selection_canvas step replaces its harvested ISO mints with the finalist ISOs', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const at = src.indexOf("if (s.tool === 'site_selection_canvas') {\n                const iso = _canvasFinalistIsos(");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 300)).toMatch(/if \(iso && iso\.length\) fresh\.iso = iso;/);
    // it runs before the mints are copied from `fresh` into the plan's pool
    expect(src.indexOf('for (const [kind, vals] of Object.entries(fresh))', at)).toBeGreaterThan(at);
  });
});

describe('the answer guide leads with the shortlist, not the markets the deadline removed', () => {
  it('excluded_by_* verdicts are not led with', async () => {
    const { _execAnswerGuide } = await import('../server.mjs');
    const v = (market, verdict, composite_score) => ({ market, verdict, composite_score });
    const result = {
      excluded_by_max_months: { count: 58, markets: [v('Garden City', 'CAUTION', 45.9), v('Commack', 'CAUTION', 45.8)] },
      shortlist: [v('Midland–Odessa', 'BUILD', 80.6), v('Upper Peninsula MI', 'BUILD', 77)],
    };
    const g = _execAnswerGuide([{ step: 1, tool: 'site_selection_canvas', status: 'executed', result }]);
    expect(g).toMatch(/LEAD WITH THE VERDICT — this run returned: Midland–Odessa: BUILD \(80\.6\) · Upper Peninsula MI: BUILD \(77\)/);
    expect(g).not.toContain('Garden City');
    expect(g).not.toContain('Commack');
  });
});
