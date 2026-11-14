// light-profile.test.mjs: /mcp/light, the execute_plan-first light listing (2026-11-12).
//
// Real handler over HTTP, local stub backend, no network.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
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

const PRO = 'dch_live_lightprofiletest01';
// 400 facility rows with a long note each: a keyed search_facilities answer
// far over 12,000 characters, which /mcp serves whole.
const ROWS = Array.from({ length: 400 }, (_, i) => ({
  id: 1000 + i, name: `Facility ${i}`, provider: 'Operator', city: 'Ashburn', state: 'VA', country: 'US',
  lat: 39 + i / 1000, lon: -77 - i / 1000, capacity_mw: 10 + i,
  note: 'x'.repeat(120),
}));

let S, G, PORT, httpServer, stub, prevBase;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const url = new URL(req.url, 'http://_');
        res.setHeader('content-type', 'application/json');
        if (url.pathname === '/api/v1/keys/validate') {
          let key = '';
          try { key = JSON.parse(b || '{}').api_key || ''; } catch (_) {}
          res.end(JSON.stringify(key === PRO
            ? { valid: true, tier: 'pro', developer_id: 'dev_light', email: 'g@example.com' }
            : { valid: false, tier: 'free' }));
          return;
        }
        if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
        res.end(JSON.stringify({ success: true, count: ROWS.length, total: ROWS.length, data: ROWS, results: ROWS }));
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  G = await import('../lib/light-profile.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
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
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'light-profile-test', version: '1.0' } } };

// PINNED, not read back from LIGHT_TOOLS: a count taken from the thing it checks cannot fail.
const EXPECTED_TOOLS = [
  'execute_plan', 'discover_tools',
  'get_market_dcpi_rank', 'get_grid_intelligence', 'get_interconnection_queue', 'search_facilities',
  'find_sites', 'analyze_site', 'source_capacity', 'get_changes',
];
const BANNED = /\$\s?\d|\/mo\b|per month|per year|\bPro\b|Developer plan|Enterprise|Land & Power|Team plan|trial|partner/i;

describe('/mcp/light lists the light, front-door-first catalog', () => {
  it('serves exactly the pinned tools, execute_plan first, in at most 30 KB', async () => {
    const r = await post('/mcp/light', LIST);
    expect(r.status).toBe(200);
    expect(r.json.result.tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
    expect(Buffer.byteLength(r.raw)).toBeLessThanOrEqual(G.LIGHT_TOOLS_LIST_MAX_BYTES);
    expect(G.LIGHT_TOOLS_LIST_MAX_BYTES).toBe(30000);
  });

  it('execute_plan reads as the front door and spells out the Data Center Power Index (DCPI)', async () => {
    const { json } = await post('/mcp/light', LIST);
    const ep = json.result.tools[0];
    expect(ep.description).toMatch(/^FRONT DOOR\. Use this first/);
    expect(ep.description).toContain('Data Center Power Index (DCPI)');
    expect(ep.description).toMatch(/discover_tools lists every DC Hub tool/);
  });

  it('descriptions are bounded, carry no outputSchema, and name no price or plan', async () => {
    const { json } = await post('/mcp/light', LIST);
    for (const t of json.result.tools) {
      expect(t.description.length, `${t.name} description`).toBeLessThanOrEqual(G.LIGHT_DESCRIPTION_MAX + 150);
      expect(t.description.length, `${t.name} description is empty`).toBeGreaterThan(80);
      expect(t.outputSchema, `${t.name} still carries outputSchema`).toBeUndefined();
      expect(t.description, `${t.name} description`).not.toMatch(BANNED);
    }
  });

  it('inputSchema and access annotations are the /mcp ones', async () => {
    const canon = new Map((await post('/mcp', LIST)).json.result.tools.map((t) => [t.name, t]));
    const { json } = await post('/mcp/light', LIST);
    for (const t of json.result.tools) {
      const c = canon.get(t.name);
      expect(t.inputSchema).toEqual(c.inputSchema);
      expect((t.annotations || {}).access).toBe((c.annotations || {}).access);
    }
  });

  it('/mcp is unchanged: the full catalog, outputSchema included', async () => {
    const r = await post('/mcp', LIST);
    expect(r.json.result.tools.length).toBeGreaterThan(80);
    expect(r.json.result.tools.some((t) => t.outputSchema)).toBe(true);
  });

  it('initialize on /mcp/light states the count it lists and that every tool stays callable', async () => {
    const r = await post('/mcp/light', INIT);
    expect(r.status).toBe(200);
    const ins = r.json.result.instructions || '';
    expect(ins).toMatch(/ENDPOINT SCOPE: \/mcp\/light lists 10 DC Hub tools/);
    expect(ins).toMatch(/the full list is at https:\/\/dchub\.cloud\/mcp/);
    expect(ins).toMatch(/start with execute_plan/);
    expect(ins).toMatch(/tools\/call accepts any DC Hub tool by name/);
  });

  it('a tool that is not listed is still reachable by name (a listing scope, not an entitlement scope)', async () => {
    const r = await post('/mcp/light', { jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'get_grid_scoreboard', arguments: { limit: 1 } } });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toMatch(/unknown tool|not found|Method not found/i);
  });
});

