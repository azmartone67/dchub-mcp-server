// next-ask-args.test.mjs — next_ask carries filled args (owner 2026-11-18, "lets do 1-6", item 2) and a keyed site
// answer offers save_site (item 3). lib/agent-outreach.mjs.
//
// Pure: each follow-up's args come from the call that just ran, under the suggested tool's own argument names; the
// question text stays; no visible line. Then the real /mcp handler over HTTP against a stub backend, no network:
// every arg name is checked against the served tools/list inputSchema, the keyed / keyless site split, the kill
// switches, and the follow-through telemetry row (_via_next_ask, _via_next_ask_args).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { nextAskFor, watchAskFor, watchSiteAskFor, WATCH_SITE_ASK_TOOLS, nextAskArgsOn, watchSiteAskOn,
  nextAskArgsMatch, noteNextAsk, paramsForTrack, _resetOutreachForTest, NEXT_ASK_SHOWN_FIELD, nextAskShownLogOn,
  servedNextAskTo, withNextAskShown, holdTrackRow, flushTrackRows } from '../lib/agent-outreach.mjs';

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const FORBIDDEN = /\b(paid|upgrade|trial|plans?|pricing|price|\$\s?\d|per month|subscription|free|credits?|calls? a day|answers? a day|per day|Pro|Developer|Enterprise|unlock|only|first)\b/i;

// The calls the unit tests make, and what each follow-up must carry.
const CASES = [
  ['get_market_intel', { market: 'Northern Virginia' }, false, { tool: 'set_market_alert' }],   // the market watch wins
  ['get_market_dcpi_rank', {}, false, { tool: 'rank_markets', args: { criteria: 'ai_ready' } }],
  // get_interconnection_queue takes iso only, and a state does not name one ISO: no args.
  ['get_power_availability_timeline', { state: 'va', years: 3 }, false, { tool: 'get_interconnection_queue', noArgs: true }],
  ['get_interconnection_queue', { iso: 'PJM', state: 'VA' }, false, { tool: 'get_energy_prices', args: { iso: 'PJM' } }],
  ['get_interconnection_queue', { iso: 'PJM,ERCOT', state: 'TX' }, false, { tool: 'get_energy_prices', args: { state: 'TX' } }],
  ['get_grid_data', { iso: 'pjm' }, false, { tool: 'get_interconnection_queue', args: { iso: 'PJM' } }],
  ['get_grid_intelligence', { region_id: 'ISO-NE' }, false, { tool: 'get_interconnection_queue', args: { iso: 'ISONE' } }],
  ['get_grid_intelligence', { region_id: 'PJM', state: 'OH' }, false, { tool: 'get_power_availability_timeline', args: { state: 'OH' } }],
  ['get_grid_data', { iso: 'NGESO' }, false, { tool: 'rank_markets', args: { criteria: 'ai_ready' } }],
  ['get_energy_prices', { iso: 'ERCOT' }, false, { tool: 'rank_markets', args: { criteria: 'cheapest_power' } }],
  ['analyze_site', { lat: 33.45, lon: -112.07, capacity_mw: 100 }, false,
    { tool: 'compare_sites', args: { locations: '33.45,-112.07', capacity_mw: 100 } }],
  ['analyze_site', { lat: 33.45, lon: -112.07, capacity_mw: 100, state: 'az' }, true,
    { tool: 'save_site', args: { lat: 33.45, lon: -112.07, state: 'AZ', target_mw: 100 } }],
  ['get_composite_site_score', { lat: 39.04, lng: -77.48 }, true, { tool: 'save_site', args: { lat: 39.04, lon: -77.48 } }],
  ['get_composite_site_score', { lat: 39.04, lon: -77.48, state: 'VA' }, false,
    { tool: 'execute_plan', args: { state: 'VA', lat: 39.04, lon: -77.48 } }],
  ['source_capacity', { market: 'Dallas', state: 'TX', min_mw: 20 }, false,
    { tool: 'request_capacity_intro', args: { capacity_mw: 20, markets: 'Dallas', states: 'TX' } }],
  ['get_water_risk', { lat: 33.4, lon: -112.1 }, false, { tool: 'execute_plan', args: { lat: 33.4, lon: -112.1 } }],
];

