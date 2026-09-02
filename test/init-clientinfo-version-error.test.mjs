// ── an `initialize` missing clientInfo.version must say SO, not "server down" ──
//
// THE DEFECT (live-verified 2026-09-02 against https://dchub.cloud/mcp and the
// Railway origin …-4d2e.up.railway.app/mcp — byte-identical, so this was
// application logic and not the edge). POST /mcp initialize with
// clientInfo:{name:"probe"} (no `version`) answered:
//
//   {"jsonrpc":"2.0","error":{"code":-32000,
//    "message":"Bad Request: Server not initialized"},"id":null}
//
// The payload was malformed; the message blamed SERVER STATE. It sent one
// debugging session ~15 minutes down a false "production outage" path, and any
// integrator wiring a new MCP client who forgets `version` reads it the same
// way: "DC Hub is down."
//
// ★ WHY THIS TEST IS TRANSPORT-DRIVEN AND NOT A UNIT TEST OF THE VALIDATOR.
// The bug was never in a validator — there wasn't one. It lived in the SEAM:
// our handler branches on the raw string `body.method === 'initialize'` and
// hands off, while the SDK transport re-decides the same question by
// zod-parsing the message (types.js `isInitializeRequest`). The two disagreed,
// and the disagreement is only observable over a real HTTP round-trip. A unit
// test calling _initRequestError() directly would pass just as happily with the
// handler never wired to it — which is exactly how Stage 0a shipped inert for
// eight days. So both arms below go over the wire; the pure-function checks are
// an ADDITION, never the proof.
//
// ★ NOT A LOOSENING. `version` IS required by the MCP spec and stays required.
// The last block pins that: the set of payloads we reject is exactly the set
// the SDK's own schema rejects, asserted against that schema.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InitializeRequestSchema } from '@modelcontextprotocol/sdk/types.js';

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

// One raw initialize over HTTP. Accept advertises BOTH json and SSE exactly as
// the reproducing curl did, so success comes back as an SSE frame and the error
// as plain JSON — parse either into one shape.
async function initialize(clientInfo, { id = 1 } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {},
                ...(clientInfo === undefined ? {} : { clientInfo }) } }),
  });
  const raw = await res.text();
  const line = raw.split('\n').find((l) => l.startsWith('data: '));
  return {
    status: res.status,
    sid: res.headers.get('mcp-session-id'),
    raw,
    json: JSON.parse(line ? line.slice(6) : raw),
  };
}

describe('initialize with a malformed clientInfo names the field', () => {
  it('THE REPRO: clientInfo without `version` → -32602 naming params.clientInfo.version', async () => {
    const r = await initialize({ name: 'probe' });

    expect(r.status).toBe(400);
    expect(r.json.result).toBeUndefined();
    // Parsed fields, not substrings in a blob: a message that merely CONTAINS
    // the field name somewhere would satisfy a grep and prove nothing.
    expect(r.json.error.code).toBe(-32602);
    expect(r.json.error.data.field).toBe('params.clientInfo.version');
    expect(r.json.error.data.reason).toBe('missing');
    expect(r.json.error.data.expected).toBe('string');
    // The human-readable half has to carry the field too — that string is the
    // whole point of the fix; an integrator reads it, not error.data.
    expect(r.json.error.message).toContain('params.clientInfo.version');
    expect(r.json.error.message).toMatch(/initialize requires/);
  });

  it('does NOT blame server state — the exact wording that cost 15 minutes is gone', async () => {
    const r = await initialize({ name: 'probe' });
    expect(r.json.error.message).not.toMatch(/not initialized/i);
    expect(r.json.error.code).not.toBe(-32000);
    // The whole envelope, so a revert cannot hide the old wording in `data`.
    expect(r.raw).not.toMatch(/Server not initialized/);
  });

  it("echoes the caller's id instead of the SDK's id:null", async () => {
    const r = await initialize({ name: 'probe' }, { id: 77 });
    expect(r.json.id).toBe(77);
  });

  it('clientInfo absent entirely → names params.clientInfo, not a deeper field', async () => {
    const r = await initialize(undefined);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32602);
    expect(r.json.error.data.field).toBe('params.clientInfo');
    expect(r.json.error.message).not.toMatch(/not initialized/i);
  });

  it('version present but not a string → invalid_type, still names the field', async () => {
    const r = await initialize({ name: 'probe', version: 1.0 });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32602);
    expect(r.json.error.data.field).toBe('params.clientInfo.version');
    expect(r.json.error.data.reason).toBe('invalid_type');
  });
});

