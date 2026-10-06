// ChatGPT OAuth (owner, 2026-10-06): /mcp/chatgpt/oauth.
//
// ChatGPT custom apps support only None or OAuth, so a paid user's key never
// reaches /mcp/chatgpt and every ChatGPT call is served keyless. This URL serves
// the SAME directory profile and catalog, and challenges an initialize or
// tools/call that carries no credential, so ChatGPT runs the AuthKit sign-in.
// The frozen /mcp/chatgpt (OpenAI review) must not move: it is never challenged.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const FROZEN = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/chatgpt-toolset.frozen.json', import.meta.url)), 'utf8'));
const PRO = 'dch_live_chatgptoauthtest01';

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
            ? { valid: true, tier: 'pro', developer_id: 'dev_cgo', email: 'c@example.com' }
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
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cgo-path-test', version: '1.0' } } };
const CALL = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_grid_scoreboard', arguments: {} } };
const PRM = 'resource_metadata="https://dchub.cloud/.well-known/oauth-protected-resource/mcp"';
const canon = (tools) => JSON.stringify([...tools].sort((a, b) => (a.name < b.name ? -1 : 1)), (k, v) =>
  (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v);

describe('/mcp/chatgpt/oauth challenges an unauthenticated caller', () => {
  for (const [label, body] of [['initialize', INIT], ['tools/call', CALL]]) {
    it(`${label} with no credential: 401 + WWW-Authenticate naming the /mcp metadata`, async () => {
      const r = await post('/mcp/chatgpt/oauth', body);
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toContain(PRM);
      expect(r.json.error.code).toBe(-32001);
    });
  }

  it('the frozen /mcp/chatgpt is never challenged', async () => {
    for (const body of [INIT, CALL]) {
      const r = await post('/mcp/chatgpt', body);
      expect(r.status).toBe(200);
      expect(r.headers.get('www-authenticate')).toBeNull();
    }
  });

  it('tools/list is open and serves exactly the frozen directory catalog', async () => {
    const r = await post('/mcp/chatgpt/oauth', LIST);
    expect(r.status).toBe(200);
    expect(canon(r.json.result.tools)).toBe(canon(FROZEN.tools));
  });

  it('a keyed initialize is served', async () => {
    const r = await post('/mcp/chatgpt/oauth', INIT, { 'x-api-key': PRO });
    expect(r.status).toBe(200);
  });

  it('with OAuth disabled it serves keyless rather than lock the caller out', async () => {
    process.env.DCHUB_WORKOS_OAUTH_ENABLED = '0';
    try {
      expect((await post('/mcp/chatgpt/oauth', INIT)).status).toBe(200);
    } finally { process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1'; }
  });

  it('kill switch DCHUB_CHATGPT_OAUTH_DISABLE=1 serves keyless', async () => {
    process.env.DCHUB_CHATGPT_OAUTH_DISABLE = '1';
    try {
      expect((await post('/mcp/chatgpt/oauth', INIT)).status).toBe(200);
    } finally { delete process.env.DCHUB_CHATGPT_OAUTH_DISABLE; }
  });
});

describe('profile and metrics tag', () => {
  it('both URLs get the directory profile; only the OAuth URL is tagged chatgpt-oauth', () => {
    const req = (path) => ({ path });
    expect(S._pathProfile(req('/mcp/chatgpt/oauth'))).toBe(S._pathProfile(req('/mcp/chatgpt')));
    expect(S._pathProfile(req('/mcp/chatgpt'))).toBeTruthy();
    expect(S._pathSource(req('/mcp/chatgpt/oauth'))).toBe('chatgpt-oauth');
    expect(S._pathSource(req('/mcp/chatgpt'))).toBe('');
  });
});

describe('no network', () => {
  it('made no connection off loopback', () => { expect(foreign).toEqual([]); });
});
