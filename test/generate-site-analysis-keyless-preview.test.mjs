// generate_site_analysis keyless preview (owner 2026-10-14): verdict band + power band from the cheap
// score call, the other factors and the shareable report named as locked; no score, no report link.
// Kill switch DCHUB_REPORT_KEYLESS_PREVIEW=0 restores the plain wall.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const SITE = { success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, fiber_connectivity: 95.4, market_conditions: 60.6, risk_resilience: 72.2 },
  nearby: { facilities_100km: 685, substations_50km: 212 }, interpretation: 'Excellent site', source: 'DC Hub' };
const REPORT = { ok: true, lat: 33.45, lon: -112.07, survey: { verdict: 'BUILD', power: { headroom_mw: 350.5 } },
  pdf_report_url: 'https://dchub.cloud/report?sig=SECRET_REPORT_SIG', deliverable: 'Branded 5-page PDF' };
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_SITE_EMAIL_UNLOCK', 'DCHUB_REPORT_KEYLESS_PREVIEW'];
const prev = {};
let httpServer, stub, PORT, S;
beforeAll(async () => {
  for (const k of ENV) prev[k] = process.env[k];
  await new Promise((r) => {
    stub = createServer((req, res) => { req.resume(); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const p = req.url.split('?')[0];
      if (p === '/api/site-score') return res.end(JSON.stringify(SITE));
      if (p === '/api/v1/site-report') return res.end(JSON.stringify(REPORT));
      res.end('{}'); }); });
    stub.listen(0, '127.0.0.1', r);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'report-preview-test';
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
    'user-agent': 'claude-user', 'x-forwarded-for': '198.51.100.' + (60 + (n++ % 190)) };
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

describe('_reportTeaser', () => {
  it('bands the verdict and power, names the locked factors and the report', () => {
    const t = S._reportTeaser(SITE);
    expect(['BUILD', 'CAUTION', 'AVOID']).toContain(t.verdict);
    expect(t.locked).toEqual(S.REPORT_TEASER_LOCKED);
    expect(t.locked).toContain('shareable_report');
    expect(JSON.stringify(t)).not.toMatch(/83\.7|88\.1|95\.4/);
  });
  it('null for no answer or a failure', () => {
    expect(S._reportTeaser(null)).toBeNull();
    expect(S._reportTeaser({ success: false })).toBeNull();
    expect(S._reportTeaser({ success: true })).toBeNull();
  });
});

describe('keyless wall, end to end', () => {
  it('returns the teaser and leaks no score, figure or report link', async () => {
    delete process.env.DCHUB_REPORT_KEYLESS_PREVIEW;
    const r = await call('generate_site_analysis', { lat: 33.45, lon: -112.07, capacity_mw: 50 });
    const sc = r.structuredContent;
    expect(['BUILD', 'CAUTION', 'AVOID']).toContain(sc.site_teaser.verdict);
    expect(sc.site_teaser.locked).toContain('shareable_report');
    expect(sc.next_tool).toBe('claim_free_key');
    const all = JSON.stringify(r);
    for (const leak of ['83.7', '88.1', '95.4', '350.5', 'SECRET_REPORT_SIG', 'Branded 5-page']) expect(all).not.toContain(leak);
  });
  it('kill switch restores the plain wall', async () => {
    process.env.DCHUB_REPORT_KEYLESS_PREVIEW = '0';
    const r = await call('generate_site_analysis', { lat: 33.45, lon: -112.07, capacity_mw: 50 });
    expect(r.structuredContent.site_teaser).toBeUndefined();
    expect(r.structuredContent.error).toBe('pro_required');
  });
});
