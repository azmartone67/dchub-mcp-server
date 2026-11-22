// cli-returns-attribution-1118.test.mjs — Grok CLI note 2026-11-18 (owner "lets fix"), items 1-4.
//
//   1. The keyless first full execute_plan answer kept no next_tools: compactFirstPlan does not copy it and the re-add
//      loop after it did not list it, so the day's best answer carried no get_changes check-in. next_recipe was then
//      dropped by lib/plan-compact.mjs KEEP_KEYS.
//   2. A key reply gave Codex CLI no snippet and Copilot CLI the VS Code one (`servers` in .vscode/mcp.json).
//   3. The key reply's "Full access" link reached Stripe with no client_reference_id (an empty ref).
//   4. A wall's plain /connect link was counted on no channel (owner 2026-11-19: count it as mcp-wall, wall=connect).
//
// Real server on a real port (execute_plan's steps loop back through /mcp), against a backend stub.
import { unsealPayload } from '../lib/token-seal.mjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { KEEP_KEYS } from '../lib/plan-compact.mjs';
import { tagConnectValues, wallConnectTagStep, BARE_CONNECT_URL, WALL_CONNECT_URL } from '../lib/wall-connect-tag.mjs';

const SECRET = 'cli-returns-1118-internal-key-not-real';
const FAKE_KEY = 'dch_live_cli_returns_1118_not_real_0000';
const REUSED_KEY = 'dch_live_cli_returns_1118_reused_not_real_1';
let claimReply = null;   // set by a test to stub a different /keys/claim answer
const PLAN = { intent: 'Northern Virginia 100 MW data center: how is the market?' };

let S, stub, httpServer, PORT;
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://stub').pathname;
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/claim') return send(claimReply || { success: true, api_key: FAKE_KEY, daily_limit: 10 });
      if (p.startsWith('/api/v1/grid/intelligence/')) {
        return send({ iso: 'PJM', demand_mw: 92000, as_of: '2026-11-18T00:00:00Z', generation_mix: { NG: { mw: 40000 } } });
      }
      if (p.startsWith('/api/v1/interconnection-queue/')) return send({ iso: 'PJM', total_projects: 10, total_gw: 300, projects: [] });
      if (p.startsWith('/api/v1/markets/')) {
        return send({ market: 'northern-virginia', name: 'Northern Virginia', facility_count: 300, as_of: '2026-11-18' });
      }
      if (p.startsWith('/api/v1/mcp/full-cap/')) return send({ ok: false });
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  process.env.PORT = String(await freePort());
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
});

async function post(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}
let rpc = 10;
// One MCP session as `client` (clientInfo name) from `ip`; returns { init, call(name, args) }.
async function session(ip, client, { path = '/mcp', ua = 'Mozilla/5.0' } = {}) {
  const h0 = { 'x-forwarded-for': ip, 'user-agent': ua };
  const init = await post(path, h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    init: JSON.parse(init.body).result,
    call: async (name, args) => {
      const { body } = await post(path, h, { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } });
      return JSON.parse(body).result;
    },
  };
}
const daily = (sc) => (Array.isArray(sc.next_tools) ? sc.next_tools : []).find((t) => t && t.tool === 'get_changes');

describe('1) the keyless first full plan answer keeps its way back', () => {
  it('KEEP_KEYS keeps next_tools and next_recipe', () => {
    expect(KEEP_KEYS).toContain('next_tools');
    expect(KEEP_KEYS).toContain('next_recipe');
  });

  it('call 1 (first full, compact default) and call 2 (preview) both carry get_changes {window:"1d"} for the market', async () => {
    const s = await session('198.18.118.1', 'codex-mcp-client', { ua: 'codex_cli_rs/0.58.0' });
    const r1 = await s.call('execute_plan', PLAN);
    const sc1 = r1.structuredContent || {};
    expect(sc1.totals.tier_note, 'call 1 is the day\'s first full answer').toMatch(/steps ran at full depth/);
    const d1 = daily(sc1);
    expect(d1, JSON.stringify(sc1.next_tools)).toBeTruthy();
    expect(d1.args).toMatchObject({ window: '1d' });
    expect(d1.args.watchlist).toContain('northern-virginia');
    // next_recipe is in KEEP_KEYS (above) but lib/lean-response.mjs drops it from every answer while lean is on.
    const sc2 = (await s.call('execute_plan', PLAN)).structuredContent || {};
    expect(String((sc2.totals || {}).tier_note || '')).not.toMatch(/steps ran at full depth/);
    expect(daily(sc2)).toBeTruthy();
  }, 120_000);

  it('/mcp/chatgpt (frozen): the first answer has no next_tools', async () => {
    const s = await session('198.18.118.2', 'openai-mcp', { path: '/mcp/chatgpt' });
    const r = await s.call('execute_plan', PLAN);
    const sc = r.structuredContent || {};
    expect(sc.next_tools).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('get_changes');
  }, 120_000);
});

