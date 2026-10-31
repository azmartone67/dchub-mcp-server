// The upstream kit (2026-10-31): sdk/node/compose.mjs lets another MCP server
// register DC Hub tools inside itself, attributed with X-DCHub-Via. Offline: fetch
// is replaced, and the composition runs on a REAL McpServer + Client pair from this
// repo's own @modelcontextprotocol/sdk over an in-memory transport.
//
// Also pins the attribution fix: the SDK's clientInfo name used to be
// "dchub-node-sdk", which _INTERNAL_SELF_TAG rewrites to 'dchub-internal', so every
// SDK call was excluded from usage counts. The test reads that regex out of
// server.mjs, so a rename back (or a widened regex) goes red here.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DCHub, CLIENT_NAME, checkVia } from '../sdk/node/index.mjs';
import { registerDCHubTools, dchubToolDefinitions, STARTER_TOOLS, DESCRIPTION_PREFIX } from '../sdk/node/compose.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function internalRegexes() {
  const src = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  const body = src.slice(src.indexOf('function _INTERNAL_SELF_TAG('));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  const lits = [...fn.matchAll(/\/(\^?\([^\n]+?\)\$?)\/\.test\(safe\)/g)].map((m) => new RegExp(m[1]));
  expect(lits.length).toBeGreaterThanOrEqual(2);
  return lits;
}

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

function stubFetch(tools, callResult) {
  const seen = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ headers: init.headers, body });
    let result = {};
    if (body.method === 'tools/list') result = { tools };
    if (body.method === 'tools/call') result = callResult(body.params);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's1' },
    });
  };
  return seen;
}

const FIXTURE = STARTER_TOOLS.map((name) => ({
  name,
  description: `${name} does a thing.`,
  inputSchema: { type: 'object', properties: { iso: { type: 'string', description: 'Grid code' } }, required: name === 'get_grid_data' ? ['iso'] : [] },
})).concat([{ name: 'analyze_site', description: 'not in the starter set', inputSchema: { type: 'object', properties: {} } }]);

const PASSTHROUGH = (p) => ({ content: [{ type: 'text', text: JSON.stringify({ echo: p.name, args: p.arguments, cite_as: 'DC Hub (dchub.cloud), as of 2026-10-31' }) }] });

describe('SDK attribution', () => {
  it('client name and User-Agent are not rewritten to dchub-internal', async () => {
    const seen = stubFetch(FIXTURE, PASSTHROUGH);
    await new DCHub({ via: 'acme-energy' }).tools();
    const init = seen.find((s) => s.body.method === 'initialize');
    const name = init.body.params.clientInfo.name;
    expect(name).toBe(CLIENT_NAME);
    for (const rx of internalRegexes()) expect(rx.test(name.toLowerCase())).toBe(false);
    for (const s of seen) {
      expect(s.headers['X-DCHub-Via']).toBe('acme-energy');
      expect(s.headers['User-Agent'].toLowerCase()).not.toMatch(/dchub/);
    }
  });
  it('must-fail control: the old name IS rewritten by the same regexes', () => {
    expect(internalRegexes().some((rx) => rx.test('dchub-node-sdk'))).toBe(true);
  });
  it('no via → no header; a bad via is refused', async () => {
    const seen = stubFetch(FIXTURE, PASSTHROUGH);
    await new DCHub({ via: '' }).tools();
    expect(seen.every((s) => !('X-DCHub-Via' in s.headers))).toBe(true);
    for (const bad of ['Acme', '-acme', 'a b', 'x'.repeat(41), 'acme/1']) expect(() => checkVia(bad)).toThrow(TypeError);
    expect(checkVia('acme.energy_1-2')).toBe('acme.energy_1-2');
  });
});

describe('registerDCHubTools on a real McpServer', () => {
  async function connect(opts) {
    const seen = stubFetch(FIXTURE, PASSTHROUGH);
    const server = new McpServer({ name: 'acme-energy', version: '1.0.0' });
    const names = await registerDCHubTools(server, opts);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: 'probe-client', version: '1' });
    await client.connect(ct);
    return { names, client, seen };
  }

  it('registers the starter set with prefixed descriptions and DC Hub schemas', async () => {
    const { names, client } = await connect({ via: 'acme-energy' });
    expect(names).toEqual([...STARTER_TOOLS]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...STARTER_TOOLS].sort());
    const grid = tools.find((t) => t.name === 'get_grid_data');
    expect(grid.description.startsWith(DESCRIPTION_PREFIX)).toBe(true);
    expect(grid.inputSchema.properties.iso.description).toBe('Grid code');
    expect(grid.inputSchema.required).toEqual(['iso']);
  });

  it('passes the DC Hub result through unchanged, attributed', async () => {
    const { client, seen } = await connect({ via: 'acme-energy' });
    const r = await client.callTool({ name: 'get_grid_data', arguments: { iso: 'PJM' } });
    const out = JSON.parse(r.content[0].text);
    expect(out).toEqual({ echo: 'get_grid_data', args: { iso: 'PJM' }, cite_as: 'DC Hub (dchub.cloud), as of 2026-10-31' });
    const call = seen.find((s) => s.body.method === 'tools/call');
    expect(call.headers['X-DCHub-Via']).toBe('acme-energy');
  });

  it('a tool DC Hub does not serve fails loudly', async () => {
    stubFetch(FIXTURE, PASSTHROUGH);
    await expect(dchubToolDefinitions({ tools: ['no_such_tool'] })).rejects.toThrow(/does not serve: no_such_tool/);
  });
});
