// agent-registration-bearer.test.mjs — r-agent-registration (2026-10-25)
//
// WorkOS Agent Registration tokens (sub agent_reg_…, act.sub user_… once the
// person has claimed the agent) on bare /mcp:
//   · claimed → the identity sent to /api/v1/oauth/identity is the PERSON's
//     user_ id, with the email looked up by that id;
//   · anonymous → the identity stays the agent_reg_ id, no email lookup;
//   · aud = our AuthKit client_id is accepted for an agent_reg_ subject only.
// The frozen surfaces (/mcp/claude, /mcp/chatgpt/oauth) and the kill switch
// keep the old behaviour. OAuth is real: jose signs RS256 JWTs with a key the
// fake backend publishes as the AuthKit JWKS.
//
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const CLIENT_ID = 'client_01TESTAGENTREG';
const MCP_AUD = 'https://dchub.cloud/mcp';
let H, fence, privateKey, ISS, n = 0;

beforeAll(async () => {
  fence = fenceNetwork();
  ({ privateKey } = await generateKeyPair('RS256', { extractable: true }));
  const { d, p, q, dp, dq, qi, ...pub } = await exportJWK(privateKey);
  H = await startHarness({
    env: (base) => ({
      DCHUB_WORKOS_OAUTH_ENABLED: '1', WORKOS_AUTHKIT_DOMAIN: base,
      WORKOS_API_KEY: 'test-workos-key-not-a-real-secret', WORKOS_API_BASE: base,
    }),
    extraRoutes: (path) => {
      if (path === '/oauth2/jwks') return { keys: [{ ...pub, kid: 'k1', alg: 'RS256', use: 'sig' }] };
      if (path === '/api/v1/oauth/identity') return { api_key: PRO_KEY, tier: 'free', created: false };
      const m = path.match(/^\/user_management\/users\/(user_[A-Za-z0-9_]+)$/);
      if (m) return { id: m[1], email: `${m[1]}@Example.com` };
      return undefined;
    },
  });
  ISS = H.base;
});
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

// A fresh token per call (unique jti) so the 5-minute token cache never answers.
function jwt({ sub, aud = MCP_AUD, act } = {}) {
  const claims = { jti: `t${++n}` };
  if (act) claims.act = { sub: act };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISS).setSubject(sub).setAudience(aud)
    .setIssuedAt().setExpirationTime('10m')
    .sign(privateKey);
}

// Send one initialize with the bearer; return what reached the fake backend.
async function present(path, token) {
  const before = H.hits.length;
  const r = await H.init(path, 'agent-test', { authorization: `Bearer ${token}` });
  const after = H.hits.slice(before);
  return {
    status: r.status,
    identity: after.filter((h) => h.path === '/api/v1/oauth/identity').map((h) => h.body),
    userLookups: after.filter((h) => h.path.startsWith('/user_management/users/')).map((h) => h.path),
  };
}

describe('agent_reg_ tokens on bare /mcp', () => {
  it('a claimed agent resolves to the person in act.sub, with their email', async () => {
    const r = await present('/mcp', await jwt({ sub: 'agent_reg_CLAIMED1', act: 'user_PERSON1' }));
    expect(r.identity.length).toBeGreaterThan(0);
    expect(r.identity[0].sub).toBe('user_PERSON1');
    expect(r.identity[0].email).toBe('user_person1@example.com');
    expect(r.userLookups).toEqual(['/user_management/users/user_PERSON1']);
  });

  it('an anonymous agent keeps its agent_reg_ identity and no email lookup is made', async () => {
    const r = await present('/mcp', await jwt({ sub: 'agent_reg_ANON1' }));
    expect(r.identity.length).toBeGreaterThan(0);
    expect(r.identity[0].sub).toBe('agent_reg_ANON1');
    expect(r.identity[0].email).toBeNull();
    expect(r.userLookups).toEqual([]);
  });

  it('an act.sub that is not a user_ id is ignored', async () => {
    const r = await present('/mcp', await jwt({ sub: 'agent_reg_ODD1', act: 'agent_reg_OTHER' }));
    expect(r.identity[0].sub).toBe('agent_reg_ODD1');
    expect(r.userLookups).toEqual([]);
  });

  it('aud = our client_id is accepted for an agent_reg_ subject when WORKOS_CLIENT_ID is set', async () => {
    process.env.WORKOS_CLIENT_ID = CLIENT_ID;
    try {
      const r = await present('/mcp', await jwt({ sub: 'agent_reg_CID1', aud: CLIENT_ID, act: 'user_PERSON2' }));
      expect(r.identity.map((b) => b.sub)).toContain('user_PERSON2');
    } finally { delete process.env.WORKOS_CLIENT_ID; }
  });

  it('CONTROL: aud = client_id is refused without WORKOS_CLIENT_ID', async () => {
    const r = await present('/mcp', await jwt({ sub: 'agent_reg_CID2', aud: CLIENT_ID }));
    expect(r.identity).toEqual([]);
  });

  it('CONTROL: aud = client_id is still refused for a user_ token (no widening for people)', async () => {
    process.env.WORKOS_CLIENT_ID = CLIENT_ID;
    try {
      const r = await present('/mcp', await jwt({ sub: 'user_PLAIN1', aud: CLIENT_ID }));
      expect(r.identity).toEqual([]);
    } finally { delete process.env.WORKOS_CLIENT_ID; }
  });

  it('CONTROL: a plain user_ token on /mcp is unchanged', async () => {
    const r = await present('/mcp', await jwt({ sub: 'user_PLAIN2' }));
    expect(r.identity[0].sub).toBe('user_PLAIN2');
  });

  it('kill switch DCHUB_AGENT_REGISTRATION=0 restores the old mapping', async () => {
    process.env.DCHUB_AGENT_REGISTRATION = '0';
    try {
      const r = await present('/mcp', await jwt({ sub: 'agent_reg_KILL1', act: 'user_PERSON3' }));
      expect(r.identity[0].sub).toBe('agent_reg_KILL1');
      expect(r.userLookups).toEqual([]);
    } finally { delete process.env.DCHUB_AGENT_REGISTRATION; }
  });
});

describe('frozen surfaces keep the old behaviour', () => {
  for (const path of ['/mcp/claude', '/mcp/chatgpt/oauth']) {
    it(`${path}: a claimed agent token maps to its agent_reg_ id, no person lookup`, async () => {
      const r = await present(path, await jwt({ sub: 'agent_reg_FROZEN' + path.length, act: 'user_PERSON4' }));
      expect(r.identity.length).toBeGreaterThan(0);
      expect(r.identity[0].sub).toBe('agent_reg_FROZEN' + path.length);
      expect(r.userLookups).toEqual([]);
    });
  }
});
