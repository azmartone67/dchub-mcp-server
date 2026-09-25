// chatgpt-directory-hard-wall.test.mjs — the live probe's refusal counting,
// end to end (2026-09-25).
//
// scripts/probe-chatgpt-directory.mjs counts a per-IP daily hard wall
// (anon_hard_wall) as rate-limited (mcp#549). Its unit test feeds
// classifyResponse a hand-copied wall body, so it cannot notice the
// /mcp/chatgpt filter rewording or stripping the real one. This file makes the
// server produce the wall itself, through the profile, with the headers and
// _meta ChatGPT sends, and requires the probe to call it refused.
//
// Its own file because ANON_DAILY_CAP is read once when server.mjs loads, and
// the probe suite runs with the cap off.
//
// CONTROL: walled tools answer with data from an IP under the wall, so a
// 'refused' reading comes from the wall and not from the harness.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { classifyResponse, probeHits, GUESS_ARGS, CHATGPT_HEADERS, CHATGPT_META } from '../scripts/probe-chatgpt-directory.mjs';
import { DIRECTORY_TOOLS } from '../lib/chatgpt-directory.mjs';

const WALLED_IP = '198.51.100.7';
const OPEN_IP = '198.51.100.8';

let S, PORT, httpServer, stub;
let usageReads = 0;
const saved = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const u = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
      if (u.pathname === '/api/v1/mcp/anon-usage') {
        usageReads += 1;
        return send(200, { ok: true, count: u.searchParams.get('ip') === WALLED_IP ? 999 : 0 });
      }
      if (u.pathname === '/api/v1/mcp/trial-check') return send(200, { trial_used: false, prior_calls: 0 });
      if (u.pathname === '/api/v1/mcp/session-key') return send(404, { error: 'not found' });
      if (u.pathname === '/api/v1/keys/auto-mint') return send(503, { error: 'off in this test' });
      if (u.pathname === '/api/v1/keys/validate') return send(200, { valid: false, tier: 'free' });
      return send(200, {
        success: true, count: 2, total: 2,
        data: [{ id: 1, name: 'Ashburn Campus A', market: 'northern-virginia', capacity_mw: 120 },
               { id: 2, name: 'Dallas Campus B', market: 'dallas', capacity_mw: 80 }],
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_ANON_HARD_WALL_MULT', 'DCHUB_INTERNAL_KEY']) saved[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_ANON_DAILY_CAP = '30';        // production values: wall at 300
  process.env.DCHUB_ANON_HARD_WALL_MULT = '10';
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  // Same reason as test/anon-hard-wall.test.mjs: a 2.5s read deadline under a
  // saturated suite can abort a read the stub already answered, which fails
  // open to count 0 and would turn the walled case into a false 'data'.
  S._readDeadline.signal = () => AbortSignal.timeout(120_000);
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

let rpcId = 1;
// What the live probe does per call: POST, then keep the data: lines of the
// SSE body and parse them as the JSON-RPC message.
async function chatgptCall(ip, name) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp/chatgpt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'x-dc-client-ip': ip, ...CHATGPT_HEADERS },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
      params: { name, arguments: { ...GUESS_ARGS }, _meta: { ...CHATGPT_META } } }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  let msg = null;
  try { msg = JSON.parse(body); } catch (_) { /* msg stays null, as in the probe */ }
  return { status: res.status, raw, msg };
}

describe('/mcp/chatgpt — the real anon_hard_wall, as the live probe sees it', () => {
  // Every directory tool, as the live probe sweeps them. The wall sits below
  // the preview/paywall return points in server.mjs, so tools that answer
  // there never reach it: measured 2026-09-25, 49 of 72 calls walled and the
  // other 23 answered (the gated previews among them). This asserts what the
  // probe needs, not that split: every walled response counts as refused and
  // carries no commerce, and the wall is reached on most tools.
  it('every walled response is counted refused and leaks no commerce', async () => {
    const before = usageReads;
    const walled = [];
    const miscounted = [];
    const leaks = [];
    for (const name of Object.keys(DIRECTORY_TOOLS)) {
      if (name === 'subscribe_digest') continue;   // sends mail; the probe calls it with no args
      const r = await chatgptCall(WALLED_IP, name);
      if (!r.raw.includes('anon_hard_wall')) continue;
      walled.push(name);
      if (classifyResponse(r.raw, r.msg) !== 'refused') miscounted.push(name);
      // The wall's own copy offers a $10 pack and a checkout link; on the
      // profile none of it may reach the reviewer.
      const hits = probeHits(r.raw);
      if (hits.length) leaks.push(`${name}: ${hits.join(', ')}`);
    }
    expect(miscounted).toEqual([]);
    expect(leaks).toEqual([]);
    // Vacuity floor: 49 measured. Below 40 the wall moved, and this file is
    // no longer testing what the live probe meets.
    expect(walled.length).toBeGreaterThanOrEqual(40);
    expect(usageReads - before, 'the server never read the anon count').toBeGreaterThan(0);
  });

  it('CONTROL: the same walled tools answer with data from an IP under the wall', async () => {
    for (const name of ['get_news', 'search_facilities', 'get_market_dcpi_rank']) {
      const walled = await chatgptCall(WALLED_IP, name);
      expect(walled.raw, `${name} is no longer walled; pick a walled tool`).toContain('anon_hard_wall');
      const open = await chatgptCall(OPEN_IP, name);
      expect(open.raw, name).not.toContain('anon_hard_wall');
      expect(classifyResponse(open.raw, open.msg), name).toBe('data');
    }
  });
});
