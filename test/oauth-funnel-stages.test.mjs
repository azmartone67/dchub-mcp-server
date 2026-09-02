// oauth-funnel-stages.test.mjs — r-oauth-funnel-stages (2026-09-02, QA sweep F2)
//
// MEASURED 2026-09-02 00:23Z: oauth_connector_challenges_per_new_identity_30d
// = 1,111 with only the two ENDS of the funnel counted (challenges we issued;
// identities that resolved). Three stage counters now ride the same closed
// set, the same 60s flusher and the same sink as the existing kinds:
//   challenge_issued → oauth_authorize_started → identity_created
// so the retention read can say WHERE the loss happens.
//
// Assertions: (1) the closed-set counter accepts exactly these names and
// rejects anything else; (2) challenge_issued is bumped INSIDE the 401 branch
// (outside it, it is just an arrival counter); (3) the built-in AS emits the
// two later stages through its onEvent hook, once each, and reuses the
// identity on the second exchange (no double identity_created); (4) the
// gateway actually wires that hook.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createHash } from 'crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _chBump, _chStage, _chCounts } from '../server.mjs';
import { registerOAuthRoutes } from '../oauth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'server.mjs'), 'utf8');

beforeEach(() => { delete process.env.DCHUB_OAUTH_CHALLENGE_COUNT_DISABLE; _chCounts.clear(); });

describe('the closed kind set', () => {
  it('counts the three stages, keyed kind:method', () => {
    _chBump('challenge_issued', 'tools/call');
    _chBump('challenge_issued', 'initialize');
    _chStage('oauth_authorize_started');
    _chStage('identity_created');
    expect(_chCounts.get('challenge_issued:tools/call')).toBe(1);
    expect(_chCounts.get('challenge_issued:initialize')).toBe(1);
    expect(_chCounts.get('oauth_authorize_started:other')).toBe(1);
    expect(_chCounts.get('identity_created:other')).toBe(1);
  });
  it('still rejects a kind it does not know (cardinality stays closed)', () => {
    _chBump('__proto__', 'tools/call');
    _chBump('something_attacker_chose', 'tools/call');
    expect(_chCounts.size).toBe(0);
  });
  it('is inert under the kill switch', () => {
    process.env.DCHUB_OAUTH_CHALLENGE_COUNT_DISABLE = '1';
    _chBump('challenge_issued', 'tools/call');
    expect(_chCounts.size).toBe(0);
  });
});

describe('challenge_issued sits inside the 401 challenge branch', () => {
  it('is bumped exactly once, between the WWW-Authenticate header and the 401 return', () => {
    const re = /_chBump\('challenge_issued'/g;
    const hits = [...SRC.matchAll(re)];
    expect(hits.length).toBe(1);
    const at = hits[0].index;
    const before = SRC.lastIndexOf("Bearer resource_metadata=\"https://dchub.cloud/api/v1/oauth-protected-resource\"", at);
    const after = SRC.indexOf('return res.status(401)', at);
    expect(before).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(-1);
    expect(at - before).toBeLessThan(600);    // same branch, not a later one
    expect(after - at).toBeLessThan(600);
    // and the branch that CONTAINS it is the challenge, not the invalid-bearer 401
    expect(SRC.slice(before, after)).toContain("_chBump('claude_connector'");
  });
  it('the gateway hands oauth.mjs its stage hook', () => {
    expect(SRC).toContain('onEvent: _chStage,');
  });
});

describe('the built-in AS emits the later stages through onEvent', () => {
  const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const VERIFIER = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const CHALLENGE = b64url(createHash('sha256').update(VERIFIER).digest());
  const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
  const events = [];
  let base, srv, mints = 0;
  beforeAll(async () => {
    process.env.DCHUB_OAUTH_ENABLED = 'on';
    const app = express();
    app.use(express.json());
    registerOAuthRoutes(app, {
      issuer: 'https://dchub.cloud',
      onEvent: (k) => events.push(k),
      mintIdentity: async () => ({ api_key: 'dch_live_stage_' + (++mints), tier: 'free' }),
    });
    await new Promise((r) => { srv = app.listen(0, r); });
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  afterAll(() => { delete process.env.DCHUB_OAUTH_ENABLED; try { srv.close(); } catch {} });

  async function fullFlow(client_id) {
    const p = { client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's1' };
    const u = new URL(base + '/oauth/authorize');
    for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
    const g = await fetch(u, { redirect: 'manual' });
    expect(g.status).toBe(200);
    await g.text();
    const d = await fetch(base + '/oauth/authorize/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...p, decision: 'approve' }), redirect: 'manual',
    });
    expect(d.status).toBe(302);
    const code = new URL(d.headers.get('location')).searchParams.get('code');
    const t = await fetch(base + '/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT, code_verifier: VERIFIER }),
    });
    expect(t.status).toBe(200);
    return (await t.json()).access_token;
  }

  it('authorize → started; first token exchange → identity_created; second exchange reuses (no second created)', async () => {
    const r = await fetch(base + '/oauth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT] }),
    });
    const { client_id } = await r.json();
    await fullFlow(client_id);
    expect(events).toEqual(['oauth_authorize_started', 'identity_created']);
    await fullFlow(client_id);
    expect(events.filter((e) => e === 'oauth_authorize_started').length).toBe(2);
    expect(events.filter((e) => e === 'identity_created').length).toBe(1);   // reused per client_id
    expect(mints).toBe(1);
  });
  it('a rejected authorize (unregistered redirect) emits nothing', async () => {
    const n = events.length;
    const u = new URL(base + '/oauth/authorize');
    for (const [k, v] of Object.entries({ client_id: 'nope', redirect_uri: 'https://evil.example/cb', response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' })) u.searchParams.set(k, v);
    const g = await fetch(u, { redirect: 'manual' });
    expect(g.status).toBe(400);
    expect(events.length).toBe(n);
  });
});
