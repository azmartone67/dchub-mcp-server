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
  it('resolveOAuthToken returns null even for a token in the store', () => {
    __test._tokens.set('probe', { api_key: 'k', tier: 'free', expires: Date.now() + 1e6 });
    expect(resolveOAuthToken('probe')).toBeNull();
    __test._tokens.delete('probe');
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

    const id = resolveOAuthToken(access);
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

  it('X1: resolveOAuthToken returns null for an unknown token (anon-fallthrough fence)', () => {
    expect(resolveOAuthToken('dcht_never_issued')).toBeNull();
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