afterEach(() => {
  delete process.env.DCHUB_NEXT_ASK_ARGS;
  delete process.env.DCHUB_WATCH_SITE_NEXT_ASK;
  delete process.env.DCHUB_WATCH_NEXT_ASK;
  delete process.env.DCHUB_NEXT_ASK_SHOWN_LOG;
});

describe('next_ask args (pure)', () => {
  it.each(CASES.map((c, i) => [i, ...c]))('#%s %s', (_i, name, args, keyed, want) => {
    const a = nextAskFor(name, args, { keyed });
    expect(a.tool).toBe(want.tool);
    if (want.args) expect(a.args).toEqual(want.args);
    if (want.noArgs) expect(a.args).toBeUndefined();
    expect(typeof a.question).toBe('string');
    expect(a.question, a.question).not.toMatch(FORBIDDEN);
    if (a.needs) expect(a.needs, a.needs).not.toMatch(FORBIDDEN);
  });
  it('the question text of the existing follow-ups is kept', () => {
    expect(nextAskFor('get_energy_prices', {}).question).toBe('Which markets have the lowest power cost for a large data-center load?');
    expect(nextAskFor('get_power_availability_timeline', { state: 'VA' }).question)
      .toBe('How congested is the interconnection queue on the grid that serves this state?');
    expect(nextAskFor('analyze_site', { lat: 1, lon: 2 }).question).toBe('Want to compare this site side by side with an alternative location?');
    expect(nextAskFor('get_grid_data', {}).question).toBe('Which data-center markets on this grid rank best for available power?');
  });
  it('nothing pinned, no args key; never the tool that just ran', () => {
    for (const t of ['rank_markets', 'get_grid_scoreboard', 'get_fiber_intel', 'search_facilities', 'get_power_availability_timeline']) {
      const a = nextAskFor(t, {});
      expect(a.tool).not.toBe(t);
      expect(a.args, t).toBeUndefined();
    }
    expect(nextAskFor('execute_plan', { market: 'dallas' }).tool).toBe('rank_markets');
    expect(nextAskFor('get_interconnection_queue', { iso: 'PJM' }).tool).not.toBe('get_interconnection_queue');
  });
  it('ambiguous values are not filled: a comma list, a state name, out-of-range coordinates', () => {
    expect(nextAskFor('get_interconnection_queue', { state: 'Virginia' }).args).toBeUndefined();
    expect(nextAskFor('get_interconnection_queue', { iso: 'PJM,MISO' }).args).toBeUndefined();
    expect(nextAskFor('analyze_site', { lat: 95, lon: 10 }).args).toBeUndefined();
  });
  it('kill switch DCHUB_NEXT_ASK_ARGS=0: tool + question only (the watch asks keep their own args)', () => {
    process.env.DCHUB_NEXT_ASK_ARGS = '0';
    expect(nextAskArgsOn()).toBe(false);
    for (const [name, args, keyed] of CASES) {
      const a = nextAskFor(name, args, { keyed });
      if (a.tool === 'set_market_alert' || a.tool === 'save_site') { expect(a.args).toBeTruthy(); continue; }
      expect(Object.keys(a).sort(), name).toEqual(['question', 'tool']);
    }
  });
});

