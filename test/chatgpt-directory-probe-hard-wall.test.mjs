// chatgpt-directory-probe-hard-wall.test.mjs — r-chatgpt-directory (2026-09-25)
//
// mcp#549 taught scripts/probe-chatgpt-directory.mjs to count the per-IP daily
// hard wall as refused, so a probe run from an IP past 300 anonymous calls
// reads rate_limited N rather than 0/0/0 INCONCLUSIVE. Its unit test feeds
// classifyResponse a HAND-WRITTEN copy of the wall body. The fake backend in
// chatgpt-directory-probe.test.mjs never walls, so if the /mcp/chatgpt filter
// ever reworded or scrubbed the real refusal, that test would stay green while
// the live probe went back to reading refusals as nothing.
//
// This file produces the refusal for real: DCHUB_ANON_DAILY_CAP=30 is set
// before server.mjs loads (ANON_DAILY_CAP is read once, at import), and the
// stub backend answers /api/v1/mcp/anon-usage with a count past the wall. Every
// directory tool is then called on /mcp/chatgpt and must classify as refused.
//
// CONTROL: the same calls with the count at 0 must NOT classify as refused, so
// the wall — not something else in the harness — is what flips the verdict.
//
// The refusal must also carry no commerce: the wall message names a checkout
// link and a "$10" pack, and the profile has to scrub those like any answer.
//
// r-hard-wall-covers-gated (2026-09-25): the first cut of this file found the
// wall covered only 31 of the 72 tools. Every gated tool returned its preview
// from the tier-gate branch, which ran the handler before the wall was ever
// reached. The sweep below therefore also requires ZERO backend data queries
// past the wall -- the wall's whole cost argument -- and the last block pins
// who is still let through: a keyless caller who is paying.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { DIRECTORY_TOOLS } from '../lib/chatgpt-directory.mjs';
import { probeHits, GUESS_ARGS, classifyResponse } from '../scripts/probe-chatgpt-directory.mjs';
import { MPP_CRED_KEY } from '../mpp-hook.mjs';

let S, PORT, httpServer, stub;
let anonCount = 0, anonReads = 0, dataHits = 0;
const dataPaths = [];
const sessionCredits = {};   // session_id -> pack credits the stub reports
const prev = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
      if (p === '/api/v1/mcp/anon-usage') { anonReads += 1; return send(200, { ok: true, count: anonCount }); }
      if (p === '/api/v1/mcp/trial-check') return send(200, { trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send(404, { error: 'not found' });
      if (p === '/api/v1/keys/auto-mint') return send(503, { ok: false });
      if (p === '/api/v1/keys/validate') return send(200, { valid: false, tier: 'free' });
      if (p === '/api/v1/mcp/credits/balance') {
        const sid = new URL(req.url, 'http://_').searchParams.get('session') || '';
        return send(200, { credits: sessionCredits[sid] || 0, had_pack: false });
      }
      // A data query is a GET; the per-call telemetry (/mcp/track, signal-paywall,
      // heartbeat) is a POST and runs for a refusal too. tool-descriptions is the
      // catalog refresh, not a call.
      if (req.method === 'GET' && p !== '/api/v1/mcp/tool-descriptions') { dataHits += 1; dataPaths.push(p); }
      return send(200, { success: true, count: 1, data: [{ id: 1, name: 'Ashburn Campus A', capacity_mw: 120 }] });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_ANON_HARD_WALL_MULT', 'DCHUB_INTERNAL_KEY']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_ANON_DAILY_CAP = '30';
  process.env.DCHUB_ANON_HARD_WALL_MULT = '10';
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  // Same reason as anon-hard-wall.test.mjs: the 2500ms read deadline is a race
  // against the scheduler under the full suite, not a property under test here.
  S._readDeadline.signal = () => AbortSignal.timeout(120_000);
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

let rpcId = 1;
async function callDir(name, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp/chatgpt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: { ...args } } }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { raw, msg: JSON.parse(body) };
}

// subscribe_digest sends mail; everything else is a read.
const TOOLS = Object.keys(DIRECTORY_TOOLS).filter((n) => n !== 'subscribe_digest');

async function sweep(count) {
  anonCount = count;
  S._anonUsageCounts.clear();
  const verdicts = {};
  const offenders = [];
  for (const name of TOOLS) {
    const { raw, msg } = await callDir(name, GUESS_ARGS);
    verdicts[name] = classifyResponse(raw, msg);
    const hits = probeHits(raw);
    if (hits.length) offenders.push(`${name}: ${hits.join(', ')}`);
  }
  return { verdicts, offenders };
}

describe('/mcp/chatgpt past the per-IP hard wall', () => {
  it('CONTROL: under the wall, no directory tool reads as refused', async () => {
    const before = anonReads;
    const hitsBefore = dataHits;
    const { verdicts } = await sweep(0);
    const refused = Object.entries(verdicts).filter(([, v]) => v === 'refused').map(([n]) => n);
    expect(refused).toEqual([]);
    // Floor: the harness really reaches answers, so 'not refused' is not just 'broken'.
    expect(Object.values(verdicts).filter((v) => v === 'data').length).toBeGreaterThan(TOOLS.length / 2);
    // The count really was read from the stub, or the wall arm was never reachable.
    expect(anonReads - before).toBeGreaterThan(0);
    // And the tools really query the backend, so zero queries past the wall means the wall.
    expect(dataHits - hitsBefore).toBeGreaterThan(TOOLS.length / 2);
  }, 240_000);

  it('every directory tool the real wall stops classifies as refused, with no commerce', async () => {
    const before = dataHits;
    dataPaths.length = 0;
    const { verdicts, offenders } = await sweep(999);
    expect(dataPaths, 'a walled call still queried the backend').toEqual([]);
    expect(dataHits - before).toBe(0);
    const notRefused = Object.entries(verdicts).filter(([, v]) => v !== 'refused').map(([n, v]) => `${n}: ${v}`);
    expect(notRefused).toEqual([]);
    expect(Object.keys(verdicts).length).toBe(TOOLS.length);
    expect(offenders).toEqual([]);
  }, 240_000);
});

describe('_anonWallPaidCall — a keyless caller who is paying is not walled', () => {
  it('session-bound pack credits, an x402 payment or an MPP credential let the call through', async () => {
    sessionCredits['sess-with-pack'] = 50;
    expect(await S._anonWallPaidCall({ session_id: 'sess-with-pack' }, {}, {})).toBe(true);
    expect(await S._anonWallPaidCall({ x_payment: 'x402-payload' }, {}, {})).toBe(true);
    expect(await S._anonWallPaidCall({}, { _meta: { [MPP_CRED_KEY]: 'spt_x' } }, {})).toBe(true);
  });

  it('CONTROL: no credits, no payment, no session => walled', async () => {
    expect(await S._anonWallPaidCall({ session_id: 'sess-no-pack' }, {}, {})).toBe(false);
    expect(await S._anonWallPaidCall({}, {}, {})).toBe(false);
  });
});
