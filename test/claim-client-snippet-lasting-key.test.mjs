// claim-client-snippet-lasting-key.test.mjs — owner 2026-11-13, "MCP as front desk".
//
// claim_free_key returns a LASTING key with the ONE ready-to-paste snippet for the calling
// client directly under the key, and gives back the existing key by IP plus client instead of
// minting a new one. Pinned here, on the real /mcp tools/call path against a stub backend:
//   1. a recognised client (clientInfo name, platform, client_name or user agent) gets its own
//      snippet, key filled in, right under the key line, in place of the generic paste line;
//   2. an unrecognised client keeps the generic paste line and the full client list;
//   3. a dch_live_ key is said not to expire (key_expires:false), a key of any other shape never is;
//   4. a backend reuse (same client_name + IP) is announced as the same key, snippet still first;
//   5. the held-key reuse needs the same IP AND the same client: another IP or another client goes
//      to the backend, and a held key bound to someone's email is never handed out;
//   6. DCHUB_CLAIM_CLIENT_SNIPPET=0 restores the previous reply text.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';

const KEY = 'dch_live_' + 'f00dfeed'.repeat(4);
const KEY2 = 'dch_live_' + 'c0ffee00'.repeat(4);
const TRIAL = 'dch_trial_' + 'abad1dea'.repeat(4);
let S, stub, srv, PORT;
let claims = [];          // { body, ip } per backend claim
let claimReply = {};
let validateReply = {};
const prev = {};
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_CLAIM_CLIENT_SNIPPET'];

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      let buf = '';
      req.on('data', (d) => { buf += d; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (p === '/api/v1/keys/claim') {
          let body = {};
          try { body = JSON.parse(buf); } catch (_) {}
          claims.push({ body, ip: req.headers['x-dc-client-ip'] || null });
          res.end(JSON.stringify({ ok: true, api_key: KEY, tier: 'free', ...claimReply }));
          return;
        }
        if (p === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: true, tier: 'free', ...validateReply })); return; }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  delete process.env.DCHUB_CLAIM_CLIENT_SNIPPET;
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
});
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});
let ipN = 0;
beforeEach(() => {
  claims = []; claimReply = {}; validateReply = {};
  delete process.env.DCHUB_CLAIM_CLIENT_SNIPPET;
  S._heldKeys.clear();
  S._dropKeyCache();
});

async function post(h, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...h }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json };
}
// A fresh session per claim. `ip` defaults to a new address per call, so the held-key map
// (IP + client family) only matches when a test reuses an address on purpose.
async function claim({ clientInfo = 'acme-siting-bot', ua, ip, args = { client_name: 'snippet-test-agent' } } = {}) {
  const h0 = { 'x-dc-client-ip': ip || `198.51.100.${++ipN}`, ...(ua ? { 'user-agent': ua } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientInfo, version: '1' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const out = await post(h, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'claim_free_key', arguments: args } });
  const r = JSON.parse(out.json).result;
  return { text: r.content.map((c) => c.text).join('\n'), sc: r.structuredContent || {} };
}
// Each client's snippet is read off the reply's own persist_config, so no test restates a config shape.
const CLIENTS = [
  ['claude-code', 'claude_code', 'Claude Code'],
  ['Claude Desktop', 'claude_desktop', 'Claude Desktop'],
  ['Cursor', 'cursor', 'Cursor'],
  ['Visual Studio Code', 'vscode', 'VS Code'],
  ['Cline', 'cline', 'Cline'],
  ['windsurf', 'windsurf', 'Windsurf'],
  ['gemini-cli-mcp-client', 'gemini_cli', 'Gemini CLI'],
  ['antigravity', 'antigravity', 'Antigravity'],
];

describe('the calling client gets ITS snippet, right under the key', () => {
  for (const [name, client, label] of CLIENTS) {
    it(`${name} -> ${client}`, async () => {
      const { text, sc } = await claim({ clientInfo: name });
      const own = sc.persist_config && sc.persist_config.for_your_client;
      expect(own && own.client).toBe(client);
      expect(own.snippet).toContain(KEY);                     // key filled in
      const iKey = text.indexOf('**Your key:** `' + KEY + '`');
      const iHead = text.indexOf('**Paste this into ' + label);
      const iSnip = text.indexOf(own.snippet);
      expect(iKey).toBeGreaterThan(-1);
      expect(iHead).toBeGreaterThan(iKey);
      expect(iSnip).toBeGreaterThan(iHead);
      // nothing but the heading sits between the key line and the snippet block
      expect(text.slice(iKey, iHead).split('\n').filter(Boolean)).toHaveLength(1);
      // the generic every-client line is gone, and no other client's snippet is in the text
      expect(text).not.toContain('Paste-ready (Cursor, Windsurf, Claude Code');
      expect(text.match(/\*\*Paste this into /g)).toHaveLength(1);
      expect(Object.keys(sc.persist_config.clients)).toEqual([client]);
    });
  }
  it('a client known only by its user agent is still recognised', async () => {
    const { text, sc } = await claim({ clientInfo: 'mcp', ua: 'claude-code/2.0.31 (external, cli)' });
    expect(sc.persist_config.for_your_client.client).toBe('claude_code');
    expect(text).toContain('**Paste this into Claude Code');
    expect(text).toContain('claude mcp add dchub --transport http --header "X-API-Key: ' + KEY + '"');
  });
  it('an unknown client keeps the generic paste line and every client in persist_config', async () => {
    const { text, sc } = await claim({ clientInfo: 'acme-siting-bot', args: { client_name: 'acme-siting-bot' } });
    expect(text).not.toContain('**Paste this into ');
    expect(text).toContain('Paste-ready (Cursor, Windsurf, Claude Code');
    expect(text).toContain('url https://dchub.cloud/mcp, headers {"X-API-Key": "' + KEY + '"}');
    expect(sc.persist_config.for_your_client).toBeUndefined();
    expect(Object.keys(sc.persist_config.clients).length).toBeGreaterThanOrEqual(8);
  });
});

