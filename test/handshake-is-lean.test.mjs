// handshake-is-lean.test.mjs — Grok audit 2026-10-06, item 7.
// Before: initialize instructions 14,161 chars; tools/list 458,152 bytes (466,537 with the MPP rail on);
// claim_free_key reply ~18 KB with every client's snippet. Now: instructions under 2,000 chars with the
// long form served as the resource dchub://instructions; a shorter tools/list; and claim_free_key leads
// with the key and the one snippet for the client named in clientInfo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const KEY = 'dch_live_' + 'a1b2c3d4'.repeat(4);
let S, stub, srv, PORT;
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prev = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/keys/claim') { res.end(JSON.stringify({ success: true, api_key: KEY, tier: 'free', reused: false })); return; }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { srv = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = srv.address().port;
});
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json, bytes: Buffer.byteLength(raw) };
}
async function open(clientName) {
  const init = await post({}, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  const h = { 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { h, instructions: JSON.parse(init.json).result.instructions };
}
async function claim(clientName, args = {}) {
  const { h } = await open(clientName);
  const r = await post(h, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'claim_free_key', arguments: { client_name: 'agent-x', ...args } } });
  return { result: JSON.parse(r.json).result, bytes: r.bytes };
}

describe('initialize instructions', () => {
  it('are under 2,000 chars, keep the essentials, and point at the full guide', async () => {
    const { instructions } = await open('lean-test');
    expect(instructions.length).toBeLessThan(2000);
    for (const need of ['execute_plan', 'claim_free_key', 'for_your_human', 'unlock_more_data', 'source_capacity', 'FREE TIER', 'dchub://instructions']) {
      expect(instructions, need).toContain(need);
    }
    expect(instructions).toContain('7-day Pro trial');
    expect(instructions).not.toMatch(/\$\d/);          // no price on a Pro mention in the handshake
  });
  it('the long form is the resource dchub://instructions and keeps what moved out', async () => {
    const { h } = await open('lean-test');
    const r = await post(h, { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'dchub://instructions' } });
    const text = JSON.parse(r.json).result.contents[0].text;
    expect(text.length).toBeGreaterThan(10000);
    expect(text).toContain('LIVENESS IS THE PRODUCT');
    expect(text).toContain('IN SCOPE');
  });
  it('the full text is still exported for the canon fences', () => {
    expect(S._INSTRUCTIONS.length).toBeGreaterThan(10000);
    expect(S._INSTRUCTIONS_LEAN.length).toBeLessThan(2000);
  });
});

describe('tools/list', () => {
  it('is smaller than the 2026-10-06 baseline (458,152 bytes) by at least 8%', async () => {
    const { h } = await open('lean-test');
    const r = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(JSON.parse(r.json).result.tools.length).toBeGreaterThan(80);
    expect(r.bytes).toBeLessThan(458152 * 0.92);
  });
  it('the shared output envelope is terse (it is repeated on ~80 tools)', async () => {
    const { h } = await open('lean-test');
    const r = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = JSON.parse(r.json).result.tools;
    const generic = tools.filter((t) => JSON.stringify(t.outputSchema).includes('DC Hub envelope'));
    expect(generic.length).toBeGreaterThan(60);
    expect(JSON.stringify(generic[0].outputSchema).length).toBeLessThan(1700);
  });
});

describe('claim_free_key', () => {
  it('leads with the key, then the snippet for the client named in clientInfo', async () => {
    const { result } = await claim('Claude Desktop');
    const text = result.content[0].text;
    const iKey = text.indexOf('**Your key:**'), iSnip = text.indexOf('**Save it for Claude Desktop**');
    expect(iKey).toBeGreaterThan(-1);
    expect(iSnip).toBeGreaterThan(iKey);
    expect(text.indexOf('```')).toBeGreaterThan(iSnip);
    expect(text).toContain(KEY);
    const pc = result.structuredContent.persist_config;
    expect(Object.keys(pc.clients)).toEqual(['claude_desktop']);
    expect(pc.for_your_client.client).toBe('claude_desktop');
    expect(pc.other_clients).toBe('https://dchub.cloud/connect');
  });
  it('a different client gets its own snippet, not Claude Desktop\'s', async () => {
    const { result } = await claim('cursor-vscode-extension');
    const pc = result.structuredContent.persist_config;
    expect(Object.keys(pc.clients)).toEqual(['cursor']);
    expect(result.content[0].text).toContain('**Save it for Cursor**');
  });
  it('an unrecognised client keeps the full block, and the recognised reply is smaller', async () => {
    const known = await claim('Claude Desktop');
    const unknown = await claim('acme-siting-bot');
    expect(Object.keys(unknown.result.structuredContent.persist_config.clients).length).toBeGreaterThanOrEqual(8);
    expect(unknown.result.content[0].text).not.toContain('**Save it for ');
    // 0.8 before #779 (the Claude Desktop entry gained a launcher note and connector_url, ~400 bytes).
    expect(known.bytes).toBeLessThan(unknown.bytes * 0.88);
  });
});
