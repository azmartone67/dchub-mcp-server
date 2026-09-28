// invalid-key-visible.test.mjs — G6 (Grok audit 2026-09-27)
//
// ★THE BUG. On /mcp, `Authorization: Bearer <invalid>` answers 401 with
// WWW-Authenticate. The same junk key as X-API-Key or ?apiKey= answered 200 and
// was served free tier, and the only trace was structuredContent.identity
// .credential_refused — a field most clients never show. A user with a mistyped
// keyed connector URL never found out.
//
// ★THE CONTRACT PINNED HERE. Still 200 and still served free (a hard error would
// break the keyless URL flow and hosted clients), but:
//   • content[0].text is a short notice naming the channel and a live landing;
//   • _meta.key_status and structuredContent.identity.key_status say 'invalid';
//   • a validator that did not ANSWER (503) is 'unverified' and the notice does
//     not call the key bad;
//   • a valid key and no key get no notice;
//   • the key value is never echoed.
//
// Real HTTP through the express app, against a 127.0.0.1 backend stub; no
// socket may leave loopback.
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

// Built at runtime; each case uses its own key so the 5-minute key cache of one
// case cannot answer for another.
const k = (label) => 'dch_live_' + label.padEnd(32, 'q');
const VALID = k('g6valid');
const DOWN = k('g6down');          // validator answers 503 for this one
const DOWN_TWICE = k('g6downtwice');
const RESTRICTED = k('g6restricted');
const GENERIC_UA = 'g6-test-client/1.0';
const GROK_UA = 'grok-mcp/1.0';

let S, PORT, httpServer, stub, prevBase;
const downCalls = new Map();

function validateAnswer(key) {
  if (key === VALID) return { status: 200, body: { valid: true, tier: 'free', developer_id: 'd1', email: null } };
  if (key === DOWN) return { status: 503, body: { error: 'unavailable' } };
  if (key === DOWN_TWICE) {
    // First call: backend down. Afterwards: the backend answers "valid". A
    // cached transient failure would keep this key unverified/invalid forever.
    const n = (downCalls.get(key) || 0) + 1;
    downCalls.set(key, n);
    return n === 1
      ? { status: 503, body: { error: 'unavailable' } }
      : { status: 200, body: { valid: true, tier: 'free', developer_id: 'd2', email: null } };
  }
  if (key === RESTRICTED) return { status: 200, body: { valid: false, tier: 'free', reason: 'bind_email_required' } };
  return { status: 200, body: { valid: false, tier: 'free' } };
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: 4000 + i, name: `Facility ${i}`, provider: 'Test Provider', city: 'Reno',
  state: 'NV', country: 'US', slug: `g6-facility-${i}`, power_mw: 10 * (i + 1),
}));

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/keys/validate') {
        const a = validateAnswer((await readBody(req)).api_key || '');
        res.statusCode = a.status;
        res.end(JSON.stringify(a.body));
        return;
      }
      if (p === '/api/v1/facilities') {
        res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS }));
        return;
      }
      res.end('{}');
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
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function post(path, headers, body, ua = GENERIC_UA) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'user-agent': ua, ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { status: res.status, headers: res.headers, raw, json };
}

async function call(path, headers = {}, ua = GENERIC_UA) {
  const r = await post(path, headers, {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'search_facilities', arguments: { query: 'reno', limit: 5 } },
  }, ua);
  const result = JSON.parse(r.json).result || {};
  return { status: r.status, raw: r.raw, result,
           first: (result.content && result.content[0] && result.content[0].text) || '',
           identity: (result.structuredContent || {}).identity || {},
           meta: result._meta || {} };
}

const INVALID_LINE = /isn't valid, so you're getting free-tier results\. Get a new key at https:\/\/dchub\.cloud\//;

