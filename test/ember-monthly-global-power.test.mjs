// ember-monthly-global-power.test.mjs — (2026-11-18, be#8978)
//
// get_global_power and compare_isos read dchub-backend GET /api/v1/ember/monthly
// (Ember monthly electricity data, CC BY 4.0). The backend loader is flag-off,
// so the read answers 404 until it is on. What must hold:
//
//   * get_global_power with country= carries `electricity_monthly` (newest
//     month: mix shares, demand, carbon intensity) beside the GEM plant summary,
//     with Ember's attribution, licence id and licence URL;
//   * compare_isos rows for a non-US grid that is one country's grid carry
//     `ember_monthly`, with an area_note where the country is wider than the
//     grid; US ISO rows never ask Ember;
//   * a 404 (flag off / route not deployed), a 500 or an ok:false body leaves
//     both answers exactly as they were: no Ember keys, GEM / live data intact;
//   * the attribution survives the keyless trim, not only a paid seat.
//
// A stub backend counts its hits so a guard that never reached it fails.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { shapeEmberMonthly, emberAreaForGrid, GRID_EMBER_AREA } from '../lib/ember-monthly.mjs';

let S, PORT, httpServer, stub;
const emberSeen = [];
let emberMode = 'on';   // 'on' | '404' | '500' | 'notok'

const ATTR = 'Source: Ember, Monthly Electricity Data (ember-energy.org), CC-BY-4.0. '
  + 'Changed by DC Hub: months from 2019 onward only, columns renamed, the US national total row of the state file dropped; values are Ember\'s.';
