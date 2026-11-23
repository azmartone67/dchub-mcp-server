// plan-loopback-port-1123.test.mjs — execute_plan's loopback follows the port this process serves on (2026-11-23).
//
// The loopback used to POST to 127.0.0.1:PORT (default 3100) whatever port the app actually listened on. Tests
// listen on port 0, so every plan step, with this process's signed loopback tokens, went to whatever else owned
// PORT on the machine: in CI nothing (a quiet failed step), locally a stray server that answered with production
// rate limits, which turned chatgpt-directory-probe-hard-wall's CONTROL red.
//
// Here a DECOY owns PORT and the app listens elsewhere. The steps must reach the app, never the decoy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, httpServer, stub, decoy, PORT;
let decoyHits = 0;
const prev = {};

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
}

beforeAll(async () => {
  stub = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, count: 1, data: [{ id: 1, name: 'Ashburn Campus A', capacity_mw: 120 }] }));
  });
  decoy = createServer((req, res) => {
    decoyHits += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'decoy' }] } }));
  });
  await listen(stub);
  await listen(decoy);
  for (const k of ['DCHUB_API_BASE', 'PORT', 'DCHUB_INTERNAL_KEY']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.PORT = String(decoy.address().port);   // read once, at import
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  S._readDeadline.signal = () => AbortSignal.timeout(120_000);
  httpServer = S.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => httpServer.once('listening', resolve));
  PORT = httpServer.address().port;
});

afterAll(async () => {
  for (const srv of [httpServer, stub, decoy]) await new Promise((r) => (srv ? srv.close(r) : r()));
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('execute_plan loopback port', () => {
  it('steps go to the port the request came in on, never to a different PORT owner', async () => {
    expect(PORT).not.toBe(decoy.address().port);
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'execute_plan', arguments: { intent: 'rank markets for a 200 MW AI campus' } } }),
    });
    const raw = await res.text();
    expect(res.status).toBe(200);
    // Floor: the plan really ran steps, so zero decoy hits is not just "no loopback happened".
    expect(raw).toMatch(/\\"executed\\":\[\{/);
    expect(decoyHits).toBe(0);
    expect(S._loopbackPort()).toBe(PORT);
  }, 120_000);
});
