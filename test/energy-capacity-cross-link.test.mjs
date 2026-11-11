// Energy first + the grid <-> capacity cross-link + honest capacity counts (owner 2026-11-11, items 3 and 4).
//
//   - The handshake leads with energy and time to power, and names the Data Center Gas Index (DCGI);
//     execute_plan's intent examples lead with energy questions.
//   - A grid or queue answer (_GRID_CROSS_TOOLS) carries the capacity_source block for its ISO / state
//     (the capacity handoff item-1 bridge, lib/capacity-source-summary buildCapacitySourceBlock), one
//     text line, and next_call source_capacity, unless a wall's own ask names the next tool.
//   - A source_capacity answer carries the grid check for its place (get_power_availability_timeline,
//     get_grid_intelligence), says how many listings matched ("Only N ... so far" under LISTING_FEW),
//     never reads zero as "no capacity exists", and offers request_capacity_intro for that market as a
//     step the person approves (nothing is sent by DC Hub).
// Real /mcp handler, lean ON, a non-loopback peer (a loopback peer reads as an execute_plan step, which
// gets no next_call). CONTROL: the grid tool taken out of the pointer set loses the block.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { OUTREACH_LEAD } from '../lib/agent-outreach.mjs';
import { CAPACITY_ZERO_NOTE } from '../lib/capacity-source-summary.mjs';

const market = (name, state, count, mw) => ({ market: name, state, country: 'US', count, mw, delivery_types: ['powered_shell'] });
const DORMANT = { ok: true, program_status: 'upcoming', live_count: 0, total_mw: null, latest_updated_at: null,
  generated_at: '2026-11-11T00:00:00+00:00', markets: [], delivery_types: {} };
const LIVE = { ok: true, program_status: 'live', live_count: 2, total_mw: 80, latest_updated_at: '2026-11-10T00:00:00+00:00',
  generated_at: '2026-11-11T00:00:00+00:00', markets: [market('Dallas', 'TX', 2, 80)], delivery_types: { powered_shell: 2 } };
const card = (i, state = 'TX') => ({ id: 900 + i, slug: 'dfw-shell-' + i, title: 'Powered shell ' + i, market: 'Dallas', state,
  country: 'US', region: 'north_america', delivery_type: 'powered_shell', capacity_kw: 20000, locked: true });
const browse = (n) => ({ ok: true, program: { status: n ? 'live' : 'upcoming' }, count: n, items: Array.from({ length: n }, (_, i) => card(i)),
  filters: { market: 'Dallas', state: 'TX', min_mw: 40 } });

let H, fence, S, listings = browse(0);
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
    env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0' },
    extraRoutes: (p) => {
      if (p === '/api/v1/listings') return listings;
      if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      return undefined;
    },
  });
  S = H.S;
}, 60_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (S) S._capacitySummary.reset();
  if (H) await H.stop(); if (fence) fence.restore();
});
beforeEach(() => { delete process.env.DCHUB_LEAN_RESPONSES; S._capacitySummary.seed(DORMANT); listings = browse(0); });

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
        resolve(msg);
      });
    });
    req.on('socket', (sock) => { const note = () => CLIENT_PORTS.add(sock.localPort); if (sock.localPort) note(); else sock.once('connect', note); });
    req.on('error', reject);
    req.end(data);
  });
}
let ip = 1, rid = 1;
async function call(name, args, { key } = {}) {
  const hdr = { 'user-agent': 'node', 'x-dc-client-ip': '198.51.77.' + (ip++ % 250 + 1), ...(key ? { 'x-api-key': key } : {}) };
  const msg = await rpc(hdr, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } });
  const r = (msg && msg.result) || {};
  const blocks = (r.content || []).filter((b) => b && b.type === 'text').map((b) => b.text);
  let head = {}; try { head = JSON.parse(blocks[0]); } catch (_) { /* prose first */ }
  const sc = r.structuredContent || head;
  const cap = (sc && sc.capacity_source) || (r._meta && r._meta['cloud.dchub/capacity_source']) || null;
  return { r, sc, head, cap, text: blocks.slice(1).join('\n'), nextCall: (sc && sc.next_call) || head.next_call || null };
}

