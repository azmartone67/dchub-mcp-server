// claude-directory-auth.test.mjs — r-claude-directory (2026-09-26)
//
// Claude web has no header field, so https://dchub.cloud/mcp/claude?api_key=<key>
// must authenticate exactly like X-API-Key, and OAuth (AuthKit bearer) must work
// on this path the way it works on /mcp. The key never appears in a response.
//
// Key validation is stubbed (PRO_KEY is valid Pro). OAuth is real: jose signs
// RS256 JWTs with a key the fake backend publishes as the AuthKit JWKS
// (WORKOS_AUTHKIT_DOMAIN points at it), and /api/v1/oauth/identity maps the
// subject to PRO_KEY — the same chain resolveWorkosBearer runs in production.
//
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import {
  CLAUDE_PRM, CLAUDE_PRM_URL, CLAUDE_RESOURCE, CLAUDE_PLANS_NOTICE, requestSecrets,
} from '../lib/claude-directory.mjs';
import { startHarness, fenceNetwork, PRO_KEY, OPAQUE_KEY } from './helpers/claude-directory-harness.mjs';

const DIR = '/mcp/claude';
let H, fence, privateKey, ISS;

beforeAll(async () => {
  fence = fenceNetwork();
  ({ privateKey } = await generateKeyPair('RS256', { extractable: true }));
  const jwk = await exportJWK(privateKey);
  // Publish only the public half of the signing key.
  const { d, p, q, dp, dq, qi, ...pub } = jwk;
  H = await startHarness({
    env: (base) => ({ DCHUB_WORKOS_OAUTH_ENABLED: '1', WORKOS_AUTHKIT_DOMAIN: base }),
    extraRoutes: (p, req) => {
      if (p === '/oauth2/jwks') return { keys: [{ ...pub, kid: 'k1', alg: 'RS256', use: 'sig' }] };
      if (p === '/api/v1/oauth/identity') return { api_key: PRO_KEY, tier: 'pro', created: false };
      // A backend that echoes the caller's credential back, in several shapes.
      const k = req.headers['x-api-key'];
      if (k && !p.startsWith('/api/v1/mcp/') && !p.startsWith('/api/v1/keys/')) {
        return { data: [{ id: 1, name: 'Echo Campus', capacity_mw: 50 }], score: 71,
                 caller: k, note: `Authenticated as ${k}.`, nested: { raw: [k] } };
      }
      return undefined;
    },
  });
  ISS = H.base;
});
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

async function jwt(aud, opts = {}) {
  return new SignJWT({ email: null })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss || ISS).setSubject(opts.sub || 'user_claude_test').setAudience(aud)
    .setIssuedAt().setExpirationTime(opts.exp || '10m')
    .sign(privateKey);
}

const strip = (s) => s.replace(/"(retrieved_at|as_of|timestamp|generated_at|served_at)":"[^"]*"/g, '"$1":"T"')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, 'T').replace(/"id":\d+\}$/, '"id":0}');
const keyedHits = (from) => H.hits.slice(from).filter((h) => h.apiKey === PRO_KEY && !h.path.startsWith('/api/v1/mcp/') && !h.path.startsWith('/api/v1/keys/'));

