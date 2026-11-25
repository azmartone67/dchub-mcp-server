// next-ask-v2-1125.test.mjs — Grok spec item 5 (Nov 24): make next steps followable. lib/next-ask-v2.mjs,
// server.mjs _nextAskV2Step, lib/next-call.mjs override. Flag DCHUB_NEXT_ASK_V2, default OFF; 50/50 holdout through
// the shared assignment (lib/monetization-experiments.mjs, test exp_next_ask_v2).
//
// Rules asserted:
//   * one follow-up per mapping, its arguments filled from the same market / ISO / state / coordinates / MW;
//   * next_call.tool is always one the caller can use (in their list AND opened by their key) and is never a key tool;
//   * never rank_markets unless the question asked for a ranking;
//   * why <= 15 words, no price / plan text;
//   * through the real handler: flag OFF and the holdout arm serve today's answer (byte-equal follow-up fields), the
//     treatment arm serves next_ask + next_call naming the same tool with the same arguments, every exposure is logged
//     in both arms, a follow is logged as next_ask_followed, and next_call.tool is in the session's own tools/list;
//   * /mcp/chatgpt and /mcp/claude: no next_ask / next_call change, tool counts 65 / 69 unchanged.
// Fixtures: Ashburn, Loudoun, Columbus OH, Charlotte only.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import * as MX from '../lib/monetization-experiments.mjs';
import * as V2 from '../lib/next-ask-v2.mjs';

const NO_PRICE = /\$|\bper month\b|\/mo\b|\b(?:pro|developer|starter|enterprise|team|plan|trial|credits?|paid|upgrade|unlock|pricing|price)\b|\/day\b|\bper day\b|\bfree\b/i;
const ALL = () => true;
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

// [label, tool, args, structuredContent, usable, expected {tool, arguments}]
const MAPPINGS = [
  ['queue -> time to power, same state and MW', 'get_interconnection_queue', { iso: 'PJM', state: 'VA', capacity_mw: 100 },
    { iso: 'PJM' }, ALL, { tool: 'get_power_availability_timeline', arguments: { state: 'VA', mw: 100 } }],
  ['DCPI rank -> queue for the market\'s ISO', 'get_market_dcpi_rank', { market_slug: 'loudoun' },
    { market_slug: 'loudoun', iso: 'PJM', verdict: 'BUILD' }, ALL, { tool: 'get_interconnection_queue', arguments: { iso: 'PJM' } }],
  ['DCPI rank, a site question -> analyze_site for the market', 'get_market_dcpi_rank',
    { market_slug: 'columbus-oh', query: 'is a 50 MW site near Columbus OH workable?', capacity_mw: 50 },
    { market_slug: 'columbus-oh', iso: 'PJM' }, ALL, { tool: 'analyze_site', arguments: { location: 'columbus-oh', capacity_mw: 50 } }],
  ['DCPI rank, no ISO -> analyze_site for the market', 'get_market_dcpi_rank', { market_slug: 'charlotte' },
    { market_slug: 'charlotte' }, ALL, { tool: 'analyze_site', arguments: { location: 'charlotte' } }],
  ['search_facilities -> grid headroom, same market', 'search_facilities', { city: 'Ashburn', state: 'VA' },
    { results: [{ name: 'A', city: 'Ashburn' }] }, ALL, { tool: 'get_grid_intelligence', arguments: { market: 'ashburn' } }],
  ['search_facilities, market from the rows', 'search_facilities', { operator: 'Equinix' },
    { results: [{ name: 'A', market: 'Loudoun' }] }, ALL, { tool: 'get_grid_intelligence', arguments: { market: 'loudoun' } }],
  ['news -> set_market_alert for the market the item mentions', 'get_news', { category: 'deals' },
    { items: [{ title: 'Campus filed', entities: { markets: ['Columbus OH'] } }] }, ALL,
    { tool: 'set_market_alert', arguments: { market: 'columbus-oh', channel: 'email' } }],
  ['changes -> set_market_alert for the mover', 'get_changes', { since: '7d' },
    { market_movers: [{ market_slug: 'charlotte', delta: 2 }] }, ALL,
    { tool: 'set_market_alert', arguments: { market: 'charlotte', channel: 'email' } }],
  ['analyze_site -> compare_sites with the next-best location', 'analyze_site', { lat: 39.04, lon: -77.49, capacity_mw: 100 },
    { overall_score: 70, alternatives: [{ name: 'Columbus OH', lat: 39.96, lon: -83.0 }] }, ALL,
    { tool: 'compare_sites', arguments: { locations: '39.04,-77.49;39.96,-83', capacity_mw: 100 } }],
];

