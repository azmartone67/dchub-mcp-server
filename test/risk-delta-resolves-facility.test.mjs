// get_facility_risk_delta resolves a facility id the way get_facility does (2026-10-30).
//
// The backend /api/v1/facility-risk-delta matches only a numeric id or canonical_slug.
// get_facility also resolves other slugs, including the example its own description
// advertises (equinix-dc1-ashburn -> 9465, measured live 10-30). So the chain
// get_facility -> get_facility_risk_delta on the SAME id answered, then 400'd
// no_market_context: 4 of the 5 errored trials in the 10-30 trial export did exactly that.
// The stub below mirrors production: risk-delta knows only '9465', the facility route
// resolves the slug to 9465 and 404s an unknown one. NO real network.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer as httpServer } from 'node:http';

let S, stub, srv, PORT, hits = [];
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prev = {};

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = httpServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      hits.push({ path: u.pathname, facility_id: u.searchParams.get('facility_id'), market: u.searchParams.get('market') });
      res.setHeader('content-type', 'application/json');
      if (u.pathname === '/api/v1/facility-risk-delta') {
        const fid = u.searchParams.get('facility_id') || '';
        if (fid === '9465' || u.searchParams.get('market')) {
          res.end(JSON.stringify({ _entity: 'risk_delta', facility: { id: 9465 }, dcpi_market_health: { direction: 'flat' } })); return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'no_market_context', message: 'Provide facility_id (resolvable to a market) or market=' }));
        return;
      }
      if (u.pathname === '/api/v1/facilities/equinix-dc1-ashburn') { res.end(JSON.stringify({ id: 9465, name: 'Equinix DC1 Ashburn', city: 'Ashburn' })); return; }
      if (u.pathname.startsWith('/api/v1/facilities/')) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Facility not found' })); return; }
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
}, 60000);
afterEach(() => { hits = []; });
afterAll(async () => {
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r));
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, msg: json.trim() ? JSON.parse(json) : null };
}
async function open() {
  const init = await post({}, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'risk-delta-test', version: '1' } } });
  const h = { 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return h;
}
async function riskDelta(args) {
  const h = await open();
  const r = (await post(h, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_facility_risk_delta', arguments: args } })).msg.result;
  return { r, text: r.content.map((c) => c.text || '').join(' ') };
}
const deltaCalls = () => hits.filter((x) => x.path === '/api/v1/facility-risk-delta');

describe('get_facility_risk_delta facility resolution', () => {
  it('★ the slug get_facility advertises answers, via its numeric id', async () => {
    const { r, text } = await riskDelta({ facility_id: 'equinix-dc1-ashburn' });
    expect(text).toMatch(/dcpi_market_health/);
    expect(text).not.toMatch(/no_market_context/);
    expect(r.isError).not.toBe(true);
    expect(deltaCalls().map((x) => x.facility_id)).toEqual(['equinix-dc1-ashburn', '9465']);
  });

  it('a directly resolvable id takes one backend call, no facility lookup', async () => {
    const { text } = await riskDelta({ facility_id: '9465' });
    expect(text).toMatch(/dcpi_market_health/);
    expect(deltaCalls()).toHaveLength(1);
    expect(hits.some((x) => x.path.startsWith('/api/v1/facilities/'))).toBe(false);
  });

  it('an unknown id still returns the backend error, with no retry', async () => {
    const { text } = await riskDelta({ facility_id: 'no-such-facility' });
    expect(text).toMatch(/no_market_context/);
    expect(deltaCalls()).toHaveLength(1);
  });

  it('market= is passed through untouched and never triggers a facility lookup', async () => {
    const { text } = await riskDelta({ market: 'northern-virginia' });
    expect(text).toMatch(/dcpi_market_health/);
    expect(hits.some((x) => x.path.startsWith('/api/v1/facilities/'))).toBe(false);
    expect(deltaCalls()[0].market).toBe('northern-virginia');
  });
});
