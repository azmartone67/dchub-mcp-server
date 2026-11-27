// unlisted-tool-points-to-mcp-1127.test.mjs — stability P3 (2026-11-27).
//
// ★THE BUG. `tools/call analyze_site` on /mcp/chatgpt answered JSON-RPC -32602 "Unknown tool: analyze_site".
// analyze_site is a real DC Hub tool that the directory profile deliberately does not serve, so "Unknown tool"
// told the agent it does not exist. /mcp accepts any DC Hub tool by name; the restricted endpoints
// (/mcp/chatgpt, /mcp/claude, /mcp/core) do not.
//
// ★THE CONTRACT PINNED HERE.
//   • a real DC Hub tool that the endpoint does not serve: still an error (-32602, no result), and the message
//     names the endpoint and says the tool is available at https://dchub.cloud/mcp (it does not repeat the
//     tool's name: the directory scrub drops any sentence naming a tool those profiles do not list);
//   • a name that is not a DC Hub tool: "Unknown tool: <name>", unchanged;
//   • key / commerce tools are never pointed at from these endpoints: they keep "Unknown tool";
//   • tools/list on /mcp/chatgpt still lists 65 tools, and analyze_site is not among them.
//
// Loopback only: a 127.0.0.1 backend stub, and no socket may leave loopback.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

let PORT, httpServer, stub, prevBase;
beforeAll(async () => {
  stub = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const S = await import('../server.mjs');
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60000);
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function rpc(path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'unlisted-tool-test/1.0' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const j = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { status: res.status, raw, msg: JSON.parse(j) };
}
const call = (path, name) => rpc(path, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } });

const ENDPOINTS = ['/mcp/chatgpt', '/mcp/claude', '/mcp/core'];

describe('a real DC Hub tool the endpoint does not serve says where it is served', () => {
  // research_task is off all three endpoints; analyze_site is off /mcp/chatgpt and /mcp/core (/mcp/claude lists it).
  const CASES = [['/mcp/chatgpt', 'analyze_site'], ['/mcp/core', 'analyze_site'],
                 ['/mcp/chatgpt', 'research_task'], ['/mcp/claude', 'research_task'], ['/mcp/core', 'research_task']];
  it.each(CASES)('%s: %s', async (path, name) => {
    const r = await call(path, name);
    expect(r.msg.result).toBeUndefined();
    expect(r.msg.error).toEqual({ code: -32602,
      message: `This DC Hub tool is not available on this endpoint (${path}). It is available at https://dchub.cloud/mcp.` });
  });
  it('the endpoint named is the one called (trailing slash normalised)', async () => {
    const r = await call('/mcp/chatgpt/', 'analyze_site');
    expect(r.msg.error.message).toContain('(/mcp/chatgpt)');
  });
});

describe('everything else keeps "Unknown tool"', () => {
  it.each(ENDPOINTS)('%s: a name that is not a DC Hub tool', async (path) => {
    const r = await call(path, 'definitely_not_a_dchub_tool');
    expect(r.msg.result).toBeUndefined();
    expect(r.msg.error).toEqual({ code: -32602, message: 'Unknown tool: definitely_not_a_dchub_tool' });
  });
  it.each(ENDPOINTS)('%s: key and commerce tools are not pointed at', async (path) => {
    for (const name of ['claim_free_key', 'get_api_key', 'unlock_more_data', 'why_dchub']) {
      const r = await call(path, name);
      // the directory profiles' scrub already shortens this to "Unknown tool." (it names no unlisted tool)
      expect(r.msg.error.code, `${path} ${name}`).toBe(-32602);
      expect(r.msg.error.message, `${path} ${name}`).toMatch(/^Unknown tool/);
      expect(r.raw, `${path} ${name}`).not.toContain('dchub.cloud/mcp');
    }
  });
  it('a tool the endpoint does serve still runs (no error)', async () => {
    const r = await call('/mcp/chatgpt', 'get_news');
    expect(r.msg.error).toBeUndefined();
    expect(r.msg.result).toBeDefined();
  }, 60000);
});

describe('listing is unchanged', () => {
  it('/mcp/chatgpt tools/list: 65 tools, analyze_site not listed', async () => {
    const r = await rpc('/mcp/chatgpt', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = r.msg.result.tools.map((t) => t.name);
    expect(names.length).toBe(65);
    expect(names).not.toContain('analyze_site');
  });
  it('/mcp/claude tools/list does not gain research_task', async () => {
    const r = await rpc('/mcp/claude', { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(r.msg.result.tools.map((t) => t.name)).not.toContain('research_task');
  });
  it('no socket left loopback', () => { expect(foreign).toEqual([]); });
});
