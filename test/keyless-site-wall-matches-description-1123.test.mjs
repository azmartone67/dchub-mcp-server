// keyless-site-wall-matches-description-1123.test.mjs: QA 2026-11-23 (Des Moines IA), item 1.
//
// The analyze_site tool description says "Without a key, the first 2 `analyze_site` calls each UTC day from a network
// return the full site report" (lib/tier-canon.mjs analyzeSiteKeylessDailySentence, server.mjs
// _analyzeSiteDescDailySentence). A QA-marked caller (the daily lane never seats QA, bots, loopback or shared IPs) was
// walled on call 1, and the wall's quota_basis said "keyless callers get no full answers" with resets_at at the next
// month start, while quota.resets_at on the same result said "next 00:00 UTC". Pinned here, over the real /mcp handler:
//   A. a fresh keyless network: calls 1-2 full, call 3 the wall, whose quota_basis states the description's sentence;
//   B. a caller the lane does not seat (X-DCHub-QA: 1, UA dchub-qa-readonly, no forwarded IP): the wall states the
//      description's sentence, says this caller is not served by it, never "no full answers", and carries ONE
//      resets_at (the next UTC midnight, the same instant quota.resets_at names); the month start is
//      monthly_reports_reset_at;
//   C. the lane switched off: the old basis, unchanged (no daily runs exist to state).
// Enforcement is not touched: the same calls are full or walled as before (keyless-site-full-daily.test.mjs).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { keylessWallQuota, nextUtcDayStart, nextUtcMonthStart, KEYLESS_SITE_NOT_SEATED } from '../lib/keyless-wall.mjs';
import { analyzeSiteKeylessDailySentence } from '../lib/tier-canon.mjs';

const ARGS = { lat: 41.59, lon: -93.62 };
const FULL = { success: true, lat: 41.59, lon: -93.62, overall_score: 77.1, verdict: 'BUILD',
  factors: { power: { score: 88, verdict: 'BUILD' } },
  nearest_substations: { substations_in_radius: 5, search_radius_km: 50,
    substations: [{ name: 'Test Sub DSM', hifld_id: 'H9', max_kv: 161, distance_km: 3.1 }] } };
const NO_FULL = /keyless callers get no full answers/;

let H, fence, S;
let ipN = 1;
const freshIp = () => `203.0.113.${100 + ipN++}`;
async function call({ ip = null, ua = 'Claude-User', headers = {} } = {}) {
  const hdr = { 'user-agent': ua, ...(ip ? { 'x-forwarded-for': ip } : {}), ...headers };
  const init = await H.init('/mcp', 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  const r = await H.call('/mcp', 'analyze_site', ARGS, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  const res = (r.msg && r.msg.result) || {};
  return { sc: res.structuredContent || {}, raw: r.body };
}
const isFull = (r) => r.sc.overall_score === 77.1;
// Every resets_at in the envelope (structuredContent at any depth), as written.
function resetsAts(o, out = []) {
  if (Array.isArray(o)) { for (const x of o) resetsAts(x, out); return out; }
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
    if (k === 'resets_at') out.push(v); else resetsAts(v, out);
  }
  return out;
}
// "next 00:00 UTC" and the ISO instant of the next UTC midnight name the same reset.
const sameDailyReset = (v) => v === 'next 00:00 UTC' || v === nextUtcDayStart(new Date());

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p) => {
    if (p === '/api/v1/mcp/lp-free-runs') return { ok: true, allowed: false, used: 3, limit: 3 };
    if (p === '/api/site-score') return { ...FULL };
    if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/t' + Math.random().toString(36).slice(2, 7) };
    return undefined;
  } });
  S = H.S;
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { delete process.env.DCHUB_KEYLESS_SITE_FULL; delete process.env.DCHUB_KEYLESS_SITE_FULL_CAP; });

