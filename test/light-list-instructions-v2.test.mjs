// light-list-instructions-v2.test.mjs: A2 (owner course-correct 2026-11-21), DCHUB_LIGHT_LIST_INSTRUCTIONS_V2.
//
// For every light-list client name, every tool the initialize instructions' "Tools:" line names is in the tools/list
// that same session is served, execute_plan first, and the count is stated once. Real handler over HTTP, local stub
// backend, no network. The CONTROL case proves the check fails on today's (flag off) handshake.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { CAPABILITIES_INSTRUCTIONS } from '../lib/capabilities-instructions.mjs';

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

const FLAG = 'DCHUB_LIGHT_LIST_INSTRUCTIONS_V2';
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
  L = await import('../lib/light-list-instructions.mjs');
  P = await import('../lib/light-profile.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterEach(() => { delete process.env[FLAG]; });

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
  { name: 'Visual Studio Code' }, { name: 'Visual Studio Code - Insiders' },
  { name: 'claude-code' }, { name: 'clono' }, { name: 'Clono' }, { name: 'workbuddy' },
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
  };
}

function toolsLine(ins) {
  const m = /\bTools: ([a-z_]+(?:, [a-z_]+)*)\./.exec(ins);
  return m ? m[1].split(', ') : null;
}

// Capabilities messaging (2026-11-26): the shared handshake is the owner-approved capabilities paragraph, verbatim
// (lib/capabilities-instructions.mjs). It has no "Tools:" line for the light-list rewrite to narrow, and it names these
// tools; the ones a ten-tool light list does not carry are reachable by name (the ENDPOINT SCOPE tail says so). The pin
// below fails if the paragraph starts naming another tool the light list lacks.
const PARAGRAPH_TOOLS = ['execute_plan', 'summarize_for_citation', 'dchub_services', 'why_dchub', 'source_capacity',
  'get_changes', 'get_api_key', 'recover_my_key', 'report_finding', 'request_enhancement'];
const PARAGRAPH_UNLISTED_ON_LIGHT = ['summarize_for_citation', 'dchub_services', 'why_dchub', 'get_api_key',
  'recover_my_key', 'report_finding', 'request_enhancement'];
const paragraphNotListed = (hs) => PARAGRAPH_TOOLS.filter((n) => !hs.tools.includes(n));

// The acceptance check: what the "Tools:" line names that this client's tools/list does not.
function notListed(hs) {
  const named = toolsLine(hs.instructions) || [];
  return named.filter((n) => !hs.tools.includes(n));
}

