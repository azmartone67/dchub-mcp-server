// grid-taste-null-demand-asof.test.mjs — G-1016-01 (Grok, 2026-10-16).
//
// MEASURED: an anonymous get_grid_intelligence region_id=MISO returned the free
// taste with headline demand_mw = null and as_of 2026-10-16T04:00Z (the fuel-mix
// hour, ~11h old), while the cite read as today's date. The backend's live EIA-930
// demand read had failed for that request (main.py _grid_intel_fetch: a failed
// region-data call leaves demand_mw / demand_period / demand_24h unset and stores
// eia_demand_error), so shapeGridIntelligence fell back to as_of =
// generation_mix_period, and the taste stamped a day-only "as of 2026-10-16" over
// a null headline: on the same calendar day, that reads as "as of today".
//
// WHAT THIS PINS (anonymous seat, real /mcp handler over loopback, stub backend)
//   * a null demand never ships as the headline when another MEASURED figure is in
//     the payload: the headline falls back to the fuel-mix share, names what it
//     fell back from and why, and carries the fuel-mix hour as its own as_of;
//   * every cite on the result (taste.cite_as, top-level cite_as) carries the real
//     as_of to the hour — "2026-10-16T04:00Z" — never a bare day that reads as today;
//   * with NO measured figure at all, the headline as_of is null and the basis
//     says why, and the cite carries no data date;
//   * the healthy path (demand present) is unchanged: demand is the headline and the
//     cite names the demand hour.
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

const SECRET = 'test-internal-key-not-a-real-secret';
const TODAY = new Date().toISOString().slice(0, 10);
// The fuel-mix hour is pinned to TODAY so a day-only cite is indistinguishable from
// "as of today" — exactly the live shape (04Z on the day it was read).
const MIX_PERIOD = `${TODAY}T04`;
const MIX = { COL: { mw: 20110 }, NG: { mw: 25990 }, NUC: { mw: 11800 }, OTH: { mw: 400 },
  SUN: { mw: 0 }, WAT: { mw: 600 }, WND: { mw: 14200 } };
// The backend shape when the EIA demand call fails: no demand fields, the error string, the mix.
const GI_NO_DEMAND = {
  region: 'MISO', rto_code: 'MISO',
  eia_demand_error: 'ReadTimeout: HTTPSConnectionPool(host=api.eia.gov): Read timed out. (read timeout=8)',
  generation_mix: MIX, generation_mix_period: MIX_PERIOD,
  provenance: { source: 'EIA-930 hourly RTO/BA feed (MISO) + DC Hub grid intelligence', as_of: `${MIX_PERIOD}:00:00Z` },
};
const GI_NOTHING = { region: 'SPP', rto_code: 'SWPP', eia_demand_error: 'HTTP 503', eia_mix_error: 'HTTP 503' };
const GI_HEALTHY = {
  region: 'PJM', rto_code: 'PJM', demand_mw: 95021, demand_period: `${TODAY}T17`,
  generation_mix: MIX, generation_mix_period: MIX_PERIOD,
  demand_24h: [{ period: `${TODAY}T17`, mw: 95021 }, { period: `${TODAY}T16`, mw: 94000 }],
  provenance: { source: 'EIA-930 hourly RTO/BA feed (PJM) + DC Hub grid intelligence', as_of: `${MIX_PERIOD}:00:00Z` },
};
const CMP = { isos: [
  { iso: 'MISO', iso_name: 'MISO', avg_constraint: 41.0, avg_excess: 44.0, market_count: 20, build_count: 2,
    latest_computed_at: `${TODAY}T18:29:50Z` },
  { iso: 'SPP', iso_name: 'SPP', avg_constraint: 38.0, avg_excess: 52.0, market_count: 9, build_count: 1,
    latest_computed_at: `${TODAY}T18:29:50Z` },
  { iso: 'PJM', iso_name: 'PJM', avg_constraint: 49.2, avg_excess: 28.8, market_count: 64, build_count: 0,
    latest_computed_at: `${TODAY}T18:29:50Z` },
] };