describe('?api_key= on /mcp/claude authenticates exactly like the header', () => {
  it('query key, apiKey and key variants, and the X-API-Key header give the same answer', async () => {
    const args = { lat: 39.04, lon: -77.48 };
    // A key's first call carries one-time extras (starter_pack); spend it first
    // so the comparison is between steady-state answers.
    await H.call(DIR, 'analyze_site', args, { 'x-api-key': PRO_KEY });
    const viaHeader = await H.call(DIR, 'analyze_site', args, { 'x-api-key': PRO_KEY });
    const out = [];
    for (const q of ['api_key', 'apiKey', 'key']) {
      const before = H.hits.length;
      const r = await H.call(`${DIR}?${q}=${PRO_KEY}`, 'analyze_site', args);
      expect(keyedHits(before).length, q).toBeGreaterThan(0);          // the key reached the backend
      expect(r.raw).not.toContain('dchub.cloud/plans');                 // not a gated preview
      out.push(strip(r.body));
    }
    for (const o of out) {
      const a = strip(viaHeader.body); let i = 0; while (i < a.length && a[i] === o[i]) i++;
      expect(o, `first difference at ${i}: header=${a.slice(i - 80, i + 80)} | query=${o.slice(i - 80, i + 80)}`).toBe(a);
    }
    // CONTROL: keyless is the plans notice, so equality above is not "all anonymous".
    const anon = await H.call(DIR, 'analyze_site', args);
    expect(anon.msg.result.content.map((c) => c.text)).toEqual([CLAUDE_PLANS_NOTICE]);
  }, 60_000);

  it('a Bearer carrying a DC Hub key works too', async () => {
    const before = H.hits.length;
    const r = await H.call(DIR, 'analyze_site', { lat: 39.04, lon: -77.48 }, { authorization: `Bearer ${PRO_KEY}` });
    expect(r.status).toBe(200);
    expect(keyedHits(before).length).toBeGreaterThan(0);
    expect(r.raw).not.toContain(PRO_KEY);
  });
});

describe('the key never appears in a response', () => {
  it('not via query, header, bearer or tool argument, even when the backend echoes it', async () => {
    const channels = [
      [`${DIR}?api_key=${PRO_KEY}`, {}, {}],
      [DIR, { 'x-api-key': PRO_KEY }, {}],
      [DIR, { authorization: `Bearer ${PRO_KEY}` }, {}],
      [DIR, {}, { api_key: PRO_KEY }],
    ];
    for (const [path, headers, extraArgs] of channels) {
      for (const tool of ['get_grid_intelligence', 'get_market_intel', 'execute_plan']) {
        const r = await H.call(path, tool, { iso: 'PJM', market: 'northern-virginia', intent: 'grid headroom in PJM', ...extraArgs }, headers);
        expect(r.raw.includes(PRO_KEY), `${tool} via ${path} ${JSON.stringify(headers)} ${JSON.stringify(extraArgs)}`).toBe(false);
        expect(r.raw).not.toMatch(/CLAUDEPROkey/);
      }
    }
  }, 120_000);

  it('a credential of any shape: the per-request scrub removes what the dch_ redaction cannot see', async () => {
    for (const [path, headers] of [[`${DIR}?api_key=${OPAQUE_KEY}`, {}], [DIR, { 'x-api-key': OPAQUE_KEY }]]) {
      const before = H.hits.length;
      const r = await H.call(path, 'get_market_intel', { market: 'northern-virginia' }, headers);
      expect(H.hits.slice(before).some((h) => h.apiKey === OPAQUE_KEY), 'the key reached the backend').toBe(true);
      expect(r.raw.includes(OPAQUE_KEY), `${path} ${JSON.stringify(headers)}`).toBe(false);
    }
    // CONTROL: /mcp does echo it, so the absence above is the scrub's doing.
    const c = await H.call('/mcp', 'get_market_intel', { market: 'northern-virginia' }, { 'x-api-key': OPAQUE_KEY });
    expect(c.raw.includes(OPAQUE_KEY)).toBe(true);
  });

  it('CONTROL: the backend really echoes it — /mcp passes the key through', async () => {
    const r = await H.call('/mcp', 'get_market_intel', { market: 'northern-virginia' }, { 'x-api-key': PRO_KEY });
    expect(r.raw).toMatch(/CLAUDEPROkey/);
  });

  it('requestSecrets names every channel a credential can arrive on', () => {
    const req = { headers: { 'x-api-key': 'dch_a_1111111', authorization: 'Bearer eyJ.a.b' },
      url: '/mcp/claude?api_key=dch_b_2222222&apiKey=dch_c_3333333&key=dch_d_4444444',
      body: { params: { arguments: { api_key: 'dch_e_5555555', 'X-API-Key': 'dch_f_6666666' } } } };
    expect(requestSecrets(req).sort()).toEqual(['dch_a_1111111', 'eyJ.a.b', 'dch_b_2222222', 'dch_c_3333333',
      'dch_d_4444444', 'dch_e_5555555', 'dch_f_6666666'].sort());
  });
});

