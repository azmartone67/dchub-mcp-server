// wall-link-every-wall.test.mjs — wall-to-paid P3a (owner 2026-10-23, ~/dchub-progress/wall-to-paid-1023.md).
//
// Before: only analyze_site's pro_wall / lp_wall rows carried wall_link_th; every other wall's link is
// built by the outer step chain after the handler's `finally` sent the row, so a data-tool wall could not
// be joined to the relay open or checkout click it led to. Pinned over the real app on loopback against
// the stub backend (no network):
//   W1  /mcp keyless get_grid_intelligence: the row's status is a wall status, it carries wall_link_th,
//       and that hash is sha256 of the relay token in THIS reply's human_url (the link the caller saw);
//   W2  /mcp/claude: the reply has no link, the row is sent once and carries no wall_link_th;
//   W3  kill switch DCHUB_WALL_LINK_DEFER=0: the row is sent at once, without the hash (control: W1
//       passes because of the deferral, not because something else started writing the field);
//   W4  exactly one row per call, also after the fallback timer would have fired.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { WALL_LINK_STATUSES, WALL_LINK_FLUSH_FALLBACK_MS, parkWallTrack, flushWallTracks } from '../lib/wall-link-track.mjs';

const ARGS = { iso: 'ERCOT' };
let H, fence;

async function settle(quietMs = 400, maxMs = 8000) {
  const t0 = Date.now();
  let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
const tracksSince = (before, tool) => H.hits.slice(before)
  .filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === tool);
async function call(path, tool, args, ua) {
  await settle();
  const before = H.hits.length;
  let hdr = { 'user-agent': ua };
  const init = await H.init(path, 'probe-client', hdr);
  const sid = init.headers.get('mcp-session-id');
  if (sid) hdr = { ...hdr, 'mcp-session-id': sid };
  const r = await H.call(path, tool, args, hdr);
  await settle();
  const result = r.msg && r.msg.result;
  return { before, result, text: JSON.stringify(result), tracks: tracksSince(before, tool) };
}
const tokenHash = (url) => {
  const m = /\/upgrade\/h\/([A-Za-z0-9_-]+\.[0-9a-f]{32})/.exec(String(url || ''));
  return m ? createHash('sha256').update(m[1]).digest('hex').slice(0, 32) : null;
};

beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({}); }, 60_000);
afterAll(async () => { delete process.env.DCHUB_WALL_LINK_DEFER; if (H) await H.stop(); if (fence) fence.restore(); });

describe('every wall row names the link the caller was handed', () => {
  it('W1 /mcp data-tool wall: wall status, wall_link_th = hash of the reply human_url token', async () => {
    const w = await call('/mcp', 'get_grid_intelligence', ARGS, 'Claude-User');
    const hu = w.result && w.result.structuredContent && w.result.structuredContent.human_url;
    expect(hu, 'control: the stub wall hands out a relay link').toMatch(/\/upgrade\/h\//);
    expect(w.tracks.length).toBe(1);
    expect(WALL_LINK_STATUSES.has(w.tracks[0].body.status), w.tracks[0].body.status).toBe(true);
    expect(w.tracks[0].body.wall_link_th).toBe(tokenHash(hu));
  });
  it('W2 /mcp/claude: no link in the reply, one row, no wall_link_th', async () => {
    const w = await call('/mcp/claude', 'get_grid_intelligence', ARGS, 'Claude-User');
    expect(w.text).not.toMatch(/\/upgrade\/h\/|\/u\/[a-z0-9]{6}/i);
    expect(w.tracks.length).toBe(1);
    expect(w.tracks[0].body.wall_link_th).toBeUndefined();
  });
  it('W3 kill switch DCHUB_WALL_LINK_DEFER=0: row sent unhashed', async () => {
    process.env.DCHUB_WALL_LINK_DEFER = '0';
    try {
      const w = await call('/mcp', 'get_grid_intelligence', ARGS, 'Claude-User');
      expect(w.text).toMatch(/\/upgrade\/h\//);
      expect(w.tracks.length).toBe(1);
      expect(w.tracks[0].body.wall_link_th).toBeUndefined();
    } finally { delete process.env.DCHUB_WALL_LINK_DEFER; }
  });
  it('W4 one row per call, also past the fallback timer', async () => {
    const w = await call('/mcp', 'get_grid_intelligence', ARGS, 'Claude-User');
    await new Promise((r) => setTimeout(r, WALL_LINK_FLUSH_FALLBACK_MS + 500));
    expect(tracksSince(w.before, 'get_grid_intelligence').length).toBe(1);
  }, 20_000);
});

describe('lib/wall-link-track', () => {
  it('parks only unhashed wall rows; flush stamps the hash; an unflushed row falls back unhashed', async () => {
    const sent = [];
    const send = (p) => { sent.push(p); return Promise.resolve(); };
    const c = {};
    expect(parkWallTrack(c, { tool: 't', status: 'ok' }, send)).toBe(false);
    expect(parkWallTrack(c, { tool: 't', status: 'trial_used', wall_link_th: 'x' }, send)).toBe(false);
    expect(parkWallTrack(c, { tool: 't', status: 'trial_used' }, send, { env: { DCHUB_WALL_LINK_DEFER: 'off' } })).toBe(false);
    expect(parkWallTrack(c, { tool: 't', status: 'trial_used' }, send)).toBe(true);
    expect(parkWallTrack(c, { tool: 'u', status: 'anon_daily_cap' }, send, { fallbackMs: 30 })).toBe(true);
    expect(flushWallTracks(c, 't', {}, () => 'abc', send)).toBe(1);
    expect(sent).toEqual([{ tool: 't', status: 'trial_used', wall_link_th: 'abc' }]);
    expect(flushWallTracks(c, 't', {}, () => 'abc', send)).toBe(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(sent[1]).toEqual({ tool: 'u', status: 'anon_daily_cap' });
    expect(flushWallTracks(c, 'u', {}, () => 'zzz', send)).toBe(0);
    expect(sent.length).toBe(2);
  });
});
