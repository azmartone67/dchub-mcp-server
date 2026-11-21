// lazy-auth-v1.test.mjs — DCHUB_LAZY_AUTH_V1: lazy OAuth at the wall on the generic /mcp (owner item 3, 2026-11-21).
//
// Over the REAL /mcp handler (fake local backend, no network): an allow-listed keyless walled tools/call is answered
// 401 + the exact /mcp PRM challenge; the holdout arm, a non-allow-listed client, a free call and the flag off all
// keep the 200; the bound serves; the track row of a served eligible call carries params._lazy_auth.
// The older anonymous-connector challenge is switched off here (DCHUB_OAUTH_CHALLENGE_DISABLE=1), so every 401
// these tests see is this feature's.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import {
  LAZY_AUTH_CHALLENGE, LAZY_AUTH_MESSAGE, TRACK_FIELD, ARM_CHALLENGE, ARM_HOLDOUT, ARM_CHALLENGE_BOUND, HOLDOUT_SHARE,
  lazyAuthOn, lazyAuthArm, lazyAuthIdentity, lazyAuthAllowance, lazyAuthClientAllowed, lazyAuthDecide,
  noteLazyAuthChallenge, createLazyAuthState, withLazyAuthTrackArm, _resetLazyAuthState,
  CHATGPT_SECURITY_SCHEMES, withChatgptSecuritySchemes, chatgptLazyAuthResult,
} from '../lib/lazy-auth.mjs';
import { MCP_OAUTH_CHALLENGE } from '../lib/mcp-oauth-path.mjs';

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

const EXACT_HEADER = 'Bearer resource_metadata="https://dchub.cloud/.well-known/oauth-protected-resource/mcp", '
  + 'scope="openid profile email offline_access"';
const GATED = 'rank_markets';          // in server.mjs PAID_ONLY_TOOLS
const FREE = 'get_grid_scoreboard';    // in FREE_FULL_TOOLS, not gated

const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_WORKOS_OAUTH_ENABLED', 'DCHUB_OAUTH_CHALLENGE_DISABLE', 'DCHUB_LAZY_AUTH_V1',
  'DCHUB_LAZY_AUTH_CLIENTS', 'DCHUB_LAZY_AUTH_MAX', 'DCHUB_LAZY_AUTH_AFTER_N'];
const prevEnv = {};
let S, PORT, httpServer, stub;
let rpcId = 100;
const tracks = [];
let credits = 0;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const url = new URL(req.url, 'http://_');
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (url.pathname === '/api/v1/mcp/track') { try { tracks.push(JSON.parse(raw)); } catch (_) {} res.end('{}'); return; }
        if (url.pathname === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: false, tier: 'free' })); return; }
        if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
        if (url.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
        if (url.pathname === '/api/v1/mcp/credits/balance') { res.end(JSON.stringify({ credits, had_pack: credits > 0 })); return; }
        res.end(JSON.stringify({ success: true, count: 0, data: [], results: [] }));
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_WORKOS_OAUTH_ENABLED = '1';
  process.env.DCHUB_OAUTH_CHALLENGE_DISABLE = '1';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  net.Socket.prototype.connect = realConnect;
});

beforeEach(() => {
  process.env.DCHUB_LAZY_AUTH_V1 = '1';
  delete process.env.DCHUB_LAZY_AUTH_CLIENTS;
  delete process.env.DCHUB_LAZY_AUTH_MAX;
  delete process.env.DCHUB_LAZY_AUTH_AFTER_N;
  credits = 0;
  _resetLazyAuthState();
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, www: res.headers.get('www-authenticate'), sid: res.headers.get('mcp-session-id'), text: await res.text() };
}
async function openSession(clientName, extra = {}) {
  const init = await post(extra, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } });
  expect(init.sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...extra, 'mcp-session-id': init.sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return h;
}
const armOf = (h) => lazyAuthArm(lazyAuthIdentity({ sessionId: h['mcp-session-id'] }));
// A session whose stable arm is `want` (session ids are random; the arm is a hash of the session).
async function sessionInArm(clientName, want, extra = {}) {
  for (let i = 0; i < 80; i += 1) {
    const h = await openSession(clientName, extra);
    if (armOf(h) === want) return h;
  }
  throw new Error(`no ${want} session in 80 tries`);
}
const call = (h, name = GATED, args = { limit: 5 }) => post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
  params: { name, arguments: args } });