describe('mapping (pure): one follow-up, arguments filled', () => {
  it.each(MAPPINGS)('%s', (_l, name, args, sc, usable, want) => {
    const c = V2.chooseNextCall(name, args, sc, { current: { tool: 'rank_markets', question: 'q' }, usable });
    expect(c && c.tool).toBe(want.tool);
    expect(c.arguments).toEqual(want.arguments);
    expect(words(c.why)).toBeGreaterThan(0);
    expect(words(c.why)).toBeLessThanOrEqual(V2.WHY_MAX_WORDS);
    expect(c.why, c.why).not.toMatch(NO_PRICE);
    expect(c.line, c.line).not.toMatch(NO_PRICE);
    const ask = V2.nextAskOf(c);
    const nc = V2.nextCallOf(c);
    expect(ask.tool).toBe(nc.tool);
    expect(ask.args).toEqual(nc.arguments);
    expect(Object.keys(nc).filter((k) => k !== 'needs').sort()).toEqual(['arguments', 'tool', 'why']);
  });
  it('the alert names its email need; no other mapping needs anything', () => {
    const a = V2.chooseNextCall('get_changes', {}, { market_movers: [{ market_slug: 'charlotte' }] }, { usable: ALL });
    expect(a.needs).toMatch(/email/);
    expect(a.needs).not.toMatch(NO_PRICE);
  });
});

