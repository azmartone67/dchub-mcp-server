// auth-refused-identity.test.mjs — r-auth-refused (2026-09-14)
//
// ★THE DEFECT. identity.credential_source is read from the raw request BEFORE
// validation, so it names the channel a key arrived on, not whether the backend
// accepted it. When the backend refuses the key (200 + valid:false) the handler
// drops it (r-invalid-key-anon) and serves the call anonymously, and identity
// still read {credential_source:'header', tier:'free'}. Measured live
// 2026-09-14: a real key gated bind_email_required got the anonymous 3 rows of
// search_facilities under that identity, and an investigation concluded the
// request store was losing free keys. It was not; the key had been refused.
//
// ★WHY REAL HTTP. Separate handler branches build ctx (existing session,
// stateless tools/call) and each decides the key on its own; identity is stamped
// from that ctx. Only a request through the real POST /mcp handler shows what a
// caller reads. Same pattern as invalid-key-anon.test.mjs.
//
// ★THREE BACKEND ANSWERS: valid; 200 + bind_email_required (refused); 503
// (INDETERMINATE: the key rides and must NOT be reported refused). Each is
// driven through header, ?apiKey=, late header (anonymous initialize, then the
// header on tools/call) and stateless tools/call.
//
// ★HARD GATE, NO NETWORK. The backend is a 127.0.0.1 stub. DCHUB_API_BASE stays
// pointed at it until afterAll, because restoreSessionKey reads it per call (the
// anonymous-initialize path reaches it), not at import. Every socket connect to
// any other host is refused and recorded, and the last test fails if one was
// attempted.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

// Installed before server.mjs is imported, so nothing it starts slips past.
const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];                        // net.connect's normalized form
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

let S, PORT, httpServer, stub, prevBase, ANON;
const validateHits = {};

const GOOD  = 'dch_live_test_accepted_key';
const BIND  = 'dch_live_test_bind_gated_key';
const FLAKY = 'dch_live_test_backend_503_key';
const JUNK  = 'totally_made_up_key_zzz';

// 5 rows, more than the anonymous trim (3), so "served anonymously" shows up as
// a row count.
const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: 2000 + i,
  name: `Facility ${i}`,
  provider: 'Test Provider',
  city: 'Ashburn',
  state: 'VA',
  country: 'US',
  slug: `test-facility-${i}`,
  power_mw: 10 * (i + 1),
}));

function validateAnswer(res, key) {
  validateHits[key] = (validateHits[key] || 0) + 1;
  if (key === FLAKY) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'unavailable' }));
  } else if (key === GOOD) {
    res.end(JSON.stringify({ valid: true, tier: 'free', developer_id: 'dev_test', email: 'test@example.com' }));
  } else if (key === BIND) {
    res.end(JSON.stringify({ valid: false, tier: 'free', reason: 'bind_email_required',
                             upgrade_hint: 'bind an email to keep the free tier' }));
  } else {
    res.end(JSON.stringify({ valid: false, tier: 'free' }));
  }
}

function decode(raw) {
  return raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
}

// The tool text is a JSON object often followed by a human-relay markdown block;
// walk to the balanced close rather than parsing the whole string.
function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

async function rpc(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  return { headers: res.headers, raw: await res.text() };
}

async function search(path, headers) {
  const { raw } = await rpc(path, headers, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'search_facilities', arguments: { query: 'Ashburn', limit: 25 } },
  });
  const r = JSON.parse(decode(raw)).result || {};
  const payload = leadingJson((r.content || []).map((c) => c.text || '').join(''));
  return {
    rows: Array.isArray(payload && payload.data) ? payload.data.length : null,
    identity: (r.structuredContent && r.structuredContent.identity) || null,
  };
}

async function initialize(path, headers) {
  const { headers: h } = await rpc(path, headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {},
              clientInfo: { name: 'auth-refused-test', version: '1.0' } },
  });
  const sid = h.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  await rpc(path, { ...headers, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return sid;
}

const keyHeader = (k) => ({ 'x-api-key': k });

// [label, the channel identity must name, one search_facilities call carrying key k]
const PATHS = [
  ['header: X-API-Key on initialize and tools/call', 'header', async (k) => {
    const sid = await initialize('/mcp', keyHeader(k));
    return search('/mcp', { ...keyHeader(k), 'mcp-session-id': sid });
  }],
  ['query: ?apiKey= on initialize and tools/call', 'query', async (k) => {
    const path = `/mcp?apiKey=${k}`;
    const sid = await initialize(path, {});
    return search(path, { 'mcp-session-id': sid });
  }],
  ['late header: anonymous initialize, X-API-Key on tools/call', 'header', async (k) => {
    const sid = await initialize('/mcp', {});
    return search('/mcp', { ...keyHeader(k), 'mcp-session-id': sid });
  }],
  ['stateless: tools/call with X-API-Key and no session', 'header', (k) => search('/mcp', keyHeader(k))],
];

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/validate') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          let key = '';
          try { key = (JSON.parse(body || '{}').api_key) || ''; } catch (_) {}
          validateAnswer(res, key);
        });
        return;
      }
      if (url.pathname === '/api/v1/facilities') {
        res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });

  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  ANON = await search('/mcp', {});
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

