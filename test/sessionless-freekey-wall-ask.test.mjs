// Sessionless free-key walls ask for the email (2026-11-11).
//
// Funnel no_ask_split since 11-10 10:45Z (dchub-backend routes/mcp_funnel_events.py, reason no_session):
// get_grid_data on platform mcp, 2 of 2 sessionless walls with no ask, offers_shown "pro". The keyless
// free-key wall's email line (server.mjs _wallEmailLineStep, option A) stopped at "no session", because
// its link page grants the email onto a session. Reproduced here on main for get_grid_data,
// get_energy_prices, get_water_risk and get_renewable_energy: wall_status trial_used, email_ask none,
// offers ["pro"], on every sessionless wall.
//
// Now a sessionless keyless caller gets the in-chat form on EVERY wall (no session memo exists): the
// agent line names `bind_email` (on a call with no key it returns a new email-bound key for X-API-Key,
// mcp#1348) above the human line "Reply with your email ...", and the row says email_ask 'line'.
// Unchanged: a caller with a session, a keyed caller (bind_field), Grok, the Claude / core / ChatGPT
// directory paths, an execute_plan step (loopback peer), and DCHUB_SESSIONLESS_EMAIL_ASK=0.
// Real server.mjs app on loopback, stub backend; no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { claimHandoffFreekeyText } from '../lib/claim-handoff.mjs';

const FREE_NO_EMAIL = 'dch_live_sessionless_freekey_noemail_01';
const AGENT_LINE = claimHandoffFreekeyText();
const HUMAN_LINE = /Reply with your email and I'll unlock the full data free/;
const TOOLS = [['get_grid_data', { iso: 'PJM' }], ['get_energy_prices', { state: 'VA' }],
  ['get_water_risk', { state: 'VA' }], ['get_renewable_energy', { state: 'VA' }]];

let H, fence;
let EXTERNAL = true;           // false: the test's own sockets look like loopback (an execute_plan step)
const CLIENT_PORTS = new Set();
const events = [];
const _peer = net.Socket.prototype._getpeername;
net.Socket.prototype._getpeername = function _getpeername() {
  const p = _peer.call(this);
  return EXTERNAL && H && this.server && this.localPort === H.PORT && p && p.address && CLIENT_PORTS.has(p.port)
    ? { ...p, address: '203.0.113.7' } : p;
};

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
      if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      if (p === '/api/v1/keys/validate' && body && body.api_key === FREE_NO_EMAIL) {
        return { valid: true, tier: 'free', developer_id: 'dev_sessionless', email: null, tier_detail: { users_plan: 'free', effective: 'free' } };
      }
      return undefined;
    },
  });
}, 60_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop(); if (fence) fence.restore();
});
beforeEach(() => { EXTERNAL = true; delete process.env.DCHUB_SESSIONLESS_EMAIL_ASK; });

let ip = 1, rid = 1;
// A plain node:http request (agent: false), so the test knows its socket's local port and can make
// exactly that peer look external; the server's own loopback calls stay loopback.
function rpc(path, headers, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: H.PORT, path, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
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
async function call(name, args, { path = '/mcp', hdr = {}, sid = null } = {}) {
  const before = events.length;
  const r = await rpc(path, { 'user-agent': 'node', ...hdr, ...(sid ? { 'mcp-session-id': sid } : {}) },
    { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } });
  for (let i = 0; i < 100 && events.length === before; i++) await new Promise((res) => setTimeout(res, 20));
  await new Promise((res) => setTimeout(res, 150));
  const res = (r.msg && r.msg.result) || {};
  const text = (res.content || []).map((c) => c.text || '').join('\n');
  return { text, rows: events.slice(before).filter((e) => e.tool === name) };
}
const freshIp = () => ({ 'x-dc-client-ip': `198.51.100.${ip++}` });

