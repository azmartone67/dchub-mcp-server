// paid-sell-line.test.mjs: batch 1 item 3 (owner-approved 2026-10-04), DCHUB_PAID_SELL_LINE.
// Fixtures are keyless QA probes of the live worker (trimmed), so the markers are real.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { marketIntelSellLine, compareIsosSellLine, rankMarketsSellLine, proWallLine, paidAgentLine, parseHidList } from '../lib/paid-sell-line.mjs';
import { GRID_SELL_MAX } from '../lib/grid-sell-line.mjs';

const fx = (n) => JSON.parse(readFileSync(new URL('./fixtures/paid-sell/' + n + '.json', import.meta.url), 'utf8'));
const mk = (n) => { const f = fx(n); return { content: [{ type: 'text', text: f.text }, { type: 'text', text: '🧭 **Next:** execute_plan' }], structuredContent: f.sc }; };
const U = 'https://dchub.cloud/upgrade/h/fixture.sig';
const before = (s) => s.slice(0, s.indexOf('https://'));
const text = (r) => r.content.map((c) => c.text).join('\n');
const env = (v) => { const p = process.env.DCHUB_PAID_SELL_LINE; if (v === undefined) delete process.env.DCHUB_PAID_SELL_LINE; else process.env.DCHUB_PAID_SELL_LINE = v; return () => { if (p === undefined) delete process.env.DCHUB_PAID_SELL_LINE; else process.env.DCHUB_PAID_SELL_LINE = p; }; };

describe('builders (pure)', () => {
  it('copy matches the handoff', () => {
    expect(marketIntelSellLine({ market: 'dallas', hid: parseHidList('coverage (%), rows total, total MW'), providersTotal: 10, timeToPower: true, url: U }))
      .toBe('This free DC Hub preview of the Dallas market hides its total MW, time to power and 7 of the top 10 providers. The plans that include the full Dallas market brief are on this page: ' + U);
    const all = { _avg_time_to_power_months_in_pro: true, _queue_depth_gw_in_pro: true, _headroom_in_pro: true, _constraint_score_in_pro: true, _excess_power_score_in_pro: true, _grid_emergencies_30d_in_pro: true };
    expect(compareIsosSellLine({ isos: ['PJM', 'ERCOT'], perIso: [all, all], url: U }))
      .toBe("This free DC Hub comparison of PJM and ERCOT hides each grid's time to power, queue depth, headroom, the constraint and excess power scores and 30-day grid emergencies. The plans that include the full comparison are on this page: " + U);
    expect(rankMarketsSellLine({ criteria: 'best_overall', region: 'us', total: 10, shown: 3, scoreHidden: true, mwHidden: true, url: U }))
      .toBe("This free DC Hub best overall ranking of US markets shows 3 of 10 and hides each market's score and total MW. The plans that include the full ranking are on this page: " + U);
  });
  it('names only what the gate lists, stays under the bound, no em dash', () => {
    expect(marketIntelSellLine({ market: 'dallas', hid: [], providersTotal: 3, timeToPower: false, url: U })).toBeNull();
    expect(marketIntelSellLine({ market: 'dallas', hid: ['coverage (%)'], providersTotal: 10, timeToPower: false, url: U })).not.toMatch(/total MW|time to power/);
    expect(compareIsosSellLine({ isos: ['PJM'], perIso: [{ _headroom_in_pro: true }, {}], url: U })).toBeNull();
    const four = compareIsosSellLine({ isos: ['PJM', 'ERCOT', 'MISO', 'CAISO'], perIso: [{ _avg_time_to_power_months_in_pro: true, _queue_depth_gw_in_pro: true, _headroom_in_pro: true, _constraint_score_in_pro: true, _excess_power_score_in_pro: true, _grid_emergencies_30d_in_pro: true }], url: U });
    expect(before(four).length).toBeLessThanOrEqual(GRID_SELL_MAX + 40);   // the fixed lead and tail ride on top of the 240 list bound
    for (const s of [four, proWallLine('analyze_site', U), proWallLine('compare_sites', U)]) expect(s).not.toMatch(/—|\/mo|facilit/i);
    expect(rankMarketsSellLine({ criteria: 'weird', region: 'us', total: 10, shown: 3, scoreHidden: true, url: U })).toBeNull();
    expect(proWallLine('analyze_site', U)).not.toMatch(/\$|buy=1|free/);
    expect(proWallLine('get_dchub_recommendation', U)).toBeNull();
  });
  it('repeat agent line ends on the link', () => {
    const l = 'https://dchub.cloud/go/c/abc.def';
    expect(paidAgentLine('rank_markets', 0, true, l).endsWith(l)).toBe(true);
    expect(paidAgentLine('rank_markets', 4, false)).toContain('4 fields are withheld');
  });
});

