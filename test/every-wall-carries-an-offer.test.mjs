// Every wall carries an offer (owner 2026-11-11, item 2; lib/wall-offer-floor.mjs).
//
// Funnel 7d to 11-11: 397 walls, 210 with any offer (52.9%). Measured on main the same day with this
// harness (real /mcp handler, lean ON, a non-loopback peer so no call reads as an execute_plan step):
// the second and third wall of a depth tool in a session offered "pro" only; compare_sites,
// generate_site_analysis and get_composite_site_score asked for nothing; every anonymous hard wall
// asked for nothing; a plan whose walled steps were depth steps asked for nothing.
//
// The rule asserted on EVERY wall row the server posts (quota_wall_hit) and on the text the agent got:
//   - email_ask is an offer the backend counts (hits_with_any_offer): an unlock ask or digest_line;
//   - offers_shown names email_unlock or digest;
//   - the prose (not block 0's JSON) names the email step: bind_email / claim_free_key / subscribe_digest
//     or the email link.
// Coverage: every tool in tools/list must wall on the anonymous hard wall unless it is listed in
// NO_HARD_WALL below (and a listed tool that walls fails too, so the list cannot rot). Then every
// tool runs again against the plain stub (the trial / Pro / Land & Power walls), and two plans run
// whose steps wall. Each tool: sessionless twice, in one session three times (the ask-once memo).
// CONTROL: DCHUB_WALL_OFFER_FLOOR=0 brings back walls with no offer, so the assertion can fail.
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
    env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_ANON_DAILY_CAP: '20' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
      if (p === '/api/v1/mcp/anon-usage') return { count: anonCount };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      // A plain data answer: no planted commerce, so every offer seen is one the server added.
      return { success: true, count: 12, total_count: 12, data: ROWS, results: ROWS, items: ROWS, markets: ROWS, rows: ROWS };
    },
  });
  const list = await rpc({ 'user-agent': 'node' }, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
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
  const hdr = { 'user-agent': 'node', 'x-dc-client-ip': ipAddr };
  const init = await rpc(hdr, { jsonrpc: '2.0', id: rid++, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
  const sid = init.headers['mcp-session-id'];
  await rpc({ ...hdr, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { ...hdr, 'mcp-session-id': sid };
}
// Every call of one tool: sessionless twice, then three times in one session.
async function runTool(name, args = GUESS_ARGS) {
  const out = [];
  const sl = { 'user-agent': 'node', 'x-dc-client-ip': freshIp() };
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

describe('every wall carries an offer (lean ON)', () => {
  it('the anonymous hard wall: every tool that walls carries one, and every tool but NO_HARD_WALL walls', async () => {
    anonCount = 999;
    const bad = [], walled = new Set();
    for (const name of tools) {
      const calls = await runTool(name);
      if (calls.some((c) => c.rows.some((e) => e.tool === name))) walled.add(name);
      bad.push(...offenders(name, calls));
    }
    expect(bad).toEqual([]);
    expect(tools.filter((t) => !walled.has(t) && !NO_HARD_WALL.has(t)), 'tools that did not wall').toEqual([]);
    expect([...NO_HARD_WALL].filter((t) => walled.has(t)), 'NO_HARD_WALL tools that walled').toEqual([]);
    expect(walled.size).toBeGreaterThan(70);
  }, 600_000);

  // Funnel items 1-2 (2026-11-11): the anonymous SOFT cap (count 25 of 20, under the hard wall) is its own
  // wall (anon_daily_cap, after the handler). The live no-offer rows for get_refined_queue, find_sites and
  // get_retirement_headroom (keyless, sessionless, identities 0) were execute_plan steps at this cap.
  it('the anonymous soft cap: every tool that walls carries one', async () => {
    anonCount = 25;
    const bad = [], walled = new Set();
    for (const name of tools) {
      const calls = await runTool(name);
      for (const c of calls) for (const e of c.rows) if (e.wall_status === 'anon_daily_cap') walled.add(e.tool);
      bad.push(...offenders(name, calls));
    }
    expect(bad).toEqual([]);
    expect(walled.size, 'soft-cap walls seen').toBeGreaterThan(40);
    expect(walled.has('discover_tools'), 'discovery is never walled').toBe(false);
  }, 600_000);

  it.each([
    ['find sites for a 100 MW campus in Texas', ['find_sites', 'get_refined_queue', 'get_retirement_headroom']],
    ['timeline for power in Nevada', ['get_refined_queue']],
  ])('execute_plan at the soft cap (%s): the step walls the funnel showed with no offer now carry one', async (intent, steps) => {
    anonCount = 25;
    const calls = await runTool('execute_plan', { intent });
    const stepRows = new Set(calls.flatMap((c) => c.rows.map((e) => e.tool)));
    expect(steps.filter((t) => !stepRows.has(t)), 'pinned step walls that did not wall').toEqual([]);
    expect(offenders('execute_plan', calls)).toEqual([]);
  }, 120_000);

  it('the trial / Pro / Land & Power walls: every tool, every repeat', async () => {
    anonCount = 0;
    const bad = [], walled = new Set();
    for (const name of tools) {
      const calls = await runTool(name);
      for (const c of calls) for (const e of c.rows) walled.add(e.tool);
      bad.push(...offenders(name, calls));
    }
    expect(bad).toEqual([]);
    expect(STUB_WALLS.filter((t) => !walled.has(t)), 'pinned walls that did not wall').toEqual([]);
  }, 600_000);

  it.each([
    ['depth steps', 'list recent data center M&A transactions and hyperscaler deals', /Steps whose held-back fields an email does not open: step \d \((?:hyperscaler_deals|list_transactions)\), step \d/],
    ['grid / queue steps', 'compare PJM vs ERCOT grid headroom and interconnection queue', /Steps that came back as a preview: step \d \(get_interconnection_queue\)/],
  ])('execute_plan whose %s wall: the plan answer offers, and each step row says so', async (_l, intent, line) => {
    anonCount = 0;
    const calls = await runTool('execute_plan', { intent });
    expect(calls.every((c) => c.rows.length > 0), 'every plan run walled a step').toBe(true);
    expect(offenders('execute_plan', calls)).toEqual([]);
    for (const c of calls) expect(c.prose, c.where).toMatch(line);
  }, 120_000);

  it('CONTROL: with the floor off (DCHUB_WALL_OFFER_FLOOR=0) walls with no offer come back', async () => {
    process.env.DCHUB_WALL_OFFER_FLOOR = '0';
    anonCount = 0;
    const bad = [];
    for (const name of ['compare_sites', 'list_transactions']) bad.push(...offenders(name, await runTool(name)));
    anonCount = 999;
    bad.push(...offenders('compare_isos', await runTool('compare_isos')));
    expect(bad.some((b) => /^compare_sites .*email_ask none/.test(b))).toBe(true);
    expect(bad.some((b) => /^list_transactions session#2 .*email_ask none/.test(b))).toBe(true);
    expect(bad.some((b) => /^compare_isos .*anon_hard_wall: email_ask none/.test(b))).toBe(true);
  }, 120_000);
});
