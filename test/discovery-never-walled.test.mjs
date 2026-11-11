// Discovery is never walled (owner 2026-11-11, funnel item 1; server.mjs ANON_WALL_EXEMPT_TOOLS).
//
// Funnel 7d to 11-11 (quota_wall_hits.by_tool_email_ask_7d): discover_tools 3 walls, 0 with an offer, all
// keyless sessionless 'mcp' rows. The key quotas already skip it (QUOTA_EXEMPT_TOOLS); the anonymous per-IP
// hard wall and soft cap did not, so a keyless caller past either got the navigation tool walled or trimmed.
// execute_plan's unknown-intent fallback runs discover_tools as its only step, so a plan walled there too.
//
// Real /mcp handler, lean on, a non-loopback peer (so no call reads as an execute_plan step), a stub backend
// that records every funnel-event body and answers /anon-usage with a chosen count:
//   1) at the soft cap (25 of 20) and past the hard wall (999): discover_tools, sessionless and in a session,
//      posts no quota_wall_hit and answers the full catalog (every family, not a preview);
//   2) execute_plan with an intent the planner cannot place (its discover_tools fallback), at the soft cap,
//      posts no step wall (past the hard wall execute_plan itself walls and no step runs);
//   3) the soft cap meters call volume, so no QUOTA_EXEMPT_TOOLS tool walls at it either: at count 25 the
//      wall used to rewrite request_capacity_intro's terms link and summarize_for_citation's licence link to
//      the wall's own link;
//   4) CONTROL: at the same counts plan_query (same no-data navigation class, not exempt) walls, so the count
//      is live and the harness can see a wall.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

let H, fence, anonCount = 0;
const events = [];
const CLIENT_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
net.Socket.prototype._getpeername = function _getpeername() {
  const p = _peer.call(this);
  return H && this.server && this.localPort === H.PORT && p && p.address && CLIENT_PORTS.has(p.port)
    ? { ...p, address: '203.0.113.9' } : p;
};

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_ANON_DAILY_CAP: '20' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
      if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      return undefined;
    },
  });
}, 60_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop(); if (fence) fence.restore();
});

function rpc(headers, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: H.PORT, path: '/mcp', method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (ch) => { raw += ch; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ msg, headers: res.headers });
      });
    });
    req.on('socket', (sock) => { const note = () => CLIENT_PORTS.add(sock.localPort); if (sock.localPort) note(); else sock.once('connect', note); });
    req.on('error', reject);
    req.end(data);
  });
}
let ip = 1, rid = 100;
const freshIp = () => `198.51.${110 + Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
async function call(name, args, hdr) {
  const before = events.length;
  const r = await rpc(hdr, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } });
  // a wall row leaves after the response; give it time to arrive before reading "none"
  await new Promise((res) => setTimeout(res, 150));
  const result = (r.msg && r.msg.result) || {};
  return { result, rows: events.slice(before) };
}
async function session() {
  const hdr = { 'user-agent': 'node', 'x-dc-client-ip': freshIp() };
  const init = await rpc(hdr, { jsonrpc: '2.0', id: rid++, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
  const sid = init.headers['mcp-session-id'];
  await rpc({ ...hdr, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { ...hdr, 'mcp-session-id': sid };
}
const sessionless = () => ({ 'user-agent': 'node', 'x-dc-client-ip': freshIp() });
// The catalog block 0 carries: discover_tools' families, every one of them (a preview cut it to 1 of N).
function families(result) {
  let p = null;
  try { p = JSON.parse(result.content[0].text); } catch (_) { p = null; }
  const sc = result.structuredContent || {};
  const f = (p && (p.families || p.tool_families)) || sc.families || sc.tool_families;
  return Array.isArray(f) ? f.length : (f && typeof f === 'object' ? Object.keys(f).length : 0);
}

describe('discover_tools is never walled (funnel item 1)', () => {
  let fullFamilies = 0;
  it('baseline: under every cap it answers the full catalog', async () => {
    anonCount = 0;
    const r = await call('discover_tools', {}, sessionless());
    fullFamilies = families(r.result);
    expect(fullFamilies).toBeGreaterThan(3);
    expect(r.rows).toEqual([]);
  });

  it.each([['soft cap', 25], ['hard wall', 999]])('%s (anon count %i): no wall row, the full catalog, sessionless and in a session', async (_l, n) => {
    anonCount = n;
    const s = await session();
    for (const hdr of [sessionless(), sessionless(), s, s]) {
      const r = await call('discover_tools', {}, hdr);
      expect(r.rows.map((e) => `${e.tool}/${e.wall_status}`)).toEqual([]);
      expect(r.result.isError).not.toBe(true);
      expect(families(r.result)).toBe(fullFamilies);
      expect(JSON.stringify(r.result)).not.toContain('anon_hard_wall');
    }
  });

  // Past the hard wall execute_plan is walled itself (no step runs); the soft cap lets the plan run.
  it('execute_plan whose only step is discover_tools (soft cap, anon count 25) walls no step', async () => {
    anonCount = 25;
    const r = await call('execute_plan', { intent: 'xyzzy frobnicate quux' }, sessionless());
    expect(JSON.stringify(r.result)).toContain('discover_tools');
    expect(r.rows.filter((e) => e.tool === 'discover_tools')).toEqual([]);
  });

  it.each([
    ['why_dchub', {}, null],
    ['summarize_for_citation', { claim: 'PJM queue', source_url: 'https://dchub.cloud/grid/pjm' }, null],
    ['request_capacity_intro', { listing: 'test-listing' }, /listings\/terms|dchub\.cloud\/listings/],
    ['accept_capacity_terms', {}, /listings\/terms|dchub\.cloud\/listings/],
  ])('soft cap (anon count 25): %s is not walled and keeps its own links', async (name, args, own) => {
    anonCount = 25;
    for (const hdr of [sessionless(), await session()]) {
      const r = await call(name, args, hdr);
      expect(r.rows.map((e) => `${e.tool}/${e.wall_status}`)).toEqual([]);
      const body = JSON.stringify(r.result);
      expect(body).not.toContain('anon_daily_cap');
      expect(body).not.toContain('dchub.cloud/u/');
      if (own) expect(body).toMatch(own);
    }
  });

  it.each([['soft cap', 25, 'anon_daily_cap'], ['hard wall', 999, 'anon_hard_wall']])('CONTROL %s: plan_query (not exempt) walls at the same count', async (_l, n, status) => {
    anonCount = n;
    const r = await call('plan_query', { intent: 'rank markets for a 200 MW AI campus' }, sessionless());
    expect(r.rows.map((e) => `${e.tool}/${e.wall_status}`)).toEqual([`plan_query/${status}`]);
  });

  it('no socket left loopback', () => { expect(fence.foreign).toEqual([]); });
});
