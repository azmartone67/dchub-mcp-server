// Offline unit + integration tests for the dormant OAuth 2.1 AS (oauth.mjs).
// No network: boots the routes on an ephemeral express app and drives the flow.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createHash } from 'crypto';
import { registerOAuthRoutes, resolveOAuthToken, verifyPkceS256, oauthEnabled, __test } from '../oauth.mjs';

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const VERIFIER = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'; // 64 chars, valid
const CHALLENGE = b64url(createHash('sha256').update(VERIFIER).digest());
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let base;
let srv;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerOAuthRoutes(app, { issuer: 'https://dchub.cloud', mintIdentity: async () => ({ api_key: 'dch_live_stub', tier: 'free' }) });
  await new Promise((r) => { srv = app.listen(0, r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => { try { srv.close(); } catch {} });

const ON = () => { process.env.DCHUB_OAUTH_ENABLED = 'on'; };
const OFF = () => { delete process.env.DCHUB_OAUTH_ENABLED; };

async function register() {
  const r = await fetch(base + '/oauth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT] }),
  });
  return { status: r.status, body: await r.json() };
}
async function authorize(params) {
  const u = new URL(base + '/oauth/authorize');
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  const r = await fetch(u, { redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location'), json: r.status >= 400 ? await r.json().catch(() => ({})) : null };
}
async function token(form) {
  const r = await fetch(base + '/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

describe('PKCE S256 verification', () => {
  it('accepts a correct verifier/challenge pair', () => {
    expect(verifyPkceS256(VERIFIER, CHALLENGE)).toBe(true);
  });
  it('rejects a wrong verifier', () => {
    expect(verifyPkceS256(VERIFIER + 'x'.slice(0, 0) + 'Z', CHALLENGE)).toBe(false);
    expect(verifyPkceS256('ZabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXY', CHALLENGE)).toBe(false);
  });
  it('rejects out-of-bounds / non-string / illegal-char verifiers', () => {
    expect(verifyPkceS256('short', CHALLENGE)).toBe(false);          // < 43
    expect(verifyPkceS256('a'.repeat(129), CHALLENGE)).toBe(false);  // > 128
    expect(verifyPkceS256(null, CHALLENGE)).toBe(false);
    expect(verifyPkceS256('a'.repeat(50) + ' space', CHALLENGE)).toBe(false); // illegal char
  });
});

describe('DORMANCY — flag OFF', () => {
  beforeAll(OFF);
  it('oauthEnabled() is false', () => expect(oauthEnabled()).toBe(false));
  it('every route 404s', async () => {
    expect((await fetch(base + '/.well-known/oauth-protected-resource/mcp')).status).toBe(404);
    expect((await fetch(base + '/.well-known/oauth-authorization-server')).status).toBe(404);
    expect((await register()).status).toBe(404);
    expect((await authorize({ client_id: 'x', redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' })).status).toBe(404);
    expect((await token({ grant_type: 'authorization_code', code: 'x' })).status).toBe(404);
  });
  it('resolveOAuthToken returns null even for a valid-shaped token in cache', async () => {
    __test._tokens.set('dcht_probe', { api_key: 'k', tier: 'free', expires: Date.now() + 1e6 });
    expect(await resolveOAuthToken('dcht_probe')).toBeNull();   // flag off → null before any cache/store read
    __test._tokens.delete('dcht_probe');
  });
});

describe('FULL FLOW — flag ON', () => {
  beforeAll(ON);
  afterAll(OFF);

  it('metadata advertises S256-only + none auth + code', async () => {
    const as = await (await fetch(base + '/.well-known/oauth-authorization-server')).json();
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(as.grant_types_supported).toEqual(['authorization_code']);
    const prm = await (await fetch(base + '/.well-known/oauth-protected-resource/mcp')).json();
    expect(prm.authorization_servers).toContain('https://dchub.cloud');
  });

  it('register → authorize → token → resolve binds a durable identity', async () => {
    const reg = await register();
    expect(reg.status).toBe(201);
    const client_id = reg.body.client_id;
    expect(client_id).toMatch(/^dchc_/);

    const auth = await authorize({ client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'xyz' });
    expect(auth.status).toBe(302);
    const loc = new URL(auth.location);
    expect(loc.searchParams.get('state')).toBe('xyz');
    const code = loc.searchParams.get('code');
    expect(code).toBeTruthy();

    const tok = await token({ grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT, code_verifier: VERIFIER });
    expect(tok.status).toBe(200);
    expect(tok.body.token_type).toBe('Bearer');
    const access = tok.body.access_token;
    expect(access).toMatch(/^dcht_/);

    const id = await resolveOAuthToken(access);   // warm-cache hit (token just minted)
    expect(id).toEqual({ api_key: 'dch_live_stub', tier: 'free' });
  });

  it('rejects an unregistered redirect_uri WITHOUT redirecting (no open redirect)', async () => {
    const reg = await register();
    const r = await authorize({ client_id: reg.body.client_id, redirect_uri: 'https://evil.example/cb', response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' });
    expect(r.status).toBe(400);
    expect(r.location).toBeNull();
  });

  it('rejects plain PKCE method (redirected error)', async () => {
    const reg = await register();
    const r = await authorize({ client_id: reg.body.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'plain' });
    expect(r.status).toBe(302);
    expect(new URL(r.location).searchParams.get('error')).toBe('invalid_request');
  });

  it('rejects a bad PKCE verifier at the token endpoint', async () => {
    const reg = await register();
    const auth = await authorize({ client_id: reg.body.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' });
    const code = new URL(auth.location).searchParams.get('code');
    const tok = await token({ grant_type: 'authorization_code', code, client_id: reg.body.client_id, redirect_uri: REDIRECT, code_verifier: 'WRONGverifierWRONGverifierWRONGverifierWRONG1' });
    expect(tok.status).toBe(400);
    expect(tok.body.error).toBe('invalid_grant');
  });

  it('burns the code on single use (replay fails)', async () => {
    const reg = await register();
    const auth = await authorize({ client_id: reg.body.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' });
    const code = new URL(auth.location).searchParams.get('code');
    const t1 = await token({ grant_type: 'authorization_code', code, client_id: reg.body.client_id, redirect_uri: REDIRECT, code_verifier: VERIFIER });
    expect(t1.status).toBe(200);
    const t2 = await token({ grant_type: 'authorization_code', code, client_id: reg.body.client_id, redirect_uri: REDIRECT, code_verifier: VERIFIER });
    expect(t2.status).toBe(400);
    expect(t2.body.error).toBe('invalid_grant');
  });

  it('rejects an unsupported grant_type', async () => {
    const t = await token({ grant_type: 'password', username: 'x' });
    expect(t.status).toBe(400);
    expect(t.body.error).toBe('unsupported_grant_type');
  });

  it('rejects code reuse across a different client/redirect (binding check)', async () => {
    const reg = await register();
    const auth = await authorize({ client_id: reg.body.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' });
    const code = new URL(auth.location).searchParams.get('code');
    const t = await token({ grant_type: 'authorization_code', code, client_id: 'dchc_someoneelse', redirect_uri: REDIRECT, code_verifier: VERIFIER });
    expect(t.status).toBe(400);
    expect(t.body.error).toBe('invalid_grant');
  });

  it('X1: resolveOAuthToken returns null for an unknown token (anon-fallthrough fence)', async () => {
    expect(await resolveOAuthToken('dcht_never_issued')).toBeNull();
  });
  it('X1b: resolveOAuthToken returns null for a non-dcht_ Bearer WITHOUT touching the store (hot-path gate)', async () => {
    expect(await resolveOAuthToken('dch_live_somekey')).toBeNull();   // real X-API-Key as Bearer → fall through
  });
});

describe('C3 — mint failure never issues a hollow token', () => {
  beforeAll(ON);
  afterAll(OFF);
  it('returns 503 (not a 200 token) when identity binding throws', async () => {
    const app2 = express();
    app2.use(express.json());
    registerOAuthRoutes(app2, { issuer: 'https://dchub.cloud', mintIdentity: async () => { throw new Error('backend down'); } });
    const srv2 = await new Promise((r) => { const s = app2.listen(0, () => r(s)); });
    const b2 = `http://127.0.0.1:${srv2.address().port}`;
    try {
      const reg = await (await fetch(b2 + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json();
      const u = new URL(b2 + '/oauth/authorize');
      for (const [k, v] of Object.entries({ client_id: reg.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' })) u.searchParams.set(k, v);
      const auth = await fetch(u, { redirect: 'manual' });
      const code = new URL(auth.headers.get('location')).searchParams.get('code');
      const tok = await fetch(b2 + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: VERIFIER }) });
      expect(tok.status).toBe(503);
      expect((await tok.json()).error).toBe('temporarily_unavailable');
    } finally { srv2.close(); }
  });
});

describe('M2 — rate limiting (armed)', () => {
  beforeAll(ON);
  afterAll(OFF);
  const regWithIp = (ip) => fetch(base + '/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ redirect_uris: [REDIRECT] }),
  });
  it('429s after the per-IP register limit (Retry-After set); a different IP is unaffected', async () => {
    const IP = '203.0.113.7';          // TEST-NET-3 — unique bucket, no pollution of other tests
    let got429 = false, retryAfter = null;
    for (let i = 0; i < 25; i++) {     // register limit is 20 / 10min
      const r = await regWithIp(IP);
      if (r.status === 429) { got429 = true; retryAfter = r.headers.get('retry-after'); break; }
    }
    expect(got429).toBe(true);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const other = await regWithIp('203.0.113.8');
    expect(other.status).toBe(201);    // per-IP isolation: a fresh IP still works
  });
  it('does NOT rate-limit when dormant (guard short-circuits)', async () => {
    OFF();
    for (let i = 0; i < 30; i++) {
      const r = await regWithIp('203.0.113.9');
      expect(r.status).toBe(404);      // dormant → 404, never 429, no limiter state
    }
    ON();
  });
});

describe('P2 — durable store wiring (survives restart)', () => {
  beforeAll(ON);
  afterAll(OFF);
  function fakeStore() {
    const db = { client: new Map(), code: new Map(), token: new Map() };
    const calls = [];
    return {
      db, calls,
      async put(kind, key, data) { calls.push(['put', kind]); db[kind].set(key, { ...data }); },
      async get(kind, key) { calls.push(['get', kind]); return db[kind].get(key) || null; },
      async consume(kind, key) { calls.push(['consume', kind]); const v = db[kind].get(key) || null; db[kind].delete(key); return v; },
    };
  }
  it('write-throughs client/code/token to the store; resolve read-throughs on a cache miss', async () => {
    const fs = fakeStore();
    const app3 = express(); app3.use(express.json());
    registerOAuthRoutes(app3, { issuer: 'https://dchub.cloud', mintIdentity: async () => ({ api_key: 'dch_live_p2', tier: 'free' }), store: fs });
    const srv3 = await new Promise((r) => { const s = app3.listen(0, () => r(s)); });
    const b3 = `http://127.0.0.1:${srv3.address().port}`;
    try {
      const reg = await (await fetch(b3 + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json();
      const u = new URL(b3 + '/oauth/authorize');
      for (const [k, v] of Object.entries({ client_id: reg.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' })) u.searchParams.set(k, v);
      const auth = await fetch(u, { redirect: 'manual' });
      const code = new URL(auth.headers.get('location')).searchParams.get('code');
      const tok = await (await fetch(b3 + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: VERIFIER }) })).json();
      const access = tok.access_token;
      // the durable store saw the full lifecycle
      expect(fs.calls).toEqual(expect.arrayContaining([['put', 'client'], ['get', 'client'], ['put', 'code'], ['consume', 'code'], ['put', 'token']]));
      expect(fs.db.token.has(access)).toBe(true);
      // simulate a gateway restart: drop the warm cache → resolve MUST read the store
      __test._tokens.delete(access);
      const before = fs.calls.filter((c) => c[0] === 'get' && c[1] === 'token').length;
      const id = await resolveOAuthToken(access);
      expect(id).toEqual({ api_key: 'dch_live_p2', tier: 'free' });
      const after = fs.calls.filter((c) => c[0] === 'get' && c[1] === 'token').length;
      expect(after).toBe(before + 1);   // read-through happened
    } finally { srv3.close(); }
  });
});
