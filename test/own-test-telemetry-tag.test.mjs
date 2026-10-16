// Own test callers are written to telemetry as 'dchub-internal' (2026-10-16).
//
// ★ THE DEFECT, measured read-only on prod 2026-10-16. The chatgpt-test-cases
// GitHub Actions job sends UA 'dchub-chatgpt-test-cases/1 (github-actions)'. Its
// tools/calls are stateless, so its clientInfo self-tag is lost and
// detectPlatform(ua) finds 'chatgpt' inside OUR OWN UA: 48 call-log rows and 30
// trial_preview signals were published as ChatGPT demand. 'handoff-proof' and
// 'site-eval-a/b/c' (clientInfo names) were published as external platforms.
//
// ★ The request's own platform is NOT changed (the CI job must still exercise the
// ChatGPT profile; site-eval must still get a paywall arm). Only what is written
// to /api/v1/mcp/track and /api/v1/mcp/signal-paywall is re-tagged.
//
// Drives the REAL app over HTTP against a stub backend that records each /track
// body; no network beyond 127.0.0.1. The literals below are the same ones the
// backend test (tests/test_analyze_site_funnel_v3_sql.py) pins.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const CI_UA = 'dchub-chatgpt-test-cases/1 (github-actions)';
const DXT_UA = 'dchub-dxt-bridge/1.0.0';
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};
let S, PORT, httpServer, stub;
const tracks = [];    // /api/v1/mcp/track bodies
const signals = [];   // /api/v1/mcp/signal-paywall bodies
const paidHits = [];  // /api/v1/mcp/track-paid-hit bodies

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const u = new URL(req.url, 'http://_');
      let b = ''; for await (const ch of req) b += ch;
      res.setHeader('content-type', 'application/json');
      if (u.pathname === '/api/v1/mcp/track') tracks.push(JSON.parse(b || '{}'));
      if (u.pathname === '/api/v1/mcp/signal-paywall') signals.push(JSON.parse(b || '{}'));
      if (u.pathname === '/api/v1/mcp/track-paid-hit') paidHits.push(JSON.parse(b || '{}'));
      if (u.pathname === '/api/v1/rag/search') {
        res.end(JSON.stringify({ ok: true, query: u.searchParams.get('q'), count: 0, results: [] }));
        return;
      }
      if (u.pathname === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: false, tier: 'free' })); return; }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function statelessSearch(ua, q, id) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': ua },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'semantic_search', arguments: { q } } }),
  });
  await res.text();
  // track is fire-and-forget: wait for it to land
  for (let i = 0; i < 50 && !tracks.some((t) => t.tool === 'semantic_search' && t.user_agent === ua); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const t = tracks.filter((x) => x.tool === 'semantic_search' && x.user_agent === ua);
  expect(t.length, `no /track body for ua=${ua}`).toBeGreaterThan(0);
  return t[t.length - 1];
}

describe('the call log never names our own test caller as a platform', () => {
  it('control: a real ChatGPT connector UA is written as chatgpt', async () => {
    const t = await statelessSearch('openai-mcp/1.0.0', 'own-test control', 11);
    expect(t.platform).toBe('chatgpt');
  });

  it('the chatgpt-test-cases CI job (stateless, UA names chatgpt) is written as dchub-internal', async () => {
    const t = await statelessSearch(CI_UA, 'own-test ci', 12);
    expect(t.platform).toBe('dchub-internal');
    expect(t.client_name).toBe('dchub-internal');   // not the UA-derived 'chatgpt'
  });

  it('the Claude Desktop extension bridge (a real user, dchub- prefix, no test word) is not re-tagged', async () => {
    const t = await statelessSearch(DXT_UA, 'own-test dxt', 13);
    expect(t.platform).not.toBe('dchub-internal');
  });
});

describe('the paywall signal carries the same tag', () => {
  const fire = (c, tool) => S._ctxALS.run(c, () => S._signalPaywallForTest({
    tool, signal_type: 'trial_preview', mcp_client: c.platform, session_id: 'no-session' }));
  it('own test callers -> dchub-internal; a real ChatGPT caller keeps chatgpt', async () => {
    await fire({ platform: 'chatgpt', user_agent: CI_UA }, 'sig-ci');
    await fire({ platform: 'handoff-proof', client_name_raw: 'handoff-proof', user_agent: 'curl/8.14.1' }, 'sig-hp');
    await fire({ platform: 'chatgpt', user_agent: 'openai-mcp/1.0.0' }, 'sig-real');
    const by = Object.fromEntries(signals.map((s) => [s.tool, s.mcp_client]));
    expect(by['sig-ci']).toBe('dchub-internal');
    expect(by['sig-hp']).toBe('dchub-internal');
    expect(by['sig-real']).toBe('chatgpt');
  });
});

describe('the high-intent paid hit carries the same tag', () => {
  // site-eval presents a browser UA and a real session, so the bot screen in front of
  // track-paid-hit lets it through; only its mcp_client says it is ours.
  it('site-eval -> dchub-internal; a real browser-UA caller keeps its platform', async () => {
    const hit = (c, sid) => S._ctxALS.run(c, () => S._trackPaidHitForTest(sid, 'analyze_site'));
    await hit({ platform: 'site-eval-a', client_name_raw: 'site-eval-a',
                user_agent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15' }, 'sess-site-eval');
    await hit({ platform: 'claude', client_name_raw: 'claude-ai',
                user_agent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15' }, 'sess-real');
    const by = Object.fromEntries(paidHits.map((h) => [h.session_id, h.mcp_client]));
    expect(by['sess-site-eval']).toBe('dchub-internal');
    expect(by['sess-real']).toBe('claude');
  });
});

describe('_selfTestTelemetryTag', () => {
  it('matches the measured callers and nothing a real client sends', () => {
    const tag = S._selfTestTelemetryTag;
    expect(tag({ user_agent: CI_UA, platform: 'chatgpt' })).toBe('dchub-internal');
    expect(tag({ client_ua: CI_UA })).toBe('dchub-internal');
    expect(tag({ platform: 'handoff-proof', user_agent: 'curl/8.14.1' })).toBe('dchub-internal');
    for (const p of ['site-eval', 'site-eval-a', 'site-eval-c']) {
      expect(tag({ platform: p, user_agent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15' })).toBe('dchub-internal');
    }
    expect(tag({ client_name_raw: 'site-eval-b', platform: 'site-eval-b' })).toBe('dchub-internal');
    for (const c of [
      { platform: 'chatgpt', user_agent: 'openai-mcp/1.0.0' },
      { platform: 'claude', user_agent: DXT_UA },
      { platform: 'site-evaluator' }, { platform: 'my-handoff-proof' },
      { platform: 'mcp', user_agent: 'node' }, {}, null,
    ]) expect(tag(c)).toBe('');
  });

  it('only rewrites keys the payload already has, and keeps a raw clientInfo name', () => {
    const c = { platform: 'site-eval-a', client_name_raw: 'site-eval-a' };
    expect(S._tagOwnTestTelemetry({ tool: 't', platform: 'site-eval-a', client_name: 'site-eval-a' }, c))
      .toEqual({ tool: 't', platform: 'dchub-internal', client_name: 'site-eval-a' });
    expect(S._tagOwnTestTelemetry({ tool: 't' }, c)).toEqual({ tool: 't' });
    const p = { tool: 't', platform: 'chatgpt' };
    expect(S._tagOwnTestTelemetry(p, { platform: 'chatgpt', user_agent: 'openai-mcp/1.0.0' })).toBe(p);
  });
});
