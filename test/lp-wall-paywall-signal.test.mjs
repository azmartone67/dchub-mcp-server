// The Land & Power Pro wall (analyze_site, compare_sites, find_sites, generate_site_analysis ...)
// returned its wall WITHOUT writing a paywall signal, so the funnel's paywall_hit step (distinct
// sessions with a trial_preview or paid_tool_blocked signal) went to zero for those tools on
// 2026-09-23, the day after the Pro-only cutover, while analyze_site kept ~30 calls a day.
// Real server.mjs app on loopback, stub backend; no network, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, GUESS_ARGS, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const UA = { 'user-agent': 'Claude-User' };
const LP = ['analyze_site', 'compare_sites'];
let H, fence;
const runs = {};

async function settle(quietMs = 400, maxMs = 8000) {
  const t0 = Date.now();
  let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function run(path, extra = {}) {
  await settle();
  const before = H.hits.length;
  const init = await H.init(path, 'claude-ai', { ...UA, ...extra });
  const sid = init.headers.get('mcp-session-id');
  const hdr = { ...UA, ...extra, ...(sid ? { 'mcp-session-id': sid } : {}) };
  for (const t of LP) { await H.call(path, t, GUESS_ARGS, hdr); await settle(); }
  const hits = H.hits.slice(before);
  return {
    signals: hits.filter((h) => h.path === '/api/v1/mcp/signal-paywall' && h.body),
    tracks: hits.filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool && h.body.event !== 'recipe_lifecycle'),
    paidHits: hits.filter((h) => h.path === '/api/v1/mcp/track-paid-hit'),
    claimChecks: hits.filter((h) => h.path === '/api/v1/mcp/should-mint-claim'),
    sid,
  };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
  runs.keyless = await run('/mcp');
  runs.pro = await run('/mcp', { 'x-api-key': PRO_KEY });
  runs.claude = await run('/mcp/claude');
}, 180_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('keyless Pro wall on the Land & Power tools', () => {
  it('control: both tools were answered with the Pro wall (tracked as pro_wall)', () => {
    for (const t of LP) {
      const rows = runs.keyless.tracks.filter((r) => r.body.tool === t);
      expect(rows.length, `${t}: tracked`).toBeGreaterThan(0);
      expect(rows.map((r) => r.body.status), t).toContain('pro_wall');
    }
  });
  it('each wall writes a paid_tool_blocked paywall signal for its tool', () => {
    for (const t of LP) {
      const sig = runs.keyless.signals.filter((s) => s.body.tool === t);
      expect(sig.length, `${t}: a paywall signal`).toBeGreaterThan(0);
      for (const s of sig) {
        expect(s.body.signal_type).toBe('paid_tool_blocked');
        expect(s.body.message_shown).toBe('lp_wall');
        expect(s.body.session_id).toBeTruthy();
        expect(s.body.tier_required).toBe('paid');
      }
    }
  });
  it('also registers the session for the high-intent stage: a paid hit for the caller, then a claim mint attempt', () => {
    // human_acted joins a relay open to a high-intent row with a minted claim; without these two calls a click on
    // the wall's /upgrade/h link could never count (the join the funnel needs, 2026-10-07).
    const mine = runs.keyless.paidHits.filter((h) => h.body && h.body.session_id === runs.keyless.sid);
    for (const t of LP) {
      expect(mine.map((h) => h.body.tool), `a paid hit for ${t}`).toContain(t);
    }
    expect(runs.keyless.claimChecks.length, 'a claim mint attempt followed').toBeGreaterThanOrEqual(LP.length);
  });
});

describe('where the wall must not fire', () => {
  it('a Pro key is not walled and writes no lp_wall signal, paid hit or claim attempt', () => {
    const lpSignals = runs.pro.signals.filter((s) => s.body.message_shown === 'lp_wall');
    expect(lpSignals).toEqual([]);
    expect(runs.pro.paidHits).toEqual([]);
    expect(runs.pro.claimChecks).toEqual([]);
    expect(runs.pro.tracks.map((r) => r.body.status)).not.toContain('pro_wall');
  });
  it('/mcp/claude (kept out of the relay readout) writes no signal, paid hit or claim attempt', () => {
    expect(runs.claude.signals).toEqual([]);
    expect(runs.claude.paidHits).toEqual([]);
    expect(runs.claude.claimChecks).toEqual([]);
  });
});
