// noteN-one-key-per-session.test.mjs — Grok note N item 3 (2026-11-16).
//
// Grok read 0 of 589 mature trial keys returned and 1.53 calls per key: a key per walled call.
// On this server the inline walled-call mint (mintAutoTrial -> POST /api/v1/keys/auto-mint) is off
// by default (DCHUB_AUTO_TRIAL_MINT, owner 2026-10-20), and when it is on, F-1 skipped it only for
// a key PRESENTED on the request. A key bound to the session by bind_email / claim_free_key arrives
// on no channel, so a later walled call in that same session minted a dch_trial_ sibling.
// Pinned here on the real /mcp path against a stub backend, with the inline mint switched ON (the
// worst case; off, nothing mints anyway):
//   1. bind_email on a keyless session mints ONE durable key, says to reuse it (text + structured);
//   2. two walled calls in that session reuse it: no /keys/auto-mint, no second /keys/claim, and
//      every telemetry row carries that one key (the funnel counts it once);
//   3. DCHUB_MINT_SKIP_SESSION_KEY=0 restores the old mint (the test can fail);
//   4. claim_free_key carries the same line; DCHUB_REUSE_KEY_LINE=0 drops it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';

const KEY = 'dch_live_' + 'n0te3a11'.repeat(4);
let S, stub, srv, PORT;
let hits = [];            // { path, body, apiKey }
const prev = {};
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_AUTO_TRIAL_MINT', 'DCHUB_MINT_SKIP_SESSION_KEY',
  'DCHUB_REUSE_KEY_LINE'];
