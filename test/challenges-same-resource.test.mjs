// challenges-same-resource.test.mjs — Grok G-1014-35 (2026-10-15)
//
// The /mcp gateway has two generic 401 challenges: the first one, for an
// anonymous Claude connector, and the invalid-bearer one. The audience the
// gateway enforces is https://dchub.cloud/mcp. The invalid-bearer challenge used
// to name the ROOT protected-resource document (/.well-known/oauth-protected-
// resource, resource https://dchub.cloud), so a client that followed it asked
// AuthKit for a token for the origin and the aud binding then refused it.
//
// Pinned over the REAL /mcp handler (fake local backend, no network):
//   - both challenges name the same resource_metadata document
//   - that document is the one whose resource is https://dchub.cloud/mcp
//     (/api/v1/oauth-protected-resource; the root document is NOT named)
//   - the audience the gateway enforces is that same resource
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

// ★HARD GATE, NO NETWORK (same gate as challenge-carries-human-line): every
// non-loopback connect is refused and recorded; the last test fails if one was tried.
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

const ENFORCED_RESOURCE = 'https://dchub.cloud/mcp';
const PRM_URL = 'https://dchub.cloud/api/v1/oauth-protected-resource';
const ROOT_PRM_URL = 'https://dchub.cloud/.well-known/oauth-protected-resource';

let S, PORT, httpServer, stub, prevBase, prevWorkos;
let rpcId = 10;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: false, tier: 'free' })); return; }
      if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      if (url.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevWorkos = process.env.DCHUB_WORKOS_OAUTH_ENABLED;
  process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevWorkos === undefined) delete process.env.DCHUB_WORKOS_OAUTH_ENABLED; else process.env.DCHUB_WORKOS_OAUTH_ENABLED = prevWorkos;
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, www: res.headers.get('www-authenticate'), sid: res.headers.get('mcp-session-id'), text: await res.text() };
}

async function openSession(clientName, extra = {}) {
  const init = await post(extra, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  expect(init.sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...extra, 'mcp-session-id': init.sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return h;
}
const callTool = (h) => post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
  params: { name: 'rank_markets', arguments: { limit: 10 } } });
const prmOf = (www) => (String(www || '').match(/resource_metadata="([^"]+)"/) || [])[1];

describe('the two generic 401 challenges name one protected-resource document', () => {
  let first, invalid;
  beforeAll(async () => {
    const claude = await openSession('claude-ai');
    await callTool(claude);                  // served
    first = await callTool(claude);          // challenged
    // initialize with a bad bearer is refused before a session exists, so the
    // bearer rides the tool call, as it does for a connector whose token expired.
    const plain = await openSession('plain-client');
    invalid = await callTool({ ...plain, authorization: 'Bearer not-a-real-token-g1014-35' });
  });

  it('both paths are live (a first anonymous Claude call is challenged, a bad bearer is 401 invalid_token)', () => {
    expect(first.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(invalid.www).toContain('error="invalid_token"');
  });

  it('they carry the same resource_metadata URL', () => {
    expect(prmOf(first.www)).toBeTruthy();
    expect(prmOf(invalid.www)).toBe(prmOf(first.www));
  });

  it('that URL is the document whose resource is the audience the gateway enforces, not the root document', () => {
    expect(prmOf(invalid.www)).toBe(PRM_URL);
    expect(prmOf(invalid.www)).not.toBe(ROOT_PRM_URL);
    expect(ENFORCED_RESOURCE).toBe((process.env.DCHUB_MCP_RESOURCE || 'https://dchub.cloud/mcp').trim());
  });

  it('no socket left loopback', () => {
    expect(foreign).toEqual([]);
  });
});
