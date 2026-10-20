// claude-directory-lazy-auth.test.mjs — optional sign-in on /mcp/claude (owner GO 2026-10-20).
//
// Claude offers sign-in only when an HTTP request fails with 401 + WWW-Authenticate
// (resource_metadata). On /mcp/claude a keyless tools/call whose result is a PREVIEW is
// now answered that way; a keyless call whose answer is complete is still served, and
// any credential at all is never challenged here. /mcp and /mcp/chatgpt are unchanged.
//
// The fake backend answers a keyless data route with a withheld field (_score_in_pro) —
// a preview — unless the request asks for the planted COMPLETE news query, which comes back
// with nothing withheld. OAuth is real: jose signs RS256 JWTs with a key the fake backend
// publishes as the AuthKit JWKS. Loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import {
  CLAUDE_PRM_URL, CLAUDE_RESOURCE, CLAUDE_PLANS_NOTICE, CLAUDE_LAZY_AUTH_CHALLENGE,
  claudeLazyAuthEnabled, claudeLazyAuthEligible, claudeLazyAuthResponse,
} from '../lib/claude-directory.mjs';
import { rawBodyIsGated } from '../lib/chatgpt-directory.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const DIR = '/mcp/claude';
const COMPLETE = 'complete-market';
let H, fence, privateKey, ISS;

beforeAll(async () => {
  fence = fenceNetwork();
  ({ privateKey } = await generateKeyPair('RS256', { extractable: true }));
  const jwk = await exportJWK(privateKey);
  const { d, p, q, dp, dq, qi, ...pub } = jwk;
  H = await startHarness({
    env: (base) => ({ DCHUB_WORKOS_OAUTH_ENABLED: '1', WORKOS_AUTHKIT_DOMAIN: base }),
    extraRoutes: (path, req, body, u) => {
      if (path === '/oauth2/jwks') return { keys: [{ ...pub, kid: 'k1', alg: 'RS256', use: 'sig' }] };
      if (path === '/api/v1/oauth/identity') return { api_key: PRO_KEY, tier: 'pro', created: false };
      // A keyless answer with nothing withheld.
      if (u && (String(u.search) + path).includes(COMPLETE)) {
        return { success: true, items: [{ title: COMPLETE, demand_mw: 1200 }], as_of: '2026-10-20T00:00:00Z' };
      }
      return undefined;
    },
  });
  ISS = H.base;
});
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
  delete process.env.DCHUB_CLAUDE_LAZY_AUTH;
});

async function jwt(aud, opts = {}) {
  return new SignJWT({ email: null })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISS).setSubject(opts.sub || 'user_lazy_test').setAudience(aud)
    .setIssuedAt().setExpirationTime('10m')
    .sign(privateKey);
}

const EXPECTED_HEADER = `Bearer resource_metadata="${CLAUDE_PRM_URL}", scope="openid profile email offline_access"`;

