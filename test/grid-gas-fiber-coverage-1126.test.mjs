// grid-gas-fiber-coverage-1126.test.mjs — (2026-11-26, owner sweep: every grid, gas and fiber
// addition the backend serves reaches a tool, without a new tool)
//
//   * get_interconnection_queue's large_load block reads the tracker for the ISO asked (it was
//     ERCOT only), and drops a tracker echo for another ISO;
//   * get_gas_intelligence carries pipeline_capacity_utilization from /api/v1/gas/pipeline-capacity
//     for the state asked, read in parallel, absent when the read fails or the state has nothing;
//   * get_fiber_readiness carries fttp_providers from /api/v1/fiber/providers?bbox= around the point,
//     absent when the read is degraded or empty.
//
// A stub backend counts its hits so a guard that did not run fails.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub;
const hits = [];
const mode = { gasCap: 'ok', fttp: 'ok' };

const GAS_CAP = {
  ok: true, type: 'FeatureCollection', units: 'Dth per gas day', basis: 'Scheduled share of operating capacity.',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-112.5, 33.3] }, properties: {
      pipeline: 'TW', kind: 'point', loc_id: '1', loc_name: 'Low Plant', county: 'MARICOPA', state: 'AZ',
      util_pct: 12.0, operating_dth: 250000, scheduled_dth: 30000, available_dth: 220000, gas_day: '2026-11-26', cycle: 'Intraday 1' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-111.9, 33.4] }, properties: {
      pipeline: 'TW', kind: 'segment', loc_id: '2', loc_name: 'Hot Segment', county: 'PINAL', state: 'AZ',
      util_pct: 96.5, operating_dth: 100000, scheduled_dth: 96500, available_dth: 3500, gas_day: '2026-11-26', cycle: 'Intraday 1' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-104, 32] }, properties: {
      pipeline: 'TW', kind: 'point', loc_id: '3', loc_name: 'Out Of State', county: 'EDDY', state: 'NM',
      util_pct: 100, operating_dth: 1, scheduled_dth: 1, available_dth: 0, gas_day: '2026-11-26', cycle: 'Intraday 1' } },
  ],
  pipelines: [
    { code: 'TW', name: 'Transwestern Pipeline', operator: 'Energy Transfer', gas_day: '2026-11-26', cycle: 'Intraday 1',
      stale: false, at_or_above_90pct: 6, most_constrained: [], source_url: 'https://example.test/tw', terms_url: 'https://example.test/tw/terms' },
    { code: 'ZZ', name: 'Elsewhere Pipeline', gas_day: '2026-11-26', stale: false },
  ],
  held: [{ code: 'EPNG', name: 'El Paso Natural Gas', reason: 'held pending the publisher\'s permission to redistribute', terms_url: 'https://example.test/k' }],
};
const FTTP = { ok: true, source: 'FCC Broadband Data Collection (fiber-to-the-premises filings)',
  providers: [{ brand: 'Verizon', locations: 439413, hexes: 3239 }, { brand: 'Lightpath', locations: 96244, hexes: 750 }] };

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      const u = new URL(req.url, 'http://_');
      if (u.pathname === '/api/v1/keys/validate') {
        res.end(JSON.stringify({ valid: true, tier: 'pro', developer_id: 'dev_cov_pro', email: 'pro@example.com' }));
        return;
      }
      if (u.pathname.startsWith('/api/v1/mcp/')) { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      hits.push({ path: u.pathname, q: u.searchParams });
      if (u.pathname.startsWith('/api/v1/gas/intelligence/')) {
        res.end(JSON.stringify({ region: 'AZ', region_name: 'Arizona', henry_hub_usd_mmbtu: 3.1, gas_access: { pipelines: 4 } }));
        return;
      }
      if (u.pathname === '/api/v1/gas/pipeline-capacity') {
        if (mode.gasCap === 'down') { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: 'db down' })); return; }
        res.end(JSON.stringify(GAS_CAP));
        return;
      }
      if (u.pathname === '/api/infrastructure/connectivity/score') {
        res.end(JSON.stringify({ score: 88, near_net_bucket: 'on-net', carrier_count: 12, carrier_data_coverage: 'confirmed' }));
        return;
      }
      if (u.pathname === '/api/v1/fiber/providers') {
        if (mode.fttp === 'degraded') { res.end(JSON.stringify({ ok: true, providers: [], degraded: true, error: 'x' })); return; }
        res.end(JSON.stringify(FTTP));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
});

