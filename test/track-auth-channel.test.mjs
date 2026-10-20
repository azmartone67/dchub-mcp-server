// track-auth-channel.test.mjs — onboarding item 1 (owner 2026-10-20)
//
// ★WHAT THIS PINS. The /api/v1/mcp/track payload for a tool call carries `auth_channel`, the
// channel the call's credential arrived on, so dchub-backend can split a claimed key's later-day
// calls by HOW the key came back (connector URL, client header, OAuth, server-side session
// restore) — the one rung of the claim ladder nothing measured. A wrong channel here would
// silently mis-credit the persistence path the ladder exists to judge, so each value is driven
// through the real POST /mcp handler, not only through the pure helper.
//
// Qualifies for the hard gate: the only sockets are a 127.0.0.1 backend stub and the real
// express app listening on 127.0.0.1.
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
const CLAIMED = 'dch_live_' + 'claimedinsession'.padEnd(32, 'x');
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
  if (key === CLAIMED) {
    return { valid: true, tier: 'free', developer_id: null, email: null, source: 'claim_api', streak: null };
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
      if (p === '/api/v1/keys/claim') {
        await readBody(req);
        res.end(JSON.stringify({ api_key: CLAIMED, tier: 'free' }));
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


describe('_trackAuthChannel (pure)', () => {
  it('maps each ctx shape to one channel, and null when ctx has no auth_source', () => {
    const f = (c) => S._trackAuthChannel(c);
    expect(f(null)).toBe(null);
    expect(f({})).toBe(null);
    expect(f({ auth_source: 'header', api_key: 'k' })).toBe('header');
    expect(f({ auth_source: 'bearer', api_key: 'k' })).toBe('bearer');
    expect(f({ auth_source: 'bearer', api_key: 'k', auth_oauth: true })).toBe('oauth');
    expect(f({ auth_source: 'query', api_key: 'k' })).toBe('query');
    expect(f({ auth_source: 'inline_argument', api_key: 'k' })).toBe('inline_argument');
    expect(f({ auth_source: 'session_restore', api_key: 'k' })).toBe('session_restore');
    expect(f({ auth_source: 'none', api_key: 'k' })).toBe('session');
    expect(f({ auth_source: 'none', api_key: null })).toBe('none');
    expect(f({ auth_source: 'something-new', api_key: 'k' })).toBe(null);
  });
});

describe('auth_channel rides the track payload of a real /mcp tool call', () => {
  it('a key in the connector URL is tracked as query', async () => {
    const got = await search(`/mcp?apiKey=${ACCEPTED}`, {}, 'ch-query');
    expect(got.bodies.map((b) => [b.api_key, b.auth_channel])).toEqual([[ACCEPTED, 'query']]);
  });

  it('a key in the X-API-Key header is tracked as header', async () => {
    const got = await search('/mcp', { 'x-api-key': ACCEPTED }, 'ch-header');
    expect(got.bodies.map((b) => [b.api_key, b.auth_channel])).toEqual([[ACCEPTED, 'header']]);
  });

  it('no credential is tracked as none', async () => {
    const got = await search('/mcp', {}, 'ch-none');
    expect(got.bodies.map((b) => [b.api_key, b.auth_channel])).toEqual([[null, 'none']]);
  });

  it('a key claimed in this session and auto-bound is tracked as session, not as a pasted key', async () => {
    const init = await post('/mcp', {}, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {},
                clientInfo: { name: 'openai-mcp', version: '1.0.0' } },
    });
    const sid = init.headers.get('mcp-session-id');
    expect(sid, 'initialize did not mint a session id').toBeTruthy();
    const h = { 'mcp-session-id': sid };
    await post('/mcp', h, { jsonrpc: '2.0', method: 'notifications/initialized' });
    const claim = await post('/mcp', h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'claim_free_key', arguments: { client_name: 'auth-channel-test' } } });
    expect(claim.json).toContain(CLAIMED);
    const got = await search('/mcp', h, 'ch-session');
    expect(got.bodies.map((b) => [b.api_key, b.auth_channel])).toEqual([[CLAIMED, 'session']]);
  });
});

describe('hard gate: no network', () => {
  it('no connection left 127.0.0.1', () => {
    expect(foreign).toEqual([]);
  });
});
