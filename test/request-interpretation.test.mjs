// request-interpretation.test.mjs — (2026-08-25)  STAGE 0a
//
// An argument this server does not declare is dropped in silence. Measured
// live 2026-08-25, both real:
//
//   get_power_availability_timeline{latitude,longitude} -> API 400. That tool
//     declares {mw, state, years} and NO coordinates. The 400 says a parameter
//     was rejected; it never says WHICH.
//   /api/v1/facilities?search=… -> the ENTIRE 17,170-row fleet, because
//     `search` was not an accepted alias. No error at all.
//
// A dropped argument that errors is visible. One that is ignored is not.
//
// ★★★ WHY THIS FILE BOOTS THE REAL SERVER. The first cut of Stage 0a shipped,
// deployed, and could NEVER FIRE — verified absent in production 2026-08-25.
// It read Object.keys(args) inside the tool callback, but the SDK validates
// params.arguments with safeParseAsync(z.object(shape)) and hands the callback
// parseResult.data, and **zod strips undeclared keys**. The undeclared argument
// is gone before the handler runs, so "sent MINUS declared" computed there is
// always empty.
//
// It had 17 guards. Every one of them called the exported function DIRECTLY
// with a hand-built args object still containing the undeclared keys — a state
// the real dispatcher cannot produce — and two more only grepped server.mjs for
// the call expression, proving the call was WRITTEN, never that it could DO
// anything. So: the guard below drives a real tools/call over HTTP through the
// real Express app and the real SDK. If the capture ever moves back downstream
// of validation, THIS fails.
//
// ★ The load-bearing half of this file is still the REFUSAL. There is no
// `recognized_arguments`, and there must not be: capacity_mw and state are BOTH
// declared on analyze_site and identical at dispatch, yet state moves the
// composite score (AZ 83.6 vs TX 71) and capacity_mw does not (79 at 1 MW,
// 5000 MW and absent — re-measured 2026-08-25, score 80). Reporting both as
// "recognized" would report a silently dropped constraint as understood.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

let S;         // server.mjs module namespace
let PORT;      // ephemeral — server.mjs does not bind one under VITEST (r70)
let httpServer;

beforeAll(async () => {
  // ★ Unreachable on purpose: every tool call below fails upstream in
  // milliseconds. That keeps this file OFFLINE and deterministic, and it pins
  // the property that matters most — the block survives the error envelope,
  // because a caller who sent a bad argument is exactly the caller who errored.
  //
  // ★★ RESTORED IMMEDIATELY. server.mjs captures `const API_BASE` ONCE at module
  // evaluation, so the override only has to survive the import — but vitest can
  // share a worker (and therefore process.env) across files, and leaving it set
  // pointed three live-network tests in mcp/regression at a dead host. Measured:
  // 3 failures that vanished when those files ran alone. If server.mjs was
  // already imported by a sibling this override is a no-op and the calls below
  // reach the real backend — the assertions hold either way, because the block
  // is stamped independently of whether the upstream call succeeded.
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
});

