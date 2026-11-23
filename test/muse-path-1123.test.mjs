// 2026-11-23: /mcp/muse, the read-first listing for Meta's Muse Connector Platform review.
// It serves the /mcp/claude read-only profile under its own source tag, and must never list a tool
// that sends an introduction, mints or emails a key, binds an email, sets an alert or opens checkout.
// Driven over the real Express app, loopback only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};


let S, PORT, httpServer, stub, prevBase;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const url = new URL(req.url, 'http://_');
        if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function post(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'user-agent': 'dchub-qa-readonly', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  let json = null;
  try { json = JSON.parse(data); } catch (_) {}
  return { status: res.status, headers: res.headers, json, raw };
}
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'muse-path-test', version: '1.0' } } };
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const names = (r) => (r.json?.result?.tools || []).map((t) => t.name).sort();

async function initAndList(path) {
  const init = await post(path, INIT);
  const sid = init.headers.get('mcp-session-id');
  const list = await post(path, LIST, sid ? { 'mcp-session-id': sid } : {});
  return { init, list };
}


const MUST_NOT_LIST = ['request_capacity_intro', 'accept_capacity_intro', 'accept_capacity_terms',
  'get_api_key', 'bind_email', 'recover_my_key', 'unlock_more_data', 'subscribe_digest',
  'set_market_alert', 'set_site_alert', 'set_shortlist_alert', 'register_standing_intent',
  'delete_standing_intent', 'save_site', 'save_to_shortlist'];

describe('/mcp/muse is the read-only directory profile', () => {
  let bare, claude, muse;
  beforeAll(async () => {
    bare = await initAndList('/mcp');
    claude = await initAndList('/mcp/claude');
    muse = await initAndList('/mcp/muse');
  });

  it('baselines answer (the comparisons below are not vacuous)', () => {
    expect(bare.init.status).toBe(200);
    expect(names(bare.list)).toEqual(expect.arrayContaining(MUST_NOT_LIST));
    expect(names(claude.list).length).toBeGreaterThan(30);
  });
  it('POST initialize 200 keyless, no challenge', () => {
    expect(muse.init.status).toBe(200);
    expect(muse.init.headers.get('www-authenticate')).toBeNull();
  });
  it('lists the same tools as /mcp/claude', () => {
    expect(muse.list.status).toBe(200);
    expect(names(muse.list)).toEqual(names(claude.list));
  });
  it('lists none of the intro, key, email, alert, webhook or checkout tools', () => {
    const listed = names(muse.list);
    for (const t of MUST_NOT_LIST) expect(listed).not.toContain(t);
  });
  it('every listed tool is read-only except the two feedback tools', () => {
    const writes = (muse.list.json?.result?.tools || [])
      .filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name).sort();
    expect(writes.filter((n) => !['report_finding', 'request_enhancement'].includes(n))).toEqual([]);
  });
  it('a direct tools/call to an unlisted intro tool is refused', async () => {
    const r = await post('/mcp/muse', { jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'request_capacity_intro', arguments: { capacity_mw: 5 } } });
    const text = JSON.stringify(r.json || r.raw);
    expect(r.json?.error || r.json?.result?.isError).toBeTruthy();
    expect(text).not.toMatch(/introduction (sent|requested)/i);
  });
});

describe('attribution and auth', () => {
  it('own source tag, distinct from /mcp/claude, kept out of the relay readout', async () => {
    expect(S._pathSource({ path: '/mcp/muse' })).toBe('meta-muse');
    expect(S._pathSource({ path: '/mcp/muse' })).not.toBe(S._pathSource({ path: '/mcp/claude' }));
    const { excludedFromRelayReadout, CLAUDE_PROFILE } = await import('../lib/claude-directory.mjs');
    expect(S._pathProfile({ path: '/mcp/muse' })).toBe(CLAUDE_PROFILE);
    expect(excludedFromRelayReadout({ source: 'meta-muse' })).toBe(true);
  });
  it('an unknown bearer gets no /mcp/claude resource_metadata challenge on /mcp/muse', async () => {
    const r = await post('/mcp/muse', INIT, { authorization: 'Bearer not-a-real-token-1123' });
    expect(String(r.headers.get('www-authenticate') || '')).not.toContain('/mcp/claude');
  });
});
