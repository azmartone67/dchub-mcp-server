// cli-starter.test.mjs: Grok funnel spec F3 (2026-11-22), DCHUB_CLI_STARTER (lib/cli-starter.mjs).
//
// Real handler over HTTP, local stub backend, no network. The six named coding clients get the starter order and the
// example line; every other client and /mcp/chatgpt are unchanged. CONTROL: flag off, no example, old order.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const FLAG = 'DCHUB_CLI_STARTER';
let S, L, P, PORT, httpServer, stub, prevBase;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url.startsWith('/api/v1/keys/validate')) { res.end(JSON.stringify({ valid: false, tier: 'free' })); return; }
        if (req.url.startsWith('/api/v1/mcp/session-key')) { res.statusCode = 404; res.end('{}'); return; }
        res.end(JSON.stringify({ success: true, data: [] }));
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  L = await import('../lib/cli-starter.mjs');
  P = await import('../lib/light-profile.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterEach(() => { delete process.env[FLAG]; delete process.env.DCHUB_LIGHT_LIST_INSTRUCTIONS_V2; });

afterAll(async () => {
  delete process.env[FLAG];
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
  expect(foreign).toEqual([]);
});

async function post(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  let json = null;
  try { json = JSON.parse(data); } catch (_) {}
  return { status: res.status, headers: res.headers, raw, json };
}

// Every light-list identity (lib/light-profile.mjs LIGHT_CLI_NAME / LIGHT_HOST_NAME / LIGHT_CLI_UA), as the client
// sends it: clientInfo.name with a generic UA, and Clono and Copilot CLI by User-Agent.
const LIGHT_CLIENTS = [
  { name: 'github-copilot-developer' }, { name: 'copilot-cli' }, { name: 'codex-mcp-client' }, { name: 'codex-cli' },
  { name: 'cursor-vscode' }, { name: 'cursor' }, { name: 'Visual Studio Code' }, { name: 'Visual Studio Code - Insiders' },
  { name: 'claude-code' }, { name: 'clono' }, { name: 'Clono' }, { name: 'opencode' }, { name: 'workbuddy' },
  { name: 'gemini-cli-mcp-client' }, { name: 'gemini-cli' }, { name: 'windsurf-client' }, { name: 'Windsurf' },
  { name: 'codeium' }, { name: 'cline-vscode' }, { name: 'Cline' },
  { name: 'mcp', ua: 'Clono (+https://clono.sh)' }, { name: 'mcp', ua: 'copilot-cli/1.0.34' },
];
const label = (c) => (c.ua ? `${c.name} via UA ${c.ua}` : c.name);

async function handshake(c, path = '/mcp') {
  const ua = c.ua || 'node';
  const init = await post(path, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: c.name, version: '1.0' } } },
  { 'user-agent': ua });
  const sid = init.headers.get('mcp-session-id');
  const h = { 'user-agent': ua, ...(sid ? { 'mcp-session-id': sid } : {}) };
  await post(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  const list = await post(path, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, h);
  return {
    status: init.status,
    sid,
    instructions: (init.json && init.json.result && init.json.result.instructions) || '',
    tools: ((list.json && list.json.result && list.json.result.tools) || []).map((t) => t.name),
    listBytes: Buffer.byteLength(JSON.stringify((list.json && list.json.result) || {})),
  };
}

function toolsLine(ins) {
  const m = /\bTools: ([a-z_]+(?:, [a-z_]+)*)\./.exec(ins);
  return m ? m[1].split(', ') : null;
}

const SIX = [
  { name: 'github-copilot-developer' }, { name: 'copilot-cli' }, { name: 'mcp', ua: 'copilot-cli/1.0.34' },
  { name: 'codex-mcp-client' }, { name: 'codex-cli' }, { name: 'opencode' }, { name: 'mcp', ua: 'opencode/0.9.1/cli' },
  { name: 'cursor-vscode' }, { name: 'cursor' }, { name: 'windsurf-client' }, { name: 'Windsurf' }, { name: 'codeium' },
  { name: 'cline-vscode' }, { name: 'Cline' },
];
// Light-list clients the spec does not name, and a generic client: unchanged with the flag on.
const OTHERS = [{ name: 'claude-code' }, { name: 'Visual Studio Code' }, { name: 'gemini-cli-mcp-client' },
  { name: 'clono' }, { name: 'workbuddy' }, { name: 'mcp' }, { name: 'claude-ai' }, { name: 'openai-mcp' }];
const MAX_INSTR = 2048;