describe('site watch: save_site for keyed callers (pure)', () => {
  it('keyed, with coordinates, on the two site tools', () => {
    expect([...WATCH_SITE_ASK_TOOLS]).toEqual(['analyze_site', 'get_composite_site_score']);
    const w = watchSiteAskFor('analyze_site', { lat: 33.45, lon: -112.07 }, { keyed: true });
    expect(w).toEqual({ tool: 'save_site', args: { lat: 33.45, lon: -112.07 },
      question: 'Want this site kept on your key, so a later session can see what changed around it?' });
    expect(w.question).not.toMatch(FORBIDDEN);
  });
  it('keyless, no coordinates, another tool or a kill switch: none (the keyless follow-up is unchanged)', () => {
    expect(watchSiteAskFor('analyze_site', { lat: 33.45, lon: -112.07 }, { keyed: false })).toBeNull();
    expect(nextAskFor('analyze_site', { lat: 33.45, lon: -112.07 }).tool).toBe('compare_sites');
    expect(watchSiteAskFor('analyze_site', { location: 'phoenix' }, { keyed: true })).toBeNull();
    expect(watchSiteAskFor('get_water_risk', { lat: 1, lon: 2 }, { keyed: true })).toBeNull();
    process.env.DCHUB_WATCH_SITE_NEXT_ASK = 'off';
    expect(watchSiteAskOn()).toBe(false);
    expect(watchSiteAskFor('analyze_site', { lat: 33.45, lon: -112.07 }, { keyed: true })).toBeNull();
    delete process.env.DCHUB_WATCH_SITE_NEXT_ASK;
    process.env.DCHUB_WATCH_NEXT_ASK = '0';
    expect(watchSiteAskFor('analyze_site', { lat: 33.45, lon: -112.07 }, { keyed: true })).toBeNull();
  });
  it('the market watch is unchanged', () => {
    expect(watchAskFor('get_market_intel', { market: 'phoenix' })).toEqual({ tool: 'set_market_alert',
      question: "Want an email when Phoenix's power verdict or scores change? Tell me your email and I'll set it up.",
      args: { market: 'phoenix', channel: 'email' }, needs: 'an email your human types here, passed as email (never guess one)' });
    expect(watchAskFor('get_market_intel', { market: 'phoenix' }, { keyed: true }).tool).toBe('set_market_alert');
  });
});

describe('follow-through telemetry (pure)', () => {
  it('_via_next_ask names the tool the suggestion came from; _via_next_ask_args says if its args were used', () => {
    _resetOutreachForTest();
    noteNextAsk('s1', 'get_grid_data', 'get_interconnection_queue', Date.now(), { iso: 'PJM' });
    expect(paramsForTrack({ iso: 'pjm' }, 's1', 'get_interconnection_queue'))
      .toEqual({ iso: 'pjm', _via_next_ask: 'get_grid_data', _via_next_ask_args: 'all' });
    noteNextAsk('s2', 'analyze_site', 'compare_sites', Date.now(), { locations: '1,2', capacity_mw: 50 });
    expect(paramsForTrack({ locations: '1,2;3,4' }, 's2', 'compare_sites')._via_next_ask_args).toBe('none');
    expect(paramsForTrack({ locations: '1,2', capacity_mw: 80 }, 's2', 'compare_sites')._via_next_ask_args).toBe('some');
    noteNextAsk('s3', 'rank_markets', 'get_market_dcpi_rank');   // no args suggested: no args field
    expect(paramsForTrack({ market_slug: 'x' }, 's3', 'get_market_dcpi_rank')).toEqual({ market_slug: 'x', _via_next_ask: 'rank_markets' });
    expect(paramsForTrack({ q: 1 }, 's3', 'search_facilities')).toEqual({ q: 1 });
    expect(nextAskArgsMatch({}, { a: 1 })).toBeNull();
  });
});

describe('shown: the served call\'s own row names its next_ask (pure)', () => {
  it('the field, the served tool, and a copy that leaves the handler\'s args alone', () => {
    expect(NEXT_ASK_SHOWN_FIELD).toBe('_next_ask_to');
    expect(servedNextAskTo({ structuredContent: { next_ask: { tool: 'rank_markets', question: 'q' } } })).toBe('rank_markets');
    for (const r of [null, {}, { structuredContent: [] }, { structuredContent: { next_ask: {} } },
      { structuredContent: { next_ask: { tool: 'Not A Tool!' } } }]) expect(servedNextAskTo(r)).toBeNull();
    const args = { iso: 'PJM' };
    const row = { tool: 'get_grid_data', status: 'ok', params: args };
    const out = withNextAskShown(row, 'get_interconnection_queue');
    expect(out.params).toEqual({ iso: 'PJM', _next_ask_to: 'get_interconnection_queue' });
    expect(args).toEqual({ iso: 'PJM' });
    expect(row.params).toBe(args);
    expect(withNextAskShown({ tool: 't', params: undefined }, 'x').params).toEqual({ _next_ask_to: 'x' });
  });
  it('held rows leave on flush, marked for this tool only; an error row and a result with no next_ask are not marked', () => {
    const sent = [];
    const c = {};
    holdTrackRow(c, { tool: 'a', status: 'ok', params: { q: 1 } }, (p) => sent.push(p));
    holdTrackRow(c, { tool: 'b', status: 'ok', params: {} }, (p) => sent.push(p));
    holdTrackRow(c, { tool: 'a', status: 'error', params: {} }, (p) => sent.push(p));
    expect(sent).toHaveLength(0);
    expect(flushTrackRows(c, 'a', { structuredContent: { next_ask: { tool: 'rank_markets' } } })).toBe(2);
    expect(sent.map((r) => r.params._next_ask_to)).toEqual(['rank_markets', undefined]);
    expect(flushTrackRows(c, 'b', { structuredContent: {} })).toBe(1);
    expect(sent[2].params._next_ask_to).toBeUndefined();
    expect(flushTrackRows(c, 'a', {})).toBe(0);   // sent once
  });
  it('a row nothing flushes still leaves, unmarked', async () => {
    const sent = [];
    holdTrackRow({}, { tool: 'a', status: 'ok', params: {} }, (p) => sent.push(p), { fallbackMs: 20 });
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toEqual([{ tool: 'a', status: 'ok', params: {} }]);
  });
  it('kill switch DCHUB_NEXT_ASK_SHOWN_LOG', () => {
    expect(nextAskShownLogOn({})).toBe(true);
    for (const v of ['0', 'off', 'false', 'no']) expect(nextAskShownLogOn({ DCHUB_NEXT_ASK_SHOWN_LOG: v })).toBe(false);
  });
});

