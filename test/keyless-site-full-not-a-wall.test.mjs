// The daily site lane's free run is not a wall (Brain 2026-11-02, live check of mcp#1236).
//
// Measured live 11-02 02:17Z, keyless on /mcp: the free run came back full, with daily_site_runs
// used 1 of 2, but the backend still withholds one DCPI figure (time_to_power_months; the band
// stays), so the answer was marked partial and every wall step fired on it: "Your AI assistant hit
// DC Hub's paid data boundary on analyze_site", and next_ask "open the link first, then ask again
// for the full answer" (which spends the second run for the same partial answer). On /mcp/claude
// the lazy-auth filter swaps any keyless partial answer for a 401 sign-in, so the run never reached
// the caller there. Real server.mjs app on loopback, stub backend whose site-score withholds the
// months the way util/site_market_verdict does; caller IP from X-Forwarded-For, as in production.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { WALL_NEXT_ASK_QUESTION } from '../lib/short-wall-link.mjs';
import { isKeylessSiteRun } from '../lib/keyless-full-trial.mjs';

const ARGS = { lat: 33.45, lon: -112.07 };
const FULL = {
  success: true, lat: 33.45, lon: -112.07, overall_score: 83.7, verdict: 'BUILD',
  factors: { power: { score: 91, verdict: 'BUILD' }, fiber: { score: 64, verdict: 'CAUTION' } },
  nearest_substations: { substations_in_radius: 7, search_radius_km: 50,
    substations: [{ name: 'Test Sub XYZ', hifld_id: 'H123', max_kv: 230, distance_km: 2.4 }] },
  time_to_power: { time_to_power_months: null, time_to_power_band: '24_to_48_months',
    market_slug: 'phoenix', _time_to_power_months_withheld: true,
    // The paid-field marker that makes the live answer partial_preview, reason
    // "time_to_power_months withheld" (it is stripped before the caller sees it).
    _time_to_power_months_in_pro: true },
};

let H, fence;
let ipN = 1;
// /mcp answers a keyless Claude.ai connector with its own OAuth challenge when WorkOS is on; a
// different client keeps these /mcp calls on the tool path.
const MCP_UA = 'Cursor/1.7.0';
const freshIp = () => `198.51.100.${ipN++}`;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: (base) => ({ DCHUB_WORKOS_OAUTH_ENABLED: '1', WORKOS_AUTHKIT_DOMAIN: base }),
    extraRoutes: (p) => (p === '/api/site-score' ? { ...FULL } : undefined),
  });
}, 120_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

const scOf = (r) => (r.msg && r.msg.result && r.msg.result.structuredContent) || {};
const textOf = (r) => ((r.msg && r.msg.result && r.msg.result.content) || []).map((x) => x.text || '').join('\n');

describe('isKeylessSiteRun', () => {
  it('only a stamped run counts', () => {
    expect(isKeylessSiteRun({ daily_site_runs: { used: 1, limit: 2 } })).toBe(true);
    expect(isKeylessSiteRun({ daily_site_runs: { used: 0 } })).toBe(false);
    expect(isKeylessSiteRun({ daily_site_runs: 'yes' })).toBe(false);
    expect(isKeylessSiteRun({})).toBe(false);
    expect(isKeylessSiteRun(null)).toBe(false);
  });
});

describe('/mcp: the free run carries no wall copy', () => {
  it('no "paid data boundary" relay, no "ask again" next_ask, and the withheld months are named', async () => {
    const hdr = { 'user-agent': MCP_UA, 'x-forwarded-for': freshIp() };
    const init = await H.init('/mcp', 'cursor', hdr);
    const sid = init.headers.get('mcp-session-id');
    const r = await H.call('/mcp', 'analyze_site', ARGS, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
    const sc = scOf(r), text = textOf(r);
    expect(sc.overall_score, 'the full answer').toBe(83.7);
    expect(sc.daily_site_runs).toMatchObject({ used: 1, limit: 2 });
    expect(sc.provenance.completeness, 'partial, as live: the months stay withheld').toBe('partial_preview');
    expect(JSON.stringify(r.msg.result)).not.toMatch(/paid data boundary|free-tier limit/);
    expect(JSON.stringify(r.msg.result)).not.toContain(WALL_NEXT_ASK_QUESTION);
    expect(text).toContain('Time to power is shown as a band (24_to_48_months); the estimate in months is not part of the free run.');
  });

  it('control: the wall past the cap still carries its wall copy', async () => {
    const hdr = { 'user-agent': MCP_UA, 'x-forwarded-for': freshIp() };
    const init = await H.init('/mcp', 'cursor', hdr);
    const sid = init.headers.get('mcp-session-id');
    const h2 = { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) };
    await H.call('/mcp', 'analyze_site', ARGS, h2);
    await H.call('/mcp', 'analyze_site', ARGS, h2);
    const r3 = await H.call('/mcp', 'analyze_site', ARGS, h2);
    expect(scOf(r3).daily_site_runs).toBeUndefined();
    expect(scOf(r3).overall_score ?? null).toBe(null);
    expect(JSON.stringify(r3.msg.result)).toMatch(/human_url|for_your_human/);
  });
});

describe('/mcp/claude: the free run is served, not swapped for a sign-in', () => {
  it('a keyless free run is 200 with the full answer', async () => {
    const r = await H.call('/mcp/claude', 'analyze_site', ARGS, { 'user-agent': 'Claude-User', 'x-forwarded-for': freshIp() });
    expect(r.status).toBe(200);
    expect(r.headers.get('www-authenticate')).toBeNull();
    expect(scOf(r).overall_score).toBe(83.7);
    expect(scOf(r).daily_site_runs).toMatchObject({ used: 1, limit: 2 });
  });

  it('past the cap, the keyless wall is still answered with the sign-in challenge', async () => {
    const ip = freshIp();
    const h = { 'user-agent': 'Claude-User', 'x-forwarded-for': ip };
    expect((await H.call('/mcp/claude', 'analyze_site', ARGS, h)).status).toBe(200);
    expect((await H.call('/mcp/claude', 'analyze_site', ARGS, h)).status).toBe(200);
    const r3 = await H.call('/mcp/claude', 'analyze_site', ARGS, h);
    expect(r3.status).toBe(401);
    expect(r3.headers.get('www-authenticate')).toMatch(/resource_metadata=/);
  });
});