async function rpc(method, params, key) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               ...(key ? { 'x-api-key': key } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return JSON.parse(json).result || {};
}
const PRO = 'dch_live_cov_pro_seat';
const bodyOf = (r) => { try { return JSON.parse((r.content || [])[0].text); } catch { return {}; } };
const call = (name, args) => rpc('tools/call', { name, arguments: args }, PRO);

describe('large-load tracker follows the ISO asked', () => {
  const was = process.env.DCHUB_QUEUE_MOAT;
  afterEach(() => { vi.unstubAllGlobals(); if (was === undefined) delete process.env.DCHUB_QUEUE_MOAT; else process.env.DCHUB_QUEUE_MOAT = was; });
  const row = { metric: 'large_load_forecast', value_mw: 32000, as_of_date: '2026-01-15', published_date: '2026-02-06',
    source_title: 'PJM doc', source_url: 'https://www.pjm.com/x.xlsx', basis: 'published' };
  const stubFetch = (echoIso) => {
    const f = vi.fn(async (url) => {
      const iso = new URL(String(url)).searchParams.get('iso');
      const body = { iso: echoIso === undefined ? iso : echoIso, rows: [row] };
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => body, text: async () => JSON.stringify(body) };
    });
    vi.stubGlobal('fetch', f); return f;
  };
  const base = { iso: 'PJM', projects: [] };

  it('asks the tracker for PJM when the question is PJM, and attaches the block under PJM', async () => {
    process.env.DCHUB_QUEUE_MOAT = '1'; const f = stubFetch();
    const out = await S._withLargeLoad(base, 'PJM');
    expect(f).toHaveBeenCalledTimes(1);
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get('iso')).toBe('PJM');
    expect(out.large_load.iso).toBe('PJM');
    expect(out.large_load.rows[0].source_url).toBe('https://www.pjm.com/x.xlsx');
  });
  it('folds ISO-NE to the tracker key ISONE; no ISO (the snapshot) stays ERCOT', async () => {
    expect(S._largeLoadTrackerIso('ISO-NE')).toBe('ISONE');
    expect(S._largeLoadTrackerIso('iso_ne')).toBe('ISONE');
    expect(S._largeLoadTrackerIso(undefined)).toBe('ERCOT');
    expect(S._largeLoadTrackerIso('')).toBe('ERCOT');
    process.env.DCHUB_QUEUE_MOAT = '1'; const f = stubFetch();
    await S._withLargeLoad(base, undefined);
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get('iso')).toBe('ERCOT');
  });
  it('a tracker echo for another ISO is dropped, never attached under the asked ISO', async () => {
    process.env.DCHUB_QUEUE_MOAT = '1'; stubFetch('ERCOT');
    expect(await S._withLargeLoad(base, 'PJM')).toBe(base);
  });
});

