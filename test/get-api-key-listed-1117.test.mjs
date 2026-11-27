// get-api-key-listed-1117.test.mjs — the key tool is listed as get_api_key (owner-approved 2026-11-17).
//
// lib/key-tool-name.mjs: the handler stays registered as claim_free_key (telemetry, backend funnels and the gating
// sets key on it); tools/list on the canonical surfaces shows it as get_api_key, tools/call get_api_key resolves to it
// through TOOL_ALIASES, and claim_free_key stays callable but unlisted. Every pointer at the key tool on those
// surfaces (instructions, other tools' descriptions, next_tool values and prose in results) names get_api_key.
// The directory profiles (/mcp/chatgpt, /mcp/claude) and /mcp/core list neither name and are unchanged.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  KEY_TOOL_LISTED, KEY_TOOL_REGISTERED, KEY_TOOL_TITLE, keyToolPointerText, keyToolPointerStep, listKeyToolAs,
} from '../lib/key-tool-name.mjs';

let httpServer, stub, PORT, S, prevBase;
const claims = [];

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.startsWith('/api/v1/keys/claim')) {
        claims.push(body);
        res.end(JSON.stringify({ api_key: 'dch_live_testkey0001', tier: 'free', reused: false }));
        return;
      }
      res.end('{}');
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  // The stub stays the API base until afterAll: the claim handler reads DCHUB_API_BASE per call, so restoring it right
  // after import sent the tools/call cases to production (hard-gate no-network check, mcp#1538 smoke).
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

async function rpc(path, method, params = {}, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const raw = await res.text();
  const j = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { body: JSON.parse(j), headers: res.headers };
}
const names = (r) => ((r.body.result || {}).tools || []).map((t) => t.name);

describe('tools/list: get_api_key is listed, claim_free_key is not (canonical surfaces)', () => {
  it.each(['/mcp', '/mcp?catalog=full', '/mcp/oauth', '/mcp/registry'])('%s', async (path) => {
    const r = await rpc(path, 'tools/list');
    const n = names(r);
    expect(n).toContain(KEY_TOOL_LISTED);
    expect(n).not.toContain(KEY_TOOL_REGISTERED);
    expect(n).toHaveLength(99);   // 99 on 2026-11-26: get_site_context; one renamed, none added: the tool-count canon stayed 97; 98 on 2026-11-20: accept_capacity_intro
    const t = r.body.result.tools.find((x) => x.name === KEY_TOOL_LISTED);
    // the title rides top-level or in annotations, depending on the path's slimming; at least one carries it
    const titles = [t.title, t.annotations && t.annotations.title].filter((x) => x !== undefined);
    expect(titles.length).toBeGreaterThan(0);
    for (const x of titles) expect(x).toBe(KEY_TOOL_TITLE);
    expect(Object.keys(t.inputSchema.properties).sort()).toEqual(['client_name', 'email', 'market']);   // market: daily habit, mcp#1539
    // no description anywhere in the list still points at the old name (connect_url's tool= value: see the next case)
    expect(JSON.stringify(r.body.result.tools)).not.toMatch(/(?<![=/&?.\-A-Za-z0-9_])claim_free_key(?![A-Za-z0-9_])/);
    // the listing metric: no free-key / free-tier / paid-plan wording in the served list
    expect(JSON.stringify(r.body.result.tools)).not.toMatch(/free key|free tier|paid plan/i);
  });

  // 2026-11-18 (owner stability item 2): the access tag's connect_url was built from the REGISTERED name, so the
  // listed get_api_key entry carried tool=claim_free_key in annotations.connect_url (and the _meta mirror).
  it.each(['/mcp', '/mcp?catalog=full', '/mcp/registry'])('%s: the key tool\'s connect_url names get_api_key', async (path) => {
    const t = (await rpc(path, 'tools/list')).body.result.tools.find((x) => x.name === KEY_TOOL_LISTED);
    const urls = [t.annotations && t.annotations.connect_url, t._meta && t._meta['cloud.dchub/access'] && t._meta['cloud.dchub/access'].connect_url]
      .filter((x) => x !== undefined);
    expect(urls.length, 'control: the entry carries a connect_url').toBeGreaterThan(0);
    for (const u of urls) expect(u).toBe('https://dchub.cloud/connect?ref=mcp-tools-list&tool=get_api_key');
    expect(JSON.stringify(t)).not.toMatch(/claim_free_key/);
  });

  it('the sessioned path: the key tool\'s connect_url names get_api_key', async () => {
    const init = await rpc('/mcp', 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } });
    const sid = init.headers.get('mcp-session-id');
    const t = (await rpc('/mcp', 'tools/list', {}, { 'mcp-session-id': sid })).body.result.tools.find((x) => x.name === KEY_TOOL_LISTED);
    expect(t.annotations && t.annotations.connect_url).toBe('https://dchub.cloud/connect?ref=mcp-tools-list&tool=get_api_key');
  });

  it('a pack that carries the key tool lists it as get_api_key', async () => {
    const n = names(await rpc('/mcp/grid', 'tools/list'));
    expect(n).toContain(KEY_TOOL_LISTED);
    expect(n).not.toContain(KEY_TOOL_REGISTERED);
  });

  it('the sessioned path lists it the same way', async () => {
    const init = await rpc('/mcp', 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } });
    const sid = init.headers.get('mcp-session-id');
    expect(sid).toBeTruthy();
    const n = names(await rpc('/mcp', 'tools/list', {}, { 'mcp-session-id': sid }));
    expect(n).toContain(KEY_TOOL_LISTED);
    expect(n).not.toContain(KEY_TOOL_REGISTERED);
  });

  it.each(['/mcp/chatgpt', '/mcp/claude', '/mcp/core'])('%s lists neither name (unchanged)', async (path) => {
    const n = names(await rpc(path, 'tools/list'));
    expect(n.length).toBeGreaterThan(0);
    expect(n).not.toContain(KEY_TOOL_LISTED);
    expect(n).not.toContain(KEY_TOOL_REGISTERED);
  });
});

