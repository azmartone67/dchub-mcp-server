// air-permit-context-tool.test.mjs — (2026-11-11)
//
// get_air_permit_context reads dchub-backend GET /api/v1/air-permit-context:
// EPA Green Book county designations (US-wide) + TCEQ gas-turbine permits
// (Texas only), a dated public-domain snapshot. What must hold:
//
//   * lat/lon (and their aliases) reach the backend; radius_km/status/limit
//     pass through only when given;
//   * `site` resolves through the published DCPI row and the answer says so
//     (resolved_from); an unresolvable site and a call with no point are
//     REFUSED, never read at (0, 0);
//   * an anonymous caller gets every filing, cite_as and as_of — the anon trim
//     must not touch public facts — and a paid seat sees no upsell;
//   * a backend error comes back as data, not a crash;
//   * the planner routes air-permit / nonattainment intents to the air_permits
//     class with get_air_permit_context first, binds the named market as
//     `site`, and leaves moratorium and gas-economics intents where they were.
//
// A stub backend counts its hits so a guard that never reached it fails.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub;
const seen = [];
const dcpiSeen = [];

const filings = Array.from({ length: 12 }, (_, i) => ({
  name: `Turbine Co ${i}`, permit_no: String(180000 + i), status: i % 3 ? 'issued' : 'pending',
  type: 'TCEQ air permit, gas turbines 20 MW or more: standard permit',
  date: '2026-07-24', date_kind: 'issued', distance_km: 10 + i, distance_basis: 'city_centroid',
  project_mw: 100 + i,
  source_url: 'https://www.tceq.texas.gov/downloads/permitting/air/memos/turbine-lst.xlsx',
}));
function body(q) {
  if (q.get('lat') === '1') return null;
  return {
    ok: true,
    query: { lat: Number(q.get('lat')), lon: Number(q.get('lon')), radius_km: 100, limit: 10, status: 'all' },
    nonattainment: { available: true, county: 'Midland County', state: 'TX', in_nonattainment: false,
                     designations: [], pollutants: [], as_of: '2026-10-31' },
    nearby_filings: filings,
    filings_summary: { within_radius: 12, returned: 12, truncated: false, issued: 8, pending: 4 },
    coverage: { point_in_texas: true, filings_covered_here: true },
    coverage_note: 'Filings: TCEQ gas turbines, Texas only.',
    sources: { nonattainment: { url: 'https://www3.epa.gov/airquality/greenbook/downld/nayro.dbf', as_of: '2026-10-31' },
               tx_turbine_permits: { url: 'https://www.tceq.texas.gov/downloads/permitting/air/memos/turbine-lst.xlsx', as_of: '2026-10-07' } },
    as_of: '2026-10-07',
    as_of_by_source: { nonattainment: '2026-10-31', tx_turbine_permits: '2026-10-07' },
    cite_as: 'Source: DC Hub (dchub.cloud), as of 2026-10-07; upstream EPA Green Book ... TCEQ ...',
  };
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      const u = new URL(req.url, 'http://_');
      if (u.pathname === '/api/v1/keys/validate') {
        const k = req.headers['x-api-key'] || u.searchParams.get('key') || '';
        const pro = String(k).includes('pro');
        res.end(JSON.stringify({ valid: true, tier: pro ? 'pro' : 'free',
          developer_id: pro ? 'dev_air_pro' : 'dev_air_free', email: pro ? 'pro@example.com' : null }));
        return;
      }
      if (u.pathname.startsWith('/api/v1/mcp/')) { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      if (u.pathname.startsWith('/api/v1/dcpi/scores/')) {
        const slug = decodeURIComponent(u.pathname.split('/').pop());
        dcpiSeen.push(slug);
        if (slug === 'midland-tx') {
          res.end(JSON.stringify({ market_slug: 'midland-tx', market_name: 'Midland–Odessa', state: 'TX',
                                   latitude: 31.99, longitude: -102.08 }));
        } else { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); }
        return;
      }
      if (u.pathname === '/api/v1/air-permit-context') {
        seen.push(u.searchParams);
        const b = body(u.searchParams);
        if (!b) { res.statusCode = 503; res.end(JSON.stringify({ ok: false, error: 'air-permit snapshot unavailable' })); return; }
        res.end(JSON.stringify(b));
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

const call = (args, key) => rpc('tools/call', { name: 'get_air_permit_context', arguments: args }, key);
const sc = (r) => r.structuredContent
  || (() => { try { return JSON.parse((r.content || [])[0].text); } catch { return {}; } })();

describe('get_air_permit_context', () => {
  it('sends the point and only the options given', async () => {
    const n = seen.length;
    await call({ latitude: 31.97, lng: -102.08 });
    expect(seen.length, 'the stub never saw the call — this guard ran nothing').toBe(n + 1);
    expect(seen[n].get('lat')).toBe('31.97');
    expect(seen[n].get('lon')).toBe('-102.08');
    expect(seen[n].get('radius_km')).toBe(null);
    expect(seen[n].get('status')).toBe(null);
    await call({ lat: 31.97, lon: -102.08, radius_km: 50, status: 'pending', limit: 5 });
    expect(seen[n + 1].get('radius_km')).toBe('50');
    expect(seen[n + 1].get('status')).toBe('pending');
    expect(seen[n + 1].get('limit')).toBe('5');
  });

  it('an anonymous caller gets every filing, dated and cited', async () => {
    const r = await call({ lat: 31.97, lon: -102.08 });
    const out = sc(r);
    expect(out.nearby_filings).toHaveLength(12);
    expect(out.nearby_filings.every((f) => f.source_url && f.permit_no)).toBe(true);
    expect(out.nonattainment.county).toBe('Midland County');
    expect(out.as_of).toBe('2026-10-07');
    expect(out.cite_as).toMatch(/^Source: DC Hub \(dchub\.cloud\), as of 2026-10-07/);
    expect(out.see_also.moratoriums_and_zoning).toBe('get_permitting_intel');
    expect(JSON.stringify(r)).not.toContain('sign up to unlock');
  });

  it('a paid seat gets the same rows and no upsell', async () => {
    const r = await call({ lat: 31.97, lon: -102.08 }, 'dch_live_air_pro_seat');
    expect(sc(r).nearby_filings).toHaveLength(12);
    expect(JSON.stringify(r)).not.toMatch(/sign up to unlock|claim_free_key|\/pricing/i);
  });

  it('site resolves through the DCPI row and says so', async () => {
    const n = seen.length;
    const r = await call({ site: 'Midland TX' });
    expect(dcpiSeen).toContain('midland-tx');
    expect(seen.length).toBe(n + 1);
    expect(seen[n].get('lat')).toBe('31.99');
    const out = sc(r);
    expect(out.resolved_from.market_slug).toBe('midland-tx');
    expect(out.resolved_from.note).toMatch(/MARKET-level read/);
  });

  it('an unresolvable site and a point-less call are refused, never read at (0, 0)', async () => {
    const n = seen.length;
    const r1 = await call({ site: 'Atlantis' });
    expect(r1.isError).toBe(true);
    expect(sc(r1).error).toBe('location not resolved');
    const r2 = await call({});
    expect(r2.isError).toBe(true);
    expect(sc(r2).error).toMatch(/lat and lon \(or site\) required/);
    expect(seen.length, 'a refused call must not reach the backend').toBe(n);
  });

  it('a backend error comes back as data', async () => {
    const r = await call({ lat: 1, lon: 2 });
    const out = sc(r);
    expect(out.ok, 'an error must not read as a successful answer').not.toBe(true);
    expect(out.nearby_filings).toBeUndefined();
    expect(JSON.stringify(out)).toMatch(/snapshot unavailable|503/);
  });

  it('is advertised in tools/list', async () => {
    const r = await rpc('tools/list', {});
    const t = (r.tools || []).find((x) => x.name === 'get_air_permit_context');
    expect(t, 'get_air_permit_context missing from tools/list').toBeTruthy();
    expect(Object.keys(t.inputSchema.properties)).toEqual(
      expect.arrayContaining(['lat', 'lon', 'site', 'radius_km', 'status', 'limit']));
  });
});

describe('planner routes air-permit intents', () => {
  const plan = (t) => S._planQuery(t, {});
  const tools = (p) => (p.sequence || p.recommended_sequence || []).map((s) => s.tool);
  const first = (p) => (p.sequence || p.recommended_sequence || [])[0] || {};

  it('"air permits for gas turbines near Midland, TX" -> air_permits, site bound', () => {
    const p = plan('air permits for gas turbines near Midland, TX');
    expect(p.intent_class).toBe('air_permits');
    expect(first(p).tool).toBe('get_air_permit_context');
    expect(first(p).args_hint).toEqual({ site: 'midland-tx' });
    expect(tools(p)).toContain('get_permitting_intel');
    expect(tools(p), 'gas turbine is equipment, not a gas-price noun').not.toContain('get_gas_index');
  });

  it('nonattainment with coordinates beats the site_analysis coords boost', () => {
    const p = plan('nonattainment status at 31.97,-102.08');
    expect(p.intent_class).toBe('air_permits');
    expect(first(p).args_hint).toMatchObject({ lat: 31.97, lon: -102.08 });
  });

  it('a corridor county binds its point and radius', () => {
    const p = plan('is Loudoun County in ozone nonattainment?');
    expect(p.intent_class).toBe('air_permits');
    expect(first(p).args_hint).toHaveProperty('radius_km');
  });

  it('moratorium and gas-economics intents are not captured', () => {
    expect(plan('gas economics for on-site generation in Texas').intent_class).not.toBe('air_permits');
    expect(plan('how soon can a 100 MW load get power in ERCOT').intent_class).toBe('grid_headroom');
    expect(plan('gas turbines and gas prices in Texas').intent_class).not.toBe('air_permits');
  });

  it('discover_tools can find it', () => {
    const fam = S._TOOL_FAMILIES_TABLE.find((f) => f.tools.includes('get_air_permit_context'));
    expect(fam && fam.family).toBe('site_geometry');
  });
});
