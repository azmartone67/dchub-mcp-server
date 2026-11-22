// No served tool count in any handshake (owner 2026-11-22, "fix the 10 DC Hub tools count too").
//
// After the catalog total came out (mcp#1653), each initialize still said how many tools its own list
// served: "this client's /mcp list shows 10 DC Hub tools", "/mcp/grok lists 11 DC Hub tools", the packs'
// "/mcp/<pack> lists N DC Hub tools", the slim "shows 7 DC Hub tools", the light v2 "This list shows N tools"
// and the starter pack's "(10 tools)". This reads every one of them from the real handler over loopback
// (stub backend, no network) and requires no "<N> tools" / "<N> DC Hub tools" anywhere, while each scope
// line still says what it is ("a subset of DC Hub tools", a listing scope).
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const COUNT = /\b\d[\d,]*\s+(?:DC Hub\s+)?tools\b/i;
const ENV = { DCHUB_SLIM_PROFILE_TEST: '1', DCHUB_LIGHT_LIST_INSTRUCTIONS_V2: '1' };
let S, L, httpServer, stub, PORT, prevBase;
const prevEnv = {};
const served = {};

async function rpc(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  try { return JSON.parse(data).result; } catch (_) { return undefined; }
}
const init = (path, client = 'no-served-count-test', headers = {}) => rpc(path, { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1' } } }, headers)
  .then((r) => r?.instructions);

const CORE = ['/mcp', '/mcp/grok', '/mcp/grok/oauth', '/mcp/chatgpt', '/mcp/claude', '/mcp/core', '/mcp/light'];
let PACKS = [];

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{}'); }); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  for (const [k, v] of Object.entries(ENV)) { prevEnv[k] = process.env[k]; process.env[k] = v; }
  S = await import('../server.mjs');
  L = await import('../lib/light-list-instructions.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  PACKS = [...S.MCP_PACKS.keys()];
  for (const p of [...CORE, ...PACKS]) served[p] = await init(p);
  served['implicit light (Cursor)'] = await init('/mcp', 'cursor-vscode', { 'user-agent': 'node' });
  served['implicit light (CLI)'] = await init('/mcp', 'x', { 'user-agent': 'copilot-cli/1.0.34' });
  served['slim ?tools=core'] = await init('/mcp?tools=core');
  for (const [k, v] of Object.entries(ENV)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  served['implicit light, v2 off'] = await init('/mcp', 'cursor-vscode', { 'user-agent': 'node' });
}, 60_000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

describe('no handshake states a served tool count (owner 2026-11-22)', () => {
  it('reads every surface (packs are the real list, each answer is text)', () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(5);
    for (const [k, v] of Object.entries(served)) expect(typeof v, k).toBe('string');
  });

  it('CONTROL: the detector reads the pre-fix wordings as counts', () => {
    for (const s of ["this client's /mcp list shows 10 DC Hub tools", '/mcp/grok lists 11 DC Hub tools',
      'This list shows 3 tools; discover_tools lists the rest.', 'AI-campus workflow (10 tools):', 'DC Hub: 98 tools.']) {
      expect(s, s).toMatch(COUNT);
    }
    expect('lists a subset of DC Hub tools').not.toMatch(COUNT);
  });

  it('every initialize names no tool count and still carries its scope line', () => {
    for (const [k, v] of Object.entries(served)) {
      expect(v, `${k}: ${String(v).match(COUNT)?.[0]}`).not.toMatch(COUNT);
    }
    for (const p of ['/mcp/grok', '/mcp/light', ...PACKS]) {
      expect(served[p], p).toMatch(/ENDPOINT SCOPE: \/mcp\/\S+ (?:lists a subset of DC Hub tools, a listing scope|is a listing scope)/);
    }
    expect(served['implicit light, v2 off']).toMatch(/this client's \/mcp list shows a subset of DC Hub tools/);
    expect(served['slim ?tools=core']).toMatch(/\(tools=core\) is a listing scope, not a permission scope/);
  });

  it('lightCountSentence states no number', () => {
    for (const listed of [['a'], ['a', 'discover_tools'], Array.from({ length: 12 }, (_, i) => `t${i}`)]) {
      expect(L.lightCountSentence(listed)).not.toMatch(COUNT);
      expect(L.lightCountSentence(listed)).toMatch(/^This list shows a subset of DC Hub tools/);
    }
  });

  it('the AI-campus starter pack resource states no tool count', async () => {
    const r = await rpc('/mcp', { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'dchub://packs/ai-campus-power' } });
    const text = (r?.contents || []).map((c) => c.text || '').join('\n');
    expect(text).toContain('energy-first AI-campus workflow');
    expect(text).not.toMatch(COUNT);
  });
});