let S, PORT, httpServer, stub, prevBase, prevSecret, prevFlag, prevIsError;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') return send({ valid: false, tier: 'free' });
      if (p === '/api/v1/keys/auto-mint') return send({ ok: false });
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/grid/intelligence/MISO') return send(GI_NO_DEMAND);
      if (p === '/api/v1/grid/intelligence/SPP') return send(GI_NOTHING);
      if (p === '/api/v1/grid/intelligence/PJM') return send(GI_HEALTHY);
      if (p === '/api/v1/dcpi/iso-comparison') return send(CMP);
      if (p === '/api/v1/interconnection-queue/snapshot') return send({ by_iso: [] });
      if (p.startsWith('/api/v1/grid/extended/')) return send({ available: false });
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevFlag = process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
  delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;   // default ON: the taste path
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY', prevFlag);
  restore('DCHUB_PREVIEW_ISERROR', prevIsError);
  restore('DCHUB_INTERNAL_KEY', prevSecret);
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  restore('DCHUB_API_BASE', prevBase);
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}

let ipN = 40;
async function anonCall(args) {
  const h0 = { 'x-forwarded-for': `203.0.113.${ipN++}` };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } });
  const h = { ...h0, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'get_grid_intelligence', arguments: args } });
  const result = JSON.parse(body).result || {};
  return { result, sc: result.structuredContent || {}, text: (result.content || []).map((c) => c.text || '').join('\n') };
}

// Every string on the result that reads "as of <date>": the cites an agent quotes.
function asOfPhrases(o) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') { for (const m of v.matchAll(/as of (\d{4}-\d{2}-\d{2}[^\s,;)"]*)/g)) out.push(m[1]); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(o);
  return out;
}

describe('G-1016-01: grid taste with no demand reading', () => {
  it('MISO, demand read failed: headline falls back to the measured fuel-mix share with its own hour', async () => {
    const { sc, text } = await anonCall({ region_id: 'MISO' });
    expect(sc.taste, text.slice(0, 600)).toBeTruthy();
    const h = sc.taste.headline;
    expect(h.value, 'the headline must not be a null demand when a measured share is present').not.toBeNull();
    expect(h.name).toBe('renewable_share_pct');
    expect(h.unit).toBe('%');
    expect(h.fallback_from).toBe('demand_mw');
    expect(h.as_of).toBe(`${MIX_PERIOD}:00Z`);
    expect(h.window).toBe(MIX_PERIOD);
    expect(h.basis).toMatch(/demand/i);
    expect(h.basis).toMatch(/did not return|failed|absent/i);
  });

  it('MISO: every cite carries the real as_of to the hour, never a bare day that reads as today', async () => {
    const { sc } = await anonCall({ region_id: 'MISO' });
    expect(sc.taste.cite_as).toContain(`as of ${MIX_PERIOD}:00Z`);
    expect(typeof sc.cite_as).toBe('string');
    expect(sc.cite_as).toContain(`as of ${MIX_PERIOD}:00Z`);
    expect(sc.citation.cite_as).toContain(`as of ${MIX_PERIOD}:00Z`);
    expect(sc.citation.cite_as).toMatch(/PARTIAL/);
    const phrases = asOfPhrases({ taste: sc.taste, cite_as: sc.cite_as, citation: sc.citation });
    expect(phrases.length).toBeGreaterThan(0);
    for (const p of phrases) expect(p, `cite "as of ${p}" must carry the hour`).not.toBe(TODAY);
  });

  it('no measured figure at all: headline as_of null, basis says why, cite carries no data date', async () => {
    const { sc, text } = await anonCall({ region_id: 'SPP' });
    expect(sc.taste, text.slice(0, 600)).toBeTruthy();
    const h = sc.taste.headline;
    expect(h.value).toBeNull();
    expect(h.as_of).toBeNull();
    expect(h.basis).toMatch(/^UNMEASURED/);
    expect(sc.taste.cite_as).not.toMatch(/as of \d{4}/);
    expect(sc.cite_as).not.toMatch(/as of \d{4}/);
    expect(sc.citation.cite_as).not.toMatch(/as of \d{4}/);
  });

  it('healthy path unchanged: demand is the headline and the cite names the demand hour', async () => {
    const { sc } = await anonCall({ region_id: 'PJM' });
    expect(sc.taste.headline).toMatchObject({ name: 'demand_mw', value: 95021, unit: 'MW', window: `${TODAY}T17` });
    expect(sc.taste.headline.fallback_from).toBeUndefined();
    expect(sc.taste.cite_as).toContain(`as of ${TODAY}T17:00Z`);
    expect(sc.cite_as).toContain(`as of ${TODAY}T17:00Z`);
  });

  it('made no off-loopback connection', () => {
    expect(foreign).toEqual([]);
  });
});
