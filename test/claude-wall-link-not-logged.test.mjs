// claude-wall-link-not-logged.test.mjs — QA-C P1 (2026-10-19), logging half.
//
// /mcp/claude strips every relay link from a wall before the reply leaves (human_url, show_to_user,
// for_your_human; Grok option B, mcp#973), so a Claude-connector wall hands out NO link. The call row
// still carried wall_link_th, the hash of the link the handler built before the filter ran, so the
// analyze_site funnel's wall_links counted a link the caller never saw. Pinned, over the real app on
// loopback against a stub backend:
//   C1  /mcp/claude keyless analyze_site: the reply has no link, the /track row is status pro_wall,
//       tagged source claude-directory, and carries NO wall_link_th;
//   C2  control, /mcp keyless analyze_site with a session: the reply has a link and the row DOES carry
//       wall_link_th (so C1 cannot pass because the field is never written).
// No network (fenceNetwork), no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const UA = { 'user-agent': 'Claude-User' };
const ARGS = { lat: 33.45, lon: -112.07 };
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
async function wall(path, session) {
  await settle();
  const before = H.hits.length;
  let hdr = { ...UA };
  if (session) {
    const init = await H.init(path, 'claude-ai', hdr);
    const sid = init.headers.get('mcp-session-id');
    if (sid) hdr = { ...hdr, 'mcp-session-id': sid };
  }
  const r = await H.call(path, 'analyze_site', ARGS, hdr);
  await settle();
  const tracks = H.hits.slice(before).filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === 'analyze_site');
  return { r, tracks, text: JSON.stringify(r.msg && r.msg.result) };
}

beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({}); }, 60_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('wall_link_th is written only for walls that handed out a link', () => {
  it('C1 /mcp/claude: wall logged pro_wall, source claude-directory, no link in the reply, no wall_link_th', async () => {
    const w = await wall('/mcp/claude', false);
    expect(w.text).not.toMatch(/\/upgrade\/h\/|\/u\/[a-z0-9]+/i);
    expect(w.tracks.length).toBe(1);
    expect(w.tracks[0].body.status).toBe('pro_wall');
    expect(w.tracks[0].body.source).toBe('claude-directory');
    expect(w.tracks[0].body.wall_link_th).toBeUndefined();
  });
  it('C2 control, /mcp: the wall hands out a link and the row names it', async () => {
    const w = await wall('/mcp', true);
    expect(w.text).toMatch(/\/upgrade\/h\/|\/u\/[a-z0-9]+/i);
    expect(w.tracks.length).toBe(1);
    expect(w.tracks[0].body.status).toMatch(/pro_wall|lp_wall/);
    expect(typeof w.tracks[0].body.wall_link_th).toBe('string');
  });
});
