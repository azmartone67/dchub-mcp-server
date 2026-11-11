// Sessionless cap walls ask for the email through the agent (Grok -> Brain 2026-11-09).
//
// dchub-backend no_ask_split_7d (be#8642, live 11-09): 186 of the 271 walls that asked for nothing in 7
// days had no MCP session. The email-first cap wall links a page that grants onto the session, so a
// sessionless caller got no email path at all. Now:
//   - the soft cap (anon_daily_cap) and the land/site hard wall lead with claim_free_key {email} + X-API-Key;
//   - the quota_wall_hit row carries email_ask 'line';
//   - a caller WITH a session keeps the page link (unchanged), Grok and the Claude profile ask nothing,
//     a Pro-only tool keeps the earlier wall, and DCHUB_SESSIONLESS_EMAIL_ASK=0 restores the old wall.
// Lean responses stay at their default (on): this checks what the agent receives.
// The harness serves on 127.0.0.1, and a loopback peer is an execute_plan step (c.loopback_step), whose
// asks the outer plan answer carries. A real sessionless caller is not on loopback: sockets the MCP server
// accepts report a TEST-NET address unless a test asks for loopback (EXTERNAL = false).
// Real server.mjs app on loopback, stub backend; no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'node:net';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { _resetCapWallDay } from '../lib/keyless-wall.mjs';
process.env.DCHUB_KEYLESS_SITE_FULL = '0';

const UA = { 'user-agent': 'Claude-User' };
const SHORT = 'https://dchub.cloud/u/abcdef';
const ASK = /ask your human for their email[^]*`claim_free_key` with \{email\}[^]*X-API-Key/;

let H, fence, anonCount = 0, ipN = 0;
let EXTERNAL = true;
const _peer = net.Socket.prototype._getpeername;   // what socket.remoteAddress reads
net.Socket.prototype._getpeername = function _getpeername() {
  const p = _peer.call(this);
  return EXTERNAL && H && this.server && this.localPort === H.PORT && p && p.address ? { ...p, address: '203.0.113.7' } : p;
};