describe('lib: keylessWallQuota for a caller the running lane does not seat', () => {
  const NOW = new Date('2026-11-23T18:00:00Z');
  it('states the lane sentence, says the caller is not served, one daily resets_at, the month on its own field', () => {
    const q = keylessWallQuota(NOW, { dailyCap: 0, laneCap: 2 });
    expect(q.quota_basis.startsWith(analyzeSiteKeylessDailySentence(2) + ' ' + KEYLESS_SITE_NOT_SEATED)).toBe(true);
    expect(q.quota_basis).not.toMatch(NO_FULL);
    expect(q.resets_at).toBe('2026-11-24T00:00:00Z');
    expect(q.monthly_reports_reset_at).toBe('2026-12-01T00:00:00Z');
    expect(q.remaining_this_month).toBe(0);
  });
  it('a seated caller keeps the seated basis; the lane off keeps the old basis', () => {
    expect(keylessWallQuota(NOW, { dailyCap: 2, laneCap: 2 }).quota_basis).not.toContain(KEYLESS_SITE_NOT_SEATED);
    const off = keylessWallQuota(NOW, { dailyCap: 0, laneCap: 0 });
    expect(off.quota_basis).toMatch(NO_FULL);
    expect(off.resets_at).toBe('2026-12-01T00:00:00Z');
    expect(off.monthly_reports_reset_at).toBeUndefined();
  });
  it('no plan name or price in the new sentence', () => {
    expect(KEYLESS_SITE_NOT_SEATED).not.toMatch(/\$|\bpro\b|developer|starter|plan|pricing|free key/i);
  });
});

describe('A. a fresh keyless network: 1-2 full, 3 the wall, the wall says what the description says', () => {
  it('three calls', async () => {
    const desc = S._analyzeSiteDescDailySentence();
    expect(desc, 'the description states the daily runs (lane on by default)').toBe(analyzeSiteKeylessDailySentence(2));
    const ip = freshIp();
    expect(isFull(await call({ ip })), 'call 1 full').toBe(true);
    expect(isFull(await call({ ip })), 'call 2 full').toBe(true);
    const r3 = await call({ ip });
    expect(isFull(r3), 'call 3 the wall').toBe(false);
    expect(r3.sc.quota_basis).toContain(desc);
    expect(r3.sc.quota_basis).not.toMatch(NO_FULL);
    expect(r3.sc.quota_basis).not.toContain(KEYLESS_SITE_NOT_SEATED);   // this network WAS served
    expect(r3.sc.resets_at).toBe(nextUtcDayStart(new Date()));
  });
});

describe('B. a caller the lane does not seat: walled on call 1, the wall is truthful and has one reset', () => {
  for (const [label, opts] of [
    ['X-DCHub-QA: 1', { ip: '203.0.113.250', headers: { 'x-dchub-qa': '1' } }],
    ['UA dchub-qa-readonly', { ip: '203.0.113.251', ua: 'dchub-qa-readonly/1.0' }],
    ['no forwarded IP (loopback)', {}],
  ]) {
    it(label, async () => {
      const r = await call(opts);
      expect(isFull(r), 'enforcement unchanged: not seated, so the wall').toBe(false);
      const sc = r.sc;
      expect(sc.quota_basis).toContain(S._analyzeSiteDescDailySentence());
      expect(sc.quota_basis).toContain(KEYLESS_SITE_NOT_SEATED);
      expect(sc.quota_basis).not.toMatch(NO_FULL);
      expect(r.raw).not.toMatch(NO_FULL);
      expect(sc.monthly_reports_reset_at).toBe(nextUtcMonthStart(new Date()));
      const all = resetsAts(sc);
      expect(all.length, 'resets_at present').toBeGreaterThan(0);
      for (const v of all) expect(sameDailyReset(v), 'every resets_at is the daily reset: ' + v).toBe(true);
      expect(all).not.toContain(nextUtcMonthStart(new Date()));
    });
  }
});

describe('C. the lane off: nothing to state, the old basis', () => {
  it('DCHUB_KEYLESS_SITE_FULL=0', async () => {
    process.env.DCHUB_KEYLESS_SITE_FULL = '0';
    const r = await call({ ip: freshIp() });
    expect(isFull(r)).toBe(false);
    expect(r.sc.quota_basis).toMatch(NO_FULL);
    expect(r.sc.quota_basis).not.toContain(KEYLESS_SITE_NOT_SEATED);
  });
});
