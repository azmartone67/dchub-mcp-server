// list-slim.test.mjs - R1 (Grok MCP platform ranking plan, 2026-10-18): the /mcp tools/list is cut by
// more than half without touching what the server validates or returns.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { slimOutputSchema, slimDescription, stripChangelog, slimToolsList, SLIM_DESC_MAX, WIRE_ENVELOPE_KEYS } from '../lib/list-slim.mjs';

let S, srv, PORT;
beforeAll(async () => {
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  await new Promise((r) => { srv = S.app.listen(0, '127.0.0.1', r); });
  PORT = srv.address().port;
});
afterAll(async () => { await new Promise((r) => srv.close(r)); });

async function wire(path = '/mcp') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { bytes: Buffer.byteLength(raw), tools: JSON.parse(json).result.tools };
}

describe('wire list vs the canonical catalog', () => {
  it('is under half the canonical size, with every tool still listed', async () => {
    const canon = await S._buildToolsListResult(null);
    const w = await wire();
    expect(w.tools.map((t) => t.name).sort()).toEqual(canon.tools.map((t) => t.name).sort());
    expect(w.bytes).toBeLessThan(JSON.stringify(canon).length * 0.5);
  });
  it('keeps names, titles, parameter names/types/required and the access annotations', async () => {
    const canon = new Map((await S._buildToolsListResult(null)).tools.map((t) => [t.name, t]));
    for (const t of (await wire()).tools) {
      const c = canon.get(t.name);
      expect(t.title, t.name).toBe(c.title);
      expect(Object.keys(t.inputSchema.properties || {}), t.name).toEqual(Object.keys(c.inputSchema.properties || {}));
      expect(t.inputSchema.required, t.name).toEqual(c.inputSchema.required);
      for (const k of ['access', 'tier_required', 'maturity', 'readOnlyHint']) expect(t.annotations[k], `${t.name}.${k}`).toEqual(c.annotations[k]);
      expect(t.description.length, t.name).toBeLessThanOrEqual(SLIM_DESC_MAX + 1);
      // Every tool-specific output key survives, in order; only the shared envelope stubs are omitted from the wire.
      expect(Object.keys(t.outputSchema.properties), t.name)
        .toEqual(Object.keys(c.outputSchema.properties).filter((k) => !WIRE_ENVELOPE_KEYS.includes(k)));
    }
  });
  it('the envelope stubs are off the wire but still on the registered schema the SDK validates against', async () => {
    const canon = (await S._buildToolsListResult(null)).tools;
    const w = await wire();
    for (const t of w.tools) for (const k of WIRE_ENVELOPE_KEYS) expect(t.outputSchema.properties, `${t.name}.${k}`).not.toHaveProperty(k);
    for (const t of canon) for (const k of WIRE_ENVELOPE_KEYS) expect(t.outputSchema.properties, `canonical ${t.name}.${k}`).toHaveProperty(k);
  });
  it('the advertised outputSchemas stay small (they were 27.6 KB before the envelope stubs came off)', async () => {
    const w = await wire();
    expect(JSON.stringify(w.tools.map((t) => t.outputSchema)).length).toBeLessThan(14000);
  });
  it('the canonical (registered) schemas are the full ones the SDK validates against', async () => {
    const canon = (await S._buildToolsListResult(null)).tools;
    expect(JSON.stringify(canon.map((t) => t.outputSchema)).length).toBeGreaterThan(150000);
  });
  it('the frozen directory path is not slimmed', async () => {
    const w = await wire('/mcp/chatgpt');
    expect(w.tools.length).toBeGreaterThan(0);
  });
});

describe('slimming primitives', () => {
  it('outputSchema keeps top-level keys and primitive types only', () => {
    const o = slimOutputSchema({ type: 'object', properties: { a: { type: 'string', description: 'x'.repeat(50) }, b: { anyOf: [{ type: 'object' }, { type: 'null' }] } } });
    expect(o).toEqual({ type: 'object', additionalProperties: true, properties: { a: { type: 'string' }, b: {} } });
  });
  it('drops a dated change-log sentence and keeps the first sentence even if it is dated', () => {
    const d = 'Does the thing. WITHDRAWN 2026-08-08, RESTORED 2026-08-30 after a fix. Returns rows.';
    expect(stripChangelog(d)).toBe('Does the thing. Returns rows.');
  });
  it('keeps the Answers and Try sentences when the body is cut', () => {
    const body = Array.from({ length: 60 }, (_, i) => `Filler sentence number ${i} about nothing much.`).join(' ');
    const d = `${body} Answers "which market is cheapest right now". Try: my_tool a=1.`;
    const out = slimDescription(d);
    expect(out.length).toBeLessThanOrEqual(SLIM_DESC_MAX + 1);
    expect(out).toContain('Answers "which market is cheapest right now".');
    expect(out).toContain('Try: my_tool a=1.');
  });
  it('slimOutputSchema omits exactly the envelope keys and keeps every other key with its type', () => {
    const props = { _entity: { type: 'string' }, provenance: { type: 'object' }, quota: { type: 'object' }, citation: {}, site_evaluation_handoff: {},
      _return_loop: { type: 'object' }, _front_door: { type: 'object' }, success: {}, rate: { type: 'number', description: 'x' }, rows: { anyOf: [{ type: 'array' }] } };
    const o = slimOutputSchema({ type: 'object', properties: props });
    expect(o.properties).toEqual({ success: {}, rate: { type: 'number' }, rows: {} });
    expect(o).toMatchObject({ type: 'object', additionalProperties: true });
  });
  it('the envelope key list is the seven keys the registered schema shares', () => {
    expect([...WIRE_ENVELOPE_KEYS].sort()).toEqual(['_entity', '_front_door', '_return_loop', 'citation', 'provenance', 'quota', 'site_evaluation_handoff']);
  });
  it('slimToolsList does not mutate its input', () => {
    const input = { tools: [{ name: 'x', description: 'd '.repeat(2000), inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { a: { type: 'string', description: 'z' }, _entity: { type: 'string' }, provenance: { type: 'object' } } } }] };
    const copy = JSON.stringify(input);   // envelope keys in the input: omitting them from the wire copy must not delete them from it
    slimToolsList(input);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
