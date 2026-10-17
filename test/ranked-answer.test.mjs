/**
 * ranked_answer: the "rank markets for a 200 MW AI campus" join (owner/Grok 2026-10-17).
 * Pure functions plus a source-wiring check. No network, no server boot.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildRankedAnswer, attachRankedRelay, requestedMw } from '../lib/ranked-answer.mjs';

const mk = (market, rank, city, state, dep, score) => ({
  market, rank, city, state, score, deployable_mw: { value: dep }, ai_ready_mw: { value: 1 } });
const idxStep = { step: 1, tool: 'ai_capacity_index', status: 'executed', args: {} };
const dcpi = (slug, verdict, composite) =>
  ({ step: 2, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: slug },
     _full: { verdict, composite_score: composite, time_to_power_months: null } });
const INTENT = 'rank markets for a 200 MW AI campus';
function run(markets, dcpiSteps) {
  const executed = [idxStep, ...dcpiSteps];
  const full = new Map([[idxStep, { markets }], ...dcpiSteps.map((s) => [s, s._full])]);
  return buildRankedAnswer(INTENT, 'market_ranking', executed, full);
}

describe('requestedMw', () => {
  it('reads MW and GW, null otherwise', () => {
    expect(requestedMw(INTENT)).toBe(200);
    expect(requestedMw('a 1.5 GW campus')).toBe(1500);
    expect(requestedMw('rank markets')).toBeNull();
  });
});

describe('buildRankedAnswer', () => {
  const mkts = [mk('ashburn-va', 1, 'Ashburn', 'VA', 500, 450), mk('phoenix-az', 2, 'Phoenix', 'AZ', 150, 300),
                mk('columbus-oh', 3, 'Columbus', 'OH', 400, 280)];
  it('says plainly that the capacity #1 is AVOID and names the best checked market', () => {
    const r = run(mkts, [dcpi('ashburn-va', 'AVOID', 26.7), dcpi('columbus-oh', 'BUILD', 71)]);
    expect(r.headline).toContain('Ashburn, VA ranks #1 on AI capacity but DCPI says AVOID');
    expect(r.headline).toContain('Best checked market: Columbus, OH, DCPI BUILD (71)');
    expect(r.markets_verdict_checked).toBe(2);
    expect(r.markets_ranked).toBe(3);
  });
  it('fits_requested_mw compares deployable_mw with the ask; unchecked markets carry no verdict', () => {
    const r = run(mkts, [dcpi('ashburn-va', 'AVOID', 26.7)]);
    const by = Object.fromEntries(r.markets.map((m) => [m.market, m]));
    expect(by['ashburn-va'].fits_requested_mw).toBe(true);
    expect(by['phoenix-az'].fits_requested_mw).toBe(false);
    expect(by['phoenix-az'].verdict).toBeNull();
    expect(by['phoenix-az'].verdict_checked).toBe(false);
  });
  it('deployable exactly equal to the ask fits', () => {
    const r = run([mk('x-tx', 1, 'X', 'TX', 200, 10), mk('y-tx', 2, 'Y', 'TX', 199, 9)], []);
    expect(r.markets.map((m) => m.fits_requested_mw)).toEqual([true, false]);
  });
  it('all checked AVOID: refuses to recommend', () => {
    const r = run(mkts, [dcpi('ashburn-va', 'AVOID', 26.7)]);
    expect(r.headline).toContain('none can be recommended');
  });
  it('no DCPI steps: capacity-only, no invented verdict', () => {
    const r = run(mkts, []);
    expect(r.headline).toContain('capacity only');
    expect(r.markets.every((m) => m.verdict === null)).toBe(true);
  });
  it('other intent classes and missing index return null', () => {
    expect(buildRankedAnswer(INTENT, 'grid_headroom', [idxStep], new Map([[idxStep, { markets: mkts }]]))).toBeNull();
    expect(buildRankedAnswer(INTENT, 'market_ranking', [], new Map())).toBeNull();
  });
});

describe('attachRankedRelay', () => {
  const base = (sc) => ({ content: [], structuredContent: sc });
  it('copies the link the response already carries, never mints one', () => {
    const r = attachRankedRelay(base({ ranked_answer: { relay: null }, human_url: 'https://dchub.cloud/upgrade/h/x', human_message: 'msg' }));
    expect(r.structuredContent.ranked_answer.relay.url).toBe('https://dchub.cloud/upgrade/h/x');
    expect(r.structuredContent.ranked_answer.relay.text).toBe('msg');
  });
  it('falls back to for_your_human.url; no link means no relay', () => {
    const a = attachRankedRelay(base({ ranked_answer: { relay: null }, for_your_human: { url: 'https://dchub.cloud/upgrade/h/y', text: 't' } }));
    expect(a.structuredContent.ranked_answer.relay.url).toBe('https://dchub.cloud/upgrade/h/y');
    const b = attachRankedRelay(base({ ranked_answer: { relay: null } }));
    expect(b.structuredContent.ranked_answer.relay).toBeNull();
  });
  it('is a no-op for results without ranked_answer', () => {
    const x = base({ human_url: 'https://dchub.cloud/upgrade/h/z' });
    expect(attachRankedRelay(x)).toBe(x);
  });
});

describe('wiring', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  it('execute_plan emits ranked_answer and the tool chain ends in attachRankedRelay', () => {
    expect(src).toContain('_isCleanPlatform() ? null : buildRankedAnswer(sc.intent, sc.intent_class, executed, fullByEntry)');
    expect(src).toContain('return attachRankedRelay(_oneLinkWallStepInner(result, name))');
  });
});