/** Drive a real tools/call over HTTP; return the structuredContent. */
async function callOverHttp(name, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  const r = JSON.parse(json).result || {};
  if (r.structuredContent) return r.structuredContent;
  try { return JSON.parse((r.content || []).map((c) => c.text || '').join('')); } catch { return {}; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE END-TO-END GUARD. This is the one the original shipped without.
// ─────────────────────────────────────────────────────────────────────────────
describe('through the REAL dispatcher, over HTTP', () => {
  it('names the undeclared arguments of a real tools/call', async () => {
    const sc = await callOverHttp('get_power_availability_timeline',
      { state: 'TX', latitude: 32.78, longitude: -96.8 });
    expect(sc.request_interpretation?.unsupported_arguments).toEqual(['latitude', 'longitude']);
  });

  it('stays SILENT when every argument is declared', async () => {
    const sc = await callOverHttp('get_power_availability_timeline', { state: 'TX' });
    expect(sc.request_interpretation).toBeUndefined();
  });

  it('★ REFUSES to flag a DECLARED-but-inert argument (capacity_mw), only the unknown one', async () => {
    const sc = await callOverHttp('analyze_site',
      { latitude: 32.78, longitude: -96.8, capacity_mw: 500, bogus_zzz: 1 });
    expect(sc.request_interpretation?.unsupported_arguments).toEqual(['bogus_zzz']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. NON-VACUITY. If the SDK ever stops stripping, the ctx capture is no longer
//    load-bearing and this file's premise has changed. Fail loudly then.
// ─────────────────────────────────────────────────────────────────────────────
describe('the mechanism this fix exists for', () => {
  it('the SDK strips undeclared keys before the handler — so args CANNOT be the source', async () => {
    const srv = new McpServer({ name: 'guard', version: '0' });
    let seen = null;
    srv.registerTool('probe', { description: 'g', inputSchema: { state: z.string().optional() } },
      async (a) => { seen = Object.keys(a); return { content: [], structuredContent: { ok: true } }; });
    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '1' });
    await Promise.all([srv.connect(s), client.connect(c)]);
    await client.callTool({ name: 'probe', arguments: { state: 'TX', latitude: 1, longitude: 2 } });
    expect(seen).toEqual(['state']);                       // latitude/longitude already gone
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The pure capture, at its own boundary.
// ─────────────────────────────────────────────────────────────────────────────
describe('_rawArgKeysFromBody reads the wire, not the parsed args', () => {
  const body = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

  it('captures every key the caller actually sent', () => {
    expect(S._rawArgKeysFromBody(body('t', { a: 1, b: 2 })).get('t')).toEqual(['a', 'b']);
  });

  it('handles a JSON-RPC batch', () => {
    const m = S._rawArgKeysFromBody([body('t1', { a: 1 }), body('t2', { b: 2 })]);
    expect(m.get('t1')).toEqual(['a']);
    expect(m.get('t2')).toEqual(['b']);
  });

  it('★ refuses to guess when one batch names the same tool twice', () => {
    expect(S._rawArgKeysFromBody([body('t', { a: 1 }), body('t', { b: 2 })]).get('t')).toBe(null);
  });

  it('ignores non-tools/call messages and malformed bodies', () => {
    expect(S._rawArgKeysFromBody({ method: 'tools/list' }).size).toBe(0);
    expect(S._rawArgKeysFromBody(null).size).toBe(0);
    expect(S._rawArgKeysFromBody({ method: 'tools/call', params: null }).size).toBe(0);
  });

  it('records an empty key list for an argument-less call', () => {
    expect(S._rawArgKeysFromBody(body('t', undefined)).get('t')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The block's own contract.
// ─────────────────────────────────────────────────────────────────────────────
describe('the block itself', () => {
  const declared = (...k) => new Set(k);

  it('reports sent MINUS declared, sorted', () => {
    expect(S._requestInterpretation(['longitude', 'latitude', 'state'], declared('mw', 'state', 'years'))
      .unsupported_arguments).toEqual(['latitude', 'longitude']);
  });

  it('is silent when everything is declared, and on an empty call', () => {
    expect(S._requestInterpretation(['state'], declared('mw', 'state'))).toBe(null);
    expect(S._requestInterpretation([], declared('state'))).toBe(null);
  });

  it('is silent when nothing was captured (stdio, unparsed body, ambiguous batch)', () => {
    expect(S._requestInterpretation(null, declared('state'))).toBe(null);
  });

  it('is silent for a tool whose declared set is unknown', () => {
    expect(S._requestInterpretation(['zz'], null)).toBe(null);
  });

  it('★ NEVER claims an argument was recognized or applied', () => {
    const ri = S._requestInterpretation(['zz'], declared('state'));
    expect(ri.recognized_arguments).toBeUndefined();
    expect(ri.applied_arguments).toBeUndefined();
    expect(ri.caveat).toMatch(/cannot tell you that a DECLARED argument was APPLIED/);
  });

  it('never overwrites a block the handler published itself', () => {
    const own = { unsupported_arguments: ['handler_said_so'] };
    const r = S._stampRequestInterpretation(
      { content: [], structuredContent: { ok: true, request_interpretation: own } },
      ['bogus'], declared('x'));
    expect(r.structuredContent.request_interpretation).toBe(own);
  });

  it('fail-soft: never throws, never drops the result', () => {
    expect(S._stampRequestInterpretation(null, ['a'], declared('x'))).toBe(null);
    const evil = { content: [], get structuredContent() { throw new Error('boom'); } };
    expect(() => S._stampRequestInterpretation(evil, ['a'], declared('x'))).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. WIRING. Kept from the original, and re-scoped: the capture must be read
//    from the request ctx, NOT from the handler's already-stripped args.
// ─────────────────────────────────────────────────────────────────────────────
describe('wiring', () => {
  const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

  it('the dispatcher stamps from the CTX capture, never from `args`', () => {
    expect(SRC).toMatch(/_stampRequestInterpretation\([\s\S]{0,400}?_ctxRawArgKeys\(name\), _toolParamKeys\(name\)\)/);
    expect(SRC).not.toMatch(/_stampRequestInterpretation\([\s\S]{0,400}?\), args, _toolParamKeys/);
  });

  it('every POST path that can carry a tools/call captures the raw keys', () => {
    expect((SRC.match(/raw_arg_keys: _rawArgKeysFromBody\(/g) || []).length).toBe(3);
  });

  it('_flagUpstreamError stays outermost', () => {
    expect(SRC).toMatch(/=> _flagUpstreamError\(/);
  });
});
