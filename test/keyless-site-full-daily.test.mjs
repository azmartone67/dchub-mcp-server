// The daily site lane (owner 2026-11-01, Grok growth plan item 1): the FULL analyze_site answer
// DCHUB_KEYLESS_SITE_FULL_CAP (default 2) times per caller IP per UTC day, keyless from the Land &
// Power wall, or a key below Pro once its monthly free runs are spent. Past that, today's wall /
// preview, unchanged. Real server.mjs app on loopback, stub backend (same counter stub as
// lp-free-monthly-runs.test.mjs); the caller IP comes from X-Forwarded-For, as in production.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const FREE_KEY = 'dch_trial_FREEdailysite0123456789abcdef';
const ARGS = { lat: 33.45, lon: -112.07 };
const FULL = {
  success: true, lat: 33.45, lon: -112.07, overall_score: 83.7, verdict: 'BUILD',
  factors: { power: { score: 91, verdict: 'BUILD' }, fiber: { score: 64, verdict: 'CAUTION' } },
  nearest_substations: { substations_in_radius: 7, search_radius_km: 50,
    substations: [{ name: 'Test Sub XYZ', hifld_id: 'H123', max_kv: 230, distance_km: 2.4 }] },
};

let H, fence;
let used = 0, counterDown = false, siteDown = false;
let ipN = 1;
const freshIp = () => `203.0.113.${ipN++}`;

async function settle(quietMs = 300, maxMs = 6000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call({ key = null, ip = null, ua = 'Claude-User', path = '/mcp', headers = {} } = {}) {
  const hdr = { 'user-agent': ua, ...(ip ? { 'x-forwarded-for': ip } : {}), ...(key ? { 'x-api-key': key } : {}), ...headers };
  const init = await H.init(path, 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  const before = H.hits.length;
  const r = await H.call(path, 'analyze_site', ARGS, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const hits = H.hits.slice(before);
  const res = r.msg && r.msg.result;
  return {
    res, sc: (res && res.structuredContent) || {},
    text: ((res && res.content) || []).map((x) => x.text || '').join('\n'),
    status: hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === 'analyze_site').map((h) => h.body.status),
    charges: hits.filter((h) => h.path === '/api/v1/mcp/full-cap/consume' && h.body
      && String(h.body.identity || '').startsWith('kft:') && h.body.tool === 'analyze_site'),
  };
}
const isFull = (r) => r.sc.overall_score === 83.7 && JSON.stringify(r.sc).includes('Test Sub XYZ');

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        if (counterDown) return { status: 500, body: { error: 'boom' } };
        if (body.op === 'consume') {
          const allowed = used < 3; if (allowed) used += 1;
          return { ok: true, allowed, used, limit: 3, remaining: Math.max(0, 3 - used), resets_at: '2026-12-01T00:00:00Z' };
        }
        if (body.op === 'release') { used = Math.max(0, used - 1); return { ok: true, allowed: false, used, limit: 3 }; }
        return { ok: true, allowed: used < 3, used, limit: 3 };
      }
      if (p === '/api/site-score') {
        if (siteDown) return { status: 503, body: { error: 'upstream down' } };
        return { ...FULL };
      }
      return undefined;
    },
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });
beforeEach(() => {
  used = 0; counterDown = false; siteDown = false;
  delete process.env.DCHUB_KEYLESS_SITE_FULL; delete process.env.DCHUB_KEYLESS_SITE_FULL_CAP;
});

describe('keyless: 2 full analyze_site answers per IP per UTC day, then the wall', () => {
  it('runs 1-2 are full with the daily note and are charged; run 3 is the wall', async () => {
    const ip = freshIp();
    for (let i = 1; i <= 2; i++) {
      const r = await call({ ip });
      expect(isFull(r), `run ${i}: the full answer`).toBe(true);
      expect(r.sc.daily_site_runs).toMatchObject({ used: i, limit: 2, remaining: 2 - i });
      expect(r.text).toContain(`Free full site analysis without a key: ${i} of 2 today (UTC).`);
      expect(r.text).toContain('claim_free_key');
      expect(r.status).toContain('keyless_full_trial');
      expect(r.charges).toHaveLength(1);
    }
    const r3 = await call({ ip });
    expect(isFull(r3), 'run 3: the wall').toBe(false);
    expect(r3.sc.overall_score ?? null).toBe(null);
    expect(r3.sc.daily_site_runs).toBeUndefined();
    expect(r3.status).not.toContain('keyless_full_trial');
  });

  it('an error answer from the handler does not spend a run', async () => {
    process.env.DCHUB_KEYLESS_SITE_FULL_CAP = '1';
    const S = await import('../server.mjs');
    const c = { client_ip: freshIp(), session_id: 'kssf-unit-1', client_ua: 'Claude-User', platform: 'claude' };
    const err = await S._keylessSiteFull(c, 'analyze_site', ARGS,
      async () => ({ isError: true, content: [{ type: 'text', text: 'API 400' }] }));
    expect(err).toMatchObject({ charged: false, result: { isError: true } });
    const ok = await S._keylessSiteFull(c, 'analyze_site', ARGS,
      async () => ({ content: [{ type: 'text', text: JSON.stringify(FULL) }], structuredContent: { ...FULL } }));
    expect(ok && ok.charged, 'the run is still there after the error').toBe(true);
    expect(await S._keylessSiteFull(c, 'analyze_site', ARGS, async () => ({ content: [], structuredContent: { ...FULL } }))).toBe(null);
  });

  it('the last run says so', async () => {
    const ip = freshIp();
    await call({ ip });
    const r = await call({ ip });
    expect(r.text).toContain('That was the last one today');
  });

  it('each IP has its own budget', async () => {
    const a = freshIp(), b = freshIp();
    await call({ ip: a }); await call({ ip: a });
    expect(isFull(await call({ ip: a }))).toBe(false);
    expect(isFull(await call({ ip: b }))).toBe(true);
  });

  it('no plan name or price in the added copy', async () => {
    const r = await call({ ip: freshIp() });
    const line = r.text.split('\n').filter((l) => /free full site analysis/i.test(l)).join('\n');
    expect(line.length).toBeGreaterThan(0);
    expect(line).not.toMatch(/\$\d/);
    expect(line).not.toMatch(/\b(Pro|Developer|Starter|Enterprise)\b/);
  });

  it('a failed upstream does not spend a run', async () => {
    const ip = freshIp();
    siteDown = true;
    await call({ ip });
    siteDown = false;
    expect(isFull(await call({ ip }))).toBe(true);
    expect(isFull(await call({ ip })), 'still 2 full after the failure').toBe(true);
    expect(isFull(await call({ ip }))).toBe(false);
  });
});

