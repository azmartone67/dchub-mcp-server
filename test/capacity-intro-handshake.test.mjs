// capacity-intro-handshake.test.mjs — capacity handoff item 5 (owner 2026-11-11, "Yes, add it"), retired by
// option A (owner 2026-11-16): the handshake's Capacity Source copy is the teaser only.
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

// Option A (owner 2026-11-16): the clause is gone. The served /mcp, /mcp/grok and pack handshakes carry the
// Capacity Source teaser only, no register prompt, and no price / credit / free-key / calls-per-day wording.
const BANNED = [/\d[\d,]*\s+(?:API\s+)?credits?\b/i, /calls?\/day/i, /free key/i, /free Land & Power/i, /fee only on close/i, /\$\d/];
describe('/mcp handshake: Capacity Source teaser only, neutral connect line (option A)', () => {
  it.each(['/mcp', '/mcp/grok', '/mcp/site'])('%s: teaser, no register clause, no banned wording, under the 2,048 budget', (p) => {
    const t = served[p];
    expect(typeof t).toBe('string');
    expect(t).toContain('New data center capacity listings are coming soon: query them with source_capacity, or browse https://dchub.cloud/listings.');
    expect(t).toContain('More detail is available at dchub.cloud/connect.');
    expect(t).not.toMatch(/request_capacity_intro|listings#list-capacity|CAPACITY SOURCE ROUTING/);
    expect(BANNED.filter((re) => re.test(t)).map(String)).toEqual([]);
    expect(t.length).toBeLessThanOrEqual(2048);
  });

  it('the old clause exports are gone', () => {
    expect(S.INSTR_CAPACITY_INTRO).toBeUndefined();
    expect(S._withCapacityIntroClause).toBeUndefined();
  });
});