describe('A2: a light-list handshake names only tools in that client\'s list (flag on)', () => {
  it('every identity here really is a light-list identity (the list under test is not empty or mislabelled)', () => {
    for (const c of LIGHT_CLIENTS) {
      expect(P.lightForRequest({ path: '/mcp', userAgent: c.ua || 'node', clientName: c.name, env: {} }), label(c)).toBe(true);
    }
    expect(P.lightForRequest({ path: '/mcp', userAgent: 'node', clientName: 'mcp', env: {} })).toBe(false);
  });

  it('for every light-list client, each tool on the "Tools:" line is in its tools/list, execute_plan first', async () => {
    process.env[FLAG] = '1';
    for (const c of LIGHT_CLIENTS) {
      const hs = await handshake(c);
      expect(hs.status, label(c)).toBe(200);
      expect(hs.sid, label(c)).toBeTruthy();
      expect(hs.tools.length, label(c)).toBeGreaterThan(0);
      expect(hs.tools.length, label(c)).toBeLessThan(20);
      expect(hs.instructions.startsWith(CAPABILITIES_INSTRUCTIONS), label(c)).toBe(true);
      expect(toolsLine(hs.instructions), label(c) + ': the paragraph has no Tools: line').toBeNull();
      expect(hs.tools[0], label(c)).toBe('execute_plan');
      for (const n of PARAGRAPH_TOOLS) expect(hs.instructions, label(c) + ' names ' + n).toContain(n);
      expect(paragraphNotListed(hs), label(c)).toEqual(PARAGRAPH_UNLISTED_ON_LIGHT.filter((n) => !hs.tools.includes(n)));
      expect(paragraphNotListed(hs).every((n) => PARAGRAPH_UNLISTED_ON_LIGHT.includes(n)), label(c)).toBe(true);
      expect(hs.instructions, label(c)).toContain('tools/call accepts any DC Hub tool by name');
    }
  });

  it('the list is described once, with no count (owner 2026-11-22): "Tools: execute_plan, .... discover_tools lists the rest."', async () => {
    process.env[FLAG] = '1';
    for (const c of [{ name: 'github-copilot-developer' }, { name: 'codex-mcp-client' }, { name: 'windsurf-client' }]) {
      const hs = await handshake(c);
      expect(hs.instructions, label(c)).toMatch(/discover_tools lists the rest\./);
      expect(hs.tools.length).toBe(10);
      expect(hs.instructions, label(c)).not.toMatch(/DC Hub: \d+ tools/);
      expect((hs.instructions.match(/\b\d+ (DC Hub )?tools\b/g) || []).length, label(c)).toBe(0);   // owner 2026-11-22: no count
      expect((hs.instructions.match(/discover_tools lists the rest/g) || []).length, label(c)).toBe(1);
      expect(hs.instructions).toContain('a listing scope, not a permission scope');
      expect(hs.instructions).toContain('tools/call accepts any DC Hub tool by name');
      expect(hs.instructions).toContain('Call execute_plan first');
      expect(hs.instructions).toContain('get_api_key included');
      // Owner 2026-11-22 ("trim it too"): 2,045 live before the trim, 3 under the cap; 2,003 here after it.
      // Held at 2,020 so a later addition has to find room instead of eating the last of the headroom.
      expect(hs.instructions.length, label(c) + ' measured ' + hs.instructions.length).toBeLessThanOrEqual(2020);
    }
  });

  it('names no connector URL but https://dchub.cloud/mcp (no /mcp/core, /mcp/oauth, /mcp/connect, /mcp/light)', async () => {
    process.env[FLAG] = '1';
    for (const c of [{ name: 'github-copilot-developer' }, { name: 'codex-mcp-client' }, { name: 'windsurf-client' }]) {
      const { instructions } = await handshake(c);
      expect(instructions).not.toMatch(/dchub\.cloud\/mcp\/(core|oauth|connect|light)/);
      for (const u of instructions.match(/https:\/\/dchub\.cloud\/mcp[^\s.,;)]*/g) || []) {
        expect(u).toMatch(/^https:\/\/dchub\.cloud\/mcp(\?catalog=full)?$/);
      }
    }
  });

  it('/mcp/light gets the same rewrite (the same ten tools)', async () => {
    process.env[FLAG] = '1';
    const hs = await handshake({ name: 'light-v2-test' }, '/mcp/light');
    expect(hs.tools.length).toBe(10);
    expect(paragraphNotListed(hs)).toEqual(PARAGRAPH_UNLISTED_ON_LIGHT);
    expect(hs.instructions).toMatch(/discover_tools lists the rest\./);
    expect(hs.instructions).toContain('ENDPOINT SCOPE: /mcp/light is a listing scope');
    // Owner 2026-11-22 ("trim it too"): /mcp/light measured 2,059 live, over the 2,048 clients keep; 2,017 after it.
    // Capabilities messaging (2026-11-26): the approved paragraph (1,797 characters, verbatim) puts /mcp/light at 2,024;
    // the held headroom moves to 2,030, still under the 2,048 clients keep (test/initialize-instructions-length).
    expect(hs.instructions.length, '/mcp/light measured ' + hs.instructions.length).toBeLessThanOrEqual(2030);
  });

  it('full-list clients are unchanged byte for byte with the flag on', async () => {
    for (const c of [{ name: 'mcp' }, { name: 'claude-ai' }, { name: 'some-agent' }]) {
      delete process.env[FLAG];
      const off = await handshake(c);
      process.env[FLAG] = '1';
      const on = await handshake(c);
      expect(on.tools.length, label(c)).toBeGreaterThan(80);
      expect(on.instructions, label(c)).toBe(off.instructions);
    }
  });

  it('CONTROL (flag off, today): the same check finds tools named but not listed, and one count', async () => {
    delete process.env[FLAG];
    for (const c of [{ name: 'github-copilot-developer' }, { name: 'codex-mcp-client' }, { name: 'windsurf-client' }]) {
      const hs = await handshake(c);
      // Capabilities messaging (2026-11-26): flag off, the same paragraph names the same unlisted tools.
      expect(paragraphNotListed(hs), label(c)).toEqual(PARAGRAPH_UNLISTED_ON_LIGHT);
      // ★2026-11-22 (owner): the shared text no longer says "DC Hub: N tools."
      expect(hs.instructions).not.toMatch(/DC Hub: \d+ tools/);
      expect(hs.instructions).toMatch(/this client's \/mcp list shows a subset of DC Hub tools/);
    }
  });
});

describe('lib/light-list-instructions.mjs', () => {
  it('flag is off unless 1/true/yes/on', () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'no', 'maybe']) expect(L.lightListInstructionsV2On({ [FLAG]: v })).toBe(false);
    for (const v of ['1', 'true', 'YES', ' on ']) expect(L.lightListInstructionsV2On({ [FLAG]: v })).toBe(true);
  });

  it('lightLeadTools: execute_plan first, substitutes only when listed, unlisted dropped', () => {
    const light = P.LIGHT_TOOLS;
    expect(L.lightLeadTools(light)).toEqual(['execute_plan', 'get_grid_intelligence', 'source_capacity', 'get_market_dcpi_rank', 'search_facilities']);
    expect(L.lightLeadTools(['search_facilities', 'execute_plan'])).toEqual(['execute_plan', 'search_facilities']);
    expect(L.lightLeadTools(['get_grid_data', 'execute_plan', 'get_market_intel'])).toEqual(['execute_plan', 'get_grid_data', 'get_market_intel']);
    expect(L.lightLeadTools([])).toEqual([]);
  });

  it('lightListInstructions rewrites the Tools line and the count, leaves the rest, never throws', () => {
    const t = 'Lead. Tools: execute_plan, get_grid_data, source_capacity. Cite. DC Hub: 98 tools. Data moves daily.';
    const out = L.lightListInstructions(t, { listed: ['execute_plan', 'discover_tools', 'source_capacity'] });
    expect(out).toBe('Lead. Tools: execute_plan, source_capacity. Cite. discover_tools lists the rest. Data moves daily.');
    expect(L.lightListInstructions(t, { listed: [] })).toBe(t);
    expect(L.lightListInstructions(null, { listed: ['execute_plan'] })).toContain('This list shows a subset of DC Hub tools.');
    expect(L.lightListInstructions('DC Hub. x', { listed: ['execute_plan', 'discover_tools'] })).toBe('discover_tools lists the rest. x');
  });
});