// ── the real handler ──────────────────────────────────────────────────────
const SECRET = 'test-internal-key-not-a-real-secret';
const KEY = 'dch_live_nextaskargs_keyed00001';
const tracked = [];

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

let S, PORT, httpServer, stub, prevBase, prevSecret;
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const p = url.pathname;
      if (p === '/api/v1/mcp/track') { tracked.push(await readBody(req)); res.end('{}'); return; }
      if (p === '/api/v1/keys/validate') {
        const k = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(k === KEY ? { valid: true, tier: 'pro', developer_id: 'd_nextask', email: 'jane@firm.com', tier_detail: { users_plan: 'pro' } } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/keys/standing') { res.end(JSON.stringify({ found: true, last_seen_at: null })); return; }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, ok: true, count: 1, data: [{ iso: 'PJM', demand_mw: 1 }], results: [], items: [],
        score: 71, overall_score: 71, verdict: 'BUILD' }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function post(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}

let ipN = 20;
let rpcId = 10;
async function session(key, path = '/mcp') {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(path, h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    sid,
    async call(name, args) {
      const { body } = await post(path, h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
      const result = JSON.parse(body).result || {};
      const text = (result.content || []).map((c) => c.text || '').join('\n');
      return { result, text, sc: result.structuredContent || {} };
    },
    async list() {
      const { body } = await post(path, h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/list', params: {} });
      return (JSON.parse(body).result || {}).tools || [];
    },
  };
}

describe('next_ask args on /mcp', () => {
  it('every suggested tool exists and every filled arg name is in its served inputSchema', async () => {
    const tools = await (await session(KEY)).list();
    const props = Object.fromEntries(tools.map((t) => [t.name, Object.keys((t.inputSchema && t.inputSchema.properties) || {})]));
    expect(Object.keys(props).length).toBeGreaterThan(50);
    for (const [name, args, keyed] of CASES) {
      const a = nextAskFor(name, args, { keyed });
      expect(props[a.tool], a.tool + ' is served').toBeTruthy();
      for (const k of Object.keys(a.args || {})) expect(props[a.tool], `${a.tool}.${k}`).toContain(k);
    }
  });

  it('keyed get_grid_data for PJM: the queue with iso filled, structured only; the follow-up is logged with its source', async () => {
    const s = await session(KEY);
    const r = await s.call('get_grid_data', { iso: 'PJM' });
    expect(r.sc.next_ask).toMatchObject({ tool: 'get_interconnection_queue', args: { iso: 'PJM' } });
    expect(r.text).not.toContain('How congested is the PJM interconnection queue');   // no visible next line
    expect(r.text).not.toMatch(/Next useful call/i);
    await s.call('get_interconnection_queue', { iso: 'PJM' });
    for (let i = 0; i < 40 && !tracked.some((t) => t.tool === 'get_interconnection_queue' && t.session_id === s.sid); i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    const row = tracked.find((t) => t.tool === 'get_interconnection_queue' && t.session_id === s.sid);
    expect(row, 'follow-up tracked').toBeTruthy();
    const params = typeof row.params === 'string' ? JSON.parse(row.params) : row.params;
    expect(params).toMatchObject({ iso: 'PJM', _via_next_ask: 'get_grid_data', _via_next_ask_args: 'all' });
    // shown (mcp#1564 follow-up): the served call's own row names the next_ask it carried
    const first = tracked.find((t) => t.tool === 'get_grid_data' && t.session_id === s.sid);
    const p0 = typeof first.params === 'string' ? JSON.parse(first.params) : first.params;
    expect(p0).toEqual({ iso: 'PJM', _next_ask_to: 'get_interconnection_queue' });
    expect(params._next_ask_to).toBe('get_energy_prices');
  }, 60_000);

  it('kill switch DCHUB_NEXT_ASK_SHOWN_LOG=0: the row carries no _next_ask_to', async () => {
    process.env.DCHUB_NEXT_ASK_SHOWN_LOG = '0';
    const s = await session(KEY);
    const r = await s.call('get_grid_data', { iso: 'ERCOT' });
    expect(r.sc.next_ask && r.sc.next_ask.tool).toBe('get_interconnection_queue');
    for (let i = 0; i < 40 && !tracked.some((t) => t.tool === 'get_grid_data' && t.session_id === s.sid); i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    const row = tracked.find((t) => t.tool === 'get_grid_data' && t.session_id === s.sid);
    expect(row).toBeTruthy();
    const p = typeof row.params === 'string' ? JSON.parse(row.params) : row.params;
    expect(p._next_ask_to).toBeUndefined();
  }, 60_000);

  it('a keyed analyze_site answer offers save_site with the coordinate; keyless keeps compare_sites', async () => {
    const keyed = await (await session(KEY)).call('analyze_site', { lat: 33.45, lon: -112.07, capacity_mw: 100 });
    expect(keyed.result.isError).not.toBe(true);
    expect(keyed.sc.next_ask).toMatchObject({ tool: 'save_site', args: { lat: 33.45, lon: -112.07, target_mw: 100 } });
    expect(keyed.text).not.toContain('kept on your key');
    const anon = await (await session(null)).call('analyze_site', { lat: 33.45, lon: -112.07, capacity_mw: 100 });
    expect(JSON.stringify(anon.result)).not.toContain('save_site');
  }, 60_000);

  it('kill switch DCHUB_WATCH_SITE_NEXT_ASK=0: the keyed site answer keeps compare_sites', async () => {
    process.env.DCHUB_WATCH_SITE_NEXT_ASK = '0';
    const r = await (await session(KEY)).call('analyze_site', { lat: 33.45, lon: -112.07 });
    expect(r.sc.next_ask && r.sc.next_ask.tool).toBe('compare_sites');
  }, 60_000);

  it('/mcp/core: a core tool\'s delegated rows carry no _next_ask_to (the core answer serves no next_ask)', async () => {
    const s = await session(KEY, '/mcp/core');
    const r = await s.call('grid_power', { iso: 'PJM' });
    expect(r.sc.next_ask).toBeUndefined();
    for (let i = 0; i < 40 && !tracked.some((t) => t.session_id === s.sid && t.tool === 'get_grid_intelligence'); i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    const rows = tracked.filter((t) => t.session_id === s.sid);
    expect(rows.map((t) => t.tool)).toContain('get_grid_intelligence');
    for (const t of rows) expect(JSON.stringify(t.params || {}), t.tool).not.toContain('_next_ask_to');
  }, 60_000);

  for (const path of ['/mcp/chatgpt', '/mcp/claude']) {
    it(`${path}: no next_ask args leak into the directory profile`, async () => {
      const s = await session(KEY, path);
      const names = (await s.list()).map((t) => t.name);
      const pick = names.includes('search') ? ['search', { query: 'phoenix' }] : [names[0], {}];
      const r = await s.call(pick[0], pick[1]);
      expect(r.sc.next_ask, path).toBeUndefined();
      await new Promise((res) => setTimeout(res, 300));
      const rows = tracked.filter((t) => t.session_id === s.sid);
      expect(rows.length, path + ' rows tracked').toBeGreaterThan(0);
      for (const t of rows) expect(JSON.stringify(t.params || {}), path).not.toContain('_next_ask_to');
    });
  }
});
