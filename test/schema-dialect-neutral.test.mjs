// test/schema-dialect-neutral.test.mjs — tools/list must not DECLARE a JSON
// Schema dialect, and every served schema must compile under a 2020-12 strict
// validator with no dialect declared.
//
// ★ THE DEFECT (measured 2026-08-21, Claude Code 2.1.237 + Claude Desktop):
//   Error: Tool 'get_market_intel' has an invalid outputSchema: JSON Schema
//   declares an unsupported dialect ("$schema": "http://json-schema.org/draft-07/schema#").
//   The default validator supports JSON Schema 2020-12 only …
// Every one of the 82 tools failed at the CLIENT before the result was read —
// enterprise keys included. The SDK (1.29) converts zod → JSON Schema with
// target 'draft-7' and stamps $schema on both inputSchema and outputSchema;
// Anthropic's bundled client refuses any schema that declares a dialect
// outside its supported set. The check fires ONLY when $schema is present.
//
// ★ WHY THIS FILE EXISTS AS A ROUND TRIP: the Python QA super-user, the value
// harness and mcp_tool_calls all reported green throughout — none of them run
// the official TS client's validation. So this test does what the client does:
// a real tools/list over the in-memory transport, then an Ajv 2020-12 STRICT
// compile of every schema exactly as served.
import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, stripSchemaDialect } from '../server.mjs';

let tools;

beforeAll(async () => {
  const srv = createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await srv.connect(st);
  const client = new Client({ name: 'schema-dialect-test', version: '0' });
  await client.connect(ct);
  ({ tools } = await client.listTools());
});

// Walk every object in a schema tree; $schema is only meaningful at the root
// but a nested stamp would be just as fatal to a strict validator.
function* objects(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) yield* objects(n); return; }
  yield node;
  for (const v of Object.values(node)) yield* objects(v);
}

describe('tools/list declares no JSON Schema dialect', () => {
  it('lists every tool (the wrapper must not drop the list)', () => {
    expect(tools.length).toBeGreaterThanOrEqual(80);
  });

  it('no inputSchema or outputSchema carries a $schema keyword', () => {
    const stamped = [];
    for (const t of tools) {
      for (const k of ['inputSchema', 'outputSchema']) {
        for (const o of objects(t[k])) {
          if (Object.prototype.hasOwnProperty.call(o, '$schema')) stamped.push(`${t.name}.${k}`);
        }
      }
    }
    expect(stamped).toEqual([]);
  });

  it('every tool still advertises an outputSchema (the strip must not become a drop)', () => {
    const missing = tools.filter((t) => !t.outputSchema || typeof t.outputSchema !== 'object').map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it('every served schema compiles under Ajv 2020-12 strict — what the Claude client does', async () => {
    const mod = await import('ajv/dist/2020.js');
    const Ajv2020 = mod.default?.default ?? mod.default ?? mod;
    const addFormats = (await import('ajv-formats')).default;
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    const failures = [];
    for (const t of tools) {
      for (const k of ['inputSchema', 'outputSchema']) {
        if (!t[k]) continue;
        try { ajv.compile(t[k]); } catch (e) { failures.push(`${t.name}.${k}: ${e.message}`); }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('must-fail control — the wrapper is doing work', () => {
  it('the SDK conversion underneath still stamps draft-07, so an absent $schema proves the strip ran', async () => {
    // Convert one registered tool's outputSchema the way the SDK's own
    // tools/list does. If this ever stops carrying $schema (an SDK upgrade
    // changed the default), the wrapper is inert and this control says so —
    // review whether the strip is still needed rather than deleting the test.
    const { toJsonSchemaCompat } = await import('@modelcontextprotocol/sdk/server/zod-json-schema-compat.js');
    const { normalizeObjectSchema } = await import('@modelcontextprotocol/sdk/server/zod-compat.js');
    const reg = createServer()._registeredTools['get_market_intel'];
    const raw = toJsonSchemaCompat(normalizeObjectSchema(reg.outputSchema), { strictUnions: true, pipeStrategy: 'output' });
    expect(raw.$schema).toMatch(/draft-07/);
    expect(stripSchemaDialect(raw).$schema).toBeUndefined();
  });

  it('stripSchemaDialect leaves everything except $schema untouched', () => {
    const s = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true };
    expect(stripSchemaDialect(s)).toEqual({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true });
    expect(stripSchemaDialect(null)).toBeNull();
    expect(stripSchemaDialect({ type: 'object' })).toEqual({ type: 'object' });
  });
});
