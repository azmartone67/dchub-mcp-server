// A sessionless call's X-MCP-Client header names its platform (2026-11-10).
//
// Measured 11-10: 103 walls in 7 days came from platform 'mcp' with no MCP session, and a live
// sessionless probe that sent `X-MCP-Client: brain-askcheck-1110` still logged 'mcp': the header was
// read nowhere, and a tools/call carries no clientInfo.name. Now (server.mjs _sessionlessClientHeader):
//   - the header, sanitised like a clientInfo.name, names the platform on the wall row and call log;
//   - else a product the UA names (detectPlatform), else 'mcp' as before;
//   - a session's clientInfo (live, or remembered for a stale id) always wins over the header;
//   - our own tags (dchub-qa-readonly, site-eval-*, 1-2 char) stay internal / QA;
//   - DCHUB_SESSIONLESS_CLIENT_HEADER=0 restores the old behaviour.
// Real server.mjs app on loopback, stub backend; no network. The socket peer is reported as a
// TEST-NET address (see test/sessionless-cap-email-ask.test.mjs) so a call is not an execute_plan step.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'node:net';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { _resetCapWallDay } from '../lib/keyless-wall.mjs';
process.env.DCHUB_KEYLESS_SITE_FULL = '0';

let H, fence, ipN = 0;
const _peer = net.Socket.prototype._getpeername;
net.Socket.prototype._getpeername = function _getpeername() {
  const p = _peer.call(this);
  return H && this.server && this.localPort === H.PORT && p && p.address ? { ...p, address: '203.0.113.9' } : p;
};

async function settle(quietMs = 250, maxMs = 5000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
// One walled search_facilities call (anon soft cap). Returns the quota_wall_hit rows and the
// call-log (/api/v1/mcp/track) rows it wrote.
async function call({ ua = 'node', hdr = {}, session = null, sid = null } = {}) {
  const h = { 'user-agent': ua, 'x-dc-client-ip': `198.51.100.${++ipN}`, ...hdr };
  let id = sid;
  if (session) id = (await H.init('/mcp', session, h)).headers.get('mcp-session-id');
  H.S._anonUsageCounts.clear();
  const before = H.hits.length;
  await H.call('/mcp', 'search_facilities', { query: 'ashburn' }, { ...h, ...(id ? { 'mcp-session-id': id } : {}) });
  await settle();
  const hits = H.hits.slice(before);
  return {
    walls: hits.filter((x) => x.path === '/api/v1/mcp/funnel-event' && x.body && x.body.event === 'quota_wall_hit').map((x) => x.body),
    tracks: hits.filter((x) => x.path === '/api/v1/mcp/track' && x.body && x.body.tool === 'search_facilities').map((x) => x.body),
  };
}
const wallPlatforms = (r) => r.walls.map((w) => w.platform);

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_ANON_DAILY_CAP: '30', DCHUB_ANON_HARD_WALL_MULT: '10' },
    extraRoutes: (p) => {
      if (p === '/api/v1/mcp/anon-usage') return { ok: true, count: 50 };
      if (p === '/api/v1/mcp/pro-trial-offer/decide') return { fire: false };
      return undefined;
    },
  });
  H.S._readDeadline.signal = () => AbortSignal.timeout(120_000);
}, 120_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop(); if (fence) fence.restore();
});
beforeEach(() => { delete process.env.DCHUB_SESSIONLESS_CLIENT_HEADER; _resetCapWallDay(); });

describe('sessionless X-MCP-Client names the platform', () => {
  it('the header names the platform on the wall row and the call log, raw name in client_name', async () => {
    const r = await call({ hdr: { 'x-mcp-client': 'Zed-Assistant' } });
    expect(wallPlatforms(r)).toEqual(['zed-assistant']);
    expect(r.walls[0].is_qa).toBe(false);
    expect(r.tracks.length).toBeGreaterThan(0);
    for (const t of r.tracks) { expect(t.platform).toBe('zed-assistant'); expect(t.client_name).toBe('zed-assistant'); }
  });

  it('the header outranks a product the UA names', async () => {
    const r = await call({ ua: 'GitHubCopilot/1.2', hdr: { 'x-mcp-client': 'zed-assistant' } });
    expect(wallPlatforms(r)).toEqual(['zed-assistant']);
  });

  it('no header: a product token in the UA still names the platform (unchanged)', async () => {
    const r = await call({ ua: 'GitHubCopilot/1.2' });
    expect(wallPlatforms(r)).toEqual(['copilot']);
  });

  it('no header, generic UA: platform stays mcp (unchanged)', async () => {
    const r = await call({ ua: 'node' });
    expect(wallPlatforms(r)).toEqual(['mcp']);
    for (const t of r.tracks) expect(t.client_name).toBe('mcp');
  });

  it('a generic header name is an absence: platform stays mcp', async () => {
    const r = await call({ hdr: { 'x-mcp-client': 'MCP' } });
    expect(wallPlatforms(r)).toEqual(['mcp']);
  });

  it('a live session keeps its clientInfo platform whatever the header says', async () => {
    const r = await call({ session: 'cursor-vscode', hdr: { 'x-mcp-client': 'zed-assistant' } });
    expect(wallPlatforms(r)).toEqual(['cursor']);
  });

  it('a stale session id with a remembered clientInfo keeps it over the header', async () => {
    H.S._rememberPlatform('stale-sid-1110', 'cursor', 'cursor-vscode');
    const r = await call({ sid: 'stale-sid-1110', hdr: { 'x-mcp-client': 'zed-assistant' } });
    expect(wallPlatforms(r)).toEqual(['cursor']);
    for (const t of r.tracks) expect(t.client_name).toBe('cursor-vscode');
  });

  it('a junk header is sanitised (lowercase, [a-z0-9._-], 40 chars); a 1-char one is internal', async () => {
    const r = await call({ hdr: { 'x-mcp-client': 'Zed Assistant!<b>/1.0' } });
    expect(wallPlatforms(r)).toEqual(['zedassistantb10']);
    for (const t of r.tracks) expect(t.client_name).toBe('zedassistantb1.0');
    const long = await call({ hdr: { 'x-mcp-client': 'a'.repeat(30) + 'z'.repeat(30) } });
    expect(wallPlatforms(long)).toEqual(['a'.repeat(30) + 'z'.repeat(10)]);
    const one = await call({ hdr: { 'x-mcp-client': 'v' } });
    expect(wallPlatforms(one)).toEqual(['dchub-internal']);
  });

  it('our own tags stay ours: dchub-qa-readonly is QA, site-eval-* is internal', async () => {
    const qa = await call({ hdr: { 'x-mcp-client': 'dchub-qa-readonly' } });
    expect(qa.walls.map((w) => [w.platform, w.is_qa])).toEqual([['dchub-internal', true]]);
    const ev = await call({ hdr: { 'x-mcp-client': 'site-eval-a' } });
    expect(wallPlatforms(ev)).toEqual(['dchub-internal']);
    for (const t of ev.tracks) expect(t.platform).toBe('dchub-internal');
  });

  it('kill switch DCHUB_SESSIONLESS_CLIENT_HEADER=0 restores mcp', async () => {
    process.env.DCHUB_SESSIONLESS_CLIENT_HEADER = '0';
    const r = await call({ hdr: { 'x-mcp-client': 'zed-assistant' } });
    expect(wallPlatforms(r)).toEqual(['mcp']);
    for (const t of r.tracks) expect(t.client_name).toBe('mcp');
  });
});
