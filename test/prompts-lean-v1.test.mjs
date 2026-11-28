// prompts-lean-v1.test.mjs: A3 (owner course-correct 2026-11-21), DCHUB_PROMPTS_LEAN_V1.
//
// Light-list clients get five prompts, ask-dc-hub first; every older prompt name still resolves on prompts/get; other
// clients' prompts/list is unchanged; a prompts/get row carries the caller's client. Real handler over HTTP, local stub
// backend (which also records /api/v1/mcp/track rows), no network.
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

const FLAG = 'DCHUB_PROMPTS_LEAN_V1';
const tracked = [];
let S, LP, PORT, httpServer, stub, prevBase;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url.startsWith('/api/v1/mcp/track')) {
          try { tracked.push(JSON.parse(b || '{}')); } catch (_) {}
          res.end('{"ok":true}');
          return;
        }
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
  LP = await import('../lib/lean-prompts.mjs');
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

async function session(name, { ua = 'node', path = '/mcp' } = {}) {
  const init = await post(path, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1.0' } } }, { 'user-agent': ua });
  const sid = init.headers.get('mcp-session-id');
  const h = { 'user-agent': ua, ...(sid ? { 'mcp-session-id': sid } : {}) };
  await post(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  return {
    sid,
    list: async () => ((await post(path, { jsonrpc: '2.0', id: 2, method: 'prompts/list', params: {} }, h)).json?.result?.prompts || []),
    get: async (pn, args = {}) => (await post(path, { jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: pn, arguments: args } }, h)).json,
  };
}

const LEAN = ['ask-dc-hub', 'site', 'market', 'grid-and-queue', 'what-changed'];
const OLD = ['analyze-site', 'pick-a-market', 'power-availability', 'site-report', 'compare-markets', 'fiber-plan',
  'market_selection', 'grid_and_queue', 'water_risk', 'whats_changed', 'site_analysis', 'fiber_power_pairing', 'hyperscaler_activity'];
const BANNED = /\$\s?\d|\/mo\b|per month|per day|calls?\/day|\bPro\b|Developer plan|Enterprise|Team plan|free tier|trial|90%|\/mcp\/(core|oauth|connect|light)|chatgpt|openai|gemini|copilot|cursor/i;
const tick = () => new Promise((r) => setTimeout(r, 150));

describe('A3: lean prompts for light-list clients (flag on)', () => {
  it('prompts/list for github-copilot-developer, codex-mcp-client and cursor-vscode returns 5, ask-dc-hub first', async () => {
    process.env[FLAG] = '1';
    for (const name of ['github-copilot-developer', 'codex-mcp-client', 'windsurf-client']) {
      const s = await session(name);
      expect(s.sid, name).toBeTruthy();
      const prompts = await s.list();
      expect(prompts.map((p) => p.name), name).toEqual(LEAN);
    }
  });

  it('a UA-identified CLI (Clono, Copilot CLI) and /mcp/light get the same five', async () => {
    process.env[FLAG] = '1';
    for (const [n, o] of [['mcp', { ua: 'Clono (+https://clono.sh)' }], ['mcp', { ua: 'copilot-cli/1.0.34' }], ['x', { path: '/mcp/light' }]]) {
      expect((await (await session(n, o)).list()).map((p) => p.name), JSON.stringify(o)).toEqual(LEAN);
    }
  });

  it('every lean description spells out Data Center Power Index (DCPI), and none carries a price, plan, limit or other URL', async () => {
    process.env[FLAG] = '1';
    const prompts = await (await session('codex-mcp-client')).list();
    for (const p of prompts) {
      expect(p.description, p.name).toContain('Data Center Power Index (DCPI)');
      expect(p.description.replace(/Data Center Power Index \(DCPI\)/g, ''), p.name).not.toMatch(/DCPI/);
      expect(`${p.title} ${p.description}`, p.name).not.toMatch(BANNED);
    }
    expect(prompts[0].arguments).toEqual([expect.objectContaining({ name: 'question', required: true })]);
  });

  it('ask-dc-hub passes the user\'s question to execute_plan unchanged', async () => {
    process.env[FLAG] = '1';
    const s = await session('github-copilot-developer');
    const qn = 'Can I put a 200 MW AI campus in Dallas?';
    const r = await s.get('ask-dc-hub', { question: qn });
    const text = r.result.messages[0].content.text;
    expect(text).toMatch(/^Call the DC Hub execute_plan tool with intent set to this question, unchanged: "Can I put a 200 MW AI campus in Dallas\?"/);
    expect(text).not.toMatch(BANNED);
    const missing = await s.get('ask-dc-hub', {});
    expect(missing.error, 'question is required').toBeTruthy();
  });

  it('the other four lean texts are served and start from execute_plan or a tool in the ten-tool list', async () => {
    process.env[FLAG] = '1';
    const s = await session('windsurf-client');
    const light = ['execute_plan', 'discover_tools', 'get_market_dcpi_rank', 'get_grid_intelligence', 'get_interconnection_queue',
      'search_facilities', 'find_sites', 'analyze_site', 'source_capacity', 'get_changes'];
    for (const [pn, args] of [['site', { location: '32.78,-96.80', capacity_mw: '100' }], ['market', { capacity_mw: '200' }],
      ['grid-and-queue', { iso: 'ERCOT' }], ['grid-and-queue', {}], ['what-changed', {}]]) {
      const text = (await s.get(pn, args)).result.messages[0].content.text;
      const first = /\b(execute_plan|get_[a-z_]+|analyze_site|find_sites|search_facilities|source_capacity|discover_tools)\b/.exec(text);
      expect(first && light.includes(first[1]), `${pn} ${JSON.stringify(args)}: ${first && first[1]}`).toBe(true);
      expect(text, pn).not.toMatch(BANNED);
    }
  });

  it('prompts/get still resolves every older prompt name in a lean session', async () => {
    process.env[FLAG] = '1';
    const s = await session('github-copilot-developer');
    for (const pn of OLD) {
      const r = await s.get(pn, { location: '32.78,-96.80', capacity_mw: '100', iso: 'ERCOT', markets: 'dallas,phoenix',
        from: '32.7,-96.8', to: '32.8,-96.7', market: 'dallas' });
      expect(r.error, pn).toBeUndefined();
      expect(r.result.messages[0].content.text.length, pn).toBeGreaterThan(20);
    }
  });

  it('other clients\' prompts/list is unchanged with the flag on (names, titles, descriptions, arguments)', async () => {
    for (const name of ['mcp', 'claude-ai', 'some-agent']) {
      delete process.env[FLAG];
      const off = await (await session(name)).list();
      process.env[FLAG] = '1';
      const on = await (await session(name)).list();
      expect(off.length, name).toBeGreaterThanOrEqual(13);
      expect(on, name).toEqual(off);
      expect(on.map((p) => p.name)).not.toContain('ask-dc-hub');
    }
  });

  it('CONTROL (flag off, today): a light-list client gets the full list, near-duplicates included, no ask-dc-hub', async () => {
    delete process.env[FLAG];
    const names = (await (await session('github-copilot-developer')).list()).map((p) => p.name);
    expect(names.length).toBeGreaterThanOrEqual(13);
    expect(names).toEqual(expect.arrayContaining(['analyze-site', 'site_analysis', 'pick-a-market', 'market_selection']));
    expect(names).not.toContain('ask-dc-hub');
  });
});

describe('A3: prompts/get is counted by client', () => {
  it('flag on: the recipe:<name> row carries the caller\'s platform and client name, and no session id', async () => {
    process.env[FLAG] = '1';
    tracked.length = 0;
    const s = await session('codex-mcp-client');
    await s.get('ask-dc-hub', { question: 'grid headroom in ERCOT' });
    await s.get('analyze-site', { location: '32.78,-96.80' });
    await tick();
    const rows = tracked.filter((r) => typeof r.tool === 'string' && r.tool.startsWith('recipe:'));
    expect(rows.map((r) => r.tool)).toEqual(['recipe:ask-dc-hub', 'recipe:analyze-site']);
    for (const r of rows) {
      expect(r.platform, r.tool).not.toBe('unknown');
      expect(String(r.client_name), r.tool).toMatch(/codex/i);
      expect(r.session_id, r.tool).toBeNull();
      expect(r.params._prompt_list, r.tool).toBe('lean');
    }
    tracked.length = 0;
    const f = await session('some-agent');
    await f.get('whats_changed', {});
    await tick();
    const full = tracked.filter((r) => r.tool === 'recipe:whats_changed');
    expect(full).toHaveLength(1);
    expect(full[0].client_name).toMatch(/some-agent/);
    expect(full[0].params._prompt_list).toBe('full');
  });

  it('CONTROL (flag off, today): the same row has platform unknown and no client name', async () => {
    delete process.env[FLAG];
    tracked.length = 0;
    const s = await session('codex-mcp-client');
    await s.get('analyze-site', { location: '32.78,-96.80' });
    await tick();
    const rows = tracked.filter((r) => r.tool === 'recipe:analyze-site');
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('unknown');
    expect(rows[0].client_name).toBeNull();
    expect(rows[0].params).toEqual({ location: '32.78,-96.80' });
  });
});

describe('lib/lean-prompts.mjs', () => {
  it('flag is off unless 1/true/yes/on', () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'no']) expect(LP.promptsLeanOn({ [FLAG]: v })).toBe(false);
    for (const v of ['1', 'true', 'YES', ' on ']) expect(LP.promptsLeanOn({ [FLAG]: v })).toBe(true);
  });
  it('the listing is the five, ask-dc-hub first, names disjoint from the older prompts', () => {
    expect(LP.leanPromptsListing().prompts.map((p) => p.name)).toEqual(LEAN);
    for (const n of LEAN) expect(OLD).not.toContain(n);
  });
});