describe('client-aware default: DCHUB_LIGHT_FOR_CLI (on unless set to 0)', () => {
  const CLI_UAS = [
    'copilot-cli/1.0.34',
    'codex-mcp-client/0.121.0',
    'opencode/2.2.4/cli',
    'WorkBuddy/5.9.6',
    'Clono (+https://clono.sh)',
    'claude-code/2.0',
    'Claude-User (claude-code/2.1.0; +https://support.anthropic.com/)',
  ];
  const prev = process.env.DCHUB_LIGHT_FOR_CLI;
  afterAll(() => { if (prev === undefined) delete process.env.DCHUB_LIGHT_FOR_CLI; else process.env.DCHUB_LIGHT_FOR_CLI = prev; });
  afterEach(() => { delete process.env.DCHUB_LIGHT_FOR_CLI; });

  it('kill switch: a coding-CLI user agent gets the full /mcp list when the flag is off', async () => {
    process.env.DCHUB_LIGHT_FOR_CLI = '0';
    for (const ua of CLI_UAS) {
      const r = await post('/mcp', LIST, { 'user-agent': ua });
      expect(r.json.result.tools.length, ua).toBeGreaterThan(80);
    }
  });

  it('default on: a coding-CLI user agent gets the light list on /mcp, any other client the full list', async () => {
    delete process.env.DCHUB_LIGHT_FOR_CLI;
    for (const ua of CLI_UAS) {
      const r = await post('/mcp', LIST, { 'user-agent': ua });
      expect(r.json.result.tools.map((t) => t.name), ua).toEqual(EXPECTED_TOOLS);
      expect(r.json.result.tools[0].name, ua).toBe('execute_plan');
    }
    for (const ua of ['Mozilla/5.0', 'node', 'claude-ai/1.0']) {
      const r = await post('/mcp', LIST, { 'user-agent': ua });
      expect(r.json.result.tools.length, ua).toBeGreaterThan(80);
    }
    // Only the bare /mcp path is client-aware: /mcp/core and /mcp/grok keep their own lists.
    const g = await post('/mcp/grok', LIST, { 'user-agent': 'copilot-cli/1.0.34' });
    expect(g.json.result.tools.map((t) => t.name)[0]).toBe('execute_plan');
    expect(g.json.result.tools.length).toBe(11);
  });

  it('clientInfo.name (and X-MCP-Client) is enough when the User-Agent is generic', async () => {
    delete process.env.DCHUB_LIGHT_FOR_CLI;
    for (const name of ['claude-code', 'gemini-cli-mcp-client', 'gemini-cli', 'github-copilot-developer', 'codex-mcp-client', 'opencode', 'Clono']) {
      const r = await post('/mcp', LIST, { 'user-agent': 'node', 'x-mcp-client': name });
      expect(r.json.result.tools.map((t) => t.name), name).toEqual(EXPECTED_TOOLS);
      expect(r.json.result.tools[0].name, name).toBe('execute_plan');
    }
    const full = await post('/mcp', LIST, { 'user-agent': 'node', 'x-mcp-client': 'mcp' });
    expect(full.json.result.tools.length).toBeGreaterThan(80);
  });

  it('lightForRequest follows the default-on kill switch, matches names, and never throws', () => {
    expect(G.lightForRequest({ path: '/mcp', userAgent: 'copilot-cli/1.0.34', env: {} })).toBe(true);
    expect(G.lightForRequest({ path: '/mcp', userAgent: 'node', clientName: 'gemini-cli-mcp-client', env: {} })).toBe(true);
    expect(G.lightForRequest({ path: '/mcp', userAgent: 'Claude-User (claude-code/2.1.0; +https://support.anthropic.com/)', env: {} })).toBe(true);
    expect(G.lightForRequest({ path: '/mcp', userAgent: 'copilot-cli/1.0.34', env: { DCHUB_LIGHT_FOR_CLI: '0' } })).toBe(false);
    expect(G.lightForRequest({ path: '/mcp/core', userAgent: 'copilot-cli/1.0.34', env: {} })).toBe(false);
    expect(G.lightForRequest({ path: '/mcp', userAgent: undefined, env: {} })).toBe(false);
    expect(G.lightForRequest()).toBe(false);
    expect(G.lightForCliOn({})).toBe(true);
    expect(G.lightForCliOn({ DCHUB_LIGHT_FOR_CLI: 'off' })).toBe(false);
  });
});


