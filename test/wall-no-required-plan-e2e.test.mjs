// End to end (loopback stub backend, real /mcp): the keyless wall of compare_sites and
// get_composite_site_score carries no required_plan (owner 2026-10-14), in structuredContent and in
// every JSON text block; the wall is still the wall (_wall true, error pro_required, a link).
// Non-vacuity: analyze_site's wall on the same server still carries required_plan 'pro'
// (email unlock off), so the field is present before the step runs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const SHORT = 'https://dchub.cloud/u/abcdef';
const SITE = { success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, fiber_connectivity: 95.4, market_conditions: 60.6, risk_resilience: 72.2 },
  nearby: { facilities_100km: 685, substations_50km: 212 }, interpretation: 'Excellent site', source: 'DC Hub' };
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_SITE_EMAIL_UNLOCK', 'DCHUB_COMPARE_KEYLESS_PREVIEW'];
const prev = {};
let httpServer, stub, PORT;
beforeAll(async () => {
  for (const k of ENV) prev[k] = process.env[k];
  await new Promise((r) => {
    stub = createServer((req, res) => { req.resume(); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const p = req.url.split('?')[0];
      if (p === '/api/site-score') return res.end(JSON.stringify(SITE));
      if (p === '/api/v1/relay/short') return res.end(JSON.stringify({ ok: true, url: SHORT }));
      res.end('{}'); }); });
    stub.listen(0, '127.0.0.1', r);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'wall-no-required-plan-test';
  process.env.DCHUB_SITE_EMAIL_UNLOCK = '0';
  const S = await import('../server.mjs');
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60_000);
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});
let n = 0;
async function call(name, args) {
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'user-agent': 'claude-user', 'x-forwarded-for': '198.51.100.' + (20 + (n++ % 200)) };
  const u = `http://127.0.0.1:${PORT}/mcp`;
  const init = await fetch(u, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) });
  await init.text();
  const sid = init.headers.get('mcp-session-id'); if (sid) h['mcp-session-id'] = sid;
  const res = await fetch(u, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1,
    method: 'tools/call', params: { name, arguments: args } }) });
  const raw = await res.text();
  return JSON.parse(raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw).result;
}
const jsonBlocks = (r) => r.content.map((b) => b.text || '').filter((t) => /^\s*\{/.test(t)).map((t) => { try { return JSON.parse(t); } catch (_) { return null; } }).filter(Boolean);

describe('keyless walls', () => {
  it('analyze_site still carries required_plan (control: the field exists upstream)', async () => {
    const r = await call('analyze_site', { lat: 33.45, lon: -112.07 });
    expect(r.structuredContent.required_plan).toBe('pro');
  });
  for (const [name, args] of [
    ['compare_sites', { sites: [{ lat: 33.45, lon: -112.07 }, { lat: 39.04, lon: -77.48 }] }],
    ['get_composite_site_score', { lat: 33.45, lon: -112.07, state: 'AZ' }],
  ]) {
    it(name + ' wall has no required_plan', async () => {
      const r = await call(name, args);
      const sc = r.structuredContent;
      expect(sc._wall).toBe(true);
      expect(sc.error).toBe('pro_required');
      expect(JSON.stringify(sc)).toMatch(/https:\/\/dchub\.cloud\//);
      expect('required_plan' in sc).toBe(false);
      for (const o of jsonBlocks(r)) expect('required_plan' in o).toBe(false);
    });
  }
});
