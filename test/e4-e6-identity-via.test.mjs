// e4-e6-identity-via.test.mjs — owner items E4 (identity) and E6 (attribution), 2026-11-14.
//
// E4: an anonymous caller is never handed a key on its IP alone. The held-key map is keyed on client IP + client
//     family only, so on a hosted client (claude.ai, ChatGPT, Grok: one vendor egress for every user) it handed one
//     user's key to the next, both from claim_free_key and in-band in every keyless initialize. Off by default
//     (DCHUB_HELD_KEY_BY_IP=1 restores it). A caller gets its key back by presenting it, from the backend's dedupe,
//     or by recover_my_key; every reuse reply says so (guidance). The backend's per-IP caps now answer 429 instead
//     of another caller's key: that is a plain reply with what to do, not "Could not mint".
// E6: ?via= / X-DCHub-Via on /mcp reach the backend claim as one canonical client tag: devin and cascade are
//     windsurf; the Copilot CLI (copilot-cli) is never folded into Copilot in VS Code (github_copilot).
//
// Drives the real /mcp tools/call path against a stub backend.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import { clientViaTag, keyMintVia, OTHER_VIA } from '../lib/via-tags.mjs';

const KEY = 'dch_live_' + 'e4e6cafe'.repeat(4);
const KEY2 = 'dch_live_' + 'e4e6beef'.repeat(4);
let S, stub, srv, PORT;
let claims = [];
let claimReply = {};
let claimStatus = 200;
const prev = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      let buf = '';
      req.on('data', (d) => { buf += d; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (p === '/api/v1/keys/claim') {
          let body = {}; try { body = JSON.parse(buf); } catch (_) {}
          claims.push({ body, via: req.headers['x-dchub-via'] || null });
          res.statusCode = claimStatus;
          res.end(JSON.stringify(claimStatus === 200 ? { success: true, api_key: KEY, tier: 'free', ...claimReply } : claimReply));
          return;
        }
        if (p === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: true, tier: 'free' })); return; }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_HELD_KEY_BY_IP']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  delete process.env.DCHUB_HELD_KEY_BY_IP;
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
});
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
beforeEach(() => {
  claims = []; claimReply = {}; claimStatus = 200;
  delete process.env.DCHUB_HELD_KEY_BY_IP;
  S._heldKeys.clear();
  S._dropKeyCache();
});

async function post(path, h, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...h }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json };
}
async function init({ ip = '203.0.113.90', path = '/mcp', headers = {}, clientInfo = 'e4e6-test' } = {}) {
  const h0 = { 'x-dc-client-ip': ip, ...headers };
  const r = await post(path, h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientInfo, version: '1' } } });
  const h = { ...h0, 'mcp-session-id': r.headers.get('mcp-session-id') };
  await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { h, instructions: (JSON.parse(r.json).result || {}).instructions || '' };
}
async function claim({ args = { client_name: 'e4e6-agent' }, ...o } = {}) {
  const { h } = await init(o);
  const out = await post(o.path || '/mcp', h, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'claim_free_key', arguments: args } });
  const r = JSON.parse(out.json).result;
  return { r, text: r.content.map((c) => c.text).join('\n'), sc: r.structuredContent || {} };
}

describe('E4: no key handed back on IP + client alone (default)', () => {
  it('a second claim from the same IP and client goes to the backend, never the held map', async () => {
    await claim();
    claimReply = { api_key: KEY2 };
    const second = await claim();
    expect(claims).toHaveLength(2);                          // the backend decides, with its own dedupe rules
    expect(second.sc.api_key).toBe(KEY2);
    expect(second.sc.held_by).not.toBe('caller_fingerprint');
    expect(S._heldKeys.size).toBe(0);                        // nothing remembered by IP
  });
  it('a keyless initialize never carries a key in-band; DCHUB_HELD_KEY_BY_IP=1 restores it', async () => {
    process.env.DCHUB_HELD_KEY_BY_IP = '1';
    await claim({ ip: '203.0.113.91' });                     // remembered under the real fingerprint
    expect(S._heldKeys.size).toBe(1);
    const on = await init({ ip: '203.0.113.91' });
    expect(on.instructions).toContain(KEY);                  // the restore switch is the old behaviour
    delete process.env.DCHUB_HELD_KEY_BY_IP;
    const off = await init({ ip: '203.0.113.91' });
    expect(off.instructions).not.toContain(KEY);             // default: a stranger on that IP is not told the key
    expect(off.instructions).not.toContain('YOU ALREADY HOLD');
  });
  it('the restore switch hands the IP-held key back like before', async () => {
    process.env.DCHUB_HELD_KEY_BY_IP = '1';
    await claim();
    const second = await claim();
    expect(claims).toHaveLength(1);
    expect(second.sc).toMatchObject({ api_key: KEY, already_held: true, held_by: 'caller_fingerprint',
      guidance: S.ALREADY_HAVE_KEY_GUIDANCE });
  });
});