describe('tools/call: both names reach the same handler', () => {
  it('get_api_key and claim_free_key each mint through /api/v1/keys/claim', async () => {
    const before = claims.length;
    const a = await rpc('/mcp', 'tools/call', { name: KEY_TOOL_LISTED, arguments: { client_name: 'vitest-a' } });
    const b = await rpc('/mcp', 'tools/call', { name: KEY_TOOL_REGISTERED, arguments: { client_name: 'vitest-b' } });
    for (const r of [a, b]) {
      expect(r.body.error, JSON.stringify(r.body.error)).toBeUndefined();
      expect(r.body.result.isError).not.toBe(true);
      expect(JSON.stringify(r.body.result)).toContain('dch_live_testkey0001');
    }
    expect(claims.length - before).toBe(2);
    expect(claims.slice(before).join(' ')).toContain('vitest-a');
  });

  it('an answer pointing at the key tool names get_api_key', async () => {
    // A sessionless loopback request is an execute_plan step (server.mjs _isLoopbackPeer), whose parent result is the
    // one rewritten; a session from a forwarded IP is a caller, so this call takes the caller's path.
    const h0 = { 'x-forwarded-for': '203.0.113.71', 'user-agent': 'test-client' };
    const init = await rpc('/mcp', 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } }, h0);
    const sid = init.headers.get('mcp-session-id');
    expect(sid, 'control: a session').toBeTruthy();
    const r = await rpc('/mcp', 'tools/call', { name: KEY_TOOL_LISTED, arguments: { client_name: 'vitest-c' } }, { ...h0, 'mcp-session-id': sid });
    const s = JSON.stringify(r.body.result);
    expect(s, 'control: the key was handed back').toContain('dch_live_testkey0001');
    expect(s, 'control: the answer points at the key tool').toMatch(/\bget_api_key\b/);
    expect(s).not.toMatch(/(?<![=/&?.\-A-Za-z0-9_])claim_free_key(?![A-Za-z0-9_])/);
  });

  it('on /mcp/chatgpt get_api_key stays an unknown tool (the frozen profile does not list it)', async () => {
    const r = await rpc('/mcp/chatgpt', 'tools/call', { name: KEY_TOOL_LISTED, arguments: {} });
    expect(JSON.stringify(r.body)).toMatch(/Unknown tool/);
  });
});

describe('instructions name get_api_key', () => {
  it('initialize on /mcp: KEYS line names get_api_key', async () => {
    const r = await rpc('/mcp', 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } });
    const ins = r.body.result.instructions;
    // Capabilities messaging (2026-11-26): the approved paragraph names get_api_key and asks for no email.
    expect(ins).toContain('Call get_api_key only if the user asks for a key');
    expect(ins).not.toMatch(/\bclaim_free_key\b/);
  });
});

describe('lib/key-tool-name.mjs', () => {
  it('replaces whole tokens only, never inside a URL or a longer identifier', () => {
    expect(keyToolPointerText('call `claim_free_key` now')).toBe('call `get_api_key` now');
    expect(keyToolPointerText('(claim_free_key)')).toBe('(get_api_key)');
    expect(keyToolPointerText('https://dchub.cloud/x?tool=claim_free_key')).toBe('https://dchub.cloud/x?tool=claim_free_key');
    expect(keyToolPointerText('claim_free_key_tool')).toBe('claim_free_key_tool');
  });
  it('the step rewrites values, not keys', () => {
    const out = keyToolPointerStep({ content: [{ type: 'text', text: '{"next_tool":"claim_free_key"}' }],
      structuredContent: { next_tool: 'claim_free_key', claim_free_key_tool: 'claim_free_key', claim_free_key: { a: 1 } } });
    expect(out.content[0].text).toBe('{"next_tool":"get_api_key"}');
    expect(out.structuredContent).toEqual({ next_tool: 'get_api_key', claim_free_key_tool: 'get_api_key', claim_free_key: { a: 1 } });
    expect(keyToolPointerStep(out, { skip: true })).toBe(out);
  });
  it('kill switch DCHUB_GET_API_KEY_LISTED=0 lists and names claim_free_key', () => {
    const env = { DCHUB_GET_API_KEY_LISTED: '0' };
    const tools = [{ name: 'claim_free_key', title: 'Claim Free Key', description: 'x' }, { name: 'a', description: 'call claim_free_key' }];
    expect(listKeyToolAs(tools, env)).toBe(tools);
    expect(keyToolPointerText('call claim_free_key', env)).toBe('call claim_free_key');
    const on = listKeyToolAs(tools, {});
    expect(on.map((t) => t.name)).toEqual(['get_api_key', 'a']);
    expect(on[1].description).toBe('call get_api_key');
  });
});