describe('_paidSellStep on real-shape keyless responses', () => {
  let S, off;
  beforeAll(async () => { S = await import('../server.mjs'); }, 60_000);
  const run = (r, name, ctx = { tier: 'free', session_id: 's-paid' }) => S._ctxALS.run(ctx, () => S._gridSellStep(r, name));

  it('default OFF: byte-identical response', () => {
    const r = mk('rank_markets');
    expect(run(r, 'rank_markets')).toBe(r);
  });
  describe.each(['get_market_intel', 'compare_isos', 'rank_markets'])('%s with the switch on', (name) => {
    it('one plans sentence, ?buy=1 last, old ladder gone, hid list from markers', () => {
      const restore = env('1');
      try {
        const r = run(mk(name), name), t = text(r), sc = r.structuredContent;
        expect(sc.user_message).toMatch(/The plans that include the full [A-Za-z ]+ are on this page: https:\/\/dchub\.cloud\/upgrade\/h\/fixture\.sig\?buy=1$/);
        expect(before(sc.user_message).length).toBeLessThanOrEqual(GRID_SELL_MAX + 40);
        expect(sc.for_your_human.text).toBe(sc.user_message);
        expect(t).toContain(sc.user_message);
        expect(t).not.toMatch(/claim_free_key|\*\*Developer\*\*|Want the decision|—.*Developer/);
        expect(t).toContain(name + ' returned a free preview:');
        expect(sc.preview_is_partial).toBe(true);
        expect(r.content[1].text).toContain('execute_plan');   // the compass block is left alone
        expect(sc.user_message).not.toMatch(/—/);
      } finally { restore(); }
    });
    it('keyed callers and the other arm see the same sentence or none', () => {
      const restore = env('1');
      try {
        const r = mk(name);
        expect(run(r, name, { tier: 'free', api_key: 'dch_live_x', session_id: 's-k' })).toBe(r);
      } finally { restore(); }
    });
  });
  it('market_intel names the three things the gate listed, nothing it did not', () => {
    const restore = env('1');
    try {
      const s = run(mk('get_market_intel'), 'get_market_intel').structuredContent.user_message;
      expect(s).toContain('hides its total MW, time to power and 7 of the top 10 providers');
      expect(s).not.toMatch(/lease|asking|utilit/);
    } finally { restore(); }
  });
  it('get_market_intel REPEAT (header ends on the closing rule, no human line) swaps the old block', () => {
    const restore = env('1');
    try {
      const f = fx('get_market_intel');
      const hdrEnd = f.text.indexOf('\n\n---\n\n→ **For your human:**');
      expect(hdrEnd).toBeGreaterThan(0);
      const wall = 'https://dchub.cloud/go/c/wall.tok';
      const hdr = f.text.slice(0, hdrEnd).replaceAll('the "For your human" link below', wall);
      for (const tail of ['\n\n---\n', '\n\n---']) {          // a repeat ends on --- with at most one newline
        const r = { content: [{ type: 'text', text: hdr + tail }], structuredContent: f.sc };
        const t = run(r, 'get_market_intel').content[0].text;
        expect(t).not.toMatch(/1 of 300\+ markets|claim_free_key|Developer\*\*|Want the decision/);
        expect(t).not.toContain('\u2014\u2014');
        expect(t.includes('\u2014')).toBe(false);
        expect(t).toContain(wall);
        expect(t.trimEnd().endsWith('---')).toBe(true);        // the closing rule is kept exactly as found
        expect(t.startsWith('{"fixture":"get_market_intel"}\n\n---\n\n')).toBe(true);
      }
    } finally { restore(); }
  });
  it('a repeat call (no human line) gets the agent line ending in the wall /go/c link', () => {
    const restore = env('1');
    try {
      const f = fx('rank_markets');
      const hdr = f.text.slice(f.text.indexOf('🔒'), f.text.indexOf('→ **For your human:**')).replace('the "For your human" link below (`rank_markets`', 'https://dchub.cloud/go/c/wall.tok (`rank_markets`');
      const r = { content: [{ type: 'text', text: '{"x":1}\n\n---\n\n' + hdr.trimEnd() }], structuredContent: f.sc };
      const t = run(r, 'rank_markets').content[0].text.trimEnd();
      expect(t.endsWith('the one-click $10 link is: https://dchub.cloud/go/c/wall.tok')).toBe(true);
      expect(JSON.parse(t.split('\n\n---\n\n')[0])).toEqual({ x: 1 });
    } finally { restore(); }
  });
  describe.each(['analyze_site', 'compare_sites'])('%s wall', (name) => {
    it('paid-plan sentence (no plan name), relay link without ?buy=1, no price, no claim_free_key', () => {
      const restore = env('1');
      try {
        const r = run(mk(name), name), t = text(r);
        const s = r.structuredContent.user_message;
        expect(s).toBe(proWallLine(name, r.structuredContent.for_your_human.url));
        expect(s).toMatch(/in DC Hub's paid plan: https:\/\/dchub\.cloud\/(upgrade\/h|u)\/[^\s?]+$/);
        expect(s).not.toMatch(/\bPro\b/);
        expect(t).not.toMatch(/claim_free_key|buy=1|\$\d/);
        expect(t).toContain(s);
        expect(r.structuredContent._wall).toBeTruthy();   // still a wall
      } finally { restore(); }
    });
  });
  it('other tools are untouched, including get_dchub_recommendation', () => {
    const restore = env('1');
    try {
      const r = mk('rank_markets');
      expect(run(r, 'get_dchub_recommendation')).toBe(r);
    } finally { restore(); }
  });
  it('switch set to 0 restores the old behaviour', () => {
    const restore = env('0');
    try { const r = mk('compare_isos'); expect(run(r, 'compare_isos')).toBe(r); } finally { restore(); }
  });
});

describe('fiber citation (DCHUB_PAID_SELL_LINE)', () => {
  const fiber = () => ({
    _truncated: true, _features_total_in_pro: 500,
    features: [1, 2, 3].map((i) => ({ id: i, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]], _coordinates_total_in_pro: 884 } })),
    provenance: { as_of: null },
    preview_is_partial: true,
  });
  it('off: today\'s behaviour (the nested count wins, dated by the serve day)', async () => {
    const { attributionFor } = await import('../lib/attribution.mjs');
    const restore = env(undefined);
    try { expect(attributionFor(fiber()).citation.cite_as).toContain('3 of 884 shown'); } finally { restore(); }
  });
  it('on: the top-level total, "at least" when row-capped, no "as of" without a data date', async () => {
    const { attributionFor } = await import('../lib/attribution.mjs');
    const { citeAsFor } = await import('../lib/agent-outreach.mjs');
    const restore = env('1');
    try {
      const a = attributionFor(fiber());
      expect(a.citation.cite_as).toBe('DC Hub, dchub.cloud — PARTIAL preview, 3 of at least 500 routes shown');
      expect(a.citation.cite_as).not.toMatch(/884/);
      const out = citeAsFor({ citation: a.citation, provenance: a.provenance });
      expect(out).not.toMatch(/as of/);
      expect(out).toBe('DC Hub (dchub.cloud) — PARTIAL preview, 3 of at least 500 routes shown');
      // a dated source keeps its date
      expect(citeAsFor({ citation: { cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 10 shown', as_of: '2026-09-26', completeness: 'partial_preview' } }))
        .toBe('DC Hub (dchub.cloud) — PARTIAL preview, 3 of 10 shown, as of 2026-09-26');
      // not row-capped: no "at least"
      const f2 = fiber(); delete f2._truncated;
      expect(attributionFor(f2).citation.cite_as).toContain('3 of 500 shown');
    } finally { restore(); }
  });
});