describe('r-auth-refused — identity says so when a presented key was REFUSED', () => {
  it('control: anonymous is trimmed below the stub rows, so a row count tells keyed from anonymous', () => {
    expect(ANON.rows).toBeGreaterThan(0);
    expect(ANON.rows).toBeLessThan(ROWS.length);
    expect(ANON.identity && ANON.identity.credential_source).toBe('none');
  });

  // r-auth-unverified (2026-09-20): a 503 now also stamps
  // identity.credential_unverified on the paths that actually RE-VALIDATE on
  // the asserted call. The two session paths below do not: they hand the key in
  // at initialize, and a follow-up tools/call carrying the SAME key is served
  // from session meta without a fresh validate, so there is no indeterminate
  // answer at that moment to report. Listed by label rather than inferred, so
  // this asymmetry is stated and not discovered again.
  const REVALIDATES_ON_THE_ASSERTED_CALL = new Set([
    'late header: anonymous initialize, X-API-Key on tools/call',
    'stateless: tools/call with X-API-Key and no session',
  ]);

  describe.each(PATHS)('%s', (_label, channel, call) => {
    it('valid key: served keyed, identity names the channel and nothing else', async () => {
      const got = await call(GOOD);
      expect(got.rows).toBe(ROWS.length);
      expect(got.identity).toEqual({ credential_source: channel, tier: 'free' });
    });

    it('200 + bind_email_required: still served anonymously, and identity says the key was refused', async () => {
      const got = await call(BIND);
      // r-invalid-key-anon stays closed: the refused key buys no depth.
      expect(got.rows).toBe(ANON.rows);
      expect(got.identity.credential_source).toBe(channel);
      expect(got.identity.credential_refused).toBe('bind_email_required');
      expect(got.identity.means).toMatch(/served ANONYMOUSLY/);
      // bind_email binds the session's ACTIVE key unless api_key is passed, and a
      // refused key is not active, so the prose has to say to pass it.
      expect(got.identity.means).toContain('`bind_email`');
      expect(got.identity.means).toContain('api_key');
    });

    it('503 (indeterminate): the key rides and is NOT reported refused', async () => {
      const got = await call(FLAKY);
      expect(got.rows).toBe(ROWS.length);
      expect(got.identity.credential_refused).toBeUndefined();   // the invariant this test owns
      expect(got.identity).toEqual(
        REVALIDATES_ON_THE_ASSERTED_CALL.has(_label)
          ? {
              credential_source: channel, tier: 'free',
              credential_unverified: true,
              means: expect.stringContaining('could NOT be checked'),
            }
          : { credential_source: channel, tier: 'free' });
    });
  });

  it('a refusal with no reason reads "rejected", without the bind_email advice', async () => {
    const got = await search('/mcp', keyHeader(JUNK));
    expect(got.rows).toBe(ANON.rows);
    expect(got.identity.credential_refused).toBe('rejected');
    expect(got.identity.means).toMatch(/served ANONYMOUSLY/);
    expect(got.identity.means).not.toContain('bind_email');
  });

  it('session already holding a valid key + refused header key: refusal reported, call NOT called anonymous', async () => {
    const sid = await initialize('/mcp', keyHeader(GOOD));
    const got = await search('/mcp', { ...keyHeader(BIND), 'mcp-session-id': sid });
    expect(got.rows).toBe(ROWS.length);                  // served under the session's key
    expect(got.identity.credential_refused).toBe('bind_email_required');
    expect(got.identity.means).not.toMatch(/ANONYMOUSLY/);
    expect(got.identity.means).toMatch(/already held/);
  });

  it('session already holding a valid key + 503 header key: NOT reported refused', async () => {
    // The one case where the served key differs from the presented key AND the
    // answer is indeterminate, so it alone pins "a 503 is never a refusal" in
    // the reporting (everywhere else the key rides and nothing is refused anyway).
    const sid = await initialize('/mcp', keyHeader(GOOD));
    const got = await search('/mcp', { ...keyHeader(FLAKY), 'mcp-session-id': sid });
    expect(got.rows).toBe(ROWS.length);
    expect(got.identity.credential_refused).toBeUndefined();
    // This path DOES re-validate (the presented key differs from the session's),
    // so r-auth-unverified reports it.
    expect(got.identity).toEqual({
      credential_source: 'header', tier: 'free',
      credential_unverified: true,
      means: expect.stringContaining('could NOT be checked'),
    });
  });

  it('kill switch DCHUB_INVALID_KEY_ANON_DISABLE=1: a rejected key that rides is not reported refused', async () => {
    const prev = process.env.DCHUB_INVALID_KEY_ANON_DISABLE;
    process.env.DCHUB_INVALID_KEY_ANON_DISABLE = '1';
    try {
      const got = await search('/mcp', keyHeader(BIND));
      expect(got.rows).toBe(ROWS.length);
      expect(got.identity).toEqual({ credential_source: 'header', tier: 'free' });
    } finally {
      if (prev === undefined) delete process.env.DCHUB_INVALID_KEY_ANON_DISABLE;
      else process.env.DCHUB_INVALID_KEY_ANON_DISABLE = prev;
    }
  });

  it('the stub answered every key, and no connection left 127.0.0.1', () => {
    // A guard that never reached the stub asserted nothing; fail it.
    for (const k of [GOOD, BIND, FLAKY, JUNK]) {
      expect(validateHits[k] || 0, `the stub never validated ${k}`).toBeGreaterThan(0);
    }
    expect(foreign).toEqual([]);
  });
});
