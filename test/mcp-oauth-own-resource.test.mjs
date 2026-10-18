// D1 (owner 2026-10-18): /mcp/oauth may name its OWN protected-resource metadata, behind
// DCHUB_MCP_OAUTH_OWN_RESOURCE (default off). Pins the flag, the origin document, and that the
// server accepts tokens for either resource on this path. Item 5 context: /mcp/oauth.
//
// The full /mcp profile behind an opt-in OAuth challenge. A credential-less
// initialize / tools/call is answered 401 + WWW-Authenticate naming the /mcp
// protected-resource metadata; tools/list stays open; every key channel skips
// the challenge; bare /mcp is never challenged. See lib/mcp-oauth-path.mjs.
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

const PRO = 'dch_live_mcpoauthtest0001';

let S, PORT, httpServer, stub, prevBase, prevWorkos;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const url = new URL(req.url, 'http://_');
        res.setHeader('content-type', 'application/json');
        if (url.pathname === '/api/v1/keys/validate') {
          let key = '';
          try { key = JSON.parse(b || '{}').api_key || ''; } catch (_) {}
          res.end(JSON.stringify(key === PRO
            ? { valid: true, tier: 'pro', developer_id: 'dev_mo', email: 'm@example.com' }
            : { valid: false, tier: 'free' }));
          return;
        }
        if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  prevWorkos = process.env.DCHUB_WORKOS_OAUTH_ENABLED;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevWorkos === undefined) delete process.env.DCHUB_WORKOS_OAUTH_ENABLED;
  else process.env.DCHUB_WORKOS_OAUTH_ENABLED = prevWorkos;
  net.Socket.prototype.connect = realConnect;
});

async function post(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  let json = null;
  try { json = JSON.parse(data); } catch (_) {}
  return { status: res.status, headers: res.headers, json };
}
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-oauth-path-test', version: '1.0' } } };
const CALL = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_grid_scoreboard', arguments: {} } };
const PRM = 'resource_metadata="https://dchub.cloud/.well-known/oauth-protected-resource/mcp"';
const canon = (tools) => JSON.stringify([...tools].sort((a, b) => (a.name < b.name ? -1 : 1)), (k, v) =>
  (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v);

import { readFileSync } from 'node:fs';
import { mcpOauthChallenge, MCP_OAUTH_CHALLENGE, MCP_OAUTH_CHALLENGE_OWN, MCP_OAUTH_PRM, MCP_OAUTH_PRM_URL,
         MCP_OAUTH_RESOURCE } from '../lib/mcp-oauth-path.mjs';

describe('the flag', () => {
  it('default off: the /mcp document (the one the live worker agrees with)', () => {
    expect(mcpOauthChallenge({})).toBe(MCP_OAUTH_CHALLENGE);
    expect(mcpOauthChallenge({ DCHUB_MCP_OAUTH_OWN_RESOURCE: '0' })).toBe(MCP_OAUTH_CHALLENGE);
    expect(MCP_OAUTH_CHALLENGE).toContain('oauth-protected-resource/mcp"');
  });
  it('on (1/true/yes/on): the path\'s own document', () => {
    for (const v of ['1', 'true', 'YES', 'on']) expect(mcpOauthChallenge({ DCHUB_MCP_OAUTH_OWN_RESOURCE: v })).toBe(MCP_OAUTH_CHALLENGE_OWN);
    expect(MCP_OAUTH_CHALLENGE_OWN).toContain(MCP_OAUTH_PRM_URL);
  });
  it('RFC 9728 3.3: the own document\'s resource is the URL the client connects to', () => {
    expect(MCP_OAUTH_RESOURCE).toBe('https://dchub.cloud/mcp/oauth');
    expect(MCP_OAUTH_PRM.resource).toBe(MCP_OAUTH_RESOURCE);
    expect(MCP_OAUTH_PRM_URL).toBe('https://dchub.cloud/.well-known/oauth-protected-resource' + new URL(MCP_OAUTH_RESOURCE).pathname);
    // only `resource` differs from the /mcp document the live worker serves
    expect(MCP_OAUTH_PRM.authorization_servers).toEqual(['https://beloved-stream-52.authkit.app']);
  });
});

describe('over the real /mcp handler', () => {
  it('default: 401 names the /mcp metadata, exactly as before', async () => {
    const r = await post('/mcp/oauth', INIT);
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toBe(MCP_OAUTH_CHALLENGE);
  });
  it('flag on: 401 names /mcp/oauth\'s own metadata; the flag is read per request', async () => {
    process.env.DCHUB_MCP_OAUTH_OWN_RESOURCE = '1';
    try {
      const r = await post('/mcp/oauth', INIT);
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toBe(MCP_OAUTH_CHALLENGE_OWN);
    } finally { delete process.env.DCHUB_MCP_OAUTH_OWN_RESOURCE; }
    expect((await post('/mcp/oauth', INIT)).headers.get('www-authenticate')).toBe(MCP_OAUTH_CHALLENGE);
  });
  it('flag on never touches bare /mcp or /mcp/chatgpt', async () => {
    process.env.DCHUB_MCP_OAUTH_OWN_RESOURCE = '1';
    try {
      expect((await post('/mcp', INIT)).headers.get('www-authenticate')).toBeNull();
      expect((await post('/mcp/chatgpt', INIT)).headers.get('www-authenticate')).toBeNull();
    } finally { delete process.env.DCHUB_MCP_OAUTH_OWN_RESOURCE; }
  });
  it('the origin serves the own-resource document at its well-known path', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/.well-known/oauth-protected-resource/mcp/oauth`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.resource).toBe(MCP_OAUTH_RESOURCE);
    expect(j.authorization_servers).toEqual(MCP_OAUTH_PRM.authorization_servers);
  });
  it('the kill switch withdraws the document with the path', async () => {
    process.env.DCHUB_MCP_OAUTH_DISABLE = '1';
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/.well-known/oauth-protected-resource/mcp/oauth`);
      expect(res.status).toBe(404);
    } finally { delete process.env.DCHUB_MCP_OAUTH_DISABLE; }
  });
});

describe('the server accepts a token minted for either resource on /mcp/oauth', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  it('passes both audiences for this path, so flipping the flag never strands a client', () => {
    expect(src).toMatch(/_isMcpOauthRequest\(req\) \? \{ audiences: \[_WORKOS_AUD, MCP_OAUTH_RESOURCE\] \}/);
  });
  it('the challenge it sends is the flag-aware one, not the constant', () => {
    expect(src).toContain("res.set('WWW-Authenticate', _mcpOauthChallenge());");
    expect(src).not.toContain("res.set('WWW-Authenticate', MCP_OAUTH_CHALLENGE);");
  });
});

describe('no foreign network', () => {
  it('nothing left the loopback', () => { expect(foreign).toEqual([]); });
});