async function trackRowFor(sid, tool, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const hit = tracks.filter((r) => r && r.tool === tool && r.params && r.params[TRACK_FIELD]);
    if (hit.length) return hit;
    if (Date.now() - t0 > ms) return [];
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('the challenge header and body', () => {
  it('is the exact /mcp PRM challenge, the same literal /mcp/oauth uses', () => {
    expect(LAZY_AUTH_CHALLENGE).toBe(EXACT_HEADER);
    expect(LAZY_AUTH_CHALLENGE).toBe(MCP_OAUTH_CHALLENGE);
    expect(LAZY_AUTH_MESSAGE).not.toMatch(/\$|free|credit|pro\b|plan/i);
  });
});

describe('over the real /mcp handler', () => {
  it('allow-listed keyless walled call → 401 + the exact WWW-Authenticate header', async () => {
    const h = await sessionInArm('claude-ai', ARM_CHALLENGE);
    const before = S._chCounts.get('claude_connector:tools/call') || 0;
    const first = await call(h);
    expect(first.status, 'the first keyless call to a gated tool is served (ask after value)').toBe(200);
    const walled = await call(h);
    expect(walled.status).toBe(401);
    expect(walled.www).toBe(EXACT_HEADER);
    const body = JSON.parse(walled.text);
    expect(body.error).toEqual({ code: -32001, message: LAZY_AUTH_MESSAGE });
    expect((S._chCounts.get('claude_connector:tools/call') || 0) - before).toBe(1);
  });

  it('holdout → 200, and its track row carries params._lazy_auth = holdout', async () => {
    const h = await sessionInArm('claude-ai', ARM_HOLDOUT);
    expect((await call(h)).status).toBe(200);
    tracks.length = 0;
    const r = await call(h);
    expect(r.status).toBe(200);
    expect(r.www).toBeNull();
    const rows = await trackRowFor(h['mcp-session-id'], GATED);
    expect(rows.map((x) => x.params[TRACK_FIELD])).toContain(ARM_HOLDOUT);
  });

  it('non-allow-listed client → 200, unchanged', async () => {
    const h = await sessionInArm('plain-client', ARM_CHALLENGE);
    for (let i = 0; i < 4; i += 1) {
      const r = await call(h);
      expect(r.status).toBe(200);
      expect(r.www).toBeNull();
    }
  });

  it('a free (non-walled) call → 200 keyless, however often', async () => {
    const h = await sessionInArm('claude-ai', ARM_CHALLENGE);
    for (let i = 0; i < 4; i += 1) expect((await call(h, FREE, {})).status).toBe(200);
  });

  it('flag off → nothing changes', async () => {
    process.env.DCHUB_LAZY_AUTH_V1 = '0';
    const h = await sessionInArm('claude-ai', ARM_CHALLENGE);
    tracks.length = 0;
    for (let i = 0; i < 4; i += 1) {
      const r = await call(h);
      expect(r.status).toBe(200);
      expect(r.www).toBeNull();
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(tracks.some((x) => x && x.params && x.params[TRACK_FIELD])).toBe(false);
  });

  it('the bound: past DCHUB_LAZY_AUTH_MAX challenges the call is served and marked challenge_bound', async () => {
    process.env.DCHUB_LAZY_AUTH_MAX = '2';
    const h = await sessionInArm('claude-ai', ARM_CHALLENGE);
    expect((await call(h)).status).toBe(200);
    expect((await call(h)).status).toBe(401);
    expect((await call(h)).status).toBe(401);
    tracks.length = 0;
    expect((await call(h)).status).toBe(200);
    const rows = await trackRowFor(h['mcp-session-id'], GATED);
    expect(rows.map((x) => x.params[TRACK_FIELD])).toContain(ARM_CHALLENGE_BOUND);
  });

  it('a keyless session holding pack credits is served, not challenged', async () => {
    const h = await sessionInArm('claude-ai', ARM_CHALLENGE);
    expect((await call(h)).status).toBe(200);
    credits = 5;
    expect((await call(h)).status).toBe(200);
  });

  it('any credential skips it (an X-API-Key, even one the backend refuses)', async () => {
    const h = await sessionInArm('claude-ai', ARM_CHALLENGE);
    for (let i = 0; i < 3; i += 1) expect((await call({ ...h, 'x-api-key': 'dch_live_not_real_lazy' })).status).not.toBe(401);
  });

  it('a ChatGPT / OpenAI client on /mcp is never sent the 401, even with the list set to *', async () => {
    process.env.DCHUB_LAZY_AUTH_CLIENTS = '*';
    const h = await sessionInArm('openai-mcp', ARM_CHALLENGE, { 'user-agent': 'openai-mcp/1.0.0' });
    for (let i = 0; i < 3; i += 1) expect((await call(h)).status).toBe(200);
  });

  it('no socket left loopback', () => { expect(foreign).toEqual([]); });
});

describe('the decision (pure)', () => {
  const base = (over = {}) => ({
    env: { DCHUB_LAZY_AUTH_V1: '1' }, path: '/mcp', method: 'tools/call', tool: GATED, hasCredential: false,
    workosEnabled: true, clientName: 'claude-ai', isClaudeConnector: true, sessionId: 'sess-a',
    gatedTools: new Set([GATED]), state: createLazyAuthState(), ...over,
  });
  it('touches nothing out of scope', () => {
    for (const [k, v] of [['env', {}], ['path', '/mcp/claude'], ['path', '/mcp/chatgpt'], ['path', '/mcp/core'],
      ['path', '/mcp/grok'], ['method', 'initialize'], ['method', 'tools/list'], ['hasCredential', true],
      ['workosEnabled', false], ['planStep', true], ['tool', 'get_grid_scoreboard']]) {
      const st = createLazyAuthState();
      const d = lazyAuthDecide(base({ [k]: v, state: st }));
      expect(d.action, `${k}=${JSON.stringify(v)}`).toBe('none');
      expect(st.seen.size).toBe(0);
    }
  });
  it('serves under the allowance, then challenges (challenge arm) and counts only noted challenges', () => {
    let sid = 'x'; let i = 0;
    while (lazyAuthArm(lazyAuthIdentity({ sessionId: sid })) !== ARM_CHALLENGE) sid = 'x' + (i += 1);
    const st = createLazyAuthState();
    expect(lazyAuthDecide(base({ sessionId: sid, state: st })).action).toBe('serve');
    const d = lazyAuthDecide(base({ sessionId: sid, state: st }));
    expect(d.action).toBe('challenge');
    expect(st.challenged.size).toBe(0);
    noteLazyAuthChallenge(d.identity, st);
    expect(st.challenged.get(d.identity)).toBe(1);
  });
  it('the holdout is about 20% and stable per identity', () => {
    let h = 0; const N = 5000;
    for (let i = 0; i < N; i += 1) if (lazyAuthArm('s-' + i) === ARM_HOLDOUT) h += 1;
    expect(Math.abs(h / N - HOLDOUT_SHARE)).toBeLessThan(0.03);
    expect(lazyAuthArm('s-42')).toBe(lazyAuthArm('s-42'));
    expect(lazyAuthArm('')).toBeNull();
  });
  it('identity: session first, then caller IP; arm is independent of other splits (own salt)', () => {
    expect(lazyAuthIdentity({ sessionId: 's1', callerKey: '1.2.3.4' })).toMatch(/^s-/);
    expect(lazyAuthIdentity({ sessionId: '', callerKey: '1.2.3.4' })).toMatch(/^ip-/);
    expect(lazyAuthIdentity({})).toBe('');
  });
  it('allowance covers the keyless lanes that serve a full answer first', () => {
    expect(lazyAuthAllowance('rank_markets', {})).toBe(1);
    expect(lazyAuthAllowance('get_grid_data', { DCHUB_KEYLESS_FIRST_FULL_CAP: '3' })).toBe(3);
    expect(lazyAuthAllowance('get_grid_data', { DCHUB_KEYLESS_FULL_TRIAL: '1', DCHUB_KEYLESS_FULL_TRIAL_CAP: '4' })).toBe(4);
    expect(lazyAuthAllowance('rank_markets', { DCHUB_LAZY_AUTH_AFTER_N: '' })).toBe(1);   // never Number('') === 0
    expect(lazyAuthAllowance('rank_markets', { DCHUB_LAZY_AUTH_AFTER_N: '0' })).toBe(0);
  });
  it('client allow-list: claude by default, nameless never, OpenAI never', () => {
    expect(lazyAuthClientAllowed({ clientName: 'claude-ai', env: {} })).toBe(true);
    expect(lazyAuthClientAllowed({ clientName: '', isClaudeConnector: true, env: {} })).toBe(true);
    expect(lazyAuthClientAllowed({ clientName: 'cursor', env: {} })).toBe(false);
    expect(lazyAuthClientAllowed({ clientName: '', env: { DCHUB_LAZY_AUTH_CLIENTS: '*' } })).toBe(false);
    expect(lazyAuthClientAllowed({ clientName: 'cursor', env: { DCHUB_LAZY_AUTH_CLIENTS: 'claude,cursor' } })).toBe(true);
    expect(lazyAuthClientAllowed({ clientName: 'openai-mcp', env: { DCHUB_LAZY_AUTH_CLIENTS: '*' } })).toBe(false);
    expect(lazyAuthClientAllowed({ clientName: 'x', ua: 'openai-mcp/1.0.0', env: { DCHUB_LAZY_AUTH_CLIENTS: '*' } })).toBe(false);
    expect(lazyAuthOn({ DCHUB_LAZY_AUTH_V1: 'on' })).toBe(true);
    expect(lazyAuthOn({})).toBe(false);
  });
  it('track arm: only the call\'s own tool row, never twice', () => {
    const la = { arm: ARM_HOLDOUT, tool: GATED };
    expect(withLazyAuthTrackArm({ tool: GATED, params: { a: 1 } }, la).params).toEqual({ [TRACK_FIELD]: ARM_HOLDOUT, a: 1 });
    expect(withLazyAuthTrackArm({ tool: 'other', params: {} }, la).params).toEqual({});
    const once = { tool: GATED, params: { [TRACK_FIELD]: ARM_CHALLENGE_BOUND } };
    expect(withLazyAuthTrackArm(once, la)).toBe(once);
    expect(withLazyAuthTrackArm({ tool: GATED }, null)).toEqual({ tool: GATED });
  });
});

describe('ChatGPT half (inert, held for the store resubmission)', () => {
  it('builds the noauth + oauth2 schemes and the isError result with _meta mcp/www_authenticate', () => {
    expect(CHATGPT_SECURITY_SCHEMES.map((s) => s.type)).toEqual(['noauth', 'oauth2']);
    const t = withChatgptSecuritySchemes({ name: 'x', _meta: { a: 1 } });
    expect(t.securitySchemes[1].scopes).toEqual(['openid', 'profile', 'email', 'offline_access']);
    expect(t._meta.a).toBe(1);
    const r = chatgptLazyAuthResult();
    expect(r.isError).toBe(true);
    expect(r._meta['mcp/www_authenticate']).toEqual([EXACT_HEADER]);
  });
});
