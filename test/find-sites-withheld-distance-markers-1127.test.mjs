// find-sites-withheld-distance-markers-1127.test.mjs — stability P3 (2026-11-27).
//
// ★THE BUG. For a keyless caller the backend's own find_sites preview (dchub-backend#9472) answers
// verdict_market_distance_km: null with _verdict_market_distance_km_withheld: true, and market.distance_km: null
// with market._distance_km_withheld: true, so a null reads as withheld, not unknown. The MCP handler asks the
// backend for the full view (serverView) and builds the preview itself (_coarsenFindSites); that rebuild nulled
// both distances and wrote neither marker, so structuredContent.candidates carried bare nulls.
//
// ★THE CONTRACT PINNED HERE (keyless /mcp find_sites, a backend stub serving the full-view body):
//   • a candidate whose distances were withheld carries both markers, and both distances stay null (not un-gated);
//   • a candidate with no verdict market (nothing to withhold) gets no marker;
//   • a body the backend already gated (its own markers) keeps them.
//
// Loopback only: a 127.0.0.1 backend stub, and no socket may leave loopback.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

// The backend's full-view candidate shape (routes/find_sites.py assemble_candidates, full=True). Test values;
// the 37.2 km distance is a fixture figure.
const DIST = 37.2;
const withVerdict = {
  site_ref: 'GA sub', lat: 34.7512, lon: -85.1034, coordinate_precision_km: 0.1,
  anchor: { type: 'substation', name: 'GA sub', voltage_kv: 500, kv_band: '345_plus', operator: 'Test Utility', capacity_mva: 900 },
  iso: null, verdict: 'AVOID', verdict_market: 'Chattanooga', verdict_market_distance_km: DIST,
  market: { available: true, verdict: 'AVOID', market: 'Chattanooga', slug: 'chattanooga', iso: 'TVA',
            proximity: 'market_edge', distance_km: DIST, as_of: '2026-11-26', basis: 'test basis' },
  time_to_power: { time_to_power_months: 40, time_to_power_band: 'over_36_months', as_of: '2026-11-26' },
  next_calls: [],
};
const noMarket = {
  site_ref: 'GA south', lat: 33.0011, lon: -83.0022, coordinate_precision_km: 0.1,
  anchor: { type: 'substation', name: 'GA south', voltage_kv: 230, kv_band: '230_to_344' },
  iso: null, verdict: null, verdict_market: null, verdict_market_distance_km: null,
  verdict_withheld_reason: 'no_dcpi_market_in_range',
  market: { available: false, verdict: null, reason: 'no_dcpi_market_in_range', distance_km: null },
  next_calls: [],
};
const FULL_BODY = { success: true, mode: 'state', state: 'GA', count: 2, candidates: [withVerdict, noMarket] };
// What the backend serves a keyless caller itself (full=False): already gated, its own markers set.
const GATED_BODY = { success: true, mode: 'state', state: 'TN', count: 1, _gated: true, candidates: [{
  ...withVerdict, lat: 34.8, lon: -85.1, coordinate_precision_km: 11.0, verdict_market_distance_km: null,
  _verdict_market_distance_km_withheld: true,
  market: { ...withVerdict.market, distance_km: null, _distance_km_withheld: true },
}] };

let PORT, httpServer, stub, prevBase;
beforeAll(async () => {
  stub = createServer((req, res) => {
    const u = new URL(req.url, 'http://_');
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/api/v1/sites/find') {
      return res.end(JSON.stringify(u.searchParams.get('state') === 'TN' ? GATED_BODY : FULL_BODY));
    }
    res.end('{}');
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const S = await import('../server.mjs');
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60000);
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function findSites(state) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'find-sites-marker-test/1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_sites', arguments: { state } } }),
  });
  const raw = await res.text();
  const j = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  const result = JSON.parse(j).result || {};
  return { raw, result, cands: (result.structuredContent || {}).candidates || [] };
}

describe('keyless find_sites: a withheld distance says it is withheld', () => {
  it('the MCP-built preview marks both distances withheld, keeps them null, and marks nothing it did not withhold', async () => {
    const { raw, cands } = await findSites('GA');
    expect(cands.length).toBe(2);   // non-vacuous: the candidates reached structuredContent
    const [a, b] = cands;
    expect(a.verdict_market).toBe('Chattanooga');
    expect(a.verdict_market_distance_km).toBeNull();
    expect(a._verdict_market_distance_km_withheld).toBe(true);
    expect(a.market.distance_km).toBeNull();
    expect(a.market._distance_km_withheld).toBe(true);
    expect(raw).not.toMatch(/\b37\.2\b/);   // still gated: the figure is nowhere in the response
    expect(b.verdict_market_distance_km).toBeNull();
    expect('_verdict_market_distance_km_withheld' in b).toBe(false);
    expect('_distance_km_withheld' in b.market).toBe(false);
  }, 60000);
  it('a body the backend already gated keeps its own markers', async () => {
    const { cands } = await findSites('TN');
    expect(cands.length).toBe(1);
    expect(cands[0].verdict_market_distance_km).toBeNull();
    expect(cands[0]._verdict_market_distance_km_withheld).toBe(true);
    expect(cands[0].market.distance_km).toBeNull();
    expect(cands[0].market._distance_km_withheld).toBe(true);
  }, 60000);
  it('no socket left loopback', () => { expect(foreign).toEqual([]); });
});