describe('2) the key reply hands each coding CLI its own snippet', () => {
  it('Codex (codex-mcp-client): a TOML table in ~/.codex/config.toml holding the key', async () => {
    const s = await session('198.18.118.3', 'codex-mcp-client', { ua: 'codex_cli_rs/0.58.0' });
    const sc = (await s.call('get_api_key', { client_name: 'guard' })).structuredContent;
    const own = sc.persist_config.for_your_client;
    expect(own.client).toBe('codex_cli');
    expect(own.file).toContain('~/.codex/config.toml');
    expect(own.snippet).toBe('[mcp_servers.dchub]\nurl = "https://dchub.cloud/mcp"\nhttp_headers = { "X-API-Key" = "' + FAKE_KEY + '" }');
  }, 60_000);

  it('Copilot CLI (github-copilot-developer): mcpServers in ~/.copilot/mcp-config.json, not the VS Code block', async () => {
    const s = await session('198.18.118.4', 'github-copilot-developer', { ua: 'copilot-cli/0.0.360' });
    const sc = (await s.call('get_api_key', { client_name: 'guard' })).structuredContent;
    const own = sc.persist_config.for_your_client;
    expect(own.client).toBe('copilot_cli');
    expect(own.file).toBe('~/.copilot/mcp-config.json');
    expect(JSON.parse(own.snippet)).toEqual({ mcpServers: { dchub: { type: 'http', url: 'https://dchub.cloud/mcp',
      headers: { 'X-API-Key': FAKE_KEY }, tools: ['*'] } } });
  }, 60_000);

  it('"Visual Studio Code" still gets the vscode block', async () => {
    const s = await session('198.18.118.5', 'Visual Studio Code');
    const sc = (await s.call('get_api_key', { client_name: 'guard' })).structuredContent;
    expect(sc.persist_config.for_your_client.client).toBe('vscode');
  }, 60_000);

  it('the light-profile handshake says get_api_key and get_changes are callable by name', async () => {
    const s = await session('198.18.118.6', 'codex-mcp-client', { ua: 'codex_cli_rs/0.58.0' });
    expect(s.init.instructions).toContain('get_api_key and get_changes are callable by name even when not listed.');
    const g = await session('198.18.118.7', 'some-generic-client');
    expect(g.init.instructions).not.toContain('callable by name even when not listed');
  }, 60_000);
});

describe('3) the key reply\'s "Full access" link is bound to the minted key', () => {
  it('its /go/c payload carries k-<sha256(key)> as the reference', async () => {
    const s = await session('198.18.118.8', 'cursor');
    const r = await s.call('get_api_key', { client_name: 'guard' });
    const text = r.content.map((b) => b.text || '').join('\n');
    const m = /Full access: (https:\/\/dchub\.cloud\/go\/c\/([A-Za-z0-9_-]+)\.[0-9a-f]+)/.exec(text);
    expect(m, 'a signed /go/c link follows "Full access:"').toBeTruthy();
    const fields = unsealPayload(m[2]).split('|');
    expect(fields[0]).toBe('developer');
    expect(fields[1]).toBe('k-' + createHash('sha256').update(FAKE_KEY).digest('hex'));
  }, 60_000);

  // Grok M1.1 (2026-11-19): when the backend dedupes the claim (reused:true) the reply returns the
  // key the caller already holds, and the link must bind THAT key, not an empty or a fresh one.
  it('a reused-key reply binds the reused key', async () => {
    claimReply = { success: true, api_key: REUSED_KEY, reused: true, daily_limit: 10 };
    try {
      const s = await session('198.18.118.9', 'cursor');
      const r = await s.call('get_api_key', { client_name: 'guard-reuse' });
      expect(r.structuredContent.reused).toBe(true);
      const text = r.content.map((b) => b.text || '').join('\n');
      const m = /Full access: (https:\/\/dchub\.cloud\/go\/c\/([A-Za-z0-9_-]+)\.[0-9a-f]+)/.exec(text);
      expect(m, 'a signed /go/c link follows "Full access:"').toBeTruthy();
      const fields = unsealPayload(m[2]).split('|');
      expect(fields[1]).toBe('k-' + createHash('sha256').update(REUSED_KEY).digest('hex'));
    } finally {
      claimReply = null;
    }
  }, 60_000);
});