describe('E4: repeat callers are told they already have a key and how to recover it', () => {
  it('backend reuse: guidance, recover_my_key, reuse_basis passed through', async () => {
    claimReply = { reused: true, reuse_basis: 'client_name_ip' };
    const { text, sc } = await claim();
    expect(sc).toMatchObject({ api_key: KEY, reused: true, already_held: true, recover_tool: 'recover_my_key',
      reuse_basis: 'client_name_ip', guidance: S.ALREADY_HAVE_KEY_GUIDANCE });
    expect(text).toContain('call `recover_my_key` {email}');
    expect(S.ALREADY_HAVE_KEY_GUIDANCE).toMatch(/already have a DC Hub key/);
    expect(S.ALREADY_HAVE_KEY_GUIDANCE).toMatch(/recover_my_key/);
  });
  it('a fresh mint carries no repeat-caller guidance', async () => {
    const { sc } = await claim();
    expect(sc.reused).toBe(false);
    expect(sc.guidance).toBeUndefined();
  });
  it('a presented key is returned with the same guidance', async () => {
    const { sc } = await claim({ headers: { 'x-api-key': KEY } });
    expect(claims).toHaveLength(0);
    expect(sc).toMatchObject({ api_key: KEY, reused: true, already_keyed: true, guidance: S.ALREADY_HAVE_KEY_GUIDANCE });
  });
});

describe('E4: the backend\'s per-IP cap (429) is a plain answer, not a failure', () => {
  const capBody = { ok: false, error: 'unused_key_cap', gate: 'unused_key_cap',
    detail: 'This address already holds 3 free DC Hub keys that have never been used, so no new key is minted from it right now.' };
  it('email-less: no key, the backend sentence, and "claim again with your human\'s email"', async () => {
    claimStatus = 429; claimReply = capBody;
    const { r, text, sc } = await claim();
    expect(r.isError).toBeFalsy();
    expect(text).not.toContain('Could not mint');
    expect(text).toContain('never been used');
    expect(sc).toMatchObject({ api_key: null, minted: false, reason: 'claim_rate_limited', next_tool: 'get_api_key',
      recover_tool: 'recover_my_key', guidance: S.ALREADY_HAVE_KEY_GUIDANCE });
  });
  it('with an email: points at recover_my_key', async () => {
    claimStatus = 429; claimReply = { error: 'mint_rate_limited', detail: 'Too many keys minted from this caller.' };
    const { sc } = await claim({ args: { client_name: 'e4e6-agent', email: 'owner@example.com' } });
    expect(sc).toMatchObject({ api_key: null, next_tool: 'recover_my_key' });
  });
  it('any other backend failure still says it could not mint', async () => {
    claimStatus = 500; claimReply = { error: 'boom' };
    const { r, text } = await claim();
    expect(r.isError).toBe(true);
    expect(text).toContain('Could not mint');
  });
});

describe('E6: the connector via reaches the claim as one canonical client tag', () => {
  it.each([
    ['devin', 'windsurf'], ['cascade', 'windsurf'], ['codeium', 'windsurf'], ['windsurf', 'windsurf'],
    ['copilot-cli', 'copilot-cli'], ['github-copilot-cli', 'copilot-cli'], ['github-copilot-developer', 'copilot-cli'],
    ['github-copilot', 'github_copilot'], ['vscode', 'github_copilot'], ['copilot', 'github_copilot'],
    ['cursor', 'cursor'], ['claude-code', 'claude-code'],
  ])('?via=%s is forwarded as %s', async (via, tag) => {
    await claim({ path: '/mcp?via=' + encodeURIComponent(via) });
    expect(claims).toHaveLength(1);
    expect(claims[0].via).toBe(tag);
  });
  it('the X-DCHub-Via header works the same and wins over ?via=', async () => {
    await claim({ path: '/mcp?via=cursor', headers: { 'x-dchub-via': 'devin' } });
    expect(claims[0].via).toBe('windsurf');
  });
  it('an unregistered via is still `other`, a registered directory is itself', async () => {
    await claim({ path: '/mcp?via=some-blog' });
    await claim({ path: '/mcp?via=glama' });
    expect(claims.map((c) => c.via)).toEqual([OTHER_VIA, 'glama']);
  });
  it('the Copilot CLI is never folded into Copilot in VS Code (pure)', () => {
    expect(clientViaTag('copilot-cli')).toBe('copilot-cli');
    expect(clientViaTag('github_copilot')).toBe('github_copilot');
    expect(keyMintVia('gh-copilot')).toBe('copilot-cli');
    expect(keyMintVia('vs-code')).toBe('github_copilot');
    expect(clientViaTag('copilot-cli')).not.toBe(clientViaTag('copilot'));
  });
  it('the Copilot CLI client (github-copilot-developer) gets via=copilot-cli on its connector URL, VS Code Copilot does not', async () => {
    const cli = await claim({ clientInfo: 'github-copilot-developer' });
    const vsc = await claim({ clientInfo: 'GitHub Copilot' });
    expect(String(cli.sc.connect_url || '')).toContain('via=copilot-cli');
    expect(String(vsc.sc.connect_url || '')).not.toContain('via=copilot-cli');
    expect(String(vsc.sc.connect_url || '')).toContain('via=copilot');
  });
});
