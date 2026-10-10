// /mcp/grok's initialize instructions state the tool count that path SERVES.
//
// Owner, 2026-09-29: the canonical lead sentence ("… ground truth on the
// physical infrastructure behind AI: 92 tools over …") reached /mcp/grok
// unchanged while its tools/list served 11. Every "<N> tools" / "<N> DC Hub
// tools" the Grok handshake states must equal the length of the Grok
// tools/list, read from the real handler, so neither side can drift alone.
// /mcp keeps the full-catalog sentence byte for byte (control below).
//
// Real handler over HTTP, local stub backend, no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const TOTAL = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8')).tools.length;
const STATED = /\b(\d+)\s+(?:DC Hub\s+)?tools\b/g;
export const statedToolCounts = (t) => [...String(t || '').matchAll(STATED)].map((m) => Number(m[1]));

let S, G, PORT, httpServer, stub, prevBase;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/api/v1/mcp/session-key')) { res.statusCode = 404; res.end('{}'); return; }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  G = await import('../lib/grok-profile.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
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
  return { headers: res.headers, json: JSON.parse(data) };
}
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok-toolcount-test', version: '1.0' } } };

describe('/mcp/grok initialize instructions state the served tool count', () => {
  it('CONTROL: the detector reads the pre-fix wording as a 92-tool claim', () => {
    expect(statedToolCounts('behind AI: 92 tools over a global data-center facility map')).toEqual([92]);
    expect(statedToolCounts('which lists 11 DC Hub tools chosen')).toEqual([11]);
    expect(statedToolCounts("11 tools (a curated subset of DC Hub's full catalog of 92) over")).toEqual([11]);
  });

  for (const path of ['/mcp/grok', '/mcp/grok/oauth']) {
    it(`${path}: every stated tool count equals the served tools/list length`, async () => {
      const auth = path.endsWith('/oauth') ? { 'x-api-key': 'dchub_test_grokcount' } : {};
      const served = (await post('/mcp/grok', LIST)).json.result.tools.length;
      expect(served).toBe(G.GROK_TOOLS.length);
      const init = await post(path, INIT, auth);
      const instr = init.json?.result?.instructions;
      if (instr === undefined) return;   // the OAuth URL may challenge; the plain path is the one pinned
      const counts = statedToolCounts(instr);
      expect(counts.length, 'the Grok handshake states its tool count').toBeGreaterThan(0);
      for (const n of counts) expect(n, instr.slice(0, 400)).toBe(served);
      expect(instr).not.toMatch(new RegExp(`\\b${TOTAL} tools\\b`));
      expect(instr).toContain(`${served} tools (a curated subset of DC Hub's full catalog of ${TOTAL})`);
    });
  }

  it('the plain /mcp/grok handshake is actually pinned (not skipped)', async () => {
    const init = await post('/mcp/grok', INIT);
    expect(typeof init.json.result.instructions).toBe('string');
    expect(init.json.result.instructions).toContain('/mcp/grok lists ');
  });

  it('CONTROL: /mcp keeps the full-catalog lead sentence unchanged', async () => {
    const init = await post('/mcp', INIT);
    const instr = init.json.result.instructions;
    // 2026-10-06 (item 7): the handshake is the lean text, which states the count once as "(N tools)";
    // the full-catalog "N tools over" sentence is in the long form, the resource dchub://instructions.
    expect(instr).toMatch(new RegExp(`\\(${TOTAL} tools\\)`));
    expect(S._INSTRUCTIONS).toMatch(new RegExp(`\\b${TOTAL} tools over\\b`));
    expect(instr).not.toContain('curated subset');
    expect(instr).toBe(S._INSTRUCTIONS_LEAN);
  });

  it('grokServedCount counts only names the catalog carries (serves short, never long)', () => {
    const all = new Set(G.GROK_TOOLS);
    expect(G.grokServedCount(all)).toBe(G.GROK_TOOLS.length);
    all.delete(G.GROK_TOOLS[0]);
    expect(G.grokServedCount(all)).toBe(G.GROK_TOOLS.length - 1);
  });
});