describe('directory crawlers get the full /mcp list; Copilot CLI gets the light list', () => {
  // Representative directory/indexer and generic-bot User-Agents. These are
  // test identities, not claimed official crawler strings: they must not match
  // LIGHT_CLI_UA, so a Smithery/Glama/Muse/PulseMCP/mcp.so/registry crawl of
  // bare /mcp still sees the full catalog after DCHUB_LIGHT_FOR_CLI defaulted on.
  const DIRECTORY_UAS = [
    'Smithery/1.0 (+https://smithery.ai)',
    'Mozilla/5.0 (compatible; Glama/1.0; +https://glama.ai/mcp)',
    'MuseDirectory/1.0 (+https://musedirectory.ai)',
    'PulseMCP/1.0 (+https://www.pulsemcp.com)',
    'mcp.so-bot/1.0 (+https://mcp.so)',
    'GitHub-MCP-Registry/1.0 (+https://github.com/mcp)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  ];
  const prev = process.env.DCHUB_LIGHT_FOR_CLI;
  afterAll(() => { if (prev === undefined) delete process.env.DCHUB_LIGHT_FOR_CLI; else process.env.DCHUB_LIGHT_FOR_CLI = prev; });
  afterEach(() => { delete process.env.DCHUB_LIGHT_FOR_CLI; });

  it('default on: directory and generic-bot user-agents get the full catalog, execute_plan first', async () => {
    delete process.env.DCHUB_LIGHT_FOR_CLI;
    for (const ua of DIRECTORY_UAS) {
      expect(G.isLightCliIdentity({ userAgent: ua }), ua).toBe(false);
      const r = await post('/mcp', LIST, { 'user-agent': ua });
      expect(r.status, ua).toBe(200);
      const names = r.json.result.tools.map((t) => t.name);
      expect(names.length, ua).toBeGreaterThan(80);
      expect(names[0], ua).toBe('execute_plan');
      expect(names, ua).not.toEqual(EXPECTED_TOOLS);
      expect(r.json.result.nextCursor, ua).toBeUndefined();
    }
  });

  it('default on: Copilot CLI still gets the 10-tool light list, execute_plan first', async () => {
    delete process.env.DCHUB_LIGHT_FOR_CLI;
    const r = await post('/mcp', LIST, { 'user-agent': 'copilot-cli/0.0.394' });
    expect(r.json.result.tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
    expect(r.json.result.tools[0].name).toBe('execute_plan');
    expect(r.json.result.tools.length).toBe(10);
  });

  // Investigation of Muse Directory publishing 40 tools: tools/list on /mcp is
  // one unpaginated page (server.mjs pack comment; SDK ListTools handler returns
  // every registered tool with no cursor). No server-side cap of 40 was found.
  it('tools/list on /mcp is one unpaginated page: full catalog, no nextCursor, cursor param does not cap at 40', async () => {
    delete process.env.DCHUB_LIGHT_FOR_CLI;
    const ua = { 'user-agent': 'MuseDirectory/1.0 (+https://musedirectory.ai)' };
    const bare = await post('/mcp', LIST, ua);
    expect(bare.status).toBe(200);
    expect(bare.json.result.nextCursor).toBeUndefined();
    expect(bare.json.result.tools.length).toBeGreaterThan(80);
    expect(bare.json.result.tools.length).not.toBe(40);
    expect(bare.json.result.tools[0].name).toBe('execute_plan');
    const paged = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { cursor: 'page-2' } }, ua);
    expect(paged.status).toBe(200);
    expect(paged.json.error, JSON.stringify(paged.json).slice(0, 300)).toBeUndefined();
    expect(paged.json.result.tools.length).toBe(bare.json.result.tools.length);
    expect(paged.json.result.nextCursor).toBeUndefined();
  });
});