let trialN = 0;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      let buf = '';
      req.on('data', (d) => { buf += d; });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(buf); } catch (_) {}
        hits.push({ path: p, body, apiKey: req.headers['x-api-key'] || null });
        res.setHeader('content-type', 'application/json');
        if (p === '/api/v1/keys/claim') { res.end(JSON.stringify({ ok: true, api_key: KEY, tier: 'free', email_captured: true })); return; }
        if (p === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: true, tier: 'free', email: 'human@acme-infra.com' })); return; }
        // The day's full answers are spent, so the next calls are walled (preview + mint path).
        if (p === '/api/v1/mcp/full-cap/peek') { res.end(JSON.stringify({ ok: true, n: 999 })); return; }
        if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false })); return; }
        if (p === '/api/v1/keys/auto-mint') {
          res.end(JSON.stringify({ ok: true, api_key: 'dch_trial_' + String(++trialN).padStart(32, 'x'), tier: 'IDENTIFIED', daily_calls: 15 }));
          return;
        }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
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
  hits = [];
  process.env.DCHUB_AUTO_TRIAL_MINT = '1';
  delete process.env.DCHUB_MINT_SKIP_SESSION_KEY;
  delete process.env.DCHUB_REUSE_KEY_LINE;
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
async function session() {
  const h0 = { 'x-dc-client-ip': `203.0.113.${++ipN}`, 'user-agent': 'acme-siting-agent/2.0' };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acme-siting-agent', version: '2' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 10;
  return async (name, args = {}) => {
    const out = await post(h, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const r = JSON.parse(out.json).result;
    return { text: (r.content || []).map((c) => c.text).join('\n'), sc: r.structuredContent || {}, r };
  };
}
const settle = () => new Promise((r) => setTimeout(r, 150));   // fire-and-forget telemetry
const count = (p) => hits.filter((x) => x.path === p).length;

describe('one durable key per MCP session (Grok note N item 3)', () => {
  it('bind_email mints one key and says to reuse it, in the text and in structuredContent', async () => {
    const call = await session();
    const b = await call('bind_email', { email: 'human@acme-infra.com' });
    expect(b.sc.api_key).toBe(KEY);
    expect(b.sc.reuse_key_line).toBe(S.REUSE_KEY_LINE);
    expect(b.text.split(S.REUSE_KEY_LINE).length - 1).toBe(1);   // once, though claim_free_key ran inside
    expect(S.REUSE_KEY_LINE).toMatch(/X-API-Key/);
    expect(count('/api/v1/keys/claim')).toBe(1);
  });

  it('two walled calls after bind_email reuse that key: no second mint, one key in telemetry', async () => {
    const call = await session();
    await call('bind_email', { email: 'human@acme-infra.com' });
    await call('get_grid_intelligence', { iso: 'ERCOT' });
    await call('get_fiber_intel', { market: 'dallas' });
    await settle();
    expect(count('/api/v1/keys/auto-mint')).toBe(0);
    expect(count('/api/v1/keys/claim')).toBe(1);
    // The walled calls reached the backend as the session's own key, never anonymously or as a sibling.
    const keyed = hits.filter((x) => x.apiKey && x.path !== '/api/v1/keys/validate');
    expect(keyed.length).toBeGreaterThan(0);
    expect(new Set(keyed.map((x) => x.apiKey))).toEqual(new Set([KEY]));
    const tracked = hits.filter((x) => x.path === '/api/v1/mcp/track' && x.body && x.body.api_key);
    expect(tracked.length).toBeGreaterThan(0);
    expect(new Set(tracked.map((x) => x.body.api_key))).toEqual(new Set([KEY]));
  });

  // The walled-call mint itself (mintAutoTrial, the one place a walled call can POST
  // /keys/auto-mint), driven twice in the context a walled call of that session runs in: the
  // key bind_email bound, arrived on no channel (auth_source 'session'), inline mint ON.
  const sessionCtx = () => ({ api_key: KEY, tier: 'free', auth_source: 'session', session_id: 'h-noteN-bound',
    platform: 'acme-siting-agent', user_agent: 'acme-siting-agent/2.0', client_ip: '203.0.113.200', profile: '' });
  it('a walled call in a session holding a bound key mints nothing, twice over', async () => {
    const a = await S._ctxALS.run(sessionCtx(), () => S.mintAutoTrial('get_grid_intelligence'));
    const b = await S._ctxALS.run(sessionCtx(), () => S.mintAutoTrial('get_fiber_intel'));
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(count('/api/v1/keys/auto-mint')).toBe(0);
  });

  it('DCHUB_MINT_SKIP_SESSION_KEY=0 restores the per-call mint (so the pin above can fail)', async () => {
    process.env.DCHUB_MINT_SKIP_SESSION_KEY = '0';
    const a = await S._ctxALS.run(sessionCtx(), () => S.mintAutoTrial('get_grid_intelligence'));
    const b = await S._ctxALS.run(sessionCtx(), () => S.mintAutoTrial('get_fiber_intel'));
    expect(count('/api/v1/keys/auto-mint')).toBe(2);
    expect(a.api_key).not.toBe(b.api_key);   // two throwaway siblings of the session's one key
  });

  it('claim_free_key carries the same line under the key; the kill switch drops it', async () => {
    let call = await session();
    let c = await call('claim_free_key', { client_name: 'acme-siting-agent' });
    expect(c.sc.api_key).toBe(KEY);
    expect(c.sc.reuse_key_line).toBe(S.REUSE_KEY_LINE);
    expect(c.text).toContain('**Your key:** `' + KEY + '`\n' + S.REUSE_KEY_LINE);
    // A second claim in the same session returns the same key, not a sibling.
    const again = await call('claim_free_key', { client_name: 'acme-siting-agent' });
    expect(again.sc.api_key).toBe(KEY);
    expect(count('/api/v1/keys/claim')).toBe(1);

    process.env.DCHUB_REUSE_KEY_LINE = '0';
    call = await session();
    c = await call('claim_free_key', { client_name: 'acme-siting-agent' });
    expect(c.sc.reuse_key_line).toBeUndefined();
    expect(c.text).not.toContain(S.REUSE_KEY_LINE);
  });
});

describe('_sessionKeyMintSkip', () => {
  it('skips for a durable session key, never for a trial seat or a keyless caller', () => {
    expect(S._sessionKeyMintSkip({ api_key: KEY, auth_source: 'session' }, {})).toBe(true);
    expect(S._sessionKeyMintSkip({ api_key: 'dch_trial_abc', auth_source: 'session' }, {})).toBe(false);
    expect(S._sessionKeyMintSkip({ api_key: null }, {})).toBe(false);
    expect(S._sessionKeyMintSkip({ api_key: KEY }, { DCHUB_MINT_SKIP_SESSION_KEY: '0' })).toBe(false);
  });
});

describe('copy rules (Grok notes F/G/M)', () => {
  it('the reuse line names no plan, price, pricing link, paid, upgrade or trial', () => {
    expect(S.REUSE_KEY_LINE).not.toMatch(/\$|plan|price|pricing|paid|upgrade|trial|https?:/i);
  });
});
