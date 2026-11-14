// unlock-line-ratchet.test.mjs — Grok live agent review 2026-11-13, item 4 ("One unlock message").
//
// Walls told agents different things about the free path: "call claim_free_key for the full free tier" (four
// walls), "a free 10-calls/day key" (Claude-platform paywall line), "your key's free calls are used up" (a free
// key has no call count since B1), and a keyless analyze_site wall that said a free key opens only a preview while
// the owner's analyze_site line says a free key runs a few full site reports a month. lib/unlock-line.mjs is now
// the one source for those sentences, composed from lib/tier-canon.mjs (the FREE TIER paragraph's numbers).
//
// This file pins:
//   1. every line the module hands out agrees with the canon (same allowance clause, no number of its own);
//   2. the overpromises are gone from every other source file (evaluated over string literals, comments skipped);
//   3. a RATCHET on unlock-promise literals outside the module (claim_free_key / bind_email beside an allowance
//      claim): the count may only go down; a new one belongs in lib/unlock-line.mjs;
//   4. the kill switch DCHUB_UNLOCK_LINE_V1=0 restores the previous wording byte for byte;
//   5. over the real /mcp handler (stub backend): the keyless analyze_site wall quotes the owner's analyze_site
//      line, the grid taste says WITHHELD (not "no DCPI row") when the backend locked the ISO row, and a
//      get_refined_queue row the backend nulled under _locked_fields carries `_capacity_mw_withheld`.
// Qualifies for the hard gate: deterministic, loopback only.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as U from '../lib/unlock-line.mjs';
import { _freeKeyOfferText, _freeTierRuleForGate, ANALYZE_SITE_FREE_LINE, _rungNum, _fullAnswersPerToolPerDay } from '../lib/tier-canon.mjs';
import { EMAIL_ASK } from '../lib/claim-handoff.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('1. every unlock line agrees with the FREE TIER paragraph', () => {
  const rule = _freeTierRuleForGate();
  it('control: the canon paragraph is composed (snapshot present) and states the free-key clause', () => {
    expect(rule).toBeTruthy();
    expect(rule).toContain('Free key: ' + _freeKeyOfferText() + '.');
    expect(rule).toContain('Add an email: ' + _rungNum('identified') + ' calls/day');
  });
  it('the free-key lines quote the canon clause and the email rung, and nothing else numeric', () => {
    const L = U.unlockLines();
    for (const k of ['freeKeyAllowance', 'freeKeyNoun', 'claimNudge', 'previewNote', 'previewNoteOneCall', 'anonMaskNote', 'claudePlatformLine']) {
      expect(L[k], k).toContain(_freeKeyOfferText());
      expect(L[k], k).toContain(_rungNum('identified') + '/day with an email');
      const nums = (L[k].match(/\d+/g) || []).map(Number);
      const canonNums = [_fullAnswersPerToolPerDay('free'), _rungNum('identified')];
      for (const n of nums) expect(canonNums, `${k}: ${n} is not a canon figure`).toContain(n);
      expect(L[k], k).not.toMatch(/full free tier|calls to try|\d+-calls\/day|free calls are used up/);
    }
    expect(L.analyzeSiteKeyClause).toContain('a few free full site reports each month');
  });
  it('the unbound-key line states the email rung and the per-tool figure from the canon, no "used up"', () => {
    const t = U.unboundKeyLine(_rungNum('identified'));
    expect(t).toContain(_rungNum('identified') + ' calls/day, up to ' + _fullAnswersPerToolPerDay('identified') + ' full answers per tool per day');
    expect(t).not.toMatch(/used up/);
    expect(rule).toContain('(up to ' + _fullAnswersPerToolPerDay('identified') + ' full answers per tool per day)');
  });
  it('the email ask is the soft sentence (bind_email named; the user decides)', () => {
    expect(EMAIL_ASK).toBe(U.EMAIL_ASK_SOFT);
    expect(EMAIL_ASK).toMatch(/^If your user would like the full answer, ask whether they want to share their email/);
    expect(EMAIL_ASK).toContain('`bind_email`');
  });
  // RATCHET on the keyless analyze_site wording (mcp#1419 OWNER DECISION 2, measured 2026-11-14): the wall states
  // the allowance the code enforces. No key: the daily lane's cap per network per UTC day (the number comes from the
  // caller, never written here). A free key: a few a month on top (owner decision 2: "a few"). An email: the same
  // free key, no more site reports. Reverting to the monthly-only line, or to "a free key opens the preview",
  // fails here.
  const DAILY_2 = 'Without a key, the first 2 `analyze_site` calls each UTC day from a network return the full site '
    + 'report; after that, no full report until UTC midnight.';
  const DAILY_1 = 'Without a key, the first `analyze_site` call each UTC day from a network returns the full site '
    + 'report; after that, no full report until UTC midnight.';
  const KEY_EMAIL = 'A free key adds a few free full site reports each month: call `claim_free_key` (one call, no email); '
    + 'adding an email (`bind_email`) gives the same free key, with no more site reports.';
  const KEY_EMAIL_TEXT = 'or call `claim_free_key` (one call, no email) for a free key: it adds a few free full site '
    + 'reports each month; adding an email (`bind_email`) gives the same free key, with no more site reports.';
  it('analyze_site: the keyless wall clause states the daily keyless runs, the free key\'s monthly runs and what an email adds', () => {
    expect(U.lpFreeKeyClause('analyze_site', { lpFreeRuns: true, dailyCap: 2 })).toBe(DAILY_2 + ' ' + KEY_EMAIL);
    expect(U.lpFreeKeyClause('analyze_site', { lpFreeRuns: true, dailyCap: 1 })).toBe(DAILY_1 + ' ' + KEY_EMAIL);
    expect(U.lpFreeKeyClause('analyze_site', { lpFreeRuns: true, dailyCap: 2, text: true })).toBe(KEY_EMAIL_TEXT + ' ' + DAILY_2);
    // the lane does not serve this caller (off, a bot, the ChatGPT profile): no daily promise
    expect(U.lpFreeKeyClause('analyze_site', { lpFreeRuns: true, dailyCap: 0 })).toBe(KEY_EMAIL);
    expect(U.lpFreeKeyClause('analyze_site', { lpFreeRuns: true, dailyCap: 0, text: true })).toBe(KEY_EMAIL_TEXT);
    // no monthly runs: the daily sentence alone
    expect(U.lpFreeKeyClause('analyze_site', { lpFreeRuns: false, dailyCap: 2 })).toBe(DAILY_2);
    expect(U.lpFreeKeyClause('analyze_site', { lpFreeRuns: false })).toBe(U.LP_PREVIEW_CLAUSE);
    expect(U.lpFreeKeyClause('compare_sites', { lpFreeRuns: true, dailyCap: 2 })).toBe(U.LP_PREVIEW_CLAUSE);
    // the false claims are gone: no key is not "no full answers", and the key line does not end in previews only
    for (const d of [0, 1, 2]) {
      const t = U.lpFreeKeyClause('analyze_site', { lpFreeRuns: true, dailyCap: d });
      expect(t).not.toMatch(/A free key opens the preview|after that, previews|no full answers/);
    }
  });
  it('the keyless wall quota basis states the daily runs when the lane serves the caller', async () => {
    const { keylessWallQuota } = await import('../lib/keyless-wall.mjs');
    const on = keylessWallQuota(new Date('2026-11-14T04:00:00Z'), { dailyCap: 2 });
    expect(on.quota_basis).toContain(DAILY_2);
    expect(on.quota_basis).not.toMatch(/keyless callers get no full answers/);
    expect(on.remaining_this_month).toBe(0);
    expect(on.resets_at).toBe('2026-12-01T00:00:00Z');
    expect(keylessWallQuota(new Date(), { dailyCap: 0 }).quota_basis).toMatch(/^keyless callers get no full answers/);
  });
  it('the DCPI withheld basis quotes the clause it is handed and never says "no DCPI row"', () => {
    const b = U.DCPI_BAND_WITHHELD_BASIS('Grid/queue/market-intel tools: previews on free; an email adds 10 full answers/day each.');
    expect(b).toMatch(/^WITHHELD at this access level/);
    expect(b).toContain('an email adds 10 full answers/day each.');
    expect(b).not.toMatch(/no DCPI row|UNMEASURED/);
  });
});

