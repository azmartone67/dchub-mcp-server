// ── which credential did this call actually use? ────────────────────────────
//
// THE GAP (partner round, 2026-08-29). Three agents hit the same wall in one
// week and none could resolve it from outside:
//   ChatGPT saw `401 reauthentication required` and correctly refused to say
//     whether that was its connector or our server.
//   Grok asked for a URL-box identity that survives reconnects, not knowing
//     `connect_url` (?apiKey=) already ships one.
//   Copilot asked whether a direct bind is possible for it at all.
//
// ★ WHY A PROBE COULD NOT ANSWER IT, AND WHY THIS TEST IS TRANSPORT-DRIVEN.
// Probing live with a real key in the URL, a junk key in the URL, and no key at
// all returned IDENTICAL responses — identity falls back to a caller
// fingerprint that masks the channel. So the only way to prove the query
// channel is honored is from inside, over a real HTTP request. A unit test
// calling the stamper directly would prove nothing about the wiring: that is
// exactly how Stage 0a shipped inert for eight days
// (test/request-interpretation.test.mjs:126 greps source; it cannot execute it).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let S, PORT, httpServer;

beforeAll(async () => {
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';   // unroutable: no upstream
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
});

// One self-contained MCP session: initialize, then one tools/call.
async function callWith({ query = '', headers = {}, args = {} } = {}) {
  const url = `http://127.0.0.1:${PORT}/mcp${query}`;
  const base = { 'content-type': 'application/json',
                 accept: 'application/json, text/event-stream', ...headers };
  const init = await fetch(url, { method: 'POST', headers: base,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'dchub-verify-probe', version: '1.0' } } }) });
  const sid = init.headers.get('mcp-session-id');
  const res = await fetch(url, { method: 'POST',
    headers: { ...base, ...(sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'why_dchub', arguments: args } }) });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  let parsed; try { parsed = JSON.parse(json); } catch { return null; }
  return parsed?.result?.structuredContent?.identity ?? null;
}

describe('identity.credential_source names the channel the credential arrived on', () => {
  it('no credential -> "none", and says so in terms the caller can act on', async () => {
    const id = await callWith({});
    expect(id).toBeTruthy();
    expect(id.credential_source).toBe('none');
    // The one case that earns prose: an agent that believed it was authenticated
    // needs to learn the credential never arrived.
    expect(String(id.means)).toMatch(/ANONYMOUSLY/);
    expect(String(id.means)).toContain('connect_url');
  }, 30000);

  it('?apiKey= in the URL is reported as "query" — the connect_url channel', async () => {
    const id = await callWith({ query: '?apiKey=dch_live_0000000000000000000000000000test' });
    expect(id?.credential_source).toBe('query');
  }, 30000);

  it('X-API-Key header outranks a query key (precedence is observable, not implied)', async () => {
    const id = await callWith({
      query: '?apiKey=dch_live_0000000000000000000000000000test',
      headers: { 'x-api-key': 'dch_live_1111111111111111111111111111head' } });
    expect(id?.credential_source).toBe('header');
  }, 30000);

  it('an inline key argument is reported as "inline_argument"', async () => {
    const id = await callWith({ args: { api_key: 'dch_live_2222222222222222222222222222inln' } });
    expect(id?.credential_source).toBe('inline_argument');
  }, 30000);

  // ★ The block must never leak the credential itself — it names the CHANNEL.
  it('never echoes the key material', async () => {
    const id = await callWith({ query: '?apiKey=dch_live_0000000000000000000000000000test' });
    expect(JSON.stringify(id)).not.toContain('dch_live_0000');
  }, 30000);

  it('reports the tier alongside, so "anonymous" and "free key" are distinguishable', async () => {
    const id = await callWith({});
    expect(typeof id.tier).toBe('string');
  }, 30000);
});

describe('_identitySource — fail-soft contract', () => {
  it('no ctx (stdio / off-request) yields no block rather than a wrong one', () => {
    expect(S._identitySource(null)).toBeNull();
    expect(S._identitySource({})).toBeNull();
  });
  it('a non-none channel stays terse — prose only where it is actionable', () => {
    const q = S._identitySource({ auth_source: 'query', tier: 'free' });
    expect(q).toEqual({ credential_source: 'query', tier: 'free' });
    expect(q.means).toBeUndefined();
  });
});