describe('F3 coding-CLI starter', () => {
  it('pure: order puts the five starter tools first and drops nothing', () => {
    const base = P.LIGHT_TOOLS;
    const o = L.cliStarterOrder(base);
    expect(o.slice(0, 5)).toEqual(['execute_plan', 'get_market_dcpi_rank', 'get_grid_intelligence', 'source_capacity', 'get_fiber_intel']);
    for (const n of base) expect(o).toContain(n);
    expect(new Set(o).size).toBe(o.length);
  });

  it('pure: matches the six clients only', () => {
    for (const c of SIX) expect(L.isCliStarterIdentity({ userAgent: c.ua || 'node', clientName: c.name }), label(c)).toBe(true);
    for (const c of OTHERS) expect(L.isCliStarterIdentity({ userAgent: 'node', clientName: c.name }), label(c)).toBe(false);
  });

  it('C1+C2: each of the six gets the starter handshake and order, every light tool kept, under 2,048 characters', async () => {
    process.env.DCHUB_LIGHT_LIST_INSTRUCTIONS_V2 = '1';
    const base = {};
    for (const c of SIX) base[label(c)] = await handshake(c);
    process.env[FLAG] = '1';
    for (const c of SIX) {
      const hs = await handshake(c);
      const before = base[label(c)];
      expect(hs.status, label(c)).toBe(200);
      // Capabilities messaging (2026-11-26): the handshake is the approved paragraph, which does not open with the canon
      // sentence, so the starter rewrite leaves it alone; the paragraph carries its own first-call line
      // ('Pass the question as asked: execute_plan(intent="...")'). The starter tool ORDER still applies.
      expect(hs.instructions, label(c)).toBe(before.instructions);
      expect(hs.instructions.startsWith('DC Hub is the orchestration layer for data center and energy intelligence.'), label(c)).toBe(true);
      expect(hs.instructions, label(c)).toContain('Pass the question as asked: execute_plan(intent="<the user\'s question, unchanged>").');
      expect(hs.instructions.length, label(c)).toBeLessThanOrEqual(MAX_INSTR);
      expect(hs.tools.slice(0, 5), label(c)).toEqual(L.CLI_STARTER_TOOLS.slice());
      for (const n of before.tools) expect(hs.tools, label(c) + ' lost ' + n).toContain(n);
      expect(hs.listBytes, label(c) + ' tools/list bytes').toBeLessThan(P.LIGHT_TOOLS_LIST_MAX_BYTES);
      for (const n of (toolsLine(hs.instructions) || [])) expect(hs.tools, label(c)).toContain(n);
      expect(hs.instructions).not.toMatch(/\bfree\b|\btrial\b|credits?\b|calls\/day|\$\d|\b\d+ tools\b/i);
    }
    delete process.env.DCHUB_LIGHT_LIST_INSTRUCTIONS_V2;
  });

  // A2 off, the light handshake is already over 2,048 (2,130 measured 2026-11-21, pre-existing; A2 is on live). Here the
  // starter may only add the example less the dropped sentence, never more.
  it('A2 off too: the starter order applies and the capabilities handshake is unchanged', async () => {
    for (const c of SIX.slice(0, 3)) {
      const off = await handshake(c);
      process.env[FLAG] = '1';
      const hs = await handshake(c);
      delete process.env[FLAG];
      // Capabilities messaging (2026-11-26): no canon-sentence lead to follow, so the handshake is unchanged.
      expect(hs.instructions, label(c)).toBe(off.instructions);
      expect(hs.tools.slice(0, 5), label(c)).toEqual(L.CLI_STARTER_TOOLS.slice());
    }
  });

  it('C1: every other client is byte-identical with the flag on', async () => {
    for (const c of OTHERS) {
      const off = await handshake(c);
      process.env[FLAG] = '1';
      const on = await handshake(c);
      delete process.env[FLAG];
      expect(on.instructions, label(c)).toBe(off.instructions);
      expect(on.tools, label(c)).toEqual(off.tools);
    }
  });

  it('C3: /mcp/chatgpt is untouched (65 tools, same order) with the flag on', async () => {
    const off = await handshake({ name: 'github-copilot-developer' }, '/mcp/chatgpt');
    process.env[FLAG] = '1';
    const on = await handshake({ name: 'github-copilot-developer' }, '/mcp/chatgpt');
    expect(off.tools.length).toBe(65);
    expect(on.tools).toEqual(off.tools);
    expect(on.instructions).toBe(off.instructions);
  });

  it('CONTROL: flag off, the six get no example and the old order', async () => {
    const hs = await handshake(SIX[0]);
    expect(hs.instructions).not.toContain(L.CLI_STARTER_EXAMPLE);
    expect(hs.tools.slice(0, 5)).not.toEqual(L.CLI_STARTER_TOOLS.slice());
  });
});