describe('a lasting key, said only when true', () => {
  it('a dch_live_ key: does not expire, in the text and machine-readable', async () => {
    for (const ci of ['Cursor', 'acme-siting-bot']) {
      const { text, sc } = await claim({ clientInfo: ci });
      expect(text, ci).toContain('This key does not expire');
      expect(text, ci).toContain('24 months');
      expect(sc.key_expires, ci).toBe(false);
      expect(sc.key_lifetime, ci).toContain('does not expire');
      expect(text.match(/This key does not expire/g), ci).toHaveLength(1);
    }
  });
  it('any other key shape (a trial key does expire) is never called lasting', async () => {
    claimReply = { api_key: TRIAL };
    const { text, sc } = await claim({ clientInfo: 'Cursor' });
    expect(sc.api_key).toBe(TRIAL);
    expect(text).not.toContain('does not expire');
    expect(sc.key_expires).toBeUndefined();
    expect(sc.key_lifetime).toBeUndefined();
  });
});

describe('the existing key comes back by IP plus client, and says so', () => {
  it('the backend is asked with this caller\'s client_name and IP', async () => {
    await claim({ clientInfo: 'Cursor', ip: '203.0.113.7', args: { client_name: 'my-cursor-agent' } });
    expect(claims).toHaveLength(1);
    expect(claims[0].body.client_name).toBe('my-cursor-agent');
    expect(claims[0].ip).toBe('203.0.113.7');
  });
  it('backend reuse (same client_name + IP): the same key, announced as already held, snippet first', async () => {
    claimReply = { reused: true };
    const { text, sc } = await claim({ clientInfo: 'Cursor' });
    expect(sc).toMatchObject({ api_key: KEY, reused: true, already_held: true, held_by: 'backend_claim_dedupe', key_expires: false });
    expect(text).toContain('You already hold a DC Hub key');
    expect(text).not.toContain('Free DC Hub dev key minted');
    expect(text).toContain('Calling claim_free_key again keeps returning this same key.');
    expect(text).not.toContain('Save it once with the step');
    expect(text.indexOf('**Paste this into Cursor')).toBeGreaterThan(text.indexOf('**Your key:**'));
  });
  it('a one-key-per-email owner reuse is named as such', async () => {
    claimReply = { reused: true, one_key_per_email: true, email_captured: true };
    const { sc } = await claim({ clientInfo: 'Cursor', args: { client_name: 'x', email: 'owner@acme-datacenters.com' } });
    expect(sc).toMatchObject({ reused: true, held_by: 'one_key_per_email' });
  });
  it('same IP + same client: the held key is returned with the snippet, no second backend claim', async () => {
    await claim({ clientInfo: 'Cursor', ip: '203.0.113.50' });
    const again = await claim({ clientInfo: 'Cursor', ip: '203.0.113.50' });
    expect(claims).toHaveLength(1);
    expect(again.sc).toMatchObject({ api_key: KEY, already_held: true, held_by: 'caller_fingerprint', key_expires: false });
    expect(again.text).toContain('returning THAT key, not a new one');
    expect(again.text.indexOf('**Paste this into Cursor')).toBeGreaterThan(again.text.indexOf('**Your key:**'));
    expect(again.text).toContain('This key does not expire');
  });
  it('same client from ANOTHER IP is not handed the held key', async () => {
    await claim({ clientInfo: 'Cursor', ip: '203.0.113.60' });
    claimReply = { api_key: KEY2 };
    const other = await claim({ clientInfo: 'Cursor', ip: '203.0.113.61' });
    expect(claims).toHaveLength(2);
    expect(other.sc.api_key).toBe(KEY2);
    expect(other.sc.held_by).not.toBe('caller_fingerprint');
  });
  it('ANOTHER client from the same IP is not handed the held key', async () => {
    await claim({ clientInfo: 'Cursor', ip: '203.0.113.70' });
    claimReply = { api_key: KEY2 };
    const other = await claim({ clientInfo: 'windsurf', ip: '203.0.113.70' });
    expect(claims).toHaveLength(2);
    expect(other.sc.api_key).toBe(KEY2);
    expect(other.sc.held_by).not.toBe('caller_fingerprint');
  });
  it('a held key since bound to someone\'s email is never handed out on IP + client', async () => {
    await claim({ clientInfo: 'Cursor', ip: '203.0.113.80' });
    validateReply = { email: 'owner@acme-datacenters.com' };
    S._dropKeyCache();
    claimReply = { api_key: KEY2 };
    const other = await claim({ clientInfo: 'Cursor', ip: '203.0.113.80' });
    expect(claims).toHaveLength(2);
    expect(other.sc.api_key).toBe(KEY2);
    expect(other.text).not.toContain(KEY);
  });
});

describe('kill switch DCHUB_CLAIM_CLIENT_SNIPPET=0', () => {
  it('restores the previous reply: generic line first, snippet below it, no lasting line', async () => {
    process.env.DCHUB_CLAIM_CLIENT_SNIPPET = '0';
    const { text, sc } = await claim({ clientInfo: 'Cursor' });
    expect(text).toContain('Paste-ready (Cursor, Windsurf, Claude Code');
    expect(text).toContain('**Save it for Cursor**');
    expect(text).not.toContain('**Paste this into ');
    expect(text).not.toContain('does not expire');
    expect(sc.key_expires).toBeUndefined();
    expect(sc.persist_config.for_your_client.client).toBe('cursor');   // structured reply unchanged
  });
});
