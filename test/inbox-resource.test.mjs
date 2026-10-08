// dchub://inbox (2026-10-07) — notes a PARTNER key reads on its own.
// Pins: the resource exists only on a keyed server and carries text/plain; a read
// proxies GET {backend}/api/v1/inbox with the SESSION's key as X-API-Key and
// Accept: text/plain and nothing else (no internal key); no key / 401 / 403 /
// network failure each render as text, never a throw; over HTTP a keyed
// initialize carries the inbox line and lists the resource, a keyless one does
// neither and its instructions are unchanged. NO real network: the backend is a
// local stub and globalThis.fetch is stubbed for the direct reads.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer as httpServer } from 'node:http';

const KEY = 'dchub_pro_' + 'inboxtestkey0000'.repeat(2);
const INBOX_TEXT = 'DC Hub inbox for slug-test: 1 unread note(s) (now marked read)\n\n--- #7 | hello | from owner | 2026-10-07T00:00:00+00:00\nnote body\n';
let S, stub, srv, PORT, backendHits = [];
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prev = {};
const realFetch = globalThis.fetch;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = httpServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      backendHits.push({ path: p, method: req.method, key: req.headers['x-api-key'] || null, accept: req.headers.accept || null });
      if (p === '/api/v1/keys/validate') {
        let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
          const ok = (() => { try { return JSON.parse(b).api_key === KEY; } catch { return false; } })();
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(ok ? { valid: true, tier: 'pro' } : { valid: false, tier: 'free' }));
        });
        return;
      }
      if (p === '/api/v1/inbox') {
        if (req.headers['x-api-key'] !== KEY) { res.statusCode = req.headers['x-api-key'] ? 403 : 401; res.end('{}'); return; }
        res.setHeader('content-type', 'text/plain'); res.end(INBOX_TEXT); return;
      }
      res.setHeader('content-type', 'application/json'); res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
}, 60000);
afterEach(() => { backendHits = []; globalThis.fetch = realFetch; });
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});

const readWithKey = async (apiKey) => {
  const res = S.createServer(null, '', undefined, { keyed: true })._registeredResources['dchub://inbox'];
  return S._ctxALS.run({ api_key: apiKey }, async () => (await res.readCallback(new URL('dchub://inbox'), {})).contents[0]);
};

describe('dchub://inbox registration', () => {
  it('is registered on a keyed server with text/plain, and absent on a keyless one', () => {
    const r = S.createServer(null, '', undefined, { keyed: true })._registeredResources['dchub://inbox'];
    expect(r).toBeTruthy();
    expect(r.name).toBe('inbox');
    expect(r.metadata.mimeType).toBe('text/plain');
    expect(r.metadata.description).toMatch(/marked read on delivery/);
    expect(S.createServer(null, '')._registeredResources['dchub://inbox']).toBeUndefined();
    expect(S.createServer(null, '', undefined, { keyed: false })._registeredResources['dchub://inbox']).toBeUndefined();
    // the other resources are still there either way
    expect(S.createServer(null, '')._registeredResources['dchub://instructions']).toBeTruthy();
  });

  it('is a resource, not a tool: the tool catalog is unchanged by keyed-ness', async () => {
    const names = (s) => Object.keys(s._registeredTools).sort();
    expect(names(S.createServer(null, '', undefined, { keyed: true }))).toEqual(names(S.createServer(null, '')));
    expect(S.CANONICAL_TOOL_COUNT ?? names(S.createServer(null, '')).length).toBe(names(S.createServer(null, '')).length);
  });
});

