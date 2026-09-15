// connect-query-key-reaches-track.test.mjs — r-connect-return-join (2026-09-15)
//
// ★WHAT THIS PINS. dchub-backend's /api/v1/connect/stats counts a /connect key as used
// again when mcp_call_log.api_key equals the key the install page minted
// (routes/mcp_connect.py, _KEYS_USED_DAY2_SQL). The backend writes that column from the
// api_key field of the /api/v1/mcp/track payload this server sends. Its real-Postgres
// test writes the call rows by hand, so nothing checked that a key pasted into a
// connector URL (ChatGPT's snippet is https://dchub.cloud/mcp?apiKey=<key>) reaches that
// field at all.
//
// ★WHAT IT SHOWS. The key reaches the payload when the backend ACCEPTS it, on the
// stateless tools/call branch (a server-side client that sends no Mcp-Session-Id) and on
// a session. A key the backend REFUSES (200 + valid:false, e.g. an unbound trial key past
// its free calls) is dropped by _effectiveCallerKey: the call is served anonymously and
// the payload carries api_key null. Such a return cannot count toward keys_used_day2,
// and the response says why in identity.credential_refused.
//
// ★WHY REAL HTTP. The key is read from the URL by the POST /mcp handler, kept or dropped
// there, and read back out of the request context by the tool handler's finally block.
// Only a request through that handler crosses all three.
//
// Qualifies for the hard gate: the only sockets are a 127.0.0.1 backend stub and the
// real express app listening on 127.0.0.1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

// ★HARD GATE, NO NETWORK. Installed before server.mjs is imported: every socket connect
// to a host other than loopback is refused and recorded, and the last test fails on one.
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

// Shaped like the dch_trial_ keys /connect mints, built at runtime.
const trialKey = (label) => 'dch_trial_' + label.padEnd(32, 'x');
const ACCEPTED = trialKey('stateless');
const ACCEPTED_ON_SESSION = trialKey('sessioned');
const REFUSED = trialKey('refused');
const UA = 'openai-mcp/1.0.0';   // ChatGPT's connector: the platform resolves to 'chatgpt'

let S, PORT, httpServer, stub, prevBase;
const validated = [];   // keys the stub was asked to validate
const tracked = [];     // /api/v1/mcp/track bodies, in arrival order

const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: 3000 + i, name: `Facility ${i}`, provider: 'Test Provider', city: 'Charlotte',
  state: 'NC', country: 'US', slug: `test-facility-${i}`, power_mw: 10 * (i + 1),
}));

// What /api/v1/keys/validate answers for a dch_trial_ key (flask_mcp_endpoints.validate_key).
function validateAnswer(key) {
  if (key === ACCEPTED || key === ACCEPTED_ON_SESSION) {
    return { valid: true, tier: 'free', developer_id: null, email: null,
             source: 'auto_trial', streak: null };
  }
  if (key === REFUSED) {
    return { valid: false, tier: 'free', reason: 'bind_email_required',
             upgrade_hint: 'This DC Hub key used its 10 free unbound calls.' };
  }
  return { valid: false, tier: 'free' };
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        validated.push(key);
        res.end(JSON.stringify(validateAnswer(key)));
        return;
      }
      if (p === '/api/v1/mcp/track') {
        tracked.push(await readBody(req));
        res.end('{}');
        return;
      }
      if (p === '/api/v1/facilities') {
        res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found', path: p }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  // API_BASE is captured once when server.mjs evaluates, so this goes before the import.
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

async function post(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'user-agent': UA, ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, json };
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
// trackToolCall is fire-and-forget, so its request can land after the response. Poll for it.
async function eventually(pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await sleep(20); }
  return pred();
}

/** One search_facilities call. `label` rides in the arguments, so its track body is findable. */
async function search(path, headers, label) {
  const { json } = await post(path, headers, {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'search_facilities', arguments: { query: label, limit: 25 } },
  });
  const result = JSON.parse(json).result || {};
  const mine = () => tracked.filter((b) => b.tool === 'search_facilities'
    && b.params && b.params.query === label);
  await eventually(() => mine().length > 0, 3000);
  return { identity: (result.structuredContent || {}).identity, bodies: mine() };
}

describe('a key in the connector URL reaches the call log only when DC Hub accepts it', () => {
  it('stateless tools/call with an accepted key: the track payload carries the key', async () => {
    const got = await search(`/mcp?apiKey=${ACCEPTED}`, {}, 'stateless-accepted');
    expect(validated, 'the key never reached /api/v1/keys/validate').toContain(ACCEPTED);
    expect(got.bodies.map((b) => [b.api_key, b.platform, b.session_id]))
      .toEqual([[ACCEPTED, 'chatgpt', null]]);
    expect(got.identity).toEqual({ credential_source: 'query', tier: 'free' });
  });

  it('stateless tools/call with a refused key: served anonymously, tracked with no key', async () => {
    const got = await search(`/mcp?apiKey=${REFUSED}`, {}, 'stateless-refused');
    expect(validated, 'the key never reached /api/v1/keys/validate').toContain(REFUSED);
    expect(got.bodies.map((b) => [b.api_key, b.platform])).toEqual([[null, 'chatgpt']]);
    expect(got.identity && got.identity.credential_source).toBe('query');
    expect(got.identity && got.identity.credential_refused).toBe('bind_email_required');
  });

  it('a session opened with the key carries it on the call', async () => {
    const path = `/mcp?apiKey=${ACCEPTED_ON_SESSION}`;
    const init = await post(path, {}, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {},
                clientInfo: { name: 'openai-mcp', version: '1.0.0' } },
    });
    const sid = init.headers.get('mcp-session-id');
    expect(sid, 'initialize did not mint a session id').toBeTruthy();
    const h = { 'mcp-session-id': sid };
    await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
    const got = await search(path, h, 'sessioned-accepted');
    expect(got.bodies.map((b) => [b.api_key, b.session_id])).toEqual([[ACCEPTED_ON_SESSION, sid]]);
    expect(got.identity && got.identity.credential_refused).toBeUndefined();
  });

  it('control: a call with no key is tracked with no key', async () => {
    const got = await search('/mcp', {}, 'no-key');
    expect(got.bodies.map((b) => b.api_key)).toEqual([null]);
    expect(got.identity && got.identity.credential_source).toBe('none');
  });
});

describe('hard gate: no network', () => {
  it('no connection left 127.0.0.1', () => {
    expect(foreign).toEqual([]);
  });
});
