// 2026-11-18: /mcp/gemini, /mcp/copilot, /mcp/perplexity, /mcp/cursor, /mcp/mistral (lib/client-paths.mjs).
//
// Before: the zone worker answered GET on each with the 200 JSON description, and POST initialize
// reached this server and got 404 "Cannot POST". After: each path is the full /mcp, keyless, under
// its own arrival source tag. Driven over the real Express app, loopback only.
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

const CLIENTS = ['gemini', 'copilot', 'perplexity', 'cursor', 'mistral'];

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
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'client-paths-test', version: '1.0' } } };
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const names = (r) => (r.json?.result?.tools || []).map((t) => t.name).sort();

async function initAndList(path) {
  const init = await post(path, INIT);
  const sid = init.headers.get('mcp-session-id');
  const list = await post(path, LIST, sid ? { 'mcp-session-id': sid } : {});
  return { init, list };
}

describe('each client path is the full /mcp, keyless', () => {
  let bare;
  beforeAll(async () => { bare = await initAndList('/mcp'); });

  it('bare /mcp baseline answers (the comparison below is not vacuous)', () => {
    expect(bare.init.status).toBe(200);
    expect(bare.init.json?.result?.serverInfo?.version).toBeTruthy();
    expect(names(bare.list).length).toBeGreaterThan(50);
  });

  for (const c of CLIENTS) {
    it(`/mcp/${c}: POST initialize 200 with the /mcp serverInfo, no credential, no challenge`, async () => {
      const { init } = await initAndList(`/mcp/${c}`);
      expect(init.status).toBe(200);
      expect(init.headers.get('www-authenticate')).toBeNull();
      expect(init.json?.result?.serverInfo).toEqual(bare.init.json.result.serverInfo);
    });
    it(`/mcp/${c}: tools/list is the same tool set as bare /mcp`, async () => {
      const { list } = await initAndList(`/mcp/${c}`);
      expect(list.status).toBe(200);
      expect(names(list)).toEqual(names(bare.list));
    });
  }

  it('a path that is not declared still 404s (the routes above are not a catch-all)', async () => {
    const r = await post('/mcp/not-a-client-path-1118', INIT);
    expect(r.status).toBe(404);
  });
});

describe('attribution: an arrival source per path, never a platform', () => {
  it('each path carries its own source tag', () => {
    expect(S._pathSource({ path: '/mcp/gemini' })).toBe('gemini-path');
    expect(S._pathSource({ path: '/mcp/copilot' })).toBe('copilot-path');
    expect(S._pathSource({ path: '/mcp/perplexity' })).toBe('perplexity-path');
    expect(S._pathSource({ path: '/mcp/cursor' })).toBe('cursor-path');
    expect(S._pathSource({ path: '/mcp/mistral/' })).toBe('mistral-path');
  });
  it('the tags are distinct from each other and from every existing source', () => {
    const tags = CLIENTS.map((c) => S._pathSource({ path: `/mcp/${c}` }));
    expect(new Set(tags).size).toBe(CLIENTS.length);
    const others = [...S.MCP_SOURCE_PATHS.entries()]
      .filter(([p]) => !CLIENTS.includes(p.slice(5))).map(([, t]) => t);
    for (const t of tags) expect(others).not.toContain(t);
  });
  it('not a profile and not our own traffic: no directory profile, no core, no self-tag', () => {
    for (const c of CLIENTS) {
      const req = { path: `/mcp/${c}` };
      expect(S._pathProfile(req)).toBeNull();
      expect(S._pathIsCore(req)).toBe(false);
      expect(S._pathSelfTag(req)).toBe('');
    }
  });
  it('the bare path stays untagged', () => {
    expect(S._pathSource({ path: '/mcp' })).toBe('');
  });
});

describe('no foreign network', () => {
  it('nothing left the loopback', () => { expect(foreign).toEqual([]); });
});