// String literals of a source file, comment lines skipped.
function literals(file) {
  const LIT = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  const out = [];
  readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((ln, i) => {
    if (/^\s*(\/\/|\*)/.test(ln)) return;
    for (const m of ln.match(LIT) || []) out.push({ file, line: i + 1, text: m });
  });
  return out;
}
const SOURCES = ['server.mjs', ...readdirSync(join(ROOT, 'lib')).filter((f) => f.endsWith('.mjs') && f !== 'unlock-line.mjs').map((f) => 'lib/' + f)];
const ALL = SOURCES.flatMap(literals);

describe('2-3. no overpromise outside lib/unlock-line.mjs; the unlock-promise ratchet', () => {
  const BANNED = /for the full free tier|Unlock the full free tier|free \d+-calls\/day key|free calls are used up|A free key opens the preview/;
  it('control: the scan sees the sources (thousands of literals, the module itself excluded)', () => {
    expect(ALL.length).toBeGreaterThan(5000);
    expect(SOURCES).toContain('server.mjs');
    expect(SOURCES).not.toContain('lib/unlock-line.mjs');
    // the scan does find a banned phrase where one lives (the module's legacy copy)
    expect(literals('lib/unlock-line.mjs').some((l) => BANNED.test(l.text))).toBe(true);
  });
  it('no source literal outside the module carries an overpromise', () => {
    const hits = ALL.filter((l) => BANNED.test(l.text)).map((l) => `${l.file}:${l.line} ${l.text.slice(0, 90)}`);
    expect(hits).toEqual([]);
  });
  // claim_free_key / bind_email beside an allowance claim, outside the module. 20 on main (2026-11-13),
  // 14 after this change. Lower this number when you move one into lib/unlock-line.mjs; never raise it.
  const RATCHET_MAX = 14;
  it(`unlock-promise literals outside the module: at most ${RATCHET_MAX}, and only going down`, () => {
    const PATH = /claim_free_key|bind_email/;
    const PROMISE = /full answers? (?:per|a) |calls?\/day|calls a day|full free tier|calls to try|free tier\b/i;
    const hits = ALL.filter((l) => PATH.test(l.text) && PROMISE.test(l.text));
    expect(hits.length, hits.map((l) => `${l.file}:${l.line}`).join('\n')).toBeLessThanOrEqual(RATCHET_MAX);
  });
});

