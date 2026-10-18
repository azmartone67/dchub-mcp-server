// find-sites-target-mw-e2e.test.mjs — Grok 2026-10-18 P0-2, through the REAL /mcp HTTP path.
// find_sites does not declare target_mw (the /mcp/chatgpt catalog is frozen, tools/list is size-guarded),
// so zod strips it. The call-time hook must still carry it to the handler so the answer reports it as
// unapplied instead of reading as if it had been sized to it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, httpServer, stub, PORT, prevBase;
const BACKEND = { success: true, count: 2, candidates: [
  { anchor: { type: 'substation', name: 'UNKNOWN302688', kv_band: '500 kV+' }, lat: 30.3, lon: -93.7, site_ref: 'site_a' },
  { anchor: { type: 'substation', name: 'Real Sub', kv_band: '345 kV' }, lat: 31.1, lon: -94.1, site_ref: 'site_b' }],
  unapplied_constraints: [] };

async function call(args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_sites', arguments: args } }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  const j = JSON.parse(body);
  return JSON.parse(j.result.content[0].text);
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { req.resume(); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(req.url.startsWith('/api/v1/sites/find') ? JSON.stringify(BACKEND) : '{}');
    }); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

describe('find_sites over real /mcp', () => {
  it('target_mw reaches the handler and is reported unapplied', async () => {
    const out = await call({ state: 'TX', target_mw: 100 });
    expect(out.unapplied_constraints).toContain('target_mw');
    expect(out.unapplied_constraints_warning).toMatch(/not sized/);
  });
  it('without target_mw nothing is reported unapplied', async () => {
    const out = await call({ state: 'TX' });
    expect(out.unapplied_constraints || []).not.toContain('target_mw');
  });
  it('the hint of one call does not leak into the next', async () => {
    await call({ state: 'TX', target_mw: 100 });
    const out = await call({ state: 'OH' });
    expect(out.unapplied_constraints || []).not.toContain('target_mw');
  });
  it('an UNKNOWN* anchor name is not served', async () => {
    const out = await call({ state: 'TX' });
    const names = (out.candidates || []).map((c) => c.anchor && c.anchor.name);
    expect(names.some((n) => /^UNKNOWN/i.test(String(n)))).toBe(false);
  });
});