describe('OAuth (AuthKit bearer) on /mcp/claude', () => {
  it('a token issued for https://dchub.cloud/mcp/claude authenticates as the bound key', async () => {
    const tok = await jwt(CLAUDE_RESOURCE);
    const before = H.hits.length;
    const r = await H.call(DIR, 'analyze_site', { lat: 39.04, lon: -77.48 }, { authorization: `Bearer ${tok}` });
    expect(r.status).toBe(200);
    expect(keyedHits(before).length).toBeGreaterThan(0);
    expect(r.raw).not.toContain('dchub.cloud/plans');
    expect(r.raw.includes(tok)).toBe(false);
    expect(r.raw).not.toMatch(/CLAUDEPROkey/);
  });

  it('a token issued for https://dchub.cloud/mcp works on /mcp/claude too (same key, a subset of tools)', async () => {
    const tok = await jwt('https://dchub.cloud/mcp');
    const before = H.hits.length;
    const r = await H.call(DIR, 'get_market_intel', { market: 'northern-virginia' }, { authorization: `Bearer ${tok}` });
    expect(r.status).toBe(200);
    expect(keyedHits(before).length).toBeGreaterThan(0);
  });

  it('/mcp is unchanged: its own-audience token works there, a /mcp/claude token is refused there', async () => {
    const ok = await jwt('https://dchub.cloud/mcp');
    const before = H.hits.length;
    const a = await H.call('/mcp', 'get_market_intel', { market: 'northern-virginia' }, { authorization: `Bearer ${ok}` });
    expect(a.status).toBe(200);
    expect(keyedHits(before).length).toBeGreaterThan(0);
    const other = await jwt(CLAUDE_RESOURCE, { sub: 'user_other' });
    const b = await H.call('/mcp', 'get_market_intel', { market: 'northern-virginia' }, { authorization: `Bearer ${other}` });
    expect(b.status).toBe(401);
    expect(b.headers.get('www-authenticate')).toContain('resource_metadata="https://dchub.cloud/.well-known/oauth-protected-resource"');
  });

  it('an invalid or expired bearer gets 401 + WWW-Authenticate naming THIS resource\'s metadata', async () => {
    for (const bad of ['not-a-real-token-' + Date.now(), await jwt(CLAUDE_RESOURCE, { exp: Math.floor(Date.now() / 1000) - 60, sub: 'user_expired' })]) {
      const r = await H.call(DIR, 'get_market_intel', { market: 'northern-virginia' }, { authorization: `Bearer ${bad}` });
      expect(r.status).toBe(401);
      const wa = r.headers.get('www-authenticate');
      expect(wa).toContain('Bearer ');
      expect(wa).toContain('error="invalid_token"');
      expect(wa).toContain(`resource_metadata="${CLAUDE_PRM_URL}"`);
      expect(r.msg.error.code).toBe(-32001);
      expect(r.msg.error.message).toMatch(/not valid or has expired/);
      expect(r.raw.includes(bad)).toBe(false);
    }
  });

  it('keyless Claude connector calls are served, never challenged (authless with an optional key)', async () => {
    const ua = { 'user-agent': 'Claude-User' };
    const init = await H.init(DIR, 'claude-ai', ua);
    expect(init.status).toBe(200);
    for (let i = 0; i < 8; i++) {
      const r = await H.call(DIR, 'get_news', { query: 'data center' }, ua);
      expect(r.status, `call ${i + 1}`).toBe(200);
      expect(r.headers.get('www-authenticate'), `call ${i + 1}`).toBeNull();
    }
  });
});

describe('protected-resource metadata for /mcp/claude (RFC 9728)', () => {
  it('names https://dchub.cloud/mcp/claude as the resource and AuthKit as the server', async () => {
    const r = await H.get('/.well-known/oauth-protected-resource/mcp/claude');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toEqual(CLAUDE_PRM);
    expect(j.resource).toBe(CLAUDE_RESOURCE);
    expect(j.authorization_servers).toEqual(['https://beloved-stream-52.authkit.app']);
    expect(CLAUDE_PRM_URL).toBe('https://dchub.cloud/.well-known/oauth-protected-resource/mcp/claude');
  });
});
