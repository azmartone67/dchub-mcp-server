// high-intent-needs-a-session.test.mjs — r-hi-needs-session (2026-09-14)
//
// ★THE DEFECT. A tools/call with no Mcp-Session-Id reaches the paywall branches, which fall
// back to the literal 'no-session' and handed it to trackPaidHit and shouldMintClaim. The
// backend keyed mcp_high_intent_sessions on that string, so every sessionless caller shared
// ONE (session, tool) row. Read on Neon 2026-09-14: 17 such rows, 15 claims minted on them
// between 07-26 and 09-13, 14 auto-redeemed within seconds. The high-intent block printed
// its Developer link direct (buy.stripe.com) for those calls: it was wrapped in /go/c only
// when the context held a session, and these calls held none.
//
// ★WHY REAL HTTP. The fallback lives in the tools/call handler, so a unit test of either
// helper cannot see what the handler passes. The stub backend mints for ANY id, as the
// pre-fix backend did, so a sessionless call that still reached it would show.
//
// Qualifies for the hard gate: the only sockets are a 127.0.0.1 backend stub and the real
// express app listening on 127.0.0.1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';

const SECRET = 'test-internal-key-not-a-real-secret';
const GO = 'https://dchub.cloud/go/c/';
const TOOL = 'get_tax_incentives';
const ARGS = { state: 'VA' };
const SID = '1aa6536d-b1d4-24b4-74a8-e89ba266e781';
const KEY = 'dch_live_hineedssession_key001';
const sha = (k) => createHash('sha256').update(k).digest('hex');
// variant 'claude' skips the auto-redeem, so the block builder makes no backend call.
const CLAIM = { claim_url: 'https://dchub.cloud/claim/tok-x', claim_token: 'tok-x', count: 2, variant: 'claude' };
const WALLED = /needs full access|is a paid feature/;

let S, PORT, httpServer, stub;
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_GO_LINKS'];
const prevEnv = {};
const highIntentCalls = [];   // [endpoint, session_id], in arrival order

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      const p = url.pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/mcp/should-mint-claim') {
        const sid = url.searchParams.get('session_id') || '';
        highIntentCalls.push(['should-mint-claim', sid]);
        const tok = 'tok-' + Buffer.from(sid).toString('hex').slice(0, 12);
        res.end(JSON.stringify({ should_mint: true, count: 2, threshold: 2, claim_token: tok,
          claim_url: 'https://dchub.cloud/claim/' + tok, reused: false, variant: 'generic' }));
        return;
      }
      if (p === '/api/v1/mcp/track-paid-hit') {
        highIntentCalls.push(['track-paid-hit', (await readBody(req)).session_id]);
        res.end(JSON.stringify({ ok: true, count: 2, is_high_intent: true, threshold: 2 }));
        return;
      }
      if (p === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: false })); return; }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: true, prior_calls: 1 })); return; }
      if (p === '/api/v1/keys/auto-mint') { res.end(JSON.stringify({ ok: false })); return; }
      if (p === '/api/v1/mcp/credits/balance') { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/sources/')) { res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 1, data: [{ id: 1, state: 'VA', name: 'x' }] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;   // read per call by _goUrl
  delete process.env.DCHUB_GO_LINKS;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'user-agent': 'node', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, json };
}

async function openSession() {
  const init = await post({}, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hi-session-client', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    sid,
    async call(name, args) {
      const { json } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
      return JSON.parse(json).result || {};
    },
  };
}

const textOf = (result) => (result.content || []).map((c) => c.text || '').join('\n');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
// trackPaidHit is fire-and-forget, so its request can land after the response. Poll for it.
async function eventually(pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await sleep(20); }
  return pred();
}

/** Split a signed dchub.cloud/<path>/<payload>.<sig> link the way the backend verifies it. */
function fields(url, prefix) {
  expect(String(url).startsWith(prefix), `not a signed ${prefix} link: ${url}`).toBe(true);
  const token = url.slice(prefix.length);
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
  expect(token.slice(i + 1)).toBe(sig);
  return { payload, parts: Buffer.from(payload, 'base64url').toString().split('|') };
}

describe('the high-intent count needs a real session', () => {
  it('a call with no Mcp-Session-Id is walled without reaching either high-intent endpoint', async () => {
    const { json } = await post({}, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: TOOL, arguments: ARGS } });
    const result = JSON.parse(json).result || {};
    const text = textOf(result);
    expect(text, text.slice(0, 200)).toMatch(WALLED);
    const sessionless = () => highIntentCalls.some(([, sid]) => !sid || sid === 'no-session');
    expect(await eventually(sessionless, 1000), JSON.stringify(highIntentCalls)).toBe(false);
    expect(text).not.toContain('live siting workflow');
    expect(JSON.stringify(result).match(/https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+/g)).toBeNull();
  });

  it('control: a sessioned call on the same wall still counts the hit and asks for a claim', async () => {
    const s = await openSession();
    expect(textOf(await s.call(TOOL, ARGS))).toMatch(WALLED);
    const both = () => ['should-mint-claim', 'track-paid-hit']
      .every((e) => highIntentCalls.some(([ep, sid]) => ep === e && sid === s.sid));
    expect(await eventually(both, 3000), JSON.stringify(highIntentCalls)).toBe(true);
  });
});

describe('buildHighIntentClaimBlock prints the Developer link through /go/c whatever the caller holds', () => {
  const block = (store) => S._ctxALS.run({ ...store }, () => S.buildHighIntentClaimBlock(CLAIM, TOOL));

  it('no session: a signed developer link on an anonymous attribution id', async () => {
    const { text, sc } = await block({});
    const { parts } = fields(sc.high_intent_developer_url, GO);
    expect(parts[0]).toBe('developer');
    expect(parts[1]).toMatch(/^a-[0-9a-f]{32}$/);
    expect(parts).toHaveLength(2);
    expect(text).toContain(sc.high_intent_developer_url);
    expect(JSON.stringify({ text, sc })).not.toContain('buy.stripe.com');
  });

  it('a session: developer|<sid>', async () => {
    const { sc } = await block({ session_id: SID });
    expect(fields(sc.high_intent_developer_url, GO).parts).toEqual(['developer', SID]);
  });

  it('a live key: developer|k-<sha256(key)>|<sid>', async () => {
    const { sc } = await block({ session_id: SID, api_key: KEY });
    expect(fields(sc.high_intent_developer_url, GO).parts).toEqual(['developer', 'k-' + sha(KEY), SID]);
  });
});
