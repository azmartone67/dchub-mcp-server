// slim-profile-test-1122.test.mjs: the opt-in core list on bare /mcp, ?tools=core (Brain upgrade-funnel item 7,
// DCHUB_SLIM_PROFILE_TEST, default off).
//
// Real handler over HTTP, local stub backend, no network. Proves:
//   . flag off: ?tools=core changes nothing (full catalog on /mcp, light list for a coding CLI);
//   . flag on: ?tools=core (or X-DCHUB-Tools: core) lists exactly the seven pinned tools, execute_plan first, with the
//     /mcp inputSchemas, no outputSchema, no price or plan, and says in initialize what it lists;
//   . an explicit ?tools=core wins over the implicit light list, and nothing changes without it;
//   . an unlisted tool is still callable by name;
//   . the session_init event names the list the session was served (slim, light, full).
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

const FLAG = 'DCHUB_SLIM_PROFILE_TEST';
const events = [];
let S, P, PORT, httpServer, stub, prevBase, prevKey, prevFlag;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const url = new URL(req.url, 'http://_');
        res.setHeader('content-type', 'application/json');
        if (url.pathname === '/api/v1/mcp/track') {
          try { const j = JSON.parse(b || '{}'); if (j && j.event === 'session_init') events.push(j); } catch (_) {}
          res.end('{}');
          return;
        }
        if (url.pathname === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: false, tier: 'free' })); return; }
        if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
        res.end(JSON.stringify({ success: true, data: [], results: [] }));
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  prevKey = process.env.DCHUB_INTERNAL_KEY;
  prevFlag = process.env[FLAG];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = process.env.DCHUB_INTERNAL_KEY || 'test-internal';
  S = await import('../server.mjs');
  P = await import('../lib/slim-profile.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterEach(() => {
  if (prevFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = prevFlag;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  for (const [k, v] of [['DCHUB_API_BASE', prevBase], ['DCHUB_INTERNAL_KEY', prevKey]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  net.Socket.prototype.connect = realConnect;
  expect(foreign, 'no connection left loopback').toEqual([]);
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
  return { status: res.status, raw, json };
}
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const init = (name) => ({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1.0' } } });
const names = (r) => r.json.result.tools.map((t) => t.name);

// PINNED, not read back from SLIM_TOOLS: a list taken from the thing it checks cannot fail.
const EXPECTED = ['execute_plan', 'get_grid_intelligence', 'get_interconnection_queue', 'get_grid_data',
  'get_energy_prices', 'get_api_key', 'dchub_services'];
const BANNED = /\$\s?\d|\/mo\b|per month|per year|\bPro\b|Developer plan|Enterprise|Team plan|trial|partner|90%/i;

describe('flag off: ?tools=core changes nothing', () => {
  it('/mcp?tools=core lists the same catalog as /mcp', async () => {
    delete process.env[FLAG];
    const full = names(await post('/mcp', LIST));
    expect(full.length).toBeGreaterThan(80);
    expect(names(await post('/mcp?tools=core', LIST))).toEqual(full);
    expect(names(await post('/mcp', LIST, { 'x-dchub-tools': 'core' }))).toEqual(full);
  });

  it('a coding CLI still gets the light list', async () => {
    delete process.env[FLAG];
    const r = await post('/mcp?tools=core', LIST, { 'user-agent': 'copilot-cli/1.0.34' });
    expect(names(r)).toHaveLength(10);
    expect(names(r)[1]).toBe('discover_tools');
  });
});

describe('flag on: the opt-in core list', () => {
  it('?tools=core and X-DCHUB-Tools: core list exactly the seven pinned tools, execute_plan first', async () => {
    process.env[FLAG] = '1';
    expect(names(await post('/mcp?tools=core', LIST))).toEqual(EXPECTED);
    expect(names(await post('/mcp?tools=CORE', LIST))).toEqual(EXPECTED);
    expect(names(await post('/mcp', LIST, { 'x-dchub-tools': 'core' }))).toEqual(EXPECTED);
  });

  it('descriptions: front door first, DCPI spelled out, bounded, no outputSchema, no price or plan', async () => {
    process.env[FLAG] = '1';
    const { json } = await post('/mcp?tools=core', LIST);
    const ep = json.result.tools[0];
    expect(ep.description).toMatch(/^FRONT DOOR\. Use this first/);
    expect(ep.description).toContain('Data Center Power Index (DCPI)');
    for (const t of json.result.tools) {
      expect(t.outputSchema, `${t.name} outputSchema`).toBeUndefined();
      expect(t.description.length, `${t.name}`).toBeGreaterThan(60);
      expect(t.description.length, `${t.name}`).toBeLessThanOrEqual(P.SLIM_DESCRIPTION_MAX + 150);
      expect(t.description, `${t.name}`).not.toMatch(BANNED);
    }
  });

  it('inputSchemas are the /mcp ones', async () => {
    process.env[FLAG] = '1';
    const canon = new Map((await post('/mcp', LIST)).json.result.tools.map((t) => [t.name, t]));
    for (const t of (await post('/mcp?tools=core', LIST)).json.result.tools) {
      expect(t.inputSchema, t.name).toEqual(canon.get(t.name).inputSchema);
    }
  });

  it('an explicit ?tools=core wins over the implicit light list; without it nothing moves', async () => {
    process.env[FLAG] = '1';
    const ua = { 'user-agent': 'copilot-cli/1.0.34' };
    expect(names(await post('/mcp?tools=core', LIST, ua))).toEqual(EXPECTED);
    expect(names(await post('/mcp', LIST, ua))).toHaveLength(10);
    expect(names(await post('/mcp', LIST)).length).toBeGreaterThan(80);
    expect(names(await post('/mcp?tools=other', LIST)).length).toBeGreaterThan(80);
    expect(names(await post('/mcp/light?tools=core', LIST))).toHaveLength(10);
  });

  it('initialize says what it lists, once, with no second connector URL', async () => {
    process.env[FLAG] = '1';
    const r = await post('/mcp?tools=core', init('slim-test'));
    expect(r.status).toBe(200);
    const ins = r.json.result.instructions || '';
    // Owner 2026-11-22: no count; trimmed to fit 2,048 (the opening canon sentence says "call execute_plan first",
    // so the tail no longer repeats "start with execute_plan").
    expect(ins).toMatch(/ENDPOINT SCOPE: this \/mcp list \(tools=core\) is a listing scope, not a permission scope/);
    expect(ins).toMatch(/tools\/call accepts any DC Hub tool by name; dchub_services lists DC Hub's services; the full list is at /);
    expect(ins).toMatch(/Call execute_plan first/);   // capabilities paragraph, 2026-11-26
    expect(ins.length).toBeLessThanOrEqual(2048);
    expect(ins).not.toMatch(/\/mcp\/(oauth|core|light)\b/);
  });

  it('a tool that is not listed is still callable by name', async () => {
    process.env[FLAG] = '1';
    const r = await post('/mcp?tools=core', { jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'get_grid_scoreboard', arguments: { limit: 1 } } });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toMatch(/unknown tool|Method not found/i);
  });
});

describe('session_init names the list the session was served', () => {
  async function initEvent(path, name, headers = {}) {
    const before = events.length;
    await post(path, init(name), headers);
    for (let i = 0; i < 50 && !events.slice(before).some((e) => e.client_name === name); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return events.slice(before).find((e) => e.client_name === name);
  }

  it('slim with ?tools=core, light for a coding CLI, full on bare /mcp; flag off is never slim', async () => {
    process.env[FLAG] = '1';
    expect((await initEvent('/mcp?tools=core', 'slim-ev-a')).tool_list).toBe('slim');
    expect((await initEvent('/mcp', 'slim-ev-b', { 'user-agent': 'copilot-cli/1.0.34' })).tool_list).toBe('light');
    expect((await initEvent('/mcp', 'slim-ev-c')).tool_list).toBe('full');
    delete process.env[FLAG];
    expect((await initEvent('/mcp?tools=core', 'slim-ev-d')).tool_list).toBe('full');
  });

  it('toolListLabel maps packs and paths', () => {
    expect(P.toolListLabel({ slim: true, pack: 'slim' }, '/mcp')).toBe('slim');
    expect(P.toolListLabel({ light: true, pack: 'light' }, '/mcp/light')).toBe('light');
    expect(P.toolListLabel({ compact: true, pack: 'grok' }, '/mcp/grok')).toBe('grok');
    expect(P.toolListLabel({ pack: 'gas' }, '/mcp/gas')).toBe('gas');
    expect(P.toolListLabel(null, '/mcp')).toBe('full');
    expect(P.toolListLabel(null, '/mcp/claude')).toBe(null);
  });
});