// ── Owner item D2 (2026-11-14): multi-server IDE hosts get the light list on bare /mcp ─────────────────────────────
// The full /mcp tools/list measured 220,410 bytes live on 2026-11-14 for a Cursor identity (96 tools). An IDE agent
// loads every connected server's list into one context and caps the total tool count, so Cursor, VS Code, Windsurf
// and Cline now get the ten-tool light list, like the coding CLIs. Any caller can still ask for the full catalog.
describe('multi-server IDE hosts: light list on /mcp, full catalog on request (D2)', () => {
  // PINNED: what a multi-server host may be handed on bare /mcp.
  const MULTI_SERVER_LIST_MAX_BYTES = 100_000;
  const HOSTS = [
    { 'user-agent': 'node', 'x-mcp-client': 'cursor-vscode' },
    { 'user-agent': 'Visual Studio Code/1.106.0' },
    { 'user-agent': 'node', 'x-mcp-client': 'Visual Studio Code - Insiders' },
    { 'user-agent': 'node', 'x-mcp-client': 'windsurf-client' },
    { 'user-agent': 'node', 'x-mcp-client': 'Windsurf' },
    { 'user-agent': 'node', 'x-mcp-client': 'cline-vscode' },
    { 'user-agent': 'node', 'x-mcp-client': 'Cline' },
  ];
  const CLI = { 'user-agent': 'copilot-cli/1.0.34' };
  const prev = { cli: process.env.DCHUB_LIGHT_FOR_CLI, hosts: process.env.DCHUB_LIGHT_FOR_HOSTS };
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  afterAll(() => { restore('DCHUB_LIGHT_FOR_CLI', prev.cli); restore('DCHUB_LIGHT_FOR_HOSTS', prev.hosts); });
  afterEach(() => { delete process.env.DCHUB_LIGHT_FOR_CLI; delete process.env.DCHUB_LIGHT_FOR_HOSTS; });

  it(`default on: every IDE host gets the light list on /mcp, under ${MULTI_SERVER_LIST_MAX_BYTES} bytes`, async () => {
    for (const h of [...HOSTS, CLI]) {
      const r = await post('/mcp', LIST, h);
      const label = JSON.stringify(h);
      expect(r.status, label).toBe(200);
      expect(r.json.result.tools.map((t) => t.name), label).toEqual(EXPECTED_TOOLS);
      expect(Buffer.byteLength(r.raw), label).toBeLessThan(MULTI_SERVER_LIST_MAX_BYTES);
    }
  });

  it('CONTROL: the full catalog a host gets without this is over the pin (the size check can fail)', async () => {
    const r = await post('/mcp', LIST, { 'user-agent': 'node' });
    expect(r.json.result.tools.length).toBeGreaterThan(80);
    expect(Buffer.byteLength(r.raw)).toBeGreaterThan(MULTI_SERVER_LIST_MAX_BYTES);
  });

  it('initialize from Cursor (clientInfo only, generic UA) says the list is light and where the full one is', async () => {
    const r = await post('/mcp', { ...INIT, params: { ...INIT.params, clientInfo: { name: 'cursor-vscode', version: '1.0' } } },
      { 'user-agent': 'node' });
    expect(r.status).toBe(200);
    const ins = r.json.result.instructions || '';
    expect(ins).toMatch(/ENDPOINT SCOPE: this client's \/mcp list shows 10 DC Hub tools/);
    expect(ins).toContain('the full list is at https://dchub.cloud/mcp?catalog=full');
  });

  it('?catalog=full or X-DCHUB-Catalog: full gives the full catalog to an IDE host and to a coding CLI', async () => {
    for (const h of [HOSTS[0], HOSTS[1], CLI]) {
      const q = await post('/mcp?catalog=full', LIST, h);
      expect(q.json.result.tools.length, JSON.stringify(h)).toBeGreaterThan(80);
      const hd = await post('/mcp', LIST, { ...h, 'x-dchub-catalog': 'full' });
      expect(hd.json.result.tools.length, JSON.stringify(h)).toBeGreaterThan(80);
    }
    // anything else in the param is not an ask
    const other = await post('/mcp?catalog=all', LIST, HOSTS[0]);
    expect(other.json.result.tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
  });

  it('kill switch DCHUB_LIGHT_FOR_HOSTS=0 gives IDE hosts the full list and leaves the CLIs light', async () => {
    process.env.DCHUB_LIGHT_FOR_HOSTS = '0';
    for (const h of HOSTS) {
      const r = await post('/mcp', LIST, h);
      expect(r.json.result.tools.length, JSON.stringify(h)).toBeGreaterThan(80);
    }
    const c = await post('/mcp', LIST, CLI);
    expect(c.json.result.tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
  });

  it('only bare /mcp is client-aware, and Claude.ai and directory crawlers still get the full list', async () => {
    const g = await post('/mcp/grok', LIST, HOSTS[0]);
    expect(g.json.result.tools.length).toBe(11);
    for (const ua of ['claude-ai/1.0', 'Smithery/1.0 (+https://smithery.ai)', 'Mozilla/5.0 (compatible; Glama/1.0; +https://glama.ai/mcp)']) {
      expect(G.isLightHostIdentity({ userAgent: ua, clientName: ua }), ua).toBe(false);
      const r = await post('/mcp', LIST, { 'user-agent': ua });
      expect(r.json.result.tools.length, ua).toBeGreaterThan(80);
    }
  });

  it('lightForRequest: hosts by name or UA, the full-catalog ask wins, never throws', () => {
    expect(G.lightForRequest({ path: '/mcp', userAgent: 'node', clientName: 'cursor-vscode', env: {} })).toBe(true);
    expect(G.lightForRequest({ path: '/mcp', userAgent: 'Visual Studio Code/1.106.0', env: {} })).toBe(true);
    expect(G.lightForRequest({ path: '/mcp', userAgent: 'node', clientName: 'cursor-vscode', fullCatalog: true, env: {} })).toBe(false);
    expect(G.lightForRequest({ path: '/mcp', userAgent: 'copilot-cli/1.0.34', fullCatalog: true, env: {} })).toBe(false);
    expect(G.lightForRequest({ path: '/mcp', clientName: 'cursor-vscode', env: { DCHUB_LIGHT_FOR_HOSTS: 'off' } })).toBe(false);
    expect(G.lightForRequest({ path: '/mcp/core', clientName: 'cursor-vscode', env: {} })).toBe(false);
    expect(G.isLightHostIdentity({ clientName: 'cursorish' })).toBe(false);
    expect(G.wantsFullCatalog({ query: { catalog: 'FULL' } })).toBe(true);
    expect(G.wantsFullCatalog({ headers: { 'x-dchub-catalog': 'full' } })).toBe(true);
    expect(G.wantsFullCatalog({ query: { catalog: 'core' } })).toBe(false);
    expect(G.wantsFullCatalog(null)).toBe(false);
  });
});
