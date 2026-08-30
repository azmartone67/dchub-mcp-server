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

// ── identity.connection — present only when a gateway is in the path ────────
//
// Copilot named our worst measurement problem more precisely than our own
// dashboards do (2026-08-30): "Smithery fronting aggregates caller identity;
// popularity metrics are gateway volume, not distinct agent adoption."
// ~97% of the 7-day panel is one gateway, and that fact lived only in our IP
// logs — invisible to the agent making the call, and so unactionable by it.
//
// ★★★ THE TEST THAT MATTERS IS THE ONE ASSERTING WE NEVER CLAIM 'direct'.
// A gateway forwarding a generic clientInfo is indistinguishable from a direct
// caller by construction, so the field can only ever say 'gateway' or be
// ABSENT. Every other assertion here would still pass if that rule broke.
import { _connectionShape, _KNOWN_GATEWAYS, _identitySource } from '../server.mjs';
import { readFileSync } from 'node:fs';

describe('identity.connection', () => {
  it('names a known gateway, and says what its volume does and does not mean', () => {
    for (const g of _KNOWN_GATEWAYS) {
      const c = _connectionShape(g);
      expect(c.via, g).toBe('gateway');
      expect(c.gateway, g).toBe(g);
      expect(c.basis, g).toContain(g);
      expect(c.means.toLowerCase(), g).toContain('not distinct-agent');
      expect(c.means, g).toContain('https://dchub.cloud/mcp');
    }
    expect(_KNOWN_GATEWAYS.has('smithery'), 'the gateway that IS the panel').toBe(true);
  });

  it('IS ABSENT for everything else — it never claims direct, and never guesses', () => {
    for (const p of [undefined, null, '', '  ', 'claude', 'chatgpt', 'node', 'mcp',
                     'some-future-client', 'SMITHERY-LOOKALIKE']) {
      expect(_connectionShape(p), JSON.stringify(p)).toBeNull();
    }
    // and no value of `via` other than 'gateway' is reachable at all
    const vias = new Set([..._KNOWN_GATEWAYS].map((g) => _connectionShape(g).via));
    expect([...vias]).toEqual(['gateway']);
  });

  it('normalises case and whitespace before matching a gateway', () => {
    expect(_connectionShape('  Smithery ').via).toBe('gateway');
    expect(_connectionShape('SMITHERY').gateway).toBe('smithery');
  });

  it('rides on the identity block WITHOUT colliding with the anonymous prose', () => {
    // `means` already exists on this block for the anonymous case. A flat
    // second `means` would have been silently overwritten by it — two meanings
    // on one key. Nesting is why both survive.
    const anon = _identitySource({ auth_source: 'none', tier: 'free', platform: 'smithery' });
    expect(anon.means, 'the anonymous prose').toMatch(/served ANONYMOUSLY/);
    expect(anon.connection.means, 'the gateway prose').toMatch(/GATEWAY VOLUME/);
    expect(anon.connection.gateway).toBe('smithery');

    const keyed = _identitySource({ auth_source: 'header', tier: 'free', platform: 'smithery' });
    expect(keyed.credential_source).toBe('header');
    expect(keyed.connection.via).toBe('gateway');
  });

  it('stays terse off the gateway path — the block\'s existing contract', () => {
    // Unchanged from before this field existed. A caller with nothing to do
    // differently gets no extra bytes on every single response.
    expect(_identitySource({ auth_source: 'query', tier: 'free', platform: 'claude' }))
      .toEqual({ credential_source: 'query', tier: 'free' });
  });
});

describe('the registry entry declares itself the origin', () => {
  const M = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'))
    ._meta['io.modelcontextprotocol.registry/publisher-provided'];

  it('says which kind of endpoint this listing is', () => {
    // Published in the publisher-provided namespace, which exists for exactly
    // this. Deliberately NOT added to smithery.yaml: an unrecognised top-level
    // key in a third-party manifest risks a listing that currently ranks first
    // for twelve of thirteen terms, and the runtime block above already answers
    // the question for any caller that asks.
    expect(M.deploymentType).toBe('origin');
  });

  it('points at OUR host, so the direct-bind advice cannot be redirected', () => {
    expect(new URL(M.canonicalRemote).hostname).toBe('dchub.cloud');
    expect(M.gatewayNote).toMatch(/identity\.connection/);
  });
});