describe('dchub://inbox read', () => {
  it('proxies GET /api/v1/inbox with the session key and Accept text/plain, nothing else', async () => {
    const c = await readWithKey(KEY);
    expect(c.uri).toBe('dchub://inbox');
    expect(c.mimeType).toBe('text/plain');
    expect(c.text).toBe(INBOX_TEXT);
    const hit = backendHits.find((h) => h.path === '/api/v1/inbox');
    expect(hit).toBeTruthy();
    expect(hit.method).toBe('GET');
    expect(hit.key).toBe(KEY);
    expect(hit.accept).toBe('text/plain');
  });

  it('sends no internal key: the backend answers the caller, not the server', async () => {
    const seen = [];
    globalThis.fetch = async (url, init) => { seen.push({ url: String(url), headers: init.headers }); return new Response('x', { status: 200 }); };
    const t = await S._inboxResourceText(KEY);
    expect(t).toBe('x');
    expect(seen[0].url.endsWith('/api/v1/inbox')).toBe(true);
    expect(Object.keys(seen[0].headers).sort()).toEqual(['Accept', 'X-API-Key']);
  });

  it('no key in the session → explains, and never calls the backend', async () => {
    const c = await readWithKey(null);
    expect(c.text).toMatch(/presented no DC Hub key/);
    expect(backendHits.filter((h) => h.path === '/api/v1/inbox')).toEqual([]);
  });

  it('403 (a key without a partner slug) and 401 render as text', async () => {
    expect((await readWithKey('dchub_free_' + 'x'.repeat(32))).text).toMatch(/has no inbox \(403\)/);
    const t401 = await S._inboxResourceText(KEY, async () => new Response('{}', { status: 401 }));
    expect(t401).toMatch(/did not accept this key \(401\)/);
  });

  it('a backend failure renders as text and says nothing was marked read', async () => {
    expect(await S._inboxResourceText(KEY, async () => { throw new Error('boom'); })).toMatch(/could not be read just now \(boom\).*nothing was marked read/);
    expect(await S._inboxResourceText(KEY, async () => new Response('', { status: 503 }))).toMatch(/HTTP 503/);
    expect(await S._inboxResourceText(KEY, async () => new Response('  ', { status: 200 }))).toBe('DC Hub inbox: no unread notes.');
  });
});

describe('over HTTP: keyed vs keyless session', () => {
  async function post(headers, body) {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
    const raw = await res.text();
    const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
    return { headers: res.headers, msg: json.trim() ? JSON.parse(json) : null };   // 202 on a notification has no body
  }
  async function open(extra) {
    const init = await post(extra, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'inbox-test', version: '1' } } });
    const sid = init.headers.get('mcp-session-id');
    expect(sid).toBeTruthy();
    const h = { 'mcp-session-id': sid, ...extra };
    await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
    return { h, instructions: init.msg.result.instructions };
  }

  it('keyed: the instructions carry the inbox line, resources/list has it, and a read returns the notes', async () => {
    const { h, instructions } = await open({ 'x-api-key': KEY });
    expect(instructions).toContain(S._INSTR_TAIL_INBOX.trim());
    expect(instructions).toContain('If you are a partner agent, read dchub://inbox at the start of a session for notes from DC Hub.');
    const list = (await post(h, { jsonrpc: '2.0', id: 2, method: 'resources/list' })).msg.result.resources.map((r) => r.uri);
    expect(list).toContain('dchub://inbox');
    expect(list).toContain('dchub://instructions');
    const read = (await post(h, { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'dchub://inbox' } })).msg.result.contents[0];
    expect(read.mimeType).toBe('text/plain');
    expect(read.text).toBe(INBOX_TEXT);
    expect(backendHits.find((x) => x.path === '/api/v1/inbox').key).toBe(KEY);
  });

  it('keyless: no inbox line, no inbox resource, instructions byte-identical to the lean text', async () => {
    const { h, instructions } = await open({});
    expect(instructions).not.toContain('dchub://inbox');
    expect(instructions).toBe(S._capacityInstructions(S._INSTRUCTIONS_LEAN));
    const list = (await post(h, { jsonrpc: '2.0', id: 2, method: 'resources/list' })).msg.result.resources.map((r) => r.uri);
    expect(list).not.toContain('dchub://inbox');
    expect(list).toContain('dchub://instructions');
  });

  it('a rejected key is keyless: no inbox line and no resource', async () => {
    const { h, instructions } = await open({ 'x-api-key': 'dchub_pro_' + 'notvalid00000000'.repeat(2) });
    expect(instructions).not.toContain('dchub://inbox');
    const list = (await post(h, { jsonrpc: '2.0', id: 2, method: 'resources/list' })).msg.result.resources.map((r) => r.uri);
    expect(list).not.toContain('dchub://inbox');
  });
});