describe('the caller can use it (pure)', () => {
  // Every mapping, against every subset of the tools it could name: the choice is always in the subset or none.
  const POOL = ['get_power_availability_timeline', 'get_interconnection_queue', 'analyze_site', 'get_grid_intelligence',
    'set_market_alert', 'compare_sites', 'execute_plan', 'rank_markets', 'get_api_key'];
  it('next_call.tool is always usable, never a key tool, never the tool that just ran', () => {
    let checked = 0;
    for (let mask = 0; mask < (1 << POOL.length); mask++) {
      const allowed = new Set(POOL.filter((_, i) => mask & (1 << i)));
      for (const [, name, args, sc] of MAPPINGS) {
        for (const current of [null, { tool: 'rank_markets', question: 'q' }, { tool: 'get_api_key', question: 'q' }]) {
          const c = V2.chooseNextCall(name, args, sc, { current, usable: (t) => allowed.has(t) });
          checked++;
          if (!c || c.drop) continue;
          expect(allowed.has(c.tool), `${name} -> ${c.tool}`).toBe(true);
          expect(V2.NEVER_SUGGEST.has(c.tool)).toBe(false);
          expect(c.tool).not.toBe(name);
          expect(c.tool, 'no ranking was asked').not.toBe('rank_markets');
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });
  it('a keyless caller (no alert, no site tools) falls back to execute_plan with the place filled', () => {
    const keyless = (t) => !['set_market_alert', 'analyze_site', 'compare_sites'].includes(t);
    const a = V2.chooseNextCall('get_news', {}, { items: [{ market_slug: 'loudoun' }] }, { usable: keyless });
    expect(a.tool).toBe('execute_plan');
    expect(a.arguments).toMatchObject({ intent: expect.stringContaining('Loudoun') });
    const b = V2.chooseNextCall('analyze_site', { lat: 39.04, lon: -77.49, state: 'VA', capacity_mw: 100 },
      { alternatives: [{ lat: 39.96, lon: -83.0 }] }, { usable: keyless });
    expect(b).toMatchObject({ tool: 'get_power_availability_timeline', arguments: { state: 'VA', mw: 100 } });
  });
  it('a queue answer with no state, on a list without time to power: execute_plan for the ISO', () => {
    const c = V2.chooseNextCall('get_interconnection_queue', { iso: 'PJM' }, {}, { usable: (t) => t !== 'get_power_availability_timeline' });
    expect(c).toMatchObject({ tool: 'execute_plan', arguments: { iso: 'PJM' } });
  });
});

describe('rank_markets only for a ranking question (pure)', () => {
  it('an unmapped tool whose suggestion is rank_markets: replaced, or dropped when nothing fits', () => {
    const cur = { tool: 'rank_markets', question: 'Which markets rank best?' };
    const a = V2.chooseNextCall('get_intelligence_index', { market: 'ashburn' }, {}, { current: cur, usable: ALL });
    expect(a.tool).toBe('execute_plan');
    expect(a.arguments.market).toBe('ashburn');
    expect(V2.chooseNextCall('get_intelligence_index', {}, {}, { current: cur, usable: ALL })).toEqual({ drop: true });
    expect(V2.chooseNextCall('execute_plan', { intent: 'power near Loudoun' }, {}, { current: cur, usable: ALL })).toEqual({ drop: true });
  });
  it('the question asked for a ranking: today\'s rank_markets stays (no change)', () => {
    const cur = { tool: 'rank_markets', question: 'q' };
    expect(V2.chooseNextCall('execute_plan', { intent: 'rank the top 5 markets for 100 MW' }, {}, { current: cur, usable: ALL })).toBeNull();
    expect(V2.askedForRanking('which markets are best for power')).toBe(true);
    expect(V2.askedForRanking('time to power in Loudoun')).toBe(false);
  });
  it('a usable, non-ranking suggestion on an unmapped tool is left alone; a key tool never is', () => {
    expect(V2.chooseNextCall('get_grid_data', { iso: 'PJM' }, {}, { current: { tool: 'get_interconnection_queue' }, usable: ALL })).toBeNull();
    const k = V2.chooseNextCall('get_grid_data', { iso: 'PJM' }, {}, { current: { tool: 'get_api_key' }, usable: ALL });
    expect(k.tool).toBe('execute_plan');
  });
});

describe('assignment', () => {
  it('exp_next_ask_v2 is a client test, flag DCHUB_NEXT_ASK_V2, default off, about 50/50', () => {
    expect(MX.CLIENT_TESTS).toContain(V2.TEST);
    expect(MX.FLAGS[V2.TEST]).toBe('DCHUB_NEXT_ASK_V2');
    expect(V2.nextAskV2On({})).toBe(false);
    expect(V2.nextAskV2On({ DCHUB_NEXT_ASK_V2: '1' })).toBe(true);
    const ids = Array.from({ length: 20000 }, (_, n) => 'ip-' + n.toString(16).padStart(64, '0'));
    const share = ids.filter((i) => MX.armFor(i, V2.TEST) === MX.TREATMENT).length / ids.length;
    expect(share).toBeGreaterThan(0.48);
    expect(share).toBeLessThan(0.52);
  });
  it('matches the backend vector (dchub-backend tests/test_monetization_experiments.py)', () => {
    expect(MX.bucketFor('pk-' + 'a'.repeat(64), V2.TEST)).toBe(MX.bucketFor('pk-' + 'a'.repeat(64), 'exp_next_ask_v2'));
    expect(MX.bucketFor('ip-' + 'b'.repeat(64), V2.TEST)).toBe(Number(BigInt('0x' + createHash('sha256')
      .update('ip-' + 'b'.repeat(64) + 'exp_next_ask_v2').digest('hex').slice(0, 16)) % 100n));
  });
});

// ── through the real handler ──────────────────────────────────────────────────────────────────────────────────────
let H, fence;
const exposures = [];
const ROWS = [{ id: 1, name: 'Row A', city: 'Ashburn', market: 'Loudoun', capacity_mw: 100 }];
const KEYS = new Set();
const routes = () => (p, _req, body) => {
  if (p === '/api/v1/mcp/experiments/exposure') { exposures.push(body); return { recorded: true }; }
  if (p === '/api/v1/keys/validate' && body && KEYS.has(body.api_key)) {
    return { valid: true, tier: 'pro', developer_id: 'dev_nav2', email: null, tier_detail: { users_plan: 'pro' } };
  }
  if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
  if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
  return { success: true, count: 1, total_count: 1, data: ROWS, results: ROWS, items: ROWS, rows: ROWS };
};
const CLIENT_PORTS = new Set();
const SERVER_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
const setFlag = (v) => { if (v === undefined) delete process.env.DCHUB_NEXT_ASK_V2; else process.env.DCHUB_NEXT_ASK_V2 = v; };
let rid = 1;
function rpc(p, body, headers = {}) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: H.PORT, path: p, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'cursor/1.0',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, msg, headers: res.headers });
      });
    });
    req.on('socket', (s) => {
      const note = () => { const lp = s.localPort; CLIENT_PORTS.add(lp); s.once('close', () => CLIENT_PORTS.delete(lp)); };
      if (s.localPort) note(); else s.once('connect', note);
    });
    req.on('error', reject);
    req.end(data);
  });
}
let ipSeq = 40;
const nextIp = () => { const ip = '198.51.' + (10 + Math.floor(ipSeq / 250)) + '.' + (ipSeq % 250 + 1); ipSeq++; return ip; };
let keySeq = 0;
function keyIn(arm) {
  for (;;) {
    const k = 'dch_live_navtwo' + String(keySeq++).padStart(20, '0');
    if (MX.armFor(MX.keyRef(k), V2.TEST) === arm) { KEYS.add(k); return k; }
  }
}
async function session(key, path = '/mcp', client = 'claude-ai', ip = nextIp()) {
  const h = { 'x-dc-client-ip': ip, ...(key ? { 'x-api-key': key } : {}) };
  const init = await rpc(path, { jsonrpc: '2.0', id: rid++, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1.0' } } }, h);
  const sid = init.headers['mcp-session-id'];
  if (sid) { h['mcp-session-id'] = sid; await rpc(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, h); }
  return {
    sid,
    async call(name, args = {}) {
      const r = await rpc(path, { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name, arguments: args } }, h);
      await new Promise((res) => setTimeout(res, 120));
      const result = (r.msg && r.msg.result) || {};
      return { result, sc: result.structuredContent || {} };
    },
    async list() {
      const r = await rpc(path, { jsonrpc: '2.0', id: rid++, method: 'tools/list', params: {} }, h);
      return ((r.msg && r.msg.result) || {}).tools || [];
    },
  };
}
// The follow-up fields an agent reads (structuredContent and block 0's JSON).
function followFields(r) {
  const b0 = ((r.result.content || [])[0] || {}).text || '';
  let j = null; try { j = JSON.parse(b0.slice(b0.indexOf('{'))); } catch (_) { j = null; }
  return JSON.stringify({ ask: r.sc.next_ask || null, call: r.sc.next_call || null,
    b0ask: (j && j.next_ask) || null, b0call: (j && j.next_call) || null });
}

describe('through the handler', () => {
  beforeAll(async () => {
    net.Socket.prototype._getpeername = function _getpeername() {
      const p = _peer.call(this);
      if (this.server && SERVER_PORTS.has(this.localPort) && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.31' };
      return p;
    };
    fence = fenceNetwork();
    setFlag(undefined);
    H = await startHarness({ env: { DCHUB_INTERNAL_KEY: 'test-internal' }, extraRoutes: routes() });
    SERVER_PORTS.add(H.PORT);
  }, 180_000);
  afterAll(async () => {
    net.Socket.prototype._getpeername = _peer;
    if (H) await H.stop();
    if (fence) fence.restore();
    setFlag(undefined);
  });
  afterEach(() => { setFlag(undefined); exposures.length = 0; });

  const CALL = ['search_facilities', { city: 'Ashburn', state: 'VA' }];

  it('flag OFF: no exposure; the holdout arm serves exactly the flag-off follow-up', async () => {
    const hold = keyIn(MX.HOLDOUT);
    const off = await (await session(hold)).call(...CALL);
    expect(exposures.filter((e) => e.test === V2.TEST)).toHaveLength(0);
    setFlag('1');
    const on = await (await session(hold)).call(...CALL);
    expect(on.sc.next_ask).toBeTruthy();
    expect(followFields(on)).toBe(followFields(off));
    const ex = exposures.filter((e) => e.test === V2.TEST);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ event: 'exposure', arm: MX.HOLDOUT, tool: 'search_facilities', identity: MX.keyRef(hold) });
  }, 90_000);

  it('treatment: next_ask and next_call name the same listed tool with the same filled arguments', async () => {
    setFlag('1');
    const s = await session(keyIn(MX.TREATMENT));
    const listed = new Set((await s.list()).map((t) => t.name));
    const r = await s.call(...CALL);
    expect(r.sc.next_call).toMatchObject({ tool: 'get_grid_intelligence', arguments: { market: 'ashburn' } });
    expect(r.sc.next_ask).toMatchObject({ tool: 'get_grid_intelligence', args: { market: 'ashburn' } });
    expect(words(r.sc.next_call.why)).toBeLessThanOrEqual(15);
    expect(r.sc.next_call.why).not.toMatch(NO_PRICE);
    expect(r.sc.next_ask.question).not.toMatch(NO_PRICE);
    expect(listed.has(r.sc.next_call.tool)).toBe(true);
    expect(JSON.stringify(r.sc.next_call)).not.toContain('rank_markets');
    expect(exposures.filter((e) => e.test === V2.TEST && e.arm === MX.TREATMENT)).toHaveLength(1);
  }, 90_000);

  it('treatment: taking the suggestion is logged as next_ask_followed', async () => {
    setFlag('1');
    const s = await session(keyIn(MX.TREATMENT));
    const r = await s.call(...CALL);
    await s.call(r.sc.next_call.tool, r.sc.next_call.arguments);
    await new Promise((res) => setTimeout(res, 200));
    expect(exposures.filter((e) => e.test === V2.TEST).map((e) => e.event)).toEqual(expect.arrayContaining(['exposure', 'next_ask_followed']));
  }, 90_000);

  it('keyless: a relay wall keeps its own follow-up; no exposure, nothing changed (walls are out of scope)', async () => {
    const { capWallIdentity } = await import('../lib/keyless-wall.mjs');
    let ip;
    do { ip = nextIp(); } while (MX.armFor(capWallIdentity({ client_ip: ip }), V2.TEST) !== MX.TREATMENT);
    const off = await (await session(null, '/mcp', 'claude-ai', ip)).call('search_facilities', { city: 'Ashburn', state: 'VA' });
    setFlag('1');
    const on = await (await session(null, '/mcp', 'claude-ai', ip)).call('search_facilities', { city: 'Ashburn', state: 'VA' });
    expect(on.sc.human_url).toBeTruthy();
    expect(followFields(on)).toBe(followFields(off));
    expect(exposures.filter((e) => e.test === V2.TEST)).toHaveLength(0);
  }, 90_000);

  it('a light (coding CLI) list: the follow-up is a tool on that list (time to power is not, so execute_plan)', async () => {
    setFlag('1');
    const s = await session(keyIn(MX.TREATMENT), '/mcp', 'claude-code');
    const listed = new Set((await s.list()).map((t) => t.name));
    expect(listed.has('get_power_availability_timeline'), 'the light list').toBe(false);
    const r = await s.call('get_interconnection_queue', { iso: 'PJM', state: 'VA', capacity_mw: 100 });
    expect(exposures.filter((e) => e.test === V2.TEST).map((e) => e.arm), JSON.stringify(r.sc).slice(0, 300)).toEqual([MX.TREATMENT]);
    // The SDK drops arguments a tool does not declare (the queue takes iso only), so the place is the ISO.
    expect(r.sc.next_call).toMatchObject({ tool: 'execute_plan', arguments: { iso: 'PJM', intent: expect.stringContaining('PJM') } });
    expect(listed.has(r.sc.next_call.tool)).toBe(true);
    expect(r.sc.next_ask.tool).toBe('execute_plan');
    // get_changes names Loudoun: the full list gets set_market_alert; the light list does not carry it, so execute_plan.
    expect(listed.has('set_market_alert'), 'the light list').toBe(false);
    const light = await s.call('get_changes', { since: '7d' });
    expect(light.sc.next_call).toMatchObject({ tool: 'execute_plan', arguments: { market: 'loudoun' } });
    const full = await (await session(keyIn(MX.TREATMENT))).call('get_changes', { since: '7d' });
    expect(full.sc.next_call).toMatchObject({ tool: 'set_market_alert', arguments: { market: 'loudoun', channel: 'email' } });
  }, 90_000);

  for (const [path, count] of [['/mcp/chatgpt', 65], ['/mcp/claude', 69]]) {
    it(`${path}: tool count ${count} and the answer unchanged with the flag on`, async () => {
      const key = keyIn(MX.TREATMENT);
      const a = await session(key, path);
      const offNames = (await a.list()).map((t) => t.name);
      setFlag('1');
      const b = await session(key, path);
      const onNames = (await b.list()).map((t) => t.name);
      expect(offNames.length).toBe(count);
      expect(onNames).toEqual(offNames);
      const pick = onNames.includes('search') ? ['search', { query: 'Ashburn' }] : [onNames[0], {}];
      const r = await b.call(...pick);
      expect(r.sc.next_ask).toBeUndefined();
      expect(JSON.stringify(r.sc.next_call || null)).not.toContain('"arguments":{"market"');
      expect(exposures.filter((e) => e.test === V2.TEST)).toHaveLength(0);
    }, 90_000);
  }
});