async function settle(quietMs = 250, maxMs = 5000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function call(name, args, { session = false, path = '/mcp', extraHdr = {} } = {}) {
  const hdr = { ...UA, 'x-dc-client-ip': `198.51.100.${++ipN}`, ...extraHdr };
  let sid = null;
  if (session) sid = (await H.init(path, 'claude-ai', hdr)).headers.get('mcp-session-id');
  H.S._anonUsageCounts.clear();
  const before = H.hits.length;
  const r = await H.call(path, name, args, { ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) });
  await settle();
  const hits = H.hits.slice(before);
  const res = (r.msg && r.msg.result) || {};
  return {
    res, sc: res.structuredContent || {},
    wire: JSON.stringify(res),
    walls: hits.filter((h) => h.path === '/api/v1/mcp/funnel-event' && h.body && h.body.event === 'quota_wall_hit')
      .map((h) => h.body),
  };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_ANON_DAILY_CAP: '30', DCHUB_ANON_HARD_WALL_MULT: '10' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/mcp/anon-usage') return { ok: true, count: anonCount };
      if (p === '/api/v1/relay/short') return (body && body.relay_url) ? { ok: true, url: SHORT } : { status: 500, body: {} };
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
beforeEach(() => {
  anonCount = 0; EXTERNAL = true;
  for (const k of ['DCHUB_SESSIONLESS_EMAIL_ASK', 'DCHUB_KEYLESS_EMAIL_FIRST', 'DCHUB_KEYLESS_EMAIL_FIRST_ALL', 'DCHUB_WALL_OFFER_FLOOR']) delete process.env[k];
  _resetCapWallDay();
});

describe('sessionless keyless cap walls ask for the email through claim_free_key', () => {
  it('soft cap: _upgrade leads with the email ask, names the call, and the wall row says line', async () => {
    anonCount = 50;
    const r = await call('search_facilities', { query: 'ashburn' });
    const up = r.sc._upgrade || {};
    expect(up.tier).toBe('anon_daily_cap');
    const prose = (r.res.content || []).filter((x) => x.type === 'text' && !/^\s*\{/.test(x.text)).map((x) => x.text);
    expect(prose.some((t) => /^Keep going free: ask your human for their email/.test(t) && ASK.test(t))).toBe(true);
    expect(up.email_ask).toEqual({ tool: 'claim_free_key', arguments: { email: '<your human’s email>' } });
    expect(up.unlock_kind).toBeUndefined();                       // no page link: there is no session to grant onto
    expect(r.walls.map((w) => [w.wall_status, w.email_ask])).toEqual([['anon_daily_cap', 'line']]);
  });

  it('hard wall (land/site): the message asks for the email instead of the no-email claim', async () => {
    anonCount = 999;
    const r = await call('find_sites', { state: 'TX' });
    expect(r.wire).toMatch(ASK);
    expect(r.wire).not.toContain('`claim_free_key` (no email)');
    expect(r.walls.map((w) => [w.wall_status, w.email_ask])).toEqual([['anon_hard_wall', 'line']]);
  });

  it('CONTROL: with a session the page link stays (unchanged) and the agent ask is not added', async () => {
    anonCount = 50;
    const r = await call('search_facilities', { query: 'ashburn' }, { session: true });
    expect(r.wire).toContain(SHORT);                             // the page link (lean strips _upgrade.unlock_kind)
    expect(r.wire).not.toMatch(ASK);
    expect(r.walls.map((w) => w.email_ask)).toEqual([expect.stringMatching(/^link/)]);
  });

  it('CONTROL: a Pro-only tool (an email opens nothing) keeps the earlier wall', async () => {
    anonCount = 50;
    const r = await call('compare_sites', { sites: [{ lat: 33.4, lon: -112.0 }, { lat: 32.7, lon: -96.8 }] });
    expect(r.wire).not.toMatch(ASK);
  });

  it.each([['/mcp/claude'], ['/mcp/core'], ['/mcp/chatgpt']])('CONTROL: %s asks nothing', async (path) => {
    anonCount = 50;
    const r = await call('search_facilities', { query: 'ashburn' }, { path });
    expect(r.wire).not.toMatch(ASK);
    expect(r.walls.filter((w) => w.email_ask === 'line')).toEqual([]);   // the row never claims an ask it did not show
  });
  it('CONTROL: Grok (tagged by platform, as every email ask reads it) asks nothing', async () => {
    anonCount = 50;
    const r = await call('search_facilities', { query: 'ashburn' }, { extraHdr: { 'x-mcp-platform': 'grok' } });
    expect(r.wire).not.toMatch(ASK);
    expect(r.walls.filter((w) => w.email_ask === 'line')).toEqual([]);
    // the same call untagged does ask: the header is what turned it off
    const plain = await call('search_facilities', { query: 'ashburn' });
    expect(plain.wire).toMatch(ASK);
  });

  it('CONTROL: an execute_plan step (loopback peer) asks nothing: the outer plan answer carries the ask', async () => {
    EXTERNAL = false;
    anonCount = 50;
    const r = await call('search_facilities', { query: 'ashburn' });
    expect(r.wire).not.toMatch(ASK);
    expect((r.sc._upgrade || {}).email_ask).toBeUndefined();
  });

  it('kill switch DCHUB_SESSIONLESS_EMAIL_ASK=0 (and the offer floor off) restores the earlier sessionless walls', async () => {
    process.env.DCHUB_SESSIONLESS_EMAIL_ASK = '0';
    process.env.DCHUB_WALL_OFFER_FLOOR = '0';   // the offer floor (item 2) is its own layer
    anonCount = 50;
    const soft = await call('search_facilities', { query: 'ashburn' });
    expect(soft.wire).not.toMatch(ASK);
    expect((soft.sc._upgrade || {}).email_ask).toBeUndefined();
    expect(soft.walls.map((w) => w.email_ask)).toEqual([undefined]);
    anonCount = 999;
    const hard = await call('find_sites', { state: 'TX' });
    expect(hard.wire).not.toMatch(ASK);
    expect(hard.walls.map((w) => w.email_ask)).toEqual([undefined]);
  });
});
