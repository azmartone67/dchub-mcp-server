// site-market-verdict.test.mjs — Grok QA 2026-10-23 (health sweep 10-24, items 4-6).
// A keyed analyze_site at Lewis Center, OH said "Good site" with no market verdict while get_market_dcpi_rank
// for Columbus said AVOID, 60.4 months to power. The backend (dchub-backend util/site_market_verdict.py) now
// returns market_verdict + time_to_power on /api/site-score and on every find_sites candidate. This file pins
// what each caller sees through the real server.mjs on loopback, stub backend:
//   * keyless: the wall prints the market verdict and the time-to-power band beside the site band;
//   * free key (preview): market_verdict.verdict and time_to_power_band survive, the months do not;
//   * full: all four metros carry the verdict (target: 0 responses missing it);
//   * find_sites free coarsening withholds the months and the market distance, keeps verdict and band.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { marketVerdictFromSiteScore, withSiteScoreMarket, marketVerdictSentence, marketVerdictFromRow } from '../lib/site-verdict.mjs';

const FREE_KEY = 'dch_live_SITEMVfree0123456789abcdef';
const METROS = {
  phoenix: { lat: 33.45, lon: -112.36, state: 'AZ', market: 'Phoenix', verdict: 'CAUTION', months: 30.2, band: '24_to_48_months' },
  dallas: { lat: 32.90, lon: -96.95, state: 'TX', market: 'Dallas', verdict: 'BUILD', months: 18.0, band: 'under_24_months' },
  columbus: { lat: 40.18, lon: -83.01, state: 'OH', market: 'Columbus', verdict: 'AVOID', months: 60.4, band: 'over_48_months' },
  atlanta: { lat: 33.80, lon: -84.50, state: 'GA', market: 'Atlanta', verdict: 'CAUTION', months: 36.5, band: '24_to_48_months' },
};
const CAP = { AVOID: 'Challenging site', CAUTION: 'Viable site', BUILD: 'Good site' };
function siteBody(slug) {
  const m = METROS[slug];
  return { success: true, location: { lat: m.lat, lon: m.lon, state: m.state }, overall_score: 78.4,
    scores: { power_infrastructure: 96.9, fiber_connectivity: 74.2, gas_pipeline_access: 65.1, market_conditions: 72.3, risk_resilience: 68.6 },
    market_verdict: { available: true, verdict: m.verdict, market: m.market, slug, iso: null, proximity: 'in_market',
      distance_km: 24.7, as_of: '2026-10-24', basis: 'DCPI verdict of the nearest published DCPI market to this point',
      source_url: 'https://dchub.cloud/dcpi/' + slug },
    time_to_power: { time_to_power_months: m.months, time_to_power_band: m.band, market_slug: slug, as_of: '2026-10-24',
      basis: 'DCPI time-to-power estimate for the nearest published DCPI market', not_a_date: 'A modeled market estimate, not an energize-by date.' },
    interpretation: CAP[m.verdict], interpretation_capped: m.verdict !== 'BUILD',
    interpretation_basis: 'Capped by the ' + m.verdict + ' DCPI market verdict for ' + m.market + '.',
    source: 'DC Hub Site Intelligence' };
}
const slugAt = (lat) => Object.keys(METROS).find((k) => Math.abs(METROS[k].lat - Number(lat)) < 1e-6);

describe('lib/site-verdict: the market from a site answer', () => {
  it('reads verdict, market, slug, date and the band; never the months', () => {
    const m = marketVerdictFromSiteScore(siteBody('columbus'));
    expect(m).toEqual({ market: 'Columbus', slug: 'columbus', verdict: 'AVOID', composite_score: null,
      as_of: '2026-10-24', time_to_power_band: 'over_48_months' });
    expect(JSON.stringify(m)).not.toContain('60.4');
  });
  it('refuses a block with no band, an unknown verdict, or nothing', () => {
    expect(marketVerdictFromSiteScore({ market_verdict: { verdict: null, reason: 'no_dcpi_market_in_range' } })).toBeNull();
    expect(marketVerdictFromSiteScore({ market_verdict: { verdict: 'NEUTRAL' } })).toBeNull();
    expect(marketVerdictFromSiteScore(null)).toBeNull();
    const m = marketVerdictFromSiteScore({ market_verdict: { verdict: 'BUILD' }, time_to_power: { time_to_power_band: '9 months' } });
    expect(m.time_to_power_band).toBeUndefined();
  });
  it('a named market keeps its own row and gains the band only when the slugs agree', () => {
    const row = marketVerdictFromRow({ market_slug: 'columbus', market_name: 'Columbus', verdict: 'AVOID', composite_score: 21,
      computed_at: '2026-10-24T04:59:22Z' }, 'columbus');
    expect(withSiteScoreMarket(row, siteBody('columbus'))).toEqual({ ...row, time_to_power_band: 'over_48_months' });
    expect(withSiteScoreMarket(row, siteBody('dallas'))).toEqual(row);
    expect(withSiteScoreMarket(null, siteBody('dallas')).verdict).toBe('BUILD');
    expect(withSiteScoreMarket(row, { success: true })).toEqual(row);
  });
  it('the sentence carries the band in words', () => {
    expect(marketVerdictSentence(marketVerdictFromSiteScore(siteBody('columbus'))))
      .toBe('Market verdict (DCPI): AVOID for Columbus, time to power over 48 months, as of 2026-10-24.');
  });
});