describe('sessionless keyless free-key walls carry the email ask', () => {
  it.each(TOOLS)('%s: every sessionless wall asks (in-chat bind_email line) and the row says line', async (tool, args) => {
    const hdr = freshIp();
    for (const n of [1, 2]) {
      const r = await call(tool, args, { hdr });
      expect(r.rows.map((e) => [e.wall_status, e.session_id || '', e.email_ask]), `${tool} wall ${n}`)
        .toEqual([['trial_used', '', 'line']]);
      expect(r.rows[0].offers_shown).toContain('email_unlock');
      expect(r.text).toContain(AGENT_LINE);
      expect(r.text).toMatch(HUMAN_LINE);
      expect(r.text.split(AGENT_LINE).length - 1).toBe(1);          // one agent ask, not stacked
    }
  });

  it('CONTROL: kill switch DCHUB_SESSIONLESS_EMAIL_ASK=0 restores the wall without an ask', async () => {
    process.env.DCHUB_SESSIONLESS_EMAIL_ASK = '0';
    const r = await call('get_grid_data', { iso: 'PJM' }, { hdr: freshIp() });
    expect(r.rows.map((e) => e.email_ask)).toEqual([undefined]);
    expect(r.text).not.toContain(AGENT_LINE);
    expect(r.text).not.toMatch(HUMAN_LINE);
  });

  it('CONTROL: an execute_plan step (loopback peer) asks nothing here', async () => {
    EXTERNAL = false;
    const r = await call('get_grid_data', { iso: 'PJM' }, { hdr: freshIp() });
    expect(r.rows.map((e) => e.email_ask)).toEqual([undefined]);
    expect(r.text).not.toContain(AGENT_LINE);
  });

  it('CONTROL: Grok asks nothing (contract G3: one human URL, fixed copy)', async () => {
    const r = await call('get_grid_data', { iso: 'PJM' }, { hdr: { ...freshIp(), 'x-mcp-platform': 'grok' } });
    expect(r.rows.filter((e) => e.email_ask === 'line')).toEqual([]);
    expect(r.text).not.toContain(AGENT_LINE);
    expect(r.text).not.toMatch(HUMAN_LINE);
  });

  it.each([['/mcp/claude'], ['/mcp/core'], ['/mcp/chatgpt']])('CONTROL: %s asks nothing', async (path) => {
    const r = await call('get_grid_data', { iso: 'PJM' }, { path, hdr: freshIp() });
    expect(r.rows.filter((e) => e.email_ask === 'line')).toEqual([]);
    expect(r.text).not.toContain(AGENT_LINE);
  });

  it('CONTROL: a keyed free caller without an email keeps its structured bind_email ask (bind_field)', async () => {
    const r = await call('get_grid_data', { iso: 'PJM' }, { hdr: { ...freshIp(), 'x-api-key': FREE_NO_EMAIL } });
    expect(r.rows.map((e) => e.email_ask)).not.toContain(undefined);
    expect(r.rows.map((e) => e.email_ask)).not.toContain('line');
    expect(r.text).not.toContain(AGENT_LINE);
  });

  it('CONTROL: a sessionless grid / queue wall keeps its own ask and gets no second one', async () => {
    const r = await call('get_grid_intelligence', { iso: 'MISO' }, { hdr: freshIp() });
    expect(r.rows.map((e) => e.email_ask)).toEqual(['line']);            // the decision hand-off's ask, as on main
    expect(r.text.split('Ask your user for their email').length - 1).toBe(1);
    expect(r.text).not.toContain(AGENT_LINE);
    expect(r.text).not.toMatch(HUMAN_LINE);                                // its human line keeps the page wording
  });

  it('CONTROL: with a session the first wall asks once, as before', async () => {
    const hdr = { 'user-agent': 'node', ...freshIp() };
    const init = await H.init('/mcp', 'cursor', hdr);
    const sid = init.headers.get('mcp-session-id');
    expect(sid).toBeTruthy();
    await H.post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { ...hdr, 'mcp-session-id': sid });
    const r = await call('get_grid_data', { iso: 'PJM' }, { hdr, sid });
    expect(r.rows.map((e) => [e.session_id, e.email_ask])).toEqual([[sid, 'line']]);
    expect(r.text).toContain(AGENT_LINE);
  });
});
