// No root-level schema combinators on any served surface (2026-11-22).
//
// OpenAI and Anthropic reject a function schema with anyOf/oneOf/allOf (and
// enum/const/not) at the TOP level, and one bad tool fails tool registration
// for the whole request. Live on 2026-11-22, /mcp served a root anyOf on
// get_grid_intelligence (10-tool slim list) and get_facility (full list), so a
// client that passes MCP schemas through (Codex CLI; Copilot CLI and opencode
// with a GPT or Claude model) could connect and never call a tool. See
// lib/one-of-contract.mjs.
//
// This test lists tools on every surface, the way clients do (stateless
// tools/list, and initialize → tools/list on a session under several client
// names, which picks the slim or the full list), and fails on any root
// combinator. The ONE exception is /mcp/chatgpt: its catalog is frozen for the
// OpenAI directory review (test/chatgpt-toolset-frozen.test.mjs) and must keep
// exactly the root anyOf it was reviewed with, on exactly those two tools.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { rootCombinators, CHATGPT_FROZEN_ROOT_ANYOF } from '../lib/one-of-contract.mjs';

let httpServer, stub, PORT, prevBase, prevFlag;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  prevFlag = process.env.DCHUB_ONEOF_ANYOF;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  delete process.env.DCHUB_ONEOF_ANYOF;   // the default production state
  const S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevFlag === undefined) delete process.env.DCHUB_ONEOF_ANYOF; else process.env.DCHUB_ONEOF_ANYOF = prevFlag;
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

const offenders = (tools) => Object.fromEntries((tools || [])
  .map((t) => [t.name, rootCombinators(t.inputSchema)]).filter(([, ks]) => ks.length));

// Client names seen on /mcp, covering the slim (coding CLIs, IDEs) and the full list.
const CLIENTS = [
  ['codex-mcp-client', 'codex_cli_rs/0.63.0'],
  ['github-copilot-developer', 'node'],
  ['opencode', 'opencode/1.0.0'],
  ['gemini-cli-mcp-client', 'node'],
  ['cursor-vscode', 'Cursor/2.0'],
  ['claude-ai', 'Claude-User'],
  ['openai-mcp', 'openai-mcp/1.0.0'],
  ['mcp', 'python-httpx'],
];

// Every surface that serves a catalog, except the frozen /mcp/chatgpt.
const SURFACES = ['/mcp', '/mcp/claude', '/mcp/core', '/mcp/grok', '/mcp/oauth', '/mcp/registry'];

describe('no tool on any served surface has a root-level combinator', () => {
  for (const path of SURFACES) {
    it(`${path}: stateless tools/list`, async () => {
      const tools = await statelessList(path);
      if (path === '/mcp' || path === '/mcp/claude') expect(tools && tools.length).toBeGreaterThan(0);
      expect(offenders(tools), `${path} root combinators`).toEqual({});
    }, 60000);
    for (const [name, ua] of CLIENTS) {
      it(`${path}: ${name} session tools/list`, async () => {
        const tools = await sessionList(path, name, ua);
        if (path === '/mcp' || path === '/mcp/claude') expect(tools && tools.length).toBeGreaterThan(0);
        expect(offenders(tools), `${path} as ${name}`).toEqual({});
      }, 60000);
    }
  }

  it('/mcp still lists the two tools that used to carry it, with their identifiers declared', async () => {
    const tools = await sessionList('/mcp', 'mcp', 'python-httpx');
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const [tool, keys] of Object.entries(CHATGPT_FROZEN_ROOT_ANYOF)) {
      expect(by[tool], `${tool} listed on /mcp`).toBeTruthy();
      expect(keys.some((k) => by[tool].inputSchema.properties && by[tool].inputSchema.properties[k])).toBe(true);
    }
  }, 60000);
});

describe('/mcp/chatgpt is frozen: exactly its reviewed root anyOf, nothing more', () => {
  it('stateless and every client name: only get_facility and get_grid_intelligence, anyOf only', async () => {
    const expected = Object.fromEntries(Object.keys(CHATGPT_FROZEN_ROOT_ANYOF).map((t) => [t, ['anyOf']]));
    const lists = [await statelessList('/mcp/chatgpt')];
    for (const [name, ua] of CLIENTS) lists.push(await sessionList('/mcp/chatgpt', name, ua));
    for (const tools of lists) {
      expect(tools).toHaveLength(65);
      expect(offenders(tools)).toEqual(expected);
    }
  }, 120000);
});
