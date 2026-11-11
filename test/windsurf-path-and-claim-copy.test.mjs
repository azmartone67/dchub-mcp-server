// windsurf-path-and-claim-copy.test.mjs — (2026-11-11, funnel-9 leftovers)
//
// 1. persist_config.clients.windsurf named ~/.codeium/windsurf/mcp_config.json. Windsurf's
//    Cascade now opens ~/.config/devin/mcp_config.json from its "Open MCP config file" action
//    (docs.devin.ai/windsurf/plugins/cascade/mcp); the ~/.codeium file is only the editor's
//    discovery source, so a key pasted there is not what Cascade loads.
// 2. The claude-variant high-intent line promised "a free 7-day/50-call trial key". The claim
//    link now issues the caller's free, durable key (be#8702), not a 7-day trial.
//
// Drives a real claim_free_key tools/call against a stub backend, as persist-config-vscode does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub, STUB_PORT;
let stubHits = 0;
const FAKE_KEY = 'dchub_test_key_not_real_0000';

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      stubHits += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true, api_key: FAKE_KEY, daily_limit: 10 }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  STUB_PORT = stub.address().port;
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${STUB_PORT}`;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prev;   // sibling live-network tests share this env
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
});

async function claim() {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'claim_free_key', arguments: { client_name: 'guard' } } }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  const r = JSON.parse(json).result || {};
  if (r.structuredContent) return r.structuredContent;
  try { return JSON.parse((r.content || []).map((c) => c.text || '').join('')); } catch { return {}; }
}

describe('persist_config: Windsurf names the file Cascade opens', () => {
  it('points at ~/.config/devin/mcp_config.json, not the ~/.codeium discovery file', async () => {
    const before = stubHits;
    const sc = await claim();
    expect(stubHits, 'stub never called — DCHUB_API_BASE did not take, this guard ran nothing')
      .toBeGreaterThan(before);
    const ws = sc.persist_config?.clients?.windsurf;
    expect(ws, 'no windsurf entry in persist_config.clients').toBeTruthy();
    expect(ws.file).toContain('~/.config/devin/mcp_config.json');
    expect(ws.file).not.toContain('.codeium');
    const cfg = JSON.parse(ws.snippet);
    expect(cfg.mcpServers.dchub.serverUrl).toContain('/mcp');
    expect(cfg.mcpServers.dchub.headers['X-API-Key']).toBe(FAKE_KEY);
  });
});

describe('high-intent claim line: no trial promise on a free-key link', () => {
  it('the claude variant offers a free key, not a 7-day/50-call trial', () => {
    const line = S.VARIANT_COPY.claude('get_market_intel', { count: 3, claim_url: 'https://dchub.cloud/claim/T' }, 'https://dchub.cloud/upgrade');
    expect(line).toContain('https://dchub.cloud/claim/T');
    expect(line).toContain('a free DC Hub key');
    expect(line).not.toMatch(/7-day|50-call|trial key/);
  });
});
