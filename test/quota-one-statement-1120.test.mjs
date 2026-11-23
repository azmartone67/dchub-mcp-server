// quota-one-statement-1120.test.mjs — owner decisions of 2026-11-20 on the quota report:
// "A1, C(a), D leave unstated". The /pricing daily line is the single source of truth.
//
//   C(a)  the free-key line carries "(market intel needs an email)": a key with no bound
//         email gets the preview on exactly those three tools (lib/free-decision-taste.mjs
//         FREE_PREVIEW_ONLY_TOOLS). The qualifier's tool names are pinned to that list here.
//   A1    analyze_site's line states the enforced daily site lane (lib/keyless-full-trial.mjs) and the
//         monthly runs ("a few"); the last monthly run's note says what follows for THIS caller: today's
//         daily runs when the lane seats it, the preview until the month turns when it does not
//         (/mcp/chatgpt, a bot, the lane switched off).
//   D     the anonymous per-IP caps stay unstated: nothing here.
import { describe, it, expect, beforeAll } from 'vitest';
import { isPaidFullOnly } from '../lib/paid-full-only.mjs';

let S, TC, FDT, KFT;
beforeAll(async () => {
  process.env.DCHUB_API_BASE = process.env.DCHUB_API_BASE || 'http://127.0.0.1:9';
  S = await import('../server.mjs');
  TC = await import('../lib/tier-canon.mjs');
  FDT = await import('../lib/free-decision-taste.mjs');
  KFT = await import('../lib/keyless-full-trial.mjs');
}, 60_000);

const Q = '(market intel needs an email)';
const WORD_TO_TOOL = { grid: 'get_grid_intelligence', queue: 'get_interconnection_queue', 'market intel': 'get_market_intel' };

describe('C(a): one free-key line with the email qualifier', () => {
  it('the qualifier names exactly the preview-only tools an email opens (owner 2026-11-23: never a paid-only one)', () => {
    expect(TC.FREE_KEY_EMAIL_TOOLS_QUALIFIER).toBe(Q);
    const named = Object.keys(WORD_TO_TOOL).filter((w) => Q.includes(w)).map((w) => WORD_TO_TOOL[w]).sort();
    expect(named).toEqual([...FDT.FREE_PREVIEW_ONLY_TOOLS].filter((t) => !isPaidFullOnly(t)).sort());
    expect(named).toEqual(['get_market_intel']);
  });
  it('the offer, the wall allowance and the ladder all carry it, after the per-tool sentence', () => {
    for (const t of [TC._freeKeyOfferText(), TC._freeKeyAllowanceText(), TC._unboundKeyLadderText()]) {
      expect(t).toContain('previews plus 2 full answers per tool per day ' + Q);
    }
    expect(TC._freeKeyAllowanceText()).toBe('previews plus 2 full answers per tool per day ' + Q + ', 50/day with an email');
  });
  it('names no plan or price', () => {
    for (const t of [TC._freeKeyAllowanceText(), TC.ANALYZE_SITE_FREE_LINE]) {
      expect(t).not.toMatch(/\$\d|\b(Developer|Pro|Starter|Enterprise)\b|pricing/);
    }
  });
});

describe('A1: analyze_site states the daily lane and the monthly runs', () => {
  // ★2026-11-20 (site audit, owner via relay): the published line states no number; it points at /connect
  // (byte for byte dchub-backend be#9147). The lane default still drives enforcement, not these words.
  it('the line states no lane figure and points at /connect', () => {
    expect(TC.ANALYZE_SITE_FREE_LINE).toBe(
      'analyze_site: full site reports and previews. More detail is available at dchub.cloud/connect.');
    expect(TC.ANALYZE_SITE_FREE_LINE).not.toContain(String(KFT.KEYLESS_SITE_FULL_CAP_DEFAULT));
  });
  const lastRun = { used: 3, limit: 3, remaining: 0, resets_at: '2026-12-01T00:00:00Z' };
  it('last monthly run, lane serving: the next calls use today\'s daily runs', () => {
    expect(S._lpFreeRunNote(lastRun, 2)).toBe('Full site analysis 3 of 3 this month (UTC). '
      + 'That was the last monthly one; the next analyze_site calls use today\'s daily runs, then previews until UTC midnight.');
  });
  it('last monthly run, lane not serving: the preview until the month turns (still true there)', () => {
    expect(S._lpFreeRunNote(lastRun, 0)).toBe('Full site analysis 3 of 3 this month (UTC). '
      + 'That was the last one this month: the next analyze_site call returns the preview until 2026-12-01.');
    expect(S._lpFreeRunNote(lastRun)).toBe(S._lpFreeRunNote(lastRun, 0));
  });
  it('runs left: unchanged either way', () => {
    const fr = { used: 1, limit: 3, remaining: 2, resets_at: '2026-12-01T00:00:00Z' };
    expect(S._lpFreeRunNote(fr, 2)).toBe(S._lpFreeRunNote(fr, 0));
  });
  it('the lane cap follows the caller: a key on /mcp gets it; /mcp/chatgpt and a bot do not', () => {
    const base = { api_key: 'dch_live_test', client_ip: '203.0.113.7', client_ua: 'node' };
    expect(S._lpKeyedDailyCap({ ...base })).toBe(KFT.keylessSiteFullCap());
    expect(S._lpKeyedDailyCap({ ...base, profile: 'chatgpt_directory' })).toBe(0);
    expect(S._lpKeyedDailyCap({ ...base, client_ua: 'GPTBot/1.0' })).toBe(0);
    expect(S._lpKeyedDailyCap({ ...base }, 'compare_sites')).toBe(0);
    expect(S._lpKeyedDailyCap(null)).toBe(0);
  });
  it('the news footer says a few, not one', async () => {
    const NF = await import('../lib/news-footer.mjs');
    expect(NF.NEWS_FOOTER_LINE).toBe('Watching a site? Your DC Hub key includes a few full site analyses a month for any address.');
  });
});