describe('the challenge itself', () => {
  it('names the /mcp/claude metadata, no error code (RFC 6750 §3.1: no credential was sent)', () => {
    expect(CLAUDE_LAZY_AUTH_CHALLENGE).toBe(EXPECTED_HEADER);
    expect(CLAUDE_PRM_URL).toBe('https://dchub.cloud/.well-known/oauth-protected-resource/mcp/claude');
    expect(CLAUDE_LAZY_AUTH_CHALLENGE).not.toMatch(/error=/);
    const r = claudeLazyAuthResponse(7);
    expect(r.status).toBe(401);
    expect(r.headers['WWW-Authenticate']).toBe(EXPECTED_HEADER);
    expect(r.body).toEqual({ jsonrpc: '2.0', error: { code: -32001, message: expect.stringMatching(/^Sign in/) }, id: 7 });
  });

  it('eligibility: tools/call, no credential, OAuth on, kill switch off', () => {
    const base = { method: 'tools/call', hasCredential: false, workosEnabled: true, env: {} };
    expect(claudeLazyAuthEligible(base)).toBe(true);
    for (const m of ['initialize', 'tools/list', 'prompts/list', 'ping', 'resources/list']) {
      expect(claudeLazyAuthEligible({ ...base, method: m }), m).toBe(false);
    }
    expect(claudeLazyAuthEligible({ ...base, hasCredential: true })).toBe(false);
    expect(claudeLazyAuthEligible({ ...base, workosEnabled: false })).toBe(false);
    for (const off of ['0', 'false', 'no', 'off', 'OFF', ' 0 ']) {
      expect(claudeLazyAuthEligible({ ...base, env: { DCHUB_CLAUDE_LAZY_AUTH: off } }), off).toBe(false);
    }
    for (const on of [undefined, '', '1', 'true', 'on']) {
      expect(claudeLazyAuthEnabled(on === undefined ? {} : { DCHUB_CLAUDE_LAZY_AUTH: on }), String(on)).toBe(true);
    }
  });

  it('rawBodyIsGated reads JSON, batches and SSE, and only results', () => {
    const gated = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{}' }], structuredContent: { score: null, _score_in_pro: true } } };
    const full = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{}' }], structuredContent: { score: 71 } } };
    expect(rawBodyIsGated(JSON.stringify(gated))).toBe(true);
    expect(rawBodyIsGated(JSON.stringify(full))).toBe(false);
    expect(rawBodyIsGated(JSON.stringify([full, gated]))).toBe(true);
    expect(rawBodyIsGated(`event: message\ndata: ${JSON.stringify(gated)}\n\n`)).toBe(true);
    expect(rawBodyIsGated(`event: message\ndata: ${JSON.stringify(full)}\n\n`)).toBe(false);
    expect(rawBodyIsGated(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'pro_required' } }))).toBe(false);
    expect(rawBodyIsGated('')).toBe(false);
    expect(rawBodyIsGated('not json')).toBe(false);
  });
});

describe('keyless on /mcp/claude', () => {
  it('initialize and tools/list are served 200 with no challenge', async () => {
    const i = await H.init(DIR, 'claude-ai', { 'user-agent': 'Claude-User' });
    expect(i.status).toBe(200);
    expect(i.headers.get('www-authenticate')).toBeNull();
    const l = await H.list(DIR);
    expect(l.status).toBe(200);
    expect(l.headers.get('www-authenticate')).toBeNull();
    expect(l.msg.result.tools.length).toBeGreaterThan(10);
  });

  it('a call whose answer would be a preview is answered 401 + WWW-Authenticate (resource_metadata for /mcp/claude)', async () => {
    for (const [tool, args] of [['get_market_intel', { market: 'northern-virginia' }], ['get_news', { query: 'data center' }],
                                ['analyze_site', { lat: 39.04, lon: -77.48 }]]) {
      const r = await H.call(DIR, tool, args, { 'user-agent': 'Claude-User' });
      expect(r.status, tool).toBe(401);
      expect(r.headers.get('www-authenticate'), tool).toBe(EXPECTED_HEADER);
      expect(r.headers.get('content-type'), tool).toMatch(/application\/json/);
      expect(r.msg.error.code, tool).toBe(-32001);
      expect(r.msg.id, tool).not.toBeNull();
      // Nothing of the preview leaks into the refusal.
      expect(r.raw, tool).not.toMatch(/Ashburn Campus|_withheld|_in_pro|dch_|upgrade/i);
    }
  });

  it('any client, not only Claude: the path is the directory URL and the profile is stateless', async () => {
    const r = await H.call(DIR, 'get_market_intel', { market: 'northern-virginia' }, { 'user-agent': 'node' });
    expect(r.status).toBe(401);
  });

  it('a call whose keyless answer is complete is still served 200', async () => {
    const r = await H.call(DIR, 'get_news', { query: COMPLETE });
    expect(r.status).toBe(200);
    expect(r.headers.get('www-authenticate')).toBeNull();
    expect(r.body).toContain(COMPLETE);
    expect(JSON.stringify(r.msg.result)).not.toContain(CLAUDE_PLANS_NOTICE);
  });

  it('kill switch DCHUB_CLAUDE_LAZY_AUTH=0 restores the 200 preview byte-for-byte in shape', async () => {
    process.env.DCHUB_CLAUDE_LAZY_AUTH = '0';
    try {
      const r = await H.call(DIR, 'get_market_intel', { market: 'northern-virginia' });
      expect(r.status).toBe(200);
      expect(r.headers.get('www-authenticate')).toBeNull();
      expect(JSON.stringify(r.msg.result)).toContain(CLAUDE_PLANS_NOTICE);
    } finally { delete process.env.DCHUB_CLAUDE_LAZY_AUTH; }
  });
});

