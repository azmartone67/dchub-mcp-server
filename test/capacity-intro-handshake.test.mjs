// capacity-intro-handshake.test.mjs — capacity handoff item 5 (owner 2026-11-11, "Yes, add it").
//
// The buy/lease/RFP routing clause rides the /mcp initialize handshake (the text clients keep),
// right after the CAPACITY SOURCE ROUTING sentence. /mcp only: /mcp/grok and the packs do not
// list request_capacity_intro, and /mcp/grok holds 2,000 characters. Served through the real
// HTTP app, so the per-path wiring (opts.capacityIntro) is what is graded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttp } from 'node:http';

let S, httpServer, stub, PORT, prevBase;
const served = {};
async function init(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'capacity-intro-test', version: '1' } } }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  try { return JSON.parse(body).result?.instructions; } catch (_) { return undefined; }
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createHttp((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{}'); }); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  for (const p of ['/mcp', '/mcp/grok', '/mcp/site', '/mcp/claude', '/mcp/chatgpt']) served[p] = await init(p);
}, 60_000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

describe('/mcp handshake carries the capacity intro clause', () => {
  it('/mcp says it once, right after the routing sentence, under the 2,048 budget', () => {
    const t = served['/mcp'];
    expect(typeof t).toBe('string');
    expect(t.split(S.INSTR_CAPACITY_INTRO).length - 1).toBe(1);
    expect(t).toContain('(free; fee only on close).' + S.INSTR_CAPACITY_INTRO);
    expect(t.length).toBeLessThanOrEqual(2048);
  });

  it('names the tool, the human gate and no operator contact', () => {
    expect(S.INSTR_CAPACITY_INTRO).toMatch(/`request_capacity_intro`/);
    expect(S.INSTR_CAPACITY_INTRO).toMatch(/after your human approves/);
    expect(S.INSTR_CAPACITY_INTRO).toMatch(/never contact operators directly/);
    expect(S.INSTR_CAPACITY_INTRO).not.toMatch(/\$|\bPro\b|\bplan\b/);
  });

  it.each(['/mcp/grok', '/mcp/site', '/mcp/claude', '/mcp/chatgpt'])('%s is unchanged (no clause)', (p) => {
    expect(typeof served[p]).toBe('string');
    expect(served[p]).not.toContain(S.INSTR_CAPACITY_INTRO);
  });

  it('the insert is idempotent and a no-op without its anchor', () => {
    const once = S._withCapacityIntroClause('A (free; fee only on close). B');
    expect(S._withCapacityIntroClause(once)).toBe(once);
    expect(S._withCapacityIntroClause('no anchor here')).toBe('no anchor here');
  });
});
