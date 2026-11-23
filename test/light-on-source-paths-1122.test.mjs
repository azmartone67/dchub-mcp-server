// 2026-11-22: DCHUB_LIGHT_ON_SOURCE_PATHS (default OFF; lib/light-profile.mjs).
//
// Measured live 2026-11-22 (v2.12.62): a cursor-vscode client got 11 tools (~28 KB) on /mcp and 98 tools
// (~222 KB) on /mcp/cursor. With the flag on, the client arrival paths apply the same light rules as /mcp;
// off, they keep the full catalog. Driven over the real Express app, loopback only.
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
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'client-paths-test', version: '1.0' } } };
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const names = (r) => (r.json?.result?.tools || []).map((t) => t.name).sort();


const initFor = (name) => ({ ...INIT, params: { ...INIT.params, clientInfo: { name, version: '1.0' } } });
async function listAs(path, name, headers = {}) {
  const init = await post(path, initFor(name), headers);
  const sid = init.headers.get('mcp-session-id');
  const list = await post(path, LIST, { ...headers, ...(sid ? { 'mcp-session-id': sid } : {}) });
  return { init, list };
}
const withFlag = async (v, fn) => {
  const prev = process.env.DCHUB_LIGHT_ON_SOURCE_PATHS;
  if (v === undefined) delete process.env.DCHUB_LIGHT_ON_SOURCE_PATHS; else process.env.DCHUB_LIGHT_ON_SOURCE_PATHS = v;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.DCHUB_LIGHT_ON_SOURCE_PATHS; else process.env.DCHUB_LIGHT_ON_SOURCE_PATHS = prev;
  }
};

describe('DCHUB_LIGHT_ON_SOURCE_PATHS', () => {
  it('flag off (unset): cursor-vscode on /mcp/cursor keeps the full catalog, as today', async () => {
    await withFlag(undefined, async () => {
      const { init, list } = await listAs('/mcp/cursor', 'cursor-vscode');
      expect(init.status).toBe(200);
      expect(names(list).length).toBeGreaterThan(40);
    });
  });

  it('flag on: cursor-vscode on /mcp/cursor gets exactly the /mcp light list, under 30 KB', async () => {
    await withFlag('1', async () => {
      const bare = await listAs('/mcp', 'cursor-vscode');
      const path = await listAs('/mcp/cursor', 'cursor-vscode');
      expect(path.init.status).toBe(200);
      expect(names(path.list)).toEqual(names(bare.list));
      // 11 live (2026-11-22); one is env-gated, so the local catalog may be one short. The contract is "same as /mcp".
      expect(names(path.list).length).toBeGreaterThanOrEqual(10);
      expect(names(path.list).length).toBeLessThanOrEqual(11);
      expect(names(path.list)).toContain('execute_plan');
      expect(names(path.list)).not.toContain('get_api_key');
      expect(Buffer.byteLength(JSON.stringify(path.list.json.result))).toBeLessThan(30000);
    });
  });

  it('flag on: Visual Studio Code on /mcp/copilot is slimmed the same way', async () => {
    await withFlag('1', async () => {
      const bare = await listAs('/mcp', 'Visual Studio Code');
      const { list } = await listAs('/mcp/copilot', 'Visual Studio Code');
      expect(names(bare.list).length).toBeLessThanOrEqual(11);
      expect(names(list)).toEqual(names(bare.list));
    });
  });

  it('flag on: ?catalog=full on /mcp/cursor still returns the full catalog', async () => {
    await withFlag('1', async () => {
      const { list } = await listAs('/mcp/cursor?catalog=full', 'cursor-vscode');
      expect(names(list).length).toBeGreaterThan(40);
    });
  });

  it('flag on: a client not on the light rules (mistral-mcp-client, claude-ai) keeps the full catalog', async () => {
    await withFlag('1', async () => {
      for (const [p, n] of [['/mcp/mistral', 'mistral-mcp-client'], ['/mcp/cursor', 'claude-ai'], ['/mcp/gemini', 'client-paths-test']]) {
        const { list } = await listAs(p, n);
        expect(names(list).length, `${n} on ${p}`).toBeGreaterThan(40);
      }
    });
  });

  it('no foreign network calls', () => { expect(foreign).toEqual([]); });
});
