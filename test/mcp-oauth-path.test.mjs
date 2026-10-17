// Item 5 (Grok master task 2026-10-16, owner decision 2026-10-17): /mcp/oauth.
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

import { mcpOauthChallengeEligible, MCP_OAUTH_MESSAGE, MCP_OAUTH_CHALLENGE } from '../lib/mcp-oauth-path.mjs';

describe('/mcp/oauth challenges an unauthenticated caller', () => {
  for (const [label, body] of [['initialize', INIT], ['tools/call', CALL]]) {
    it(`${label} with no credential: 401 + WWW-Authenticate naming the /mcp metadata`, async () => {
      const r = await post('/mcp/oauth', body);
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toContain(PRM);
      expect(r.headers.get('www-authenticate')).toContain('scope="openid profile email offline_access"');
      expect(r.json.error.code).toBe(-32001);
      expect(r.json.error.message).toBe(MCP_OAUTH_MESSAGE);
    });
  }

  it('a trailing slash is the same URL', async () => {
    expect((await post('/mcp/oauth/', INIT)).status).toBe(401);
  });

  it('bare /mcp is never challenged by it', async () => {
    for (const body of [INIT, CALL]) {
      const r = await post('/mcp', body);
      expect(r.status).toBe(200);
      expect(r.headers.get('www-authenticate')).toBeNull();
    }
  });

  it('tools/list is open and lists the same catalog as /mcp', async () => {
    const r = await post('/mcp/oauth', LIST);
    expect(r.status).toBe(200);
    const base = await post('/mcp', LIST);
    const names = (x) => x.json.result.tools.map((t) => t.name).sort();
    expect(names(r).length).toBeGreaterThan(50);
    expect(names(r)).toEqual(names(base));
  });

  it('API keys keep working on every channel: header, query, and a key sent as a Bearer', async () => {
    expect((await post('/mcp/oauth', INIT, { 'x-api-key': PRO })).status).toBe(200);
    expect((await post(`/mcp/oauth?api_key=${PRO}`, INIT)).status).toBe(200);
    const b = await post('/mcp/oauth', INIT, { authorization: `Bearer ${PRO}` });
    expect(b.status).toBe(200);
    expect(b.headers.get('www-authenticate')).toBeNull();
  });

  it('a present-but-invalid bearer gets the shared invalid_token challenge', async () => {
    const r = await post('/mcp/oauth', INIT, { authorization: 'Bearer not-a-real-token-mcp-oauth-1' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('with OAuth disabled it serves keyless rather than lock the caller out', async () => {
    process.env.DCHUB_WORKOS_OAUTH_ENABLED = '0';
    try {
      expect((await post('/mcp/oauth', INIT)).status).toBe(200);
    } finally { process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1'; }
  });

  it('kill switch DCHUB_MCP_OAUTH_DISABLE=1 serves keyless', async () => {
    process.env.DCHUB_MCP_OAUTH_DISABLE = '1';
    try {
      expect((await post('/mcp/oauth', INIT)).status).toBe(200);
    } finally { delete process.env.DCHUB_MCP_OAUTH_DISABLE; }
    expect((await post('/mcp/oauth', INIT)).status).toBe(401);
  });
});

describe('routing, profile and metrics tag', () => {
  const req = (path) => ({ path });
  it('is a served MCP path with the full /mcp profile', () => {
    expect(S.MCP_PATHS).toContain('/mcp/oauth');
    expect(S._pathProfile(req('/mcp/oauth'))).toBeNull();
    expect(S._pathIsCore(req('/mcp/oauth'))).toBe(false);
  });
  it('only the OAuth URL is tagged mcp-oauth', () => {
    expect(S._pathSource(req('/mcp/oauth'))).toBe('mcp-oauth');
    expect(S._pathSource(req('/mcp'))).toBe('');
  });
});

describe('mcpOauthChallengeEligible', () => {
  const base = { isOauthPath: true, hasCredential: false, method: 'initialize', workosEnabled: true, disableRaw: '' };
  it('challenges exactly the credential-less initialize / tools/call on the OAuth path', () => {
    expect(mcpOauthChallengeEligible(base)).toBe(true);
    expect(mcpOauthChallengeEligible({ ...base, method: 'tools/call' })).toBe(true);
    expect(mcpOauthChallengeEligible({ ...base, method: 'tools/list' })).toBe(false);
    expect(mcpOauthChallengeEligible({ ...base, method: 'notifications/initialized' })).toBe(false);
    expect(mcpOauthChallengeEligible({ ...base, isOauthPath: false })).toBe(false);
    expect(mcpOauthChallengeEligible({ ...base, hasCredential: true })).toBe(false);
    expect(mcpOauthChallengeEligible({ ...base, workosEnabled: false })).toBe(false);
    for (const v of ['1', 'true', 'YES', 'on']) expect(mcpOauthChallengeEligible({ ...base, disableRaw: v })).toBe(false);
    expect(mcpOauthChallengeEligible({ ...base, disableRaw: '0' })).toBe(true);
  });
});

describe('agent-facing copy', () => {
  it('names no plan and no price', () => {
    for (const t of [MCP_OAUTH_MESSAGE, MCP_OAUTH_CHALLENGE]) {
      expect(t).not.toMatch(/\b(pro|free|paid|developer|starter|enterprise|plan|tier)\b|\$\d|\/mo\b/i);
    }
  });
});

describe('no network', () => {
  it('made no connection off loopback', () => { expect(foreign).toEqual([]); });
});
