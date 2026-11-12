// A tier-masked PREVIEW carries the free offer too (funnel 2026-11-12, item 2; lib/wall-offer-floor.mjs).
//
// get_retirement_headroom's MW mask, get_refined_queue's preview and find_sites' coarsened preview answer a keyless caller with status 'ok', so no wall
// row is parked for them and the offer floor (which read parked wall rows only) skipped them: live 2026-11-12 the answer
// said "your agent got 3 of N rows ... open <link>" and offered nothing a person could say yes to for free. Measured with
// the real /mcp handler (DCHUB_INTERNAL_KEY set, a non-loopback peer, the dchub-qa-readonly UA the live probe used).
// Rule asserted: the prose the agent receives names the email step (bind_email / subscribe_digest / claim_free_key).
// discover_tools stays keyless and offer-free. CONTROL: DCHUB_WALL_OFFER_FLOOR_PREVIEW=0 brings the no-offer preview back.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork, GUESS_ARGS } from './helpers/claude-directory-harness.mjs';

const OFFER_ASKS = new Set(['line', 'link', 'link_exit', 'bind_field', 'digest_line']);
// Measured 2026-11-11: the anonymous hard wall does not apply to these (key, account and write
// tools a keyless caller reaches without a wall, or keyed-only tools that answer with a key error).
const NO_HARD_WALL = new Set(['save_to_shortlist', 'get_shortlist', 'set_shortlist_alert', 'suggest_reallocation',
  'set_market_alert', 'subscribe_digest', 'set_site_alert', 'register_standing_intent', 'delete_standing_intent',
  'bind_email', 'recover_my_key', 'report_finding',
  // Funnel item 1 (2026-11-11): discovery is never walled (server.mjs ANON_WALL_EXEMPT_TOOLS).
  'discover_tools']);
// Tools the plain stub walls (trial / Pro / Land & Power walls); pinned so the second pass cannot go vacuous.
const STUB_WALLS = ['list_transactions', 'compare_isos', 'get_pipeline', 'hyperscaler_deals', 'get_tax_incentives',
  'get_dchub_recommendation', 'get_grid_data', 'get_interconnection_queue', 'get_energy_prices', 'get_fiber_intel',
  'ai_capacity_index', 'rank_markets', 'compare_sites', 'generate_site_analysis', 'get_composite_site_score'];

const UA = 'dchub-qa-readonly/0.1 (QA - exclude)';
const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', capacity_mw: 100 + i, score: 50 + i }));
let H, fence, tools, anonCount = 0;
const events = [];
const CLIENT_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
net.Socket.prototype._getpeername = function _getpeername() {
  const p = _peer.call(this);
  return H && this.server && this.localPort === H.PORT && p && p.address && CLIENT_PORTS.has(p.port)
    ? { ...p, address: '203.0.113.7' } : p;
};

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_INTERNAL_KEY: 'test-internal-key', DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_ANON_DAILY_CAP: '20' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
      if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      // A plain data answer: no planted commerce, so every offer seen is one the server added.
      return { success: true, count: 12, total_count: 12, data: ROWS, results: ROWS, items: ROWS, markets: ROWS, rows: ROWS };
    },
  });
  const list = await rpc({ 'user-agent': UA }, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  tools = list.msg.result.tools.map((t) => t.name);
}, 60_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop(); if (fence) fence.restore();
});
beforeEach(() => { delete process.env.DCHUB_WALL_OFFER_FLOOR; delete process.env.DCHUB_LEAN_RESPONSES; });

