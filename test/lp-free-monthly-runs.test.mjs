// Free monthly analyze_site runs (owner 2026-10-10, option ii): a key below Pro
// gets 3 FULL answers per UTC month, counted by the backend
// (dchub-backend routes/mcp_lp_free_runs.py), then the preview.
// Real server.mjs app on loopback, stub backend whose counter mimics the real
// endpoint (limit 3, consume/release/peek); no network, no disk writes.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const FREE_KEY = 'dch_trial_FREEmonthly0123456789abcdef';
const UA = { 'user-agent': 'Claude-User' };
const ARGS = { lat: 33.45, lon: -112.07 };
const FULL = {
  success: true, lat: 33.45, lon: -112.07, overall_score: 83.7, verdict: 'BUILD',
  factors: { power: { score: 91, verdict: 'BUILD' }, fiber: { score: 64, verdict: 'CAUTION' } },
  nearest_substations: { substations_in_radius: 7, search_radius_km: 50,
    substations: [{ name: 'Test Sub XYZ', hifld_id: 'H123', max_kv: 230, distance_km: 2.4 }] },
};

let H, fence;
let used = 0, LIMIT = 3, counterDown = false, siteDown = false;
const ops = [];

async function settle(quietMs = 300, maxMs = 6000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call(key) {
  const hdr = { ...UA, ...(key ? { 'x-api-key': key } : {}) };
  const init = await H.init('/mcp', 'claude-ai', hdr);
  const sid = init.headers.get('mcp-session-id');
  const before = H.hits.length;
  const r = await H.call('/mcp', 'analyze_site', ARGS, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const hits = H.hits.slice(before);
  const res = r.msg && r.msg.result;
  const track = hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === 'analyze_site');
  return {
    res, sc: (res && res.structuredContent) || {},
    text: ((res && res.content) || []).map((x) => x.text || '').join('\n'),
    status: track.map((t) => t.body.status),
    signals: hits.filter((h) => h.path === '/api/v1/mcp/signal-paywall' && h.body).map((h) => h.body),
    counterHits: hits.filter((h) => h.path === '/api/v1/mcp/lp-free-runs').map((h) => h.body),
  };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_KEY) {
        return { valid: true, tier: 'free', developer_id: null, email: null, tier_detail: { users_plan: null } };
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        ops.push(body.op);
        if (counterDown) return { status: 500, body: { error: 'boom' } };
        if (body.op === 'consume') {
          const allowed = used < LIMIT; if (allowed) used += 1;
          return { ok: true, allowed, used, limit: LIMIT, remaining: Math.max(0, LIMIT - used),
                   resets_at: '2026-11-01T00:00:00Z', email_bound: false };
        }
        if (body.op === 'release') { used = Math.max(0, used - 1); return { ok: true, allowed: false, used, limit: LIMIT }; }
        return { ok: true, allowed: used < LIMIT, used, limit: LIMIT };
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
beforeEach(() => { used = 0; LIMIT = 3; counterDown = false; siteDown = false; ops.length = 0; delete process.env.DCHUB_LP_FREE_RUNS; });

describe('free key: 3 full analyze_site runs a month, then the preview', () => {
  it('runs 1-3 are full answers with the monthly note; run 4 is the preview with the spent block', async () => {
    for (let i = 1; i <= 3; i++) {
      const r = await call(FREE_KEY);
      expect(r.status, `run ${i}`).toContain('lp_free_full');
      expect(r.sc.overall_score, `run ${i}: the score is served`).toBe(83.7);
      expect(JSON.stringify(r.sc), `run ${i}: substation detail is served`).toContain('Test Sub XYZ');
      expect(r.sc.free_full_runs).toMatchObject({ used: i, limit: 3, remaining: 3 - i });
      expect(r.text).toContain(`Free full site analysis ${i} of 3 this month`);
    }
    const r4 = await call(FREE_KEY);
    expect(r4.status).not.toContain('lp_free_full');
    expect(r4.sc.overall_score ?? null, 'run 4: the score is withheld').toBe(null);
    expect(JSON.stringify(r4.sc)).not.toContain('Test Sub XYZ');
    expect(r4.sc.free_monthly_runs).toMatchObject({ reason: 'free_monthly_limit_reached', tool: 'analyze_site',
      used: 3, limit: 3, resets_at: '2026-11-01T00:00:00Z' });
    expect(r4.text).toContain("You've used your 3 free full site analyses this month");
    expect(r4.signals.map((s) => s.message_shown)).toContain('lp_free_spent');
  });

  it('no plan name or price in the copy it adds', async () => {
    const texts = [];
    for (let i = 0; i < 4; i++) {
      const r = await call(FREE_KEY);
      texts.push(r.text.split('\n').filter((l) => /free full site analys/i.test(l)).join('\n'));
    }
    const added = texts.join('\n');
    expect(added.length).toBeGreaterThan(0);
    expect(added).not.toMatch(/\$\d/);
    expect(added).not.toMatch(/\b(Pro|Developer|Starter|Enterprise)\b/);
  });

  it('a failed full call gives the run back', async () => {
    siteDown = true;
    await call(FREE_KEY);
    expect(ops).toEqual(['consume', 'release']);
    expect(used).toBe(0);
  });

  it('counter outage fails closed: preview, no full answer', async () => {
    counterDown = true;
    const r = await call(FREE_KEY);
    expect(r.status).not.toContain('lp_free_full');
    expect(r.status).not.toContain('error');
    expect(r.sc._preview_only, 'a real preview, not an error').toBe(true);
    expect(r.sc.overall_score ?? null).toBe(null);
  });

  it('kill switch: DCHUB_LP_FREE_RUNS=0 never asks the counter and serves the preview', async () => {
    process.env.DCHUB_LP_FREE_RUNS = '0';
    const r = await call(FREE_KEY);
    expect(r.counterHits).toEqual([]);
    expect(r.sc.overall_score ?? null).toBe(null);
  });
});

describe('who never reaches the counter', () => {
  it('no key: the wall, no counter call', async () => {
    const r = await call(null);
    expect(r.counterHits).toEqual([]);
    expect(r.status).not.toContain('lp_free_full');
  });
  it('a Pro key: the full answer without spending or noting a free run', async () => {
    const r = await call(PRO_KEY);
    expect(r.counterHits).toEqual([]);
    expect(r.sc.free_full_runs).toBeUndefined();
  });
});
