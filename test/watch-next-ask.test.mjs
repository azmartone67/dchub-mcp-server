// watch-next-ask.test.mjs — watch step 2 (owner 2026-11-02): an answer about one market offers to
// watch it through next_ask (set_market_alert, market filled in, email from the user). Walls keep their
// own next_ask; profiles without set_market_alert keep the plain one. Kill switch DCHUB_WATCH_NEXT_ASK=0.
//
// Real /mcp handler over HTTP against a stub backend, no network (harness from test/watch-onecall.test.mjs).
import { nextAskFor, watchAskFor, WATCH_ASK_TOOLS } from '../lib/agent-outreach.mjs';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

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

const SECRET = 'test-internal-key-not-a-real-secret';
const MINTED = 'dch_live_watchnextaskminted00001';
const HELD = 'dch_live_watchnextask_paidkey0001';
let claims = [];
let identifies = [];
let subs = [];
let identifyResponse = null;

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
      if (p === '/api/v1/keys/claim') {
        const b = await readBody(req);
        claims.push(b);
        res.end(JSON.stringify({ ok: true, api_key: MINTED, tier: 'identified',
          email_captured: !!b.email, email: b.email || null, free_tier_summary: { daily_calls: 10 } }));
        return;
      }
      if (p === '/api/v1/keys/identify') {
        const b = await readBody(req);
        identifies.push({ body: b, key: req.headers['x-api-key'] || null });
        res.end(JSON.stringify(identifyResponse || { ok: true, identified: true, email: b.email }));
        return;
      }
      if (p === '/api/v1/alerts/subscribe') {
        const b = await readBody(req);
        subs.push({ body: b, key: req.headers['x-api-key'] || null });
        res.end(JSON.stringify({ ok: true, subscription_id: 7, market: b.market, channel: b.channel,
          message: 'subscribed to market-movement alerts' }));
        return;
      }
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(key === HELD ? { valid: true, tier: 'pro', email: 'jane@firm.com' } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [], items: [] }));
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

afterEach(() => {
  delete process.env.DCHUB_WATCH_NEXT_ASK;
  claims = []; identifies = []; subs = []; identifyResponse = null;
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

let ipN = 10;
let rpcId = 10;
async function session(key, path = '/mcp') {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(path, h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    async call(name, args) {
      const { body } = await post(path, h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
      const result = JSON.parse(body).result || {};
      const text = (result.content || []).map((c) => c.text || '').join('\n');
      let json = null;
      try { json = JSON.parse(((result.content || [])[0] || {}).text || ''); } catch (_) { json = null; }
      return { result, text, json, sc: result.structuredContent || {} };
    },
    async list() {
      const { body } = await post('/mcp', h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/list', params: {} });
      return (JSON.parse(body).result || {}).tools || [];
    },
  };
}

describe('watch next_ask (pure)', () => {
  it('market tools with a market ask to watch it, market and channel filled in', () => {
    for (const [name, args] of [['get_market_intel', { market: 'phoenix' }], ['get_market_dcpi_rank', { market_slug: 'northern-virginia' }]]) {
      const a = nextAskFor(name, args);
      expect(a.tool).toBe('set_market_alert');
      expect(a.args).toEqual({ market: args.market || args.market_slug, channel: 'email' });
      expect(a.question).toMatch(/^Want an email when .+'s power verdict or scores change\? Tell me your email/);
      expect(a.needs).toMatch(/never guess/);
    }
    expect(nextAskFor('get_market_dcpi_rank', { market_slug: 'northern-virginia' }).question).toContain('Northern Virginia');
  });
  it('no market, another tool, or the kill switch: the plain follow-up', () => {
    expect(nextAskFor('get_market_intel', {}).tool).toBe('get_market_dcpi_rank');
    expect(nextAskFor('rank_markets', { market: 'phoenix' }).tool).toBe('get_market_dcpi_rank');
    process.env.DCHUB_WATCH_NEXT_ASK = '0';
    expect(watchAskFor('get_market_intel', { market: 'phoenix' })).toBeNull();
    expect(nextAskFor('get_market_intel', { market: 'phoenix' }).tool).toBe('get_market_dcpi_rank');
  });
  it('the tool set is the two single-market tools', () => {
    expect([...WATCH_ASK_TOOLS]).toEqual(['get_market_intel', 'get_market_dcpi_rank']);
  });
});

describe('watch next_ask on /mcp', () => {
  it('a full get_market_dcpi_rank answer carries the watch ask in structuredContent', async () => {
    const s = await session(HELD);
    const r = await s.call('get_market_dcpi_rank', { market_slug: 'phoenix' });
    expect(r.result.isError).not.toBe(true);
    expect(r.sc.next_ask && r.sc.next_ask.tool).toBe('set_market_alert');
    expect(r.sc.next_ask.args).toEqual({ market: 'phoenix', channel: 'email' });
    expect(r.text).not.toContain('Want an email when');   // structured only: no steering line in the text
  });
  it('kill switch: the plain follow-up', async () => {
    process.env.DCHUB_WATCH_NEXT_ASK = '0';
    const s = await session(HELD);
    const r = await s.call('get_market_dcpi_rank', { market_slug: 'phoenix' });
    expect(r.sc.next_ask && r.sc.next_ask.tool).toBe('rank_markets');
  });
  it('the free taste on /mcp names the market in its follow-up', async () => {
    const s = await session(null);
    const r = await s.call('get_market_intel', { market: 'phoenix' });
    expect(JSON.stringify(r.sc.next_ask || {})).not.toContain('this market');
  });
  for (const path of ['/mcp/chatgpt', '/mcp/core']) {
    it(`${path} (no set_market_alert there) never offers the watch`, async () => {
      const s = await session(null, path);
      for (const [name, args] of [['get_market_intel', { market: 'phoenix' }], ['get_market_dcpi_rank', { market_slug: 'phoenix' }]]) {
        const r = await s.call(name, args);
        expect(JSON.stringify(r.result)).not.toContain('set_market_alert');
      }
    });
  }
});

