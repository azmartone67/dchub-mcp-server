// claim-reuse-wording-and-bound-key.test.mjs — Grok note 2026-11-09.
//
// 1. One masked account called claim_free_key on 4 separate days and nothing else.
//    The backend already hands back the existing key on a repeat claim and says
//    reused:true, but the fresh-mint branch still announced "Free DC Hub dev key
//    minted", so the agent never learnt it already held one. A reused key must be
//    announced as the same key (already_held, held_by) and keep the save step.
// 2. The held-key map is keyed on client IP + client family only. A held key that
//    was later bound to an email must not be handed to a caller on that match
//    alone (two people behind one NAT): it is withheld and the claim falls
//    through to the backend.
//
// Drives the real /mcp tools/call path against a stub backend.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';

const KEY = 'dch_live_' + 'b0a7cafe'.repeat(4);
let S, stub, srv, PORT;
let claimBodies = [];
let claimReply = {};
let validateReply = {};
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
          try { claimBodies.push(JSON.parse(buf)); } catch (_) {}
          res.end(JSON.stringify({ success: true, api_key: KEY, tier: 'free', ...claimReply }));
          return;
        }
        if (p === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: true, tier: 'free', ...validateReply })); return; }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
});
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
beforeEach(() => {
  claimBodies = []; claimReply = {}; validateReply = {};
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
// A fresh session per claim, from one fixed caller IP and client family.
async function claim(args = { client_name: 'reuse-test-agent' }) {
  const ip = { 'x-dc-client-ip': '203.0.113.41' };
  const init = await post(ip, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'reuse-wording-test', version: '1' } } });
  const h = { ...ip, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const out = await post(h, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'claim_free_key', arguments: args } });
  const r = JSON.parse(out.json).result;
  return { text: r.content.map((c) => c.text).join('\n'), sc: r.structuredContent || {} };
}

describe('a key the backend reused is announced as the same key', () => {
  it('fresh mint: says minted, reused false, no already_held', async () => {
    const { text, sc } = await claim();
    expect(text).toContain('Free DC Hub dev key minted');
    expect(text).not.toContain('You already hold a DC Hub key');
    expect(sc.reused).toBe(false);
    expect(sc.already_held).toBeUndefined();
  });
  it('backend reused:true (client_name + IP dedupe): says already held, keeps the save step', async () => {
    claimReply = { reused: true };
    const { text, sc } = await claim();
    expect(text).toContain('You already hold a DC Hub key');
    expect(text).not.toContain('Free DC Hub dev key minted');
    expect(text).toContain('keeps returning this same key');
    expect(text).toContain(KEY);
    expect(sc).toMatchObject({ api_key: KEY, reused: true, already_held: true, held_by: 'backend_claim_dedupe' });
    expect(sc.persist_config).toBeTruthy();
    expect(sc.connect_url).toContain(KEY);
  });
  it('backend unused-key cap: held_by names the cap', async () => {
    claimReply = { reused: true, gate: 'unused_key_cap' };
    const { sc } = await claim();
    expect(sc).toMatchObject({ reused: true, already_held: true, held_by: 'unused_key_cap' });
  });
});

describe('an email-bound held key is never handed out on an IP + client match', () => {
  it('unbound held key: the second claim gets it back without a backend mint', async () => {
    await claim();
    expect(claimBodies).toHaveLength(1);
    const second = await claim();
    expect(claimBodies).toHaveLength(1);                   // no second backend claim
    expect(second.sc).toMatchObject({ api_key: KEY, already_held: true, held_by: 'caller_fingerprint' });
  });
  it('held key later bound to an email: withheld, the claim goes to the backend instead', async () => {
    await claim();
    expect(claimBodies).toHaveLength(1);
    validateReply = { email: 'Someone.Else@Example.com' };
    S._dropKeyCache();
    const second = await claim();
    expect(claimBodies).toHaveLength(2);                   // fell through to the backend
    expect(second.sc.held_by).not.toBe('caller_fingerprint');
  });
  it('the same address on the claim may still have its own bound key back', async () => {
    await claim();
    validateReply = { email: 'owner@example.com' };
    S._dropKeyCache();
    const second = await claim({ client_name: 'reuse-test-agent', email: ' Owner@Example.com ' });
    expect(second.sc).toMatchObject({ already_held: true, held_by: 'caller_fingerprint' });
  });
});

describe('_heldKeyBoundElsewhere', () => {
  it('false for an unbound or indeterminate validation, true for another address', () => {
    expect(S._heldKeyBoundElsewhere(null, '')).toBe(false);
    expect(S._heldKeyBoundElsewhere({ valid: true, email: null }, '')).toBe(false);
    expect(S._heldKeyBoundElsewhere({ valid: true, email: 'a@x.io' }, '')).toBe(true);
    expect(S._heldKeyBoundElsewhere({ valid: true, email: 'a@x.io' }, 'b@x.io')).toBe(true);
    expect(S._heldKeyBoundElsewhere({ valid: true, email: 'A@x.io' }, ' a@X.io ')).toBe(false);
  });
});