describe('get_gas_intelligence: pipeline capacity utilization', () => {
  it('pure block: in-state locations only, most-utilized first, held pipelines named', () => {
    const b = S._gasPipelineCapacityBlock(GAS_CAP, 'AZ');
    expect(b.state).toBe('AZ');
    expect(b.locations_in_state).toBe(2);
    expect(b.at_or_above_90pct_in_state).toBe(1);
    expect(b.most_utilized.map((x) => x.loc_name)).toEqual(['Hot Segment', 'Low Plant']);
    expect(b.pipelines.map((p) => p.code)).toEqual(['TW']);
    expect(b.not_read.map((h) => h.code)).toEqual(['EPNG']);
    expect(S._gasPipelineCapacityBlock(GAS_CAP, 'VA')).toBeNull();
    expect(S._gasPipelineCapacityBlock({ ok: false, error: 'x' }, 'AZ')).toBeNull();
    expect(S._gasStateCode('Arizona')).toBe('AZ');
    expect(S._gasStateCode('tx')).toBe('TX');
    expect(S._gasStateCode('Narnia')).toBeNull();
  });

  it('the tool reads the route for the state asked and adds the block beside the brief', async () => {
    mode.gasCap = 'ok';
    const n = hits.length;
    const out = bodyOf(await call('get_gas_intelligence', { region: 'Arizona' }));
    const cap = hits.slice(n).filter((h) => h.path === '/api/v1/gas/pipeline-capacity');
    expect(cap.length, 'the stub never saw the utilization read').toBe(1);
    expect(cap[0].q.get('state')).toBe('AZ');
    expect(out.region).toBe('AZ');
    expect(out.henry_hub_usd_mmbtu).toBe(3.1);
    expect(out.pipeline_capacity_utilization.most_utilized[0].util_pct).toBe(96.5);
  });

  it('a failed utilization read leaves the brief exactly as before', async () => {
    mode.gasCap = 'down';
    const out = bodyOf(await call('get_gas_intelligence', { region: 'AZ' }));
    mode.gasCap = 'ok';
    expect(out.region).toBe('AZ');
    expect(out.henry_hub_usd_mmbtu).toBe(3.1);
    expect(out.pipeline_capacity_utilization).toBeUndefined();
  });
});

describe('get_fiber_readiness: FCC fiber-to-the-premises providers', () => {
  it('pure bbox: radius capped at 50 km, default 25, bad coordinates refused', () => {
    const b = S._fttpBbox(39.04, -77.48, 10);
    expect(b.box_km).toBe(10);
    const [w, s, e, n] = b.bbox;
    expect(w).toBeLessThan(-77.48); expect(e).toBeGreaterThan(-77.48);
    expect(s).toBeLessThan(39.04); expect(n).toBeGreaterThan(39.04);
    expect(n - s).toBeCloseTo((2 * 10) / 111.32, 3);
    expect(S._fttpBbox(39, -77, 500).box_km).toBe(50);
    expect(S._fttpBbox(39, -77, undefined).box_km).toBe(25);
    expect(S._fttpBbox(undefined, -77, 10)).toBeNull();
    expect(S._fttpBbox(95, -77, 10)).toBeNull();
  });

  it('the tool sends a bbox around the point and adds fttp_providers beside the score', async () => {
    mode.fttp = 'ok';
    const n = hits.length;
    const out = bodyOf(await call('get_fiber_readiness', { lat: 39.04, lon: -77.48, radius_km: 20 }));
    const fp = hits.slice(n).filter((h) => h.path === '/api/v1/fiber/providers');
    expect(fp.length, 'the stub never saw the FTTP read').toBe(1);
    const [w, s, e, nn] = fp[0].q.get('bbox').split(',').map(Number);
    expect(w).toBeLessThan(-77.48); expect(e).toBeGreaterThan(-77.48);
    expect(s).toBeLessThan(39.04); expect(nn).toBeGreaterThan(39.04);
    expect(out.score).toBe(88);
    expect(out.fttp_providers.provider_count).toBe(2);
    expect(out.fttp_providers.top_providers[0].brand).toBe('Verizon');
    expect(out.fttp_providers.box_half_side_km).toBe(20);
  });

  it('a degraded FTTP read leaves the score exactly as before', async () => {
    mode.fttp = 'degraded';
    const out = bodyOf(await call('get_fiber_readiness', { lat: 39.04, lon: -77.48 }));
    mode.fttp = 'ok';
    expect(out.score).toBe(88);
    expect(out.fttp_providers).toBeUndefined();
  });
});