describe('switches', () => {
  it('DCHUB_KEYLESS_SITE_FULL=0: the wall on the first call, nothing charged', async () => {
    process.env.DCHUB_KEYLESS_SITE_FULL = '0';
    const r = await call({ ip: freshIp() });
    expect(isFull(r)).toBe(false);
    expect(r.charges).toEqual([]);
  });
  it('DCHUB_KEYLESS_SITE_FULL_CAP=0: the wall', async () => {
    process.env.DCHUB_KEYLESS_SITE_FULL_CAP = '0';
    expect(isFull(await call({ ip: freshIp() }))).toBe(false);
  });
  it('DCHUB_KEYLESS_SITE_FULL_CAP=1: one full run', async () => {
    process.env.DCHUB_KEYLESS_SITE_FULL_CAP = '1';
    const ip = freshIp();
    const r = await call({ ip });
    expect(isFull(r)).toBe(true);
    expect(r.text).toContain('1 of 1 today');
    expect(isFull(await call({ ip }))).toBe(false);
  });
});

describe('a free key: monthly runs first, then the daily lane', () => {
  it('with monthly runs left: lp_free_full, no daily block, nothing charged on the daily lane', async () => {
    const r = await call({ key: FREE_KEY, ip: freshIp() });
    expect(r.status).toContain('lp_free_full');
    expect(r.sc.daily_site_runs).toBeUndefined();
    expect(r.charges).toEqual([]);
  });
  it('monthly runs spent: 2 daily full answers with the keyed note, then the spent preview', async () => {
    used = 3;
    const ip = freshIp();
    for (let i = 1; i <= 2; i++) {
      const r = await call({ key: FREE_KEY, ip });
      expect(isFull(r), `daily run ${i}`).toBe(true);
      expect(r.text).toContain(`Free daily full site analysis ${i} of 2 today (UTC), after this key's monthly runs.`);
      expect(r.text).not.toContain('claim_free_key');
    }
    const r3 = await call({ key: FREE_KEY, ip });
    expect(isFull(r3)).toBe(false);
    expect(r3.sc.free_monthly_runs).toMatchObject({ reason: 'free_monthly_limit_reached' });
  });
  it('the monthly counter down: the preview (fails closed), not the daily lane', async () => {
    counterDown = true;
    const r = await call({ key: FREE_KEY, ip: freshIp() });
    expect(isFull(r)).toBe(false);
    expect(r.charges).toEqual([]);
  });
});

describe('who is never in the lane', () => {
  it('a QA caller (UA dchub-qa-readonly): the wall, nothing charged', async () => {
    const r = await call({ ip: freshIp(), ua: 'dchub-qa-readonly/1.0' });
    expect(isFull(r)).toBe(false);
    expect(r.charges).toEqual([]);
  });
  it('a QA caller (X-DCHub-QA: 1, ordinary UA): the wall, nothing charged', async () => {
    const r = await call({ ip: freshIp(), headers: { 'x-dchub-qa': '1' } });
    expect(isFull(r)).toBe(false);
    expect(r.charges).toEqual([]);
  });
  it('no forwarded IP (loopback caller): the wall', async () => {
    expect(isFull(await call())).toBe(false);
  });
  it('/mcp/chatgpt (frozen): not the full answer, nothing charged', async () => {
    const r = await call({ ip: freshIp(), ua: 'openai-mcp/1.0.0', path: '/mcp/chatgpt' });
    expect(isFull(r)).toBe(false);
    expect(r.charges).toEqual([]);
  });
});