// A plain node:http request (agent: false) whose socket the server sees as an outside peer.
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
const freshIp = () => `198.51.${100 + Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
async function call(name, args, hdr) {
  const before = events.length;
  const r = await rpc(hdr, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } });
  for (let i = 0; i < 12 && events.length === before; i++) await new Promise((res) => setTimeout(res, 10));
  await new Promise((res) => setTimeout(res, 30));
  const content = (r.msg && r.msg.result && r.msg.result.content) || [];
  const prose = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string' && !/^\s*[{[]/.test(b.text))
    .map((b) => b.text).join('\n');
  return { prose, rows: events.slice(before) };
}
async function session(ipAddr) {
  const hdr = { 'user-agent': UA, 'x-dc-client-ip': ipAddr };
  const init = await rpc(hdr, { jsonrpc: '2.0', id: rid++, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
  const sid = init.headers['mcp-session-id'];
  await rpc({ ...hdr, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { ...hdr, 'mcp-session-id': sid };
}
// Every call of one tool: sessionless twice, then three times in one session.
async function runTool(name, args = GUESS_ARGS) {
  const out = [];
  const sl = { 'user-agent': UA, 'x-dc-client-ip': freshIp() };
  for (const n of [1, 2]) out.push({ where: 'sessionless#' + n, ...(await call(name, args, sl)) });
  const s = await session(freshIp());
  for (const n of [1, 2, 3]) out.push({ where: 'session#' + n, ...(await call(name, args, s)) });
  return out;
}
const PROSE_OFFER = /`(?:bind_email|subscribe_digest|claim_free_key)`|dchub\.cloud\/u\//;
// The rows of one call that broke the rule, as readable strings ([] = clean).
function offenders(name, calls) {
  const bad = [];
  for (const c of calls) {
    for (const e of c.rows) {
      const offers = Array.isArray(e.offers_shown) ? e.offers_shown : [];
      if (!OFFER_ASKS.has(e.email_ask)) bad.push(`${name} ${c.where} row ${e.tool}/${e.wall_status}: email_ask ${e.email_ask || 'none'}`);
      if (!offers.includes('email_unlock') && !offers.includes('digest')) bad.push(`${name} ${c.where} row ${e.tool}/${e.wall_status}: offers ${offers.join('+') || 'none'}`);
      // Owner 2026-11-11 ("Measure allowed only"): every wall here is one the floor is allowed on, plan step rows
      // included (they leave with the plan answer's standing), so the funnel counts it in the 95% target.
      if (e.offer_floor !== 'allowed') bad.push(`${name} ${c.where} row ${e.tool}/${e.wall_status}: offer_floor ${e.offer_floor || 'absent'}`);
    }
    if (c.rows.length && !(/\bemail\b/i.test(c.prose) && PROSE_OFFER.test(c.prose))) bad.push(`${name} ${c.where}: prose names no email step`);
  }
  return bad;
}


const OFFER = /`(?:bind_email|subscribe_digest|claim_free_key)`/;
describe('a tier-masked preview carries the free offer', () => {
  it.each([
    ['get_retirement_headroom', { target_mw: 100, horizon_months: 24 }],
    ['get_refined_queue', {}],
    // Funnel 2026-11-12 ~3:37 AM: find_sites was offer_kind none on a masked preview (2 hits / 0 offers).
    ['find_sites', { state: 'TX', target_mw: 100 }],
  ])('%s: keyless preview, sessionless and repeated in one session', async (name, args) => {
    anonCount = 0;
    const calls = await runTool(name, args);
    expect(calls.length).toBe(5);
    for (const c of calls) expect(c.prose, `${name} ${c.where}`).toMatch(OFFER);
  }, 60_000);

  it('discover_tools stays keyless: no wall row, no offer line', async () => {
    for (const cap of [0, 25, 999]) {
      anonCount = cap;
      const calls = await runTool('discover_tools', {});
      for (const c of calls) { expect(c.rows, `discover_tools cap ${cap} ${c.where}`).toEqual([]); expect(c.prose).not.toMatch(OFFER); }
    }
  }, 60_000);

  it('CONTROL: with DCHUB_WALL_OFFER_FLOOR_PREVIEW=0 the masked preview has no offer again', async () => {
    process.env.DCHUB_WALL_OFFER_FLOOR_PREVIEW = '0';
    try {
      anonCount = 0;
      const calls = await runTool('get_retirement_headroom', { target_mw: 100, horizon_months: 24 });
      expect(calls.some((c) => !OFFER.test(c.prose))).toBe(true);
    } finally { delete process.env.DCHUB_WALL_OFFER_FLOOR_PREVIEW; }
  }, 60_000);
});