describe('4. kill switch DCHUB_UNLOCK_LINE_V1=0: the previous wording, byte for byte', () => {
  it('legacy strings come back', async () => {
    const prev = process.env.DCHUB_UNLOCK_LINE_V1;
    try {
      process.env.DCHUB_UNLOCK_LINE_V1 = '0';
      vi.resetModules();
      const L = await import('../lib/unlock-line.mjs');
      expect(L.EMAIL_ASK).toBe('Ask your user for their email, then call `bind_email` with it to unlock the full answer.');
      expect(L.claimNudge()).toBe('Call `claim_free_key` (no email) for the full free tier');
      expect(L.claudePlatformLine()).toContain('for a free 10-calls/day key.');
      expect(L.unboundKeyLine(50)).toContain('free calls are used up. To keep going FREE (50 calls/day)');
      expect(L.lpFreeKeyClause('analyze_site', { lpFreeRuns: true })).toBe(L.LP_PREVIEW_CLAUSE);
      expect(L.markLockedRowFields({ _locked_fields: ['capacity_mw'], results: [{ capacity_mw: null }] }).results[0]).toEqual({ capacity_mw: null });
    } finally {
      if (prev === undefined) delete process.env.DCHUB_UNLOCK_LINE_V1; else process.env.DCHUB_UNLOCK_LINE_V1 = prev;
      vi.resetModules();
    }
  });
});

