// 2026-11-25: the light list survives another replica (lib/light-sid-tag.mjs).
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

import { randomUUID } from 'node:crypto';
import { mintSessionId, sidLightClass, classOf } from '../lib/light-sid-tag.mjs';

// A session id another replica minted: this process holds no session, no sessionMeta and no recalled name for it.
const foreignSid = (name) => mintSessionId({ clientName: name });
const listOn = (path, sid) => post(path, LIST, { 'mcp-session-id': sid });

describe('light-sid-tag (unit)', () => {
  it('tags only clients the light rules name, and reads back the same class', () => {
    for (const n of ['cursor-vscode', 'Visual Studio Code', 'claude-code', 'codex-mcp-client', 'windsurf-client']) {
      const sid = mintSessionId({ clientName: n });
      expect(sid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const c = sidLightClass(sid);
      expect(c, n).not.toBeNull();
      expect(classOf({ clientName: c.clientName })).toBe(classOf({ clientName: n }));
    }
    expect(sidLightClass(mintSessionId({ clientName: 'claude-ai' }))).toBeNull();
    expect(sidLightClass(mintSessionId({}))).toBeNull();
  });

  it('a plain random UUID essentially never reads as tagged (10,000 draws)', () => {
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (sidLightClass(randomUUID())) hits++;
    expect(hits).toBe(0);
  });

  it('kill switch DCHUB_LIGHT_SID_TAG=0: no tag minted, none read', () => {
    const sid = foreignSid('cursor-vscode');
    expect(sidLightClass(sid, { DCHUB_LIGHT_SID_TAG: '0' })).toBeNull();
    expect(sidLightClass(mintSessionId({ clientName: 'cursor-vscode' }, { DCHUB_LIGHT_SID_TAG: '0' }))).toBeNull();
  });
});

describe('tools/list on a replica that never saw the initialize', () => {
  it('initialize as cursor-vscode mints a tagged session id', async () => {
    const init = await post('/mcp', initFor('cursor-vscode'));
    const sid = init.headers.get('mcp-session-id');
    expect(sid).toBeTruthy();
    expect(sidLightClass(sid)?.clientName).toBe('cursor-vscode');
  });

  it('cursor-vscode session from another replica: /mcp serves the light list, same as a local session', async () => {
    const local = await listAs('/mcp', 'cursor-vscode');
    const foreign1 = await listOn('/mcp', foreignSid('cursor-vscode'));
    expect(names(local.list).length).toBeLessThanOrEqual(11);
    expect(names(foreign1)).toEqual(names(local.list));
    expect(Buffer.byteLength(JSON.stringify(foreign1.json.result))).toBeLessThan(30000);
  });

  it('ten list-only calls on fresh foreign sessions: every one is the light list', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await listOn('/mcp', foreignSid('cursor-vscode'));
      expect(names(r).length, `call ${i}`).toBeLessThanOrEqual(11);
    }
  });

  it('an untagged foreign session (claude-ai, or no name) keeps the full catalog', async () => {
    expect(names(await listOn('/mcp', randomUUID())).length).toBeGreaterThan(40);
    expect(names(await listOn('/mcp', foreignSid('claude-ai'))).length).toBeGreaterThan(40);
  });

  it('?catalog=full still opts a tagged session out', async () => {
    expect(names(await listOn('/mcp?catalog=full', foreignSid('cursor-vscode'))).length).toBeGreaterThan(40);
  });

  it('/mcp/cursor with a tagged foreign session follows DCHUB_LIGHT_ON_SOURCE_PATHS', async () => {
    const prev = process.env.DCHUB_LIGHT_ON_SOURCE_PATHS;
    try {
      delete process.env.DCHUB_LIGHT_ON_SOURCE_PATHS;
      expect(names(await listOn('/mcp/cursor', foreignSid('cursor-vscode'))).length).toBeGreaterThan(40);
      process.env.DCHUB_LIGHT_ON_SOURCE_PATHS = '1';
      expect(names(await listOn('/mcp/cursor', foreignSid('cursor-vscode'))).length).toBeLessThanOrEqual(11);
    } finally {
      if (prev === undefined) delete process.env.DCHUB_LIGHT_ON_SOURCE_PATHS; else process.env.DCHUB_LIGHT_ON_SOURCE_PATHS = prev;
    }
  });

  it('no foreign network calls', () => { expect(foreign).toEqual([]); });
});
