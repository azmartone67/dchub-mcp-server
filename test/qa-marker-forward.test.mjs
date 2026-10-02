// QA marker forwarding (2026-10-02, dchub-backend#6184).
//
// ★THE DEFECT. callAPI reaches the backend under this server's identity, so
// the backend never sees a QA caller's clientInfo.name ("dchub-qa-readonly")
// or User-Agent ("... - exclude)"), and capture_query_miss records the QA
// probe's unanswered questions as agent demand. callAPI / callAPIWrite now
// send X-DCHub-QA: 1 for such a caller; the backend honours it only next to
// X-Internal-Key.
//
// Drives the REAL app over HTTP against a stub backend that records the
// headers each /api/v1/rag/search request arrives with. The control session
// (an ordinary agent) must reach the stub WITHOUT the marker, so a marker
// sent to everyone fails too.
//
// Hard gate (test/hard-gate.txt): it decides which callers' misses the backend
// drops from its demand measurement, and it needs no network (both servers
// listen on 127.0.0.1).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const INTERNAL = 'test-internal-key-not-a-real-secret';
const prevEnv = {};
let S, PORT, httpServer, stub;
const seen = [];   // { q, headers } per /api/v1/rag/search hit

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const u = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (u.pathname === '/api/v1/rag/search') {
        seen.push({ q: u.searchParams.get('q'), headers: req.headers });
        res.end(JSON.stringify({ ok: true, query: u.searchParams.get('q'), count: 0, results: [] }));
        return;
      }
      if (u.pathname === '/api/v1/agentic/research' && req.method === 'POST') {
        let b = ''; for await (const ch of req) b += ch;
        seen.push({ q: JSON.parse(b || '{}').question, headers: req.headers });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (u.pathname === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: false, tier: 'free' })); return; }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = INTERNAL;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  return { headers: res.headers, raw };
}

const call = (q, id = 2) => ({ jsonrpc: '2.0', id, method: 'tools/call',
  params: { name: 'semantic_search', arguments: { q } } });

async function searchInSession(clientName, ua, q) {
  const h = { 'user-agent': ua };
  const init = await post(h, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  await post({ ...h, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  await post({ ...h, 'mcp-session-id': sid }, call(q));
  return hitFor(q);
}

function hitFor(q) {
  const hits = seen.filter((s) => s.q === q);
  expect(hits.length, `the backend never saw q=${q}`).toBe(1);
  return hits[0].headers;
}

describe('X-DCHub-QA is forwarded for QA callers only', () => {
  it('control: an ordinary agent reaches the backend with the internal key and no marker', async () => {
    const h = await searchInSession('acme-siting-agent', 'node', 'qa-marker control query');
    expect(h['x-internal-key']).toBe(INTERNAL);
    expect(h['x-dchub-qa']).toBeUndefined();
  });

  it('clientInfo.name dchub-qa-readonly marks the session (ordinary UA)', async () => {
    const h = await searchInSession('dchub-qa-readonly', 'node', 'qa-marker by client name');
    expect(h['x-dchub-qa']).toBe('1');
    expect(h['x-internal-key']).toBe(INTERNAL);
  });

  it('a User-Agent ending "- exclude)" marks the session (ordinary client name)', async () => {
    const h = await searchInSession('acme-siting-agent', 'dchub-eval/0.1 (eval - exclude)', 'qa-marker by ua');
    expect(h['x-dchub-qa']).toBe('1');
  });

  it('a stateless tools/call with the QA User-Agent is marked too', async () => {
    await post({ 'user-agent': 'dchub-qa-readonly/0.1 (QA - exclude)' }, call('qa-marker stateless', 7));
    expect(hitFor('qa-marker stateless')['x-dchub-qa']).toBe('1');
  });
});

describe('callAPIWrite carries the same marker', () => {
  const write = (c, q) => S._ctxALS.run(c, () => S._callAPIWriteForTest('/api/v1/agentic/research', { question: q }));
  it('QA caller: marked; ordinary caller: not marked', async () => {
    await write({ client_name_raw: 'dchub-qa-readonly', user_agent: 'node' }, 'write qa');
    await write({ client_name_raw: 'acme-siting-agent', user_agent: 'node' }, 'write control');
    expect(hitFor('write qa')['x-dchub-qa']).toBe('1');
    const ctl = hitFor('write control');
    expect(ctl['x-internal-key']).toBe(INTERNAL);
    expect(ctl['x-dchub-qa']).toBeUndefined();
  });
});

describe('_isQaCaller', () => {
  it('reads the client name and the user agent, and nothing else', () => {
    expect(S._isQaCaller({ client_name_raw: 'dchub-qa-readonly' })).toBe(true);
    expect(S._isQaCaller({ user_agent: 'dchub-qa-readonly/0.1 (QA - exclude)' })).toBe(true);
    expect(S._isQaCaller({ user_agent: 'dchub-eval/0.1 (eval - exclude)' })).toBe(true);
    expect(S._isQaCaller({ platform: 'dchub-internal', user_agent: 'dchub-mcp-server/1.0' })).toBe(false);
    expect(S._isQaCaller({ client_name_raw: 'claude-ai', user_agent: 'claude-user' })).toBe(false);
    expect(S._isQaCaller({})).toBe(false);
    expect(S._isQaCaller(null)).toBe(false);
  });
});