const emberBody = (code, name) => ({
  ok: true,
  area: { scope: 'global', code, name },
  months: [{ month: '2026-09', demand_twh: 21.4, generation_twh: 19.8, net_imports_twh: 1.6,
             carbon_intensity_gco2e_kwh: 121.5,
             mix: { Wind: { twh: 5.9, share_pct: 29.8 }, Gas: { twh: 6.3, share_pct: 31.8 },
                    Nuclear: { twh: 3.1, share_pct: 15.7 }, Solar: { twh: 1.2, share_pct: 6.1 } } }],
  as_of: '2026-09',
  as_of_basis: 'as_of is the newest month Ember publishes for this area; Ember revises recent months between releases',
  provenance: { source: 'Ember', source_key: 'ember', source_url: 'https://ember-energy.org/data/monthly-electricity-data/',
                license: 'CC-BY-4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/',
                terms_url: 'https://ember-energy.org/creative-commons/', attribution: ATTR,
                source_published_at: '2026-11-17T18:34:00+00:00' },
});
const units = Array.from({ length: 5 }, (_, i) => ({
  name: `Plant ${i}`, country: 'United Kingdom', fuel_type: i % 2 ? 'wind' : 'gas', capacity_mw: 100 * (i + 1),
  status: 'operating', start_year: 2000 + i,
}));

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      const u = new URL(req.url, 'http://_');
      if (u.pathname === '/api/v1/keys/validate') {
        res.end(JSON.stringify({ valid: true, tier: 'pro', developer_id: 'dev_ember_pro', email: 'pro@example.com' }));
        return;
      }
      if (u.pathname.startsWith('/api/v1/mcp/')) { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      if (u.pathname === '/api/v1/ember/monthly') {
        emberSeen.push(u.searchParams.get('area'));
        if (emberMode === '404') { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: 'Ember data is not loaded yet' })); return; }
        if (emberMode === '500') { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: 'read failed' })); return; }
        if (emberMode === 'notok') { res.end(JSON.stringify({ ok: false, error: 'x' })); return; }
        const area = u.searchParams.get('area');
        if (area === 'United Kingdom' || area === 'GBR') { res.end(JSON.stringify(emberBody('GBR', 'United Kingdom'))); return; }
        if (area === 'DEU') { res.end(JSON.stringify(emberBody('DEU', 'Germany'))); return; }
        res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: 'no Ember data for this area' }));
        return;
      }
      if (u.pathname === '/api/v1/global-power') {
        res.end(JSON.stringify({ units, total: 182000, as_of: '2026-07-01' }));
        return;
      }
      if (u.pathname.startsWith('/api/v1/grid/latest/')) {
        const code = decodeURIComponent(u.pathname.split('/').pop());
        res.end(JSON.stringify({ code, metrics: [{ metric: 'demand_mw', value: 30000, as_of: '2026-11-18T00:00:00Z' }] }));
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
const call = (name, args, key) => rpc('tools/call', { name, arguments: args }, key);
const sc = (r) => r.structuredContent
  || (() => { try { return JSON.parse((r.content || [])[0].text); } catch { return {}; } })();
const PRO = 'dch_live_ember_pro_seat';

describe('shapeEmberMonthly (pure)', () => {
  it('newest month, shares sorted, attribution from the backend provenance', () => {
    const b = shapeEmberMonthly(emberBody('GBR', 'United Kingdom'));
    expect(b.month).toBe('2026-09');
    expect(Object.keys(b.mix_share_pct)).toEqual(['Gas', 'Wind', 'Nuclear', 'Solar']);
    expect(b.carbon_intensity_gco2e_kwh).toBe(121.5);
    expect(b.attribution).toBe(ATTR);
    expect(b.license).toBe('CC-BY-4.0');
    expect(b.license_url).toBe('https://creativecommons.org/licenses/by/4.0/');
  });
  it('null on anything that is not an ok body with a month', () => {
    for (const v of [null, {}, [], { ok: false }, { error: 'API 404' }, { ok: true, months: [] }])
      expect(shapeEmberMonthly(v), JSON.stringify(v)).toBeNull();
  });
  it('the grid map leaves the US ISOs, Canadian provinces and sub-national zones out', () => {
    for (const c of ['PJM', 'ERCOT', 'IESO', 'AESO', 'HYDROQUEBEC', 'EU_IT_NORD', 'EU_DK1', 'JP_TOKYO'])
      expect(emberAreaForGrid(c), c).toBeNull();
    expect(emberAreaForGrid('ngeso').area).toBe('GBR');
    expect(GRID_EMBER_AREA.AEMO.wider).toMatch(/Western Australia/);
  });
});

describe('get_global_power + Ember', () => {
  it('country= adds electricity_monthly with the Ember licence, GEM summary intact', async () => {
    emberMode = 'on';
    const n = emberSeen.length;
    const out = sc(await call('get_global_power', { country: 'United Kingdom' }, PRO));
    expect(emberSeen.length, 'the stub never saw the Ember read — this guard ran nothing').toBe(n + 1);
    expect(emberSeen[n]).toBe('United Kingdom');
    expect(out.count).toBe(5);
    expect(out.electricity_monthly.area.code).toBe('GBR');
    expect(out.electricity_monthly.demand_twh).toBe(21.4);
    expect(out.electricity_monthly.attribution).toBe(ATTR);
    expect(out.electricity_monthly.license).toBe('CC-BY-4.0');
    expect(out.ember_attribution).toBe(ATTR);
    expect(out.source).toMatch(/GEM Global Integrated Power Tracker.*Ember Monthly Electricity Data \(CC-BY-4\.0\)/);
  });
  it('the attribution survives a keyless call', async () => {
    emberMode = 'on';
    const r = await call('get_global_power', { country: 'United Kingdom' });
    expect(JSON.stringify(r)).toContain('Source: Ember, Monthly Electricity Data');
  });
  it('no country, no Ember read', async () => {
    const n = emberSeen.length;
    const out = sc(await call('get_global_power', { fuel: 'coal' }, PRO));
    expect(emberSeen.length).toBe(n);
    expect(out).not.toHaveProperty('electricity_monthly');
  });
  for (const mode of ['404', '500', 'notok']) {
    it(`Ember ${mode}: the GEM answer exactly as before`, async () => {
      emberMode = mode;
      const n = emberSeen.length;
      const out = sc(await call('get_global_power', { country: 'United Kingdom' }, PRO));
      expect(emberSeen.length).toBe(n + 1);
      expect(out).not.toHaveProperty('electricity_monthly');
      expect(out).not.toHaveProperty('ember_attribution');
      expect(out.source).toBe('DC Hub — GEM Global Integrated Power Tracker (CC-BY, dchub.cloud)');
      expect(out.count).toBe(5);
      emberMode = 'on';
    });
  }
});

describe('compare_isos + Ember', () => {
  it('non-US country grids gain ember_monthly; US ISOs never ask Ember', async () => {
    emberMode = 'on';
    const n = emberSeen.length;
    const out = sc(await call('compare_isos', { isos: 'NGESO,EU_DE_LU,PJM' }, PRO));
    expect(emberSeen.slice(n).sort()).toEqual(['DEU', 'GBR']);
    expect(out.comparison.NGESO.ember_monthly.area.code).toBe('GBR');
    expect(out.comparison.NGESO.ember_monthly.area_note).toMatch(/Northern Ireland/);
    expect(out.comparison.EU_DE_LU.ember_monthly.area.name).toBe('Germany');
    expect(out.comparison.EU_DE_LU.ember_monthly.attribution).toBe(ATTR);
    expect(out.comparison.PJM).not.toHaveProperty('ember_monthly');
    expect(out.ember_attribution).toBe(ATTR);
    expect(out.source).toMatch(/Ember Monthly Electricity Data \(CC-BY-4\.0/);
  });
  it('the attribution survives a keyless call', async () => {
    emberMode = 'on';
    const r = await call('compare_isos', { isos: 'NGESO,EU_DE_LU' });
    expect(JSON.stringify(r)).toContain('Source: Ember, Monthly Electricity Data');
  });
  it('Ember 404 (flag off): rows exactly as before, no Ember keys', async () => {
    emberMode = '404';
    const n = emberSeen.length;
    const out = sc(await call('compare_isos', { isos: 'NGESO,EU_DE_LU' }, PRO));
    expect(emberSeen.length).toBe(n + 2);
    expect(out.comparison.NGESO).toBeDefined();
    expect(out.comparison.NGESO).not.toHaveProperty('ember_monthly');
    expect(out.comparison.EU_DE_LU).not.toHaveProperty('ember_monthly');
    expect(out).not.toHaveProperty('ember_attribution');
    expect(out.source).not.toMatch(/Ember/);
    emberMode = 'on';
  });
});