describe('markLockedRowFields (unit)', () => {
  it('marks a null row field listed in _locked_fields; keeps values, existing markers and the input', () => {
    const p = { _locked_fields: ['capacity_mw', 'queue_id', 'lat'], results: [
      { capacity_mw: null, queue_id: null, _queue_id_in_pro: true, lat: 33.9 }, { capacity_mw: 120 }] };
    const out = U.markLockedRowFields(p, ['results']);
    expect(out.results[0]).toEqual({ capacity_mw: null, _capacity_mw_in_pro: true, queue_id: null, _queue_id_in_pro: true, lat: 33.9 });
    expect(out.results[1]).toBe(p.results[1]);
    expect(p.results[0]._capacity_mw_in_pro).toBeUndefined();
    const none = { results: [{ capacity_mw: null }] };
    expect(U.markLockedRowFields(none, ['results'])).toBe(none);
  });
});

describe('5. /mcp e2e (real server.mjs, stub backend)', () => {
  let H, fence;
  const ISO_ROW = { iso: 'ERCOT', iso_name: 'Electric Reliability Council of Texas', market_count: 19, build_count: 1,
    avg_constraint: null, avg_excess: null, latest_computed_at: '2026-11-14T00:38:23Z' };
  let locked = true;
  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p) => {
      if (p === '/api/v1/dcpi/iso-comparison') {
        return { status: 200, body: locked
          ? { _gated: true, _locked_fields: ['avg_constraint', 'avg_excess'], isos: [{ ...ISO_ROW, locked: true }] }
          : { isos: [] } };
      }
      if (p.startsWith('/api/v1/grid/intelligence/')) {
        return { status: 200, body: { iso: 'ERCOT', demand_mw: 61000, demand_period: '2026-11-13T22',
          generation_mix: { NG: { mw: 30000 }, WND: { mw: 20000 } }, generation_mix_period: '2026-11-13T20' } };
      }
      if (p === '/api/v1/interconnection-queue/refined') {
        return { status: 200, body: { ok: true, _gated: true, _preview_only: true,
          _locked_fields: ['candidate_id', 'capacity_mw', 'estimated_ttp_months'],
          results: [{ iso: 'CAISO', state: 'AZ', fuel_type: 'Battery', capacity_mw: null, estimated_ttp_months: null,
            candidate_id: null, queue_date: '2017-05-01' }] } };
      }
      return undefined;
    } });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });
  let ipN = 60;
  async function callAs(name, args) {
    const h0 = { 'x-forwarded-for': `203.0.113.${ipN++}`, 'user-agent': 'test-client' };
    const init = await H.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } }, h0);
    const sid = init.headers.get('mcp-session-id');
    expect(sid, 'control: a session').toBeTruthy();
    const h = { ...h0, 'mcp-session-id': sid };
    await H.post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
    const r = await H.post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, h);
    const res = (r.msg && r.msg.result) || {};
    return { res, sc: res.structuredContent || null, text: (res.content || []).map((b) => b.text || '').join('\n') };
  }
  const bandOf = (r) => {
    const t = JSON.stringify(r.sc || {}) + r.text;
    const m = /"band":\{"constraint":[^{}]*?"basis":"([^"]*)"/.exec(t.replace(/\\"/g, '"'));
    return m ? m[1] : null;
  };

  it('keyless grid taste, backend locked the ISO row: the band basis says WITHHELD and names the free path', async () => {
    locked = true;
    const r = await callAs('get_grid_intelligence', { iso: 'ERCOT' });
    const basis = bandOf(r);
    expect(basis, 'control: the taste band came back\n' + r.text.slice(0, 600)).toBeTruthy();
    expect(basis).toMatch(/^WITHHELD at this access level/);
    expect(basis).toMatch(/Grid\/queue\/market-intel tools: previews on free/);
    expect(basis).not.toMatch(/no DCPI row/);
  }, 60_000);

  it('keyless grid taste, no ISO row at all: still "UNMEASURED - no DCPI row" (real absence)', async () => {
    locked = false;
    const r = await callAs('get_grid_intelligence', { iso: 'ERCOT' });
    const basis = bandOf(r);
    expect(basis, 'control: the taste band came back').toBeTruthy();
    expect(basis).toBe('UNMEASURED - no DCPI row for this region');
    locked = true;
  }, 60_000);

  it('keyless get_refined_queue: a row field nulled under _locked_fields carries its _withheld marker', async () => {
    const r = await callAs('get_refined_queue', { min_mw: 500 });
    const rows = (r.sc && r.sc.results) || [];
    expect(rows.length, 'control: rows came back\n' + r.text.slice(0, 400)).toBeGreaterThan(0);
    expect(rows[0].capacity_mw).toBeNull();
    expect(rows[0]._capacity_mw_withheld).toBe(true);
    expect(rows[0]._estimated_ttp_months_withheld).toBe(true);
  }, 60_000);

  it('keyless analyze_site L&P wall (no headline arm): the clause states the daily runs this caller gets, then a key, then an email', () => {
    // A keyless analyze_site with a headline gets the B2 arm; the no-headline arm (teaser unavailable) is where
    // the free-key clause lives, so the wall is built directly from server.mjs's export.
    // Built inside a keyless request context: the daily lane seats a caller with a real (non-loopback) IP.
    const CALLER = { client_ip: '203.0.113.77', user_agent: 'Claude-User', tier: 'free' };
    const w = H.S._runInCtxForTest(CALLER, () => H.S._lpWallResult('analyze_site'));
    const all = w.content[0].text + JSON.stringify(w.structuredContent);
    expect(w.structuredContent.next_tool, 'control: the L&P wall').toBe('claim_free_key');
    const daily = H.S._keylessSiteDailyFor(CALLER);
    expect(daily, 'control: the daily lane seats this caller at its default cap').toBe(2);
    expect(w.structuredContent.message).toContain(U.lpFreeKeyClause('analyze_site', { lpFreeRuns: true, dailyCap: daily }));
    expect(w.structuredContent.message).toContain('the first 2 `analyze_site` calls each UTC day from a network return the full site report');
    expect(w.content[0].text).toContain(U.lpFreeKeyClause('analyze_site', { lpFreeRuns: true, dailyCap: daily, text: true }));
    expect(all).not.toMatch(/A free key opens the preview/);
    // a caller the lane does not seat (a bot UA) is promised no daily run
    expect(H.S._keylessSiteDailyFor({ ...CALLER, user_agent: 'uptimerobot/2.0' })).toBe(0);
    expect(H.S._keylessSiteDailyFor({ ...CALLER, api_key: 'dch_live_x' }), 'a keyed caller is not on the keyless wall').toBe(0);
    expect(H.S._keylessSiteDailyFor({ ...CALLER, client_ip: '' }), 'no caller IP: the lane cannot count it').toBe(0);
    const noIp = H.S._runInCtxForTest({ ...CALLER, client_ip: '' }, () => H.S._lpWallResult('analyze_site'));
    expect(noIp.structuredContent.message).not.toMatch(/each UTC day from a network/);
    expect(noIp.structuredContent.message).toContain('A free key adds a few free full site reports each month');
    // other Land & Power tools keep the preview clause (their free key really is a preview)
    expect(H.S._lpWallResult('compare_sites').structuredContent.message).toContain(U.LP_PREVIEW_CLAUSE);
  });
});