describe('4) a wall\'s /connect link says it came from an MCP wall', () => {
  it('every JSON value that is the bare URL is tagged, copies included; prose and other links are not', () => {
    const o = { human_url: BARE_CONNECT_URL, for_your_human: { text: 'More detail is available at dchub.cloud/connect.', url: BARE_CONNECT_URL },
      intent_answer: { relay: { url: BARE_CONNECT_URL } }, links: [BARE_CONNECT_URL, 'https://dchub.cloud/u/abc'], note: 'see ' + BARE_CONNECT_URL };
    const t = tagConnectValues(o);
    expect(WALL_CONNECT_URL).toBe('https://dchub.cloud/connect?via=mcp-wall&wall=connect');
    expect(t.human_url).toBe(WALL_CONNECT_URL);
    expect(t.for_your_human).toEqual({ text: 'More detail is available at dchub.cloud/connect.', url: WALL_CONNECT_URL });
    expect(t.intent_answer.relay.url).toBe(WALL_CONNECT_URL);
    expect(t.links).toEqual([WALL_CONNECT_URL, 'https://dchub.cloud/u/abc']);
    expect(t.note).toBe('see ' + BARE_CONNECT_URL);
    const other = { human_url: 'https://dchub.cloud/u/abc' };
    expect(tagConnectValues(other)).toBe(other);
  });

  it('the step: the JSON block and structuredContent change by that URL only; prose blocks are byte-identical', () => {
    const sc = { answer: 'x', human_url: BARE_CONNECT_URL };
    const prose = 'More detail is available at dchub.cloud/connect. ' + BARE_CONNECT_URL;
    const r = { content: [{ type: 'text', text: prose }, { type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
    const out = wallConnectTagStep(r, { env: {} });
    expect(out.content[0].text).toBe(prose);
    expect(out.content[1].text).toBe(JSON.stringify(sc).replace(BARE_CONNECT_URL, WALL_CONNECT_URL));
    expect(out.structuredContent.human_url).toBe(WALL_CONNECT_URL);
    expect(wallConnectTagStep(r, { env: { DCHUB_WALL_CONNECT_TAG: '0' } })).toBe(r);
    expect(wallConnectTagStep(r, { skip: true, env: {} })).toBe(r);
  });

  it('live handler: a keyless preview carries no bare /connect link field; /mcp/chatgpt carries no wall tag', async () => {
    const s = await session('198.18.118.9', 'github-copilot-developer', { ua: 'copilot-cli/0.0.360' });
    await s.call('execute_plan', PLAN);
    const r = await s.call('execute_plan', PLAN);
    const all = JSON.stringify(r);
    expect(all).not.toContain('"' + BARE_CONNECT_URL + '"');
    const sc = r.structuredContent || {};
    // M1.2 (mcp#1566): with DCHUB_WALL_RELAY_URL on, the wall's link is the tagged relay page, or the tagged /connect
    // (&src=<tool>) when no relay was minted. Switched off, it is this note's tagged /connect.
    const RELAY = /^https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}\?via=mcp-wall&wall=[a-z_]+&src=[a-z_]+$/;
    if (sc.human_url && !RELAY.test(sc.human_url)) expect(sc.human_url.startsWith(WALL_CONNECT_URL), sc.human_url).toBe(true);
    process.env.DCHUB_WALL_RELAY_URL = '0';
    try {
      const off = await s.call('execute_plan', PLAN);
      const offAll = JSON.stringify(off);
      expect(offAll).not.toContain('"' + BARE_CONNECT_URL + '"');
      if ((off.structuredContent || {}).human_url) expect(off.structuredContent.human_url).toBe(WALL_CONNECT_URL);
      expect(offAll).toContain(WALL_CONNECT_URL);
    } finally { delete process.env.DCHUB_WALL_RELAY_URL; }
    const c = await session('198.18.118.10', 'openai-mcp', { path: '/mcp/chatgpt' });
    await c.call('execute_plan', PLAN);
    expect(JSON.stringify(await c.call('execute_plan', PLAN))).not.toContain('wall=connect');
  }, 120_000);
});