describe('after sign-in, and every other credential', () => {
  it('a WorkOS token for https://dchub.cloud/mcp/claude gets the full answer (the retried call)', async () => {
    const tok = await jwt(CLAUDE_RESOURCE);
    const before = H.hits.length;
    const r = await H.call(DIR, 'get_market_intel', { market: 'northern-virginia' }, { authorization: `Bearer ${tok}` });
    expect(r.status).toBe(200);
    expect(r.headers.get('www-authenticate')).toBeNull();
    expect(H.hits.slice(before).some((h) => h.apiKey === PRO_KEY)).toBe(true);
    expect(JSON.stringify(r.msg.result)).not.toContain(CLAUDE_PLANS_NOTICE);
    expect(r.body).toContain('71');
  });

  it('a credential that still gets a preview (a free account) is served the preview, never a sign-in loop', async () => {
    const free = 'dch_free_lazyauthtest0123456789';
    for (const h of [{ 'x-api-key': free }, { authorization: `Bearer ${free}` }]) {
      const r = await H.call(DIR, 'get_market_intel', { market: 'northern-virginia' }, h);
      // A key the backend calls invalid: x-api-key → preview (200); a bearer → the
      // existing invalid-token 401 (error="invalid_token"), not the lazy-auth one.
      if (h.authorization) {
        expect(r.status).toBe(401);
        expect(r.headers.get('www-authenticate')).toContain('error="invalid_token"');
      } else {
        expect(r.status).toBe(200);
        expect(JSON.stringify(r.msg.result)).toContain(CLAUDE_PLANS_NOTICE);
      }
    }
    const q = await H.call(`${DIR}?api_key=${free}`, 'get_market_intel', { market: 'northern-virginia' });
    expect(q.status).toBe(200);
    const inl = await H.call(DIR, 'get_market_intel', { market: 'northern-virginia', api_key: free });
    expect(inl.status).toBe(200);
  });

  it('X-API-Key / ?api_key= Pro keys: full answers, no challenge', async () => {
    for (const [p, h] of [[DIR, { 'x-api-key': PRO_KEY }], [`${DIR}?api_key=${PRO_KEY}`, {}]]) {
      const r = await H.call(p, 'get_market_intel', { market: 'northern-virginia' }, h);
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.msg.result)).not.toContain(CLAUDE_PLANS_NOTICE);
    }
  });
});

describe('other paths are unchanged', () => {
  it('/mcp, /mcp/chatgpt and /mcp/core keyless previews stay 200 with no challenge', async () => {
    for (const p of ['/mcp', '/mcp/chatgpt', '/mcp/core']) {
      const r = await H.call(p, 'get_market_intel', { market: 'northern-virginia' }, { 'user-agent': 'node' });
      expect(r.status, p).toBe(200);
      expect(r.headers.get('www-authenticate'), p).toBeNull();
    }
  });

  it('/mcp/oauth still challenges initialize against the /mcp metadata, not /mcp/claude', async () => {
    const r = await H.init('/mcp/oauth', 'claude-ai');
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('oauth-protected-resource/mcp"');
    expect(r.headers.get('www-authenticate')).not.toContain('/mcp/claude');
  });
});
