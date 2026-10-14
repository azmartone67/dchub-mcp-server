// get_composite_site_score keyless preview (owner 2026-10-14): verdict band + power band, the other
// factors named as locked, no score / sub-score / coverage map. Kill switch restores the plain wall.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const COMPOSITE = { success: true, location: { lat: 33.45, lng: -112.07, state: 'AZ' }, composite_score: 76.4,
  verdict: 'BUILD', confidence: 'conditional', coverage_ratio: '3/5',
  coverage: { power_grid: 'validated', fiber: 'validated', water: 'unavailable' },
  sub_scores: { power_grid: { score: 88.1, coverage: 'validated' }, fiber: { score: 61.2, coverage: 'validated' } },
  caveats: ['SECRET_CAVEAT_TEXT'] };
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_SITE_EMAIL_UNLOCK', 'DCHUB_COMPOSITE_KEYLESS_PREVIEW'];
const prev = {};
let httpServer, stub, PORT, S;
beforeAll(async () => {
  for (const k of ENV) prev[k] = process.env[k];
  await new Promise((r) => {
    stub = createServer((req, res) => { req.resume(); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const p = req.url.split('?')[0];
      if (p === '/api/v1/site-planner/composite-score') return res.end(JSON.stringify(COMPOSITE));
      res.end('{}'); }); });
    stub.listen(0, '127.0.0.1', r);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'composite-preview-test';
  process.env.DCHUB_SITE_EMAIL_UNLOCK = '0';
  S = await import('../server.mjs');
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
    'user-agent': 'claude-user', 'x-forwarded-for': '198.51.100.' + (30 + (n++ % 200)) };
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

describe('_compositeTeaser', () => {
  it('bands the verdict and the power grid, names the locked factors', async () => {
    const t = S._compositeTeaser(COMPOSITE);
    expect(['BUILD', 'CAUTION', 'AVOID']).toContain(t.verdict);
    expect(t.locked).toEqual(S.COMPOSITE_TEASER_LOCKED);
    expect(JSON.stringify(t)).not.toMatch(/76\.4|88\.1|61\.2/);
  });
  it('null for no answer, a failure, or nothing bandable', () => {
    expect(S._compositeTeaser(null)).toBeNull();
    expect(S._compositeTeaser({ success: false })).toBeNull();
    expect(S._compositeTeaser({ success: true, composite_score: null, sub_scores: {} })).toBeNull();
  });
  it('an unvalidated power grid is not banded', () => {
    const t = S._compositeTeaser({ composite_score: 80, sub_scores: { power_grid: { score: 10, coverage: 'unavailable' } } });
    expect(t.power_grid).toBeNull();
  });
});

describe('keyless wall, end to end', () => {
  it('returns the teaser and leaks no score, sub-score, coverage or caveat', async () => {
    delete process.env.DCHUB_COMPOSITE_KEYLESS_PREVIEW;
    const r = await call('get_composite_site_score', { lat: 33.45, lon: -112.07, state: 'AZ' });
    const sc = r.structuredContent;
    expect(sc.site_teaser.verdict).toBe('BUILD');
    expect(sc.site_teaser.locked).toContain('composite_score');
    expect(sc.next_tool).toBe('claim_free_key');
    const all = JSON.stringify(r);
    for (const leak of ['76.4', '88.1', '61.2', 'SECRET_CAVEAT_TEXT', 'coverage_ratio', 'sub_scores']) expect(all).not.toContain(leak);
  });
  it('kill switch restores the plain wall', async () => {
    process.env.DCHUB_COMPOSITE_KEYLESS_PREVIEW = '0';
    const r = await call('get_composite_site_score', { lat: 33.45, lon: -112.07, state: 'AZ' });
    expect(r.structuredContent.site_teaser).toBeUndefined();
    expect(r.structuredContent.error).toBe('pro_required');
  });
});
