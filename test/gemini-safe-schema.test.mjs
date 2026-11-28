// Gemini-safe tools/list schemas (Grok -> Brain 2026-11-27, change 2; lib/gemini-safe-schema.mjs).
// Live 2026-11-27: /mcp served 14 untyped input properties, 7 bare-type anyOf unions and report_finding's
// propertyNames. Gemini's function-declaration subset wants a type on every property. Every surface but the
// frozen /mcp/chatgpt catalog must now list none of those. Validation stays lenient (zod), checked below too.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { untypedProperties, geminiSafeInputSchema, UNTYPED_TYPES } from '../lib/gemini-safe-schema.mjs';

let httpServer, stub, PORT, prevBase, prevFlag;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  prevFlag = process.env.DCHUB_GEMINI_SAFE_SCHEMA;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  delete process.env.DCHUB_GEMINI_SAFE_SCHEMA;   // default on
  const S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevFlag === undefined) delete process.env.DCHUB_GEMINI_SAFE_SCHEMA; else process.env.DCHUB_GEMINI_SAFE_SCHEMA = prevFlag;
});

const parse = (raw) => JSON.parse(raw.includes('data: ')
  ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw);

async function rpc(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  return { res, body: raw ? parse(raw) : null };
}

async function statelessList(path, ua) {
  const { body } = await rpc(path, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ua ? { 'user-agent': ua } : {});
  return body && body.result && body.result.tools;
}

async function sessionList(path, clientName, ua) {
  const h = ua ? { 'user-agent': ua } : {};
  const init = await rpc(path, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0' } } }, h);
  const sid = init.res.headers.get('mcp-session-id');
  if (sid) h['mcp-session-id'] = sid;
  await rpc(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  const { body } = await rpc(path, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, h);
  return body && body.result && body.result.tools;
}


const unions = (tools) => {
  const out = [];
  const walk = (tn, path, s) => {
    if (!s || typeof s !== 'object') return;
    if (Array.isArray(s.anyOf) && s.anyOf.every((b) => b && typeof b.type === 'string')) out.push(`${tn}${path}`);
    if (Object.prototype.hasOwnProperty.call(s, 'propertyNames')) out.push(`${tn}${path} propertyNames`);
    for (const [k, v] of Object.entries(s.properties || {})) walk(tn, `${path}.${k}`, v);
    if (s.items && typeof s.items === 'object') walk(tn, `${path}[]`, s.items);
  };
  for (const t of tools || []) walk(t.name, '', t.inputSchema);
  return out;
};

describe('gemini-safe tools/list schemas', () => {
  it('full /mcp list (claude-ai session): every property typed, no bare unions, no propertyNames', async () => {
    const tools = await sessionList('/mcp', 'claude-ai');
    expect(tools.length).toBeGreaterThan(80);
    expect(untypedProperties(tools)).toEqual([]);
    expect(unions(tools)).toEqual([]);
    const ep = tools.find((t) => t.name === 'execute_plan');
    expect(ep.inputSchema.properties.max_steps.type).toBe('integer');
    expect(ep.inputSchema.properties.context.type).toBe('object');
    const rs = tools.find((t) => t.name === 'rank_sites');
    expect(rs.inputSchema.properties.candidates).toMatchObject({ type: 'array', items: { type: 'object' } });
  }, 60000);

  it('stateless /mcp, /mcp/claude and the gemini-cli light list are clean too', async () => {
    for (const tools of [await statelessList('/mcp'), await statelessList('/mcp/claude'), await sessionList('/mcp', 'gemini-cli-mcp-client')]) {
      expect(tools && tools.length).toBeGreaterThan(5);
      expect(untypedProperties(tools)).toEqual([]);
      expect(unions(tools)).toEqual([]);
    }
  }, 60000);

  it('/mcp/chatgpt is untouched (frozen catalog keeps its reviewed untyped context)', async () => {
    for (const tools of [await statelessList('/mcp/chatgpt'), await sessionList('/mcp/chatgpt', 'openai-mcp')]) {
      expect(tools && tools.length).toBeGreaterThan(5);
      expect(untypedProperties(tools).length).toBeGreaterThan(0);
    }
  }, 60000);

  it('validation stays lenient: max_steps "3" and a comma-string candidate_ids are not rejected by schema', async () => {
    const r = await rpc('/mcp', { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'execute_plan', arguments: { intent: 'power in ERCOT', max_steps: '3' } } });
    expect(JSON.stringify(r.body)).not.toMatch(/-32602|Input validation error/);
  }, 60000);

  it('kill switch DCHUB_GEMINI_SAFE_SCHEMA=0 returns the schema unchanged; table names only untyped props', () => {
    const s = { type: 'object', properties: { max_steps: { description: 'x' } } };
    expect(geminiSafeInputSchema(s, 'execute_plan', { env: { DCHUB_GEMINI_SAFE_SCHEMA: '0' } })).toBe(s);
    expect(geminiSafeInputSchema(s, 'execute_plan', { env: {} }).properties.max_steps).toEqual({ type: 'integer', description: 'x' });
    expect(Object.keys(UNTYPED_TYPES).length).toBe(8);
  });
});

// Owner 2026-11-27 7:38 PM MST: Google ADK, Perplexity, Mistral and Windsurf's Devin/Cascade get the light list on /mcp
// (lib/light-profile.mjs LIGHT_AGENT_NAME); DCHUB_MCP_LIGHT_LIST_DISABLE=1 puts every client back on the full catalog.
describe('light list: the four added clients', () => {
  const NEW = ['google-adk', 'perplexity-mcp', 'mistral-mcp-client', 'devin'];
  it('each gets the short list with execute_plan first and can still call any tool', async () => {
    for (const n of NEW) {
      const tools = await sessionList('/mcp', n, 'node');
      expect(tools.length, n).toBeLessThan(15);
      expect(tools[0].name, n).toBe('execute_plan');
    }
    const r = await rpc('/mcp', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_facility', arguments: { facility_id: 'x' } } }, { 'user-agent': 'node' });
    expect(JSON.stringify(r.body)).not.toMatch(/Tool get_facility not found|-32601/);
  }, 60000);
  it('Claude, ChatGPT and Grok client names keep the full list', async () => {
    for (const n of ['claude-ai', 'openai-mcp', 'grok']) expect((await sessionList('/mcp', n, 'node')).length, n).toBeGreaterThan(80);
  }, 60000);
  it('DCHUB_MCP_LIGHT_LIST_DISABLE=1 serves the full list to a light client', async () => {
    process.env.DCHUB_MCP_LIGHT_LIST_DISABLE = '1';
    try {
      expect((await sessionList('/mcp', 'codex-mcp-client', 'codex-mcp-client/0.63.0')).length).toBeGreaterThan(80);
      expect((await sessionList('/mcp', 'google-adk', 'node')).length).toBeGreaterThan(80);
    } finally { delete process.env.DCHUB_MCP_LIGHT_LIST_DISABLE; }
  }, 60000);
});