describe('G6: an invalid X-API-Key / query key is served free AND says so', () => {
  it('invalid X-API-Key header: 200, notice first, key_status invalid, key not echoed', async () => {
    const bad = k('g6badheader');
    const got = await call('/mcp', { 'x-api-key': bad });
    expect(got.status).toBe(200);
    expect(got.first).toBe("The DC Hub API key in this connector's X-API-Key header isn't valid, "
      + "so you're getting free-tier results. Get a new key at https://dchub.cloud/connect");
    expect(got.meta.key_status).toBe('invalid');
    expect(got.identity.key_status).toBe('invalid');
    expect(got.identity.credential_source).toBe('header');
    // the data is still served, one item later
    expect(got.result.content.length).toBeGreaterThan(1);
    expect(got.result.isError).not.toBe(true);
    expect(got.raw).not.toContain(bad);
  });

  for (const param of ['apiKey', 'api_key', 'key']) {
    it(`invalid ?${param}= key: connector-URL notice, key_status invalid`, async () => {
      const bad = k(`g6badq${param}`);
      const got = await call(`/mcp?${param}=${bad}`);
      expect(got.status).toBe(200);
      expect(got.first).toMatch(/^This DC Hub connector URL's API key isn't valid/);
      expect(got.first).toMatch(INVALID_LINE);
      expect(got.meta.key_status).toBe('invalid');
      expect(got.identity.credential_source).toBe('query');
      expect(got.raw).not.toContain(bad);
    });
  }

  it('a Grok client is sent to /install/grok', async () => {
    const got = await call(`/mcp?apiKey=${k('g6badgrok')}`, {}, GROK_UA);
    expect(got.first).toBe("This DC Hub connector URL's API key isn't valid, so you're getting "
      + 'free-tier results. Get a new key at https://dchub.cloud/install/grok');
  });

  it('valid key: no notice and no key_status', async () => {
    const got = await call('/mcp', { 'x-api-key': VALID });
    expect(got.first).not.toMatch(/isn't valid|couldn't verify/);
    expect(got.meta.key_status).toBeUndefined();
    expect(got.identity.key_status).toBeUndefined();
    expect(got.identity.credential_source).toBe('header');
  });

  it('no key: no notice and no key_status at all', async () => {
    const got = await call('/mcp');
    expect(got.first).not.toMatch(/isn't valid|couldn't verify/);
    expect(got.meta.key_status).toBeUndefined();
    expect(got.identity.key_status).toBeUndefined();
    expect(got.identity.credential_source).toBe('none');
  });

  it('validator unreachable (503): unverified, and the key is NOT called bad', async () => {
    const got = await call('/mcp', { 'x-api-key': DOWN });
    expect(got.status).toBe(200);
    expect(got.meta.key_status).toBe('unverified');
    expect(got.first).toMatch(/^DC Hub couldn't verify the DC Hub API key/);
    expect(got.first).toMatch(/not a problem with your key/);
    expect(got.first).not.toMatch(/isn't valid|invalid|Get a new key/i);
  });

  it('a transient failure is not cached: the next call re-validates and is clean', async () => {
    const first = await call('/mcp', { 'x-api-key': DOWN_TWICE });
    expect(first.meta.key_status).toBe('unverified');
    const second = await call('/mcp', { 'x-api-key': DOWN_TWICE });
    expect(downCalls.get(DOWN_TWICE)).toBe(2);   // it really asked again
    expect(second.meta.key_status).toBeUndefined();
    expect(second.first).not.toMatch(/isn't valid|couldn't verify/);
  });

  it('a REAL key held by a counting gate is restricted, never called invalid', async () => {
    const got = await call('/mcp', { 'x-api-key': RESTRICTED });
    expect(got.meta.key_status).toBe('restricted');
    expect(got.first).not.toMatch(/isn't valid|Get a new key/);
  });

  it('search keeps the one-JSON-item connector contract: machine field only', async () => {
    const r = await post(`/mcp?apiKey=${k('g6badsearch')}`, {}, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'search', arguments: { query: 'reno' } },
    });
    const res = JSON.parse(r.json).result || {};
    expect((res._meta || {}).key_status).toBe('invalid');
    expect((res.content || []).map((c) => c.text || '').join('\n')).not.toMatch(/isn't valid/);
  });

  it('initialize with an invalid query key names it in the instructions', async () => {
    const r = await post(`/mcp?apiKey=${k('g6badinit')}`, {}, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {},
                clientInfo: { name: 'g6-test-client', version: '1.0.0' } },
    });
    const instr = JSON.parse(r.json).result.instructions;
    expect(instr).toMatch(/This DC Hub connector URL's API key isn't valid/);
    expect(r.raw).not.toContain(k('g6badinit'));
  });

  it('initialize with a valid key carries no such line', async () => {
    const r = await post('/mcp', { 'x-api-key': VALID }, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {},
                clientInfo: { name: 'g6-test-client', version: '1.0.0' } },
    });
    expect(JSON.parse(r.json).result.instructions).not.toMatch(/isn't valid/);
  });

  it('invalid Bearer is still a 401 challenge (unchanged)', async () => {
    const r = await post('/mcp', { authorization: `Bearer ${k('g6badbearer')}` }, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'search_facilities', arguments: { query: 'reno' } },
    });
    // Only asserted when the OAuth challenge is enabled in this env; otherwise
    // the bearer rides as a key and must at least be flagged invalid.
    if (r.status === 401) {
      expect(r.headers.get('www-authenticate')).toBeTruthy();
    } else {
      const res = JSON.parse(r.json).result || {};
      expect((res._meta || {}).key_status).toBe('invalid');
    }
  });
});

describe('unit: _keyStatus / _keyNoticeLine', () => {
  it('maps the ctx outcomes', () => {
    expect(S._keyStatus({ auth_source: 'none' })).toBeNull();
    expect(S._keyStatus({})).toBeNull();
    expect(S._keyStatus({ auth_source: 'header' })).toBeNull();
    expect(S._keyStatus({ auth_source: 'query', auth_refused: 'rejected' })).toBe('invalid');
    expect(S._keyStatus({ auth_source: 'query', auth_refused: 'daily_cap' })).toBe('restricted');
    expect(S._keyStatus({ auth_source: 'query', auth_unverified: true })).toBe('unverified');
  });

  it('no "free-tier" line when a session key still served the call', () => {
    expect(S._keyNoticeLine({ auth_source: 'header', auth_refused: 'rejected', api_key: VALID })).toBeNull();
  });
});

describe('hard gate: no network', () => {
  it('no connection left 127.0.0.1', () => {
    expect(foreign).toEqual([]);
  });
});