describe('the handshake and execute_plan lead with energy', () => {
  it('instructions open with grid headroom, queues and the Data Center Gas Index; execute_plan examples open with time to power', async () => {
    const init = await rpc({ 'user-agent': 'node' }, { jsonrpc: '2.0', id: rid++, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
    const ins = init.result.instructions;
    expect(ins.startsWith(OUTREACH_LEAD)).toBe(true);
    const head = ins.slice(0, 260);
    expect(head).toMatch(/power: grid headroom, interconnection queues, energy and gas prices \(Data Center Gas Index, DCGI\), facilities/);
    expect(head.indexOf('grid headroom')).toBeLessThan(head.indexOf('facilities'));
    const list = await rpc({ 'user-agent': 'node' }, { jsonrpc: '2.0', id: rid++, method: 'tools/list' });
    const ep = list.result.tools.find((t) => t.name === 'execute_plan');
    expect(ep.inputSchema.properties.intent.description).toMatch(/Examples: "how soon can a 100 MW load get power in ERCOT"/);
    expect(ep.description).toMatch(/one-call planner over grid headroom and power availability, interconnection queues, PPAs and energy pricing, power generation, gas and energy infrastructure \(the Data Center Gas Index, DCGI\)/);
  }, 30_000);
});

describe('grid / queue answers name source_capacity for that place', () => {
  it.each([
    ['get_grid_intelligence', { region_id: 'ERCOT' }, { state: 'TX' }],
    ['get_power_availability_timeline', { state: 'TX', mw: 100 }, { state: 'TX', min_mw: 100 }],
    ['get_interconnection_queue', { iso: 'ERCOT' }, { state: 'TX' }],
    ['get_refined_queue', { iso: 'ERCOT' }, { state: 'TX' }],
    ['get_grid_data', { iso: 'PJM' }, null],
    ['compare_isos', { isos: 'PJM,ERCOT' }, null],
  ])('%s (dormant inventory): the block, the zero line, next_call source_capacity', async (tool, args, browseArgs) => {
    const { cap, text, nextCall, sc } = await call(tool, args, { key: PRO_KEY });
    expect(cap, tool + ' capacity_source').toBeTruthy();
    expect(cap.live_listings_matching).toBe(0);
    expect(cap.browse_call.tool).toBe('source_capacity');
    if (browseArgs) expect(cap.browse_call.arguments).toEqual(browseArgs);
    else expect(cap.browse_call.arguments.location).toMatch(/\bVA\b/);   // PJM spans states: the location filter
    expect(cap.register_call.tool).toBe('request_capacity_intro');
    expect(cap.note).toBe(CAPACITY_ZERO_NOTE);
    expect(text).toMatch(/Capacity Source: no live listing matches this request yet \(providers are onboarding; this does not mean the market has no capacity\)/);
    // A relay wall's free next answer is the wall's own ask and keeps next_call; otherwise the inventory.
    if (sc.next_ask && sc.next_ask.free === true) expect(nextCall.tool).toBe(sc.next_ask.tool);
    else expect(nextCall).toMatchObject({ tool: 'source_capacity', arguments: cap.browse_call.arguments });
  }, 30_000);

  it('an unwalled grid answer whose plain next_ask suggests another tool: next_call is still source_capacity', async () => {
    const { sc, nextCall } = await call('get_grid_intelligence', { region_id: 'ERCOT' }, { key: PRO_KEY });
    expect(sc.next_ask && sc.next_ask.free).not.toBe(true);
    expect(sc.next_ask && sc.next_ask.tool).toBe('rank_markets');
    expect(nextCall).toMatchObject({ tool: 'source_capacity', arguments: { state: 'TX' },
      why: 'this answer names a grid: browse listed capacity in the same place' });
  }, 30_000);

  it('live inventory in that state: the count line, and the browse call names the market', async () => {
    S._capacitySummary.seed(LIVE);
    const { cap, text, nextCall } = await call('get_grid_intelligence', { region_id: 'ERCOT' }, { key: PRO_KEY });
    expect(cap.live_listings_matching).toBe(2);
    expect(text).toContain('Capacity Source: 2 live listings, 80 MW, in Dallas (TX) match this request.');
    expect(nextCall).toMatchObject({ tool: 'source_capacity', arguments: { market: 'Dallas', state: 'TX' } });
  }, 30_000);

  it('a grid code that is not an RTO (a balancing authority) gets no block', async () => {
    const { cap } = await call('get_grid_data', { iso: 'AZPS' }, { key: PRO_KEY });
    expect(cap).toBeNull();
  }, 30_000);

  it('a walled grid answer keeps the block, and the wall\'s own ask is the next_call', async () => {
    const { cap, nextCall, text } = await call('get_grid_data', { iso: 'ERCOT' });
    expect(cap && cap.browse_call.arguments).toEqual({ state: 'TX' });
    expect(nextCall && nextCall.tool).not.toBe('source_capacity');
    expect(text).toMatch(/email/i);
  }, 30_000);

  it('CONTROL: out of the pointer set, the same call carries no block (the assertions above can fail)', async () => {
    S._CAPACITY_POINTER_TOOLS.delete('get_grid_intelligence');
    try {
      const { cap, nextCall } = await call('get_grid_intelligence', { region_id: 'ERCOT' }, { key: PRO_KEY });
      expect(cap).toBeNull();
      expect(nextCall && nextCall.tool).not.toBe('source_capacity');
    } finally { S._CAPACITY_POINTER_TOOLS.add('get_grid_intelligence'); }
  }, 30_000);
});

describe('source_capacity: honest counts, a person-approved register call, the grid check', () => {
  const ARGS = { market: 'Dallas', state: 'TX', min_mw: 40 };
  it('no listing: "no live listing matches yet", never "no capacity", and the register call for that market', async () => {
    const { head, text } = await call('source_capacity', ARGS);
    expect(text.split('\n')[0]).toBe(S.LISTING_NO_MATCH_LINE);
    expect(S.LISTING_NO_MATCH_LINE).toBe(CAPACITY_ZERO_NOTE);
    expect(S.LISTING_NO_MATCH_LINE).toMatch(/^No live listing matches yet\. .*does not mean the market has no capacity/);
    expect(head.listings_matching).toBe(0);
    expect(head.register_call).toEqual({ tool: 'request_capacity_intro', arguments: { markets: 'Dallas', states: 'TX', capacity_mw: 40 },
      needs_human_approval: true, why: expect.stringMatching(/only after your human approves/) });
    expect(text).toContain('Next, only once your human approves (with their name, company and agreement to the introduction terms): '
      + 'request_capacity_intro without a slug, with markets="Dallas" states="TX" capacity_mw=40, registers this requirement');
    expect(head.grid_check.calls).toEqual([{ tool: 'get_power_availability_timeline', arguments: { state: 'TX', mw: 40 } },
      { tool: 'get_grid_intelligence', arguments: { region_id: 'ERCOT' } }]);
    expect(text).toContain('Grid check for this location (time to power): `get_power_availability_timeline state="TX" mw=40` · `get_grid_intelligence region_id="ERCOT"`.');
    expect(text).not.toMatch(/no (?:data center )?capacity (?:exists|is available)|there is no capacity/i);
  }, 30_000);

  it('one listing: "Only 1 listing matches this search so far", and the register call still rides', async () => {
    listings = browse(1);
    const { head, text } = await call('source_capacity', ARGS);
    expect(text.split('\n')[0]).toBe('Only 1 listing matches this search so far (Capacity Source is onboarding providers).');
    expect(head.listings_matching).toBe(1);
    expect(head.register_call && head.register_call.needs_human_approval).toBe(true);
  }, 30_000);

  it('enough listings: the plain count, no register call, the grid check still there', async () => {
    listings = browse(4);
    const { head, text } = await call('source_capacity', ARGS);
    expect(text.split('\n')[0]).toBe('4 listings match this search.');
    expect(head.register_call).toBeUndefined();
    expect(head.grid_check.calls[0].tool).toBe('get_power_availability_timeline');
  }, 30_000);
});