// ── end to end ──────────────────────────────────────────────────────────────
const UA = { 'user-agent': 'Claude-User' };
let H, fence, ipN = 0;
async function call(tool, args, key) {
  const hdr = { ...UA, 'x-dc-client-ip': `203.0.113.${++ipN + 20}`, ...(key ? { 'x-api-key': key } : {}) };
  const sid = (await H.init('/mcp', 'claude-ai', hdr)).headers.get('mcp-session-id');
  const r = await H.call('/mcp', tool, args, { ...hdr, 'mcp-session-id': sid });
  const res = (r.msg && r.msg.result) || {};
  const text = (res.content || []).map((x) => x.text || '').join('\n');
  let json = null;
  try { json = JSON.parse((res.content || [])[0].text); } catch (_) { json = null; }
  return { sc: res.structuredContent || {}, text, json };
}
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: (p, req, body) => {
    if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
    if (p === '/api/v1/keys/validate') {
      const k = req.headers['x-api-key'] || (body && body.api_key) || '';
      if (String(k).includes(FREE_KEY) || JSON.stringify(body || {}).includes(FREE_KEY)) {
        return { valid: true, tier: 'free', developer_id: 'dev_sitemv_free', email: null, tier_detail: { users_plan: 'free' } };
      }
      return undefined;
    }
    if (p === '/api/v1/mcp/lp-free-runs') return { allowed: false, remaining: 0 };
    if (p === '/api/site-score') {
      const u = new URL(req.url, 'http://x');
      return siteBody(slugAt(u.searchParams.get('lat')) || 'columbus');
    }
    return undefined;
  } });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => { delete process.env.DCHUB_GATED_PREVIEW; delete process.env.DCHUB_SITE_EMAIL_UNLOCK; delete process.env.DCHUB_B2_SITE_HEADLINE; });

describe('analyze_site over real /mcp', () => {
  it('keyless at coordinates: the market verdict and band print beside the site band', async () => {
    const m = METROS.columbus;
    const r = await call('analyze_site', { lat: m.lat, lon: m.lon });
    expect(r.text).toContain('Market verdict (DCPI): AVOID for Columbus, time to power over 48 months');
    expect(r.text).not.toContain('get_market_dcpi_rank.');          // no "this is not the market verdict" caveat now
    expect(r.text).not.toContain('60.4');
    expect(r.text).not.toMatch(/Good site|Excellent site/);
  });
  it('free key (preview): verdict and band survive, the months and distance do not', async () => {
    const m = METROS.columbus;
    const r = await call('analyze_site', { lat: m.lat, lon: m.lon }, FREE_KEY);
    const p = r.sc._preview_only ? r.sc : (r.json || {});
    expect(p._preview_only).toBe(true);
    expect(p.market_verdict.verdict).toBe('AVOID');
    expect(p.market_verdict.distance_km).toBeNull();
    expect(p.time_to_power.time_to_power_band).toBe('over_48_months');
    expect(p.time_to_power.time_to_power_months).toBeNull();
    expect(r.text).not.toContain('60.4');
    expect(r.text).not.toMatch(/Good site|Excellent site/);
  });
  it('full answer: every one of the four metros carries the verdict and both fields', async () => {
    const missing = [];
    for (const [slug, m] of Object.entries(METROS)) {
      const r = await call('analyze_site', { lat: m.lat, lon: m.lon, state: m.state }, PRO_KEY);
      const j = r.json || r.sc;
      const ok = j && j.market_verdict && j.market_verdict.verdict === m.verdict
        && j.time_to_power && 'time_to_power_months' in j.time_to_power && j.time_to_power.time_to_power_band === m.band;
      if (!ok) missing.push(slug);
      if (m.verdict === 'AVOID') expect(j.interpretation).toBe('Challenging site');
    }
    expect(missing).toEqual([]);
  });
});

describe('find_sites free coarsening', () => {
  const cand = (slug) => ({ site_ref: 'site_' + slug, lat: METROS[slug].lat + 0.0123, lon: METROS[slug].lon - 0.0456,
    coordinate_precision_km: 0.1, anchor: { type: 'substation', name: 'S', voltage_kv: 765, operator: 'Op', capacity_mva: 900 },
    verdict: METROS[slug].verdict, market: siteBody(slug).market_verdict, time_to_power: siteBody(slug).time_to_power,
    next_calls: [] });
  const payload = () => ({ success: true, candidates: Object.keys(METROS).map(cand) });
  it('withholds the months and the market distance, keeps verdict and band, on every candidate', () => {
    for (const dp of [1, 2]) {
      const out = H.S._coarsenFindSites(payload(), dp);
      for (const c of out.candidates) {
        expect(['BUILD', 'CAUTION', 'AVOID']).toContain(c.verdict);
        expect(c.market.verdict).toBe(c.verdict);
        expect(c.market.distance_km).toBeNull();
        expect(c.time_to_power.time_to_power_months).toBeNull();
        expect(c.time_to_power._time_to_power_months_withheld).toBe(true);
        expect(c.time_to_power.time_to_power_band).toMatch(/months$/);
      }
      expect(JSON.stringify(out)).not.toMatch(/60\.4|24\.7/);
    }
  });
  it('a candidate without the blocks is left as it was', () => {
    const out = H.S._coarsenFindSites({ success: true, candidates: [{ lat: 1.23, lon: 4.56, next_calls: [] }] }, 1);
    expect(out.candidates[0].market).toBeUndefined();
    expect(out.candidates[0].time_to_power).toBeUndefined();
  });
});