describe('the error envelope carries the SUMMARY only — no raw zod issues', () => {
  // The first cut of this fix shipped `data.issues`: the raw zod issue array,
  // which publishes the SDK's internal schema-path shape in a PUBLIC error for
  // no gain the three summary fields don't already give a caller. Dropped.
  // Absence has to be PINNED — a leak that nothing asserts comes back on the
  // next edit and nobody notices, because a leak breaks no feature.

  it('data has exactly field/expected/reason — no `issues`, and no new key either', async () => {
    const r = await initialize({ name: 'probe' });
    // An allowlist, not `expect(data.issues).toBeUndefined()`: that would pass
    // just as happily if a DIFFERENT internal blob showed up tomorrow.
    expect(Object.keys(r.json.error.data).sort()).toEqual(['expected', 'field', 'reason']);
  });

  it('the SDK\'s internal schema paths and zod wording never reach the wire', async () => {
    for (const ci of [{ name: 'probe' }, undefined, { name: 'probe', version: 1 }]) {
      const r = await initialize(ci);
      // zod issue internals: the `path` array and zod's own message text.
      expect(r.raw).not.toMatch(/"path"\s*:/);
      expect(r.raw).not.toMatch(/Invalid input: expected/);
      expect(r.raw).not.toMatch(/"code"\s*:\s*"invalid_type"/);
      // …while the caller-facing summary is still all there.
      expect(r.json.error.data.field).toBeTruthy();
    }
  });

  it('the pure function does not carry them either (not merely stripped at the writer)', () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe' } } };
    const e = S._initRequestError(body);
    expect(Object.keys(e.data).sort()).toEqual(['expected', 'field', 'reason']);
    expect(JSON.stringify(e)).not.toMatch(/"path"\s*:/);
  });
});

describe('the valid arm is untouched — a spec-compliant initialize still works', () => {
  it('clientInfo with `version` → 200, a session id, and serverInfo', async () => {
    const r = await initialize({ name: 'probe', version: '1.0' });

    expect(r.status).toBe(200);
    expect(r.json.error).toBeUndefined();
    expect(r.json.result.serverInfo).toBeTruthy();
    expect(typeof r.json.result.serverInfo.name).toBe('string');
    expect(r.json.result.serverInfo.name.length).toBeGreaterThan(0);
    expect(typeof r.json.result.serverInfo.version).toBe('string');
    expect(r.json.result.protocolVersion).toBeTruthy();
    // A minted session id is what proves the handshake actually COMPLETED
    // rather than merely returning a 200 body.
    expect(r.sid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the minted session is usable — tools/list on it returns the catalog', async () => {
    const init = await initialize({ name: 'probe', version: '1.0' });
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 accept: 'application/json, text/event-stream',
                 'mcp-session-id': init.sid },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const raw = await res.text();
    const line = raw.split('\n').find((l) => l.startsWith('data: '));
    const json = JSON.parse(line ? line.slice(6) : raw);
    expect(res.status).toBe(200);
    expect(Array.isArray(json.result.tools)).toBe(true);
    expect(json.result.tools.length).toBeGreaterThan(10);
  });
});

describe('rejection set unchanged: exactly what the SDK schema already rejected', () => {
  // Every payload the new check rejects must ALREADY have been rejected by the
  // SDK (as -32000), and every payload it accepts must still be accepted. That
  // is what makes this a message fix rather than a validation change — proven
  // against the SDK's own schema, the same predicate `isInitializeRequest` runs.
  const bodies = [
    ['missing version',      { name: 'probe' }],
    ['missing name',         { version: '1.0' }],
    ['numeric version',      { name: 'probe', version: 1 }],
    ['null clientInfo',      null],
    ['valid',                { name: 'probe', version: '1.0' }],
    ['valid + extra fields', { name: 'probe', version: '1.0', title: 'Probe', websiteUrl: 'https://x.test' }],
  ];

  it.each(bodies)('%s: _initRequestError agrees with InitializeRequestSchema', (_label, clientInfo) => {
    const body = { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo } };
    const sdkAccepts = InitializeRequestSchema.safeParse(body).success;
    expect(S._initRequestError(body) === null).toBe(sdkAccepts);
  });

  it('the fixture set actually exercises BOTH verdicts', () => {
    // Guard against the block above going vacuously green if every fixture
    // happened to land on one side.
    const verdicts = bodies.map(([, ci]) => InitializeRequestSchema.safeParse(
      { jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: ci } }).success);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it('never fires on a non-initialize method', () => {
    expect(S._initRequestError({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).toBeNull();
    expect(S._initRequestError({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBeNull();
    expect(S._initRequestError(null)).toBeNull();
    expect(S._initRequestError(undefined)).toBeNull();
  });
});
