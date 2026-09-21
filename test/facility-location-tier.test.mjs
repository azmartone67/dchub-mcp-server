// facility-location-tier.test.mjs — r-location-tier (2026-09-21, owner-approved)
//
// ★THE DEFECT. callAPI sends X-Internal-Key on every backend call and the
// backend treats that header as privileged, so it returns FULL facility records
// (exact coordinates, street address, raw source row) whoever the agent is. The
// MCP server's own masks were the only gate, and none of them rounded: the free
// field mask kept latitude/longitude at full precision, the anonymous
// get_facility preview reused it, and a free key on search_facilities got exact
// coordinates on every row.
//
// ★THE RULE. Exact location — precise coordinates and a street address — goes
// to developer, the pro-class plans (pro / founding / team / metered, i.e. the
// $10 pack), enterprise, research_seed and admin. Everyone else, starter
// included, gets coordinates rounded to 2dp (~1.1 km), no street address, no raw
// upstream blob, and coordinates_status "approximate_2dp" on each coarsened
// record. Starter keeps every OTHER field it gets today.
//
// ★WHY MOST OF THIS FILE DRIVES REAL HTTP. The leak lived in the gap between
// branches: the anonymous preview, the keyed mask and the paid path each build
// their own payload. A unit test of the helper passes on a build where one of
// those branches never calls it. So the tier matrix runs through the real
// POST /mcp handler against a 127.0.0.1 stub backend, and every assertion names
// the exact rounded value it expects — a payload that simply lost its
// coordinates must fail here, not pass as "no precise coordinate found".
//
// ★HARD-GATE QUALIFICATION. Deterministic; no egress (a stub on 127.0.0.1 and a
// socket-level refusal of anything else, asserted in the last test); writes no
// files.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import {
  coarsenFacilityLocation, coarsenToolResultLocation, looksLikeFacilityRecord,
  COORDS_APPROX_STATUS,
} from '../lib/facility-location.mjs';

// ★HARD GATE, NO NETWORK — installed before server.mjs is imported.
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

// ── fixtures: synthetic, and deliberately nowhere real ──────────────────────
const EXACT = { lat: 12.345678, lon: -45.678912 };      // → 12.35, -45.68
const PEER = { lat: 12.356789, lon: -45.689123 };       // → 12.36, -45.69
const ROUNDED = { lat: 12.35, lon: -45.68 };
const PEER_ROUNDED = { lat: 12.36, lon: -45.69 };
const ADDRESS = '123 Example Road';

function facilityRecord() {
  return {
    id: 424242,
    name: 'Example Facility A',
    slug: 'example-operator-example-facility-a-0a1b2c3d',
    provider: 'Example Operator',
    city: 'Exampleville', state: 'EX', country: 'ZZ', region: 'example-market',
    latitude: EXACT.lat, longitude: EXACT.lon,
    power_mw: 48.5, status: 'operational', source: 'example-registry',
    address: ADDRESS, postal_code: '00000',
    raw_data: JSON.stringify({ street: ADDRESS, lat: EXACT.lat, lng: EXACT.lon }),
    geom: '0101000020E6100000000000000000F03F000000000000F03F',
    nearby: [{
      name: 'Example Facility B', slug: 'other-operator-example-facility-b-1a2b3c4d',
      provider: 'Other Operator', distance_km: 1.4,
      lat: PEER.lat, lng: PEER.lon, address: '9 Sample Lane',
    }],
  };
}
function searchRows() {
  return [0, 1, 2].map((i) => ({
    id: 5000 + i,
    name: `Example Facility ${i}`,
    slug: `example-operator-example-facility-${i}-0000000${i}`,
    provider: 'Example Operator',
    city: 'Exampleville', state: 'EX', country: 'ZZ',
    latitude: EXACT.lat + i / 1000, longitude: EXACT.lon - i / 1000,
    lat: EXACT.lat + i / 1000, lon: EXACT.lon - i / 1000,
    power_mw: 10 + i, address: `${100 + i} Example Road`, raw_data: '{"x":1}',
  }));
}

// key → tier the stub validates it as
const KEYS = {
  dch_live_test_free: 'free',
  dch_live_test_identified: 'identified',
  dch_live_test_starter: 'starter',
  dch_live_test_developer: 'developer',
  dch_live_test_pro: 'pro',
  dch_live_test_metered: 'metered',
  dch_live_test_packholder: 'free',   // validates free, but holds a live $10 pack
  dch_live_test_lastcredit: 'free',   // holds exactly ONE pack credit — this call spends it
  dch_live_test_balancedown: 'free',  // its balance lookup answers 500
};
const CREDITS = { dch_live_test_packholder: 800, dch_live_test_lastcredit: 1 };

let S, PORT, httpServer, stub, prevBase;
const hits = { facility: 0, facilities: 0, riskDelta: 0, credits: 0 };

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
      if (url.pathname === '/api/v1/keys/validate') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          let key = '';
          try { key = (JSON.parse(body || '{}').api_key) || ''; } catch (_) {}
          if (KEYS[key]) send(200, { valid: true, tier: KEYS[key], developer_id: 'dev_' + key, email: key + '@example.test' });
          else send(200, { valid: false });
        });
        return;
      }
      if (url.pathname === '/api/v1/mcp/credits/balance') {
        hits.credits += 1;
        const k = url.searchParams.get('key') || '';
        if (k === 'dch_live_test_balancedown') return send(500, { error: 'balance store unavailable' });
        return send(200, { credits: CREDITS[k] || 0, had_pack: !!CREDITS[k] });
      }
      if (url.pathname === '/api/v1/facilities/424242') {
        hits.facility += 1;
        return send(200, { success: true, data: facilityRecord() });
      }
      if (url.pathname === '/api/v1/facility/424242') {
        return send(200, { success: true, data: {
          fiber_carrier_count: 2, fiber_providers: ['Carrier One', 'Carrier Two'],
          on_net: true, connectivity_note: '2 on-site fiber carrier(s)' } });
      }
      if (url.pathname === '/api/v1/facilities') {
        hits.facilities += 1;
        const rows = searchRows();
        return send(200, { success: true, count: rows.length, data: rows });
      }
      if (url.pathname === '/api/v1/facility-risk-delta') {
        hits.riskDelta += 1;
        return send(200, {
          facility: { id: 424242, name: 'Example Facility A', provider: 'Example Operator',
            city: 'Exampleville', state: 'EX', market: 'example-market', lat: EXACT.lat, lon: EXACT.lon },
          dcpi_market_health: { delta: 1.2, direction: 'improving', coverage: 'measured' },
          static_dimensions: { disaster: { tool: 'get_disaster_risk', args: { lat: EXACT.lat, lon: EXACT.lon } } },
          summary: 'Market health improving over the window.',
        });
      }
      send(404, { error: 'not found', path: url.pathname });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

// ── helpers ─────────────────────────────────────────────────────────────────
function decode(raw) {
  return raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
}
function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}
async function callTool(name, args, key) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (key) headers['x-api-key'] = key;
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const env = JSON.parse(decode(raw));
  const r = env.result || {};
  const texts = (r.content || []).map((c) => c.text || '');
  return { r, payload: leadingJson(texts[0] || ''), texts, sc: r.structuredContent || null, raw };
}
// Every coordinate-keyed value anywhere in `node`, as [path, value].
const COORD_KEY = /(?:^|_)(?:lat|lng|lon|latitude|longitude)$/i;
function coordValues(node, path = '$', out = []) {
  if (Array.isArray(node)) { node.forEach((v, i) => coordValues(v, `${path}[${i}]`, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if (COORD_KEY.test(k) && (typeof v === 'number' || typeof v === 'string')) out.push([`${path}.${k}`, v]);
    else coordValues(v, `${path}.${k}`, out);
  }
  return out;
}
function decimals(v) {
  const s = String(v);
  if (/e/i.test(s)) return 99;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
const ADDRESS_KEY = /^(?:address.*|street.*|postal.*|post_?code|zip.*)$/i;
const RAW_KEY = /^_?raw(?:_.*)?$/i;
function keysMatching(node, re, path = '$', out = []) {
  if (Array.isArray(node)) { node.forEach((v, i) => keysMatching(v, re, `${path}[${i}]`, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if (re.test(k) && v !== null && v !== undefined && v !== '') out.push(`${path}.${k}`);
    keysMatching(v, re, `${path}.${k}`, out);
  }
  return out;
}
// The one facility record in a get_facility payload, whatever envelope wraps it.
function recordOf(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.data && typeof p.data === 'object' && !Array.isArray(p.data) && p.data.name) return p.data;
  if (p.name) return p;
  return null;
}
function expectCoarsened(channel, label) {
  const coords = coordValues(channel);
  expect(coords.length, `${label}: no coordinates at all — the assertion would be vacuous`).toBeGreaterThan(0);
  for (const [path, v] of coords) {
    expect(decimals(v), `${label}: ${path}=${v} is finer than 2dp`).toBeLessThanOrEqual(2);
  }
  expect(keysMatching(channel, ADDRESS_KEY), `${label}: street address served`).toEqual([]);
  expect(keysMatching(channel, RAW_KEY), `${label}: raw upstream blob served`).toEqual([]);
  expect(JSON.stringify(channel), `${label}: the exact value survives somewhere`).not.toContain(String(EXACT.lat));
}

// ── 1. the helper ───────────────────────────────────────────────────────────
describe('gateFacilityLocation — the helper', () => {
  const sample = () => ({ success: true, data: facilityRecord() });

  it('non-exact tiers: 2dp everywhere (nested nearby too), no address / raw / geom, approximate_2dp stamped', () => {
    for (const tier of ['anonymous', 'free', 'identified', 'starter', 'trial', undefined]) {
      const out = S.gateFacilityLocation(sample(), tier);
      const d = out.data;
      expect(d.latitude, `${tier}`).toBe(ROUNDED.lat);
      expect(d.longitude, `${tier}`).toBe(ROUNDED.lon);
      expect(d.coordinates_status, `${tier}`).toBe(COORDS_APPROX_STATUS);
      expect(d.nearby[0].lat, `${tier} nearby`).toBe(PEER_ROUNDED.lat);
      expect(d.nearby[0].lng, `${tier} nearby`).toBe(PEER_ROUNDED.lon);
      expect(d.nearby[0].coordinates_status, `${tier} nearby`).toBe(COORDS_APPROX_STATUS);
      expect(d.address, `${tier}`).toBeUndefined();
      expect(d.postal_code, `${tier}`).toBeUndefined();
      expect(d.raw_data, `${tier}`).toBeUndefined();
      expect(d.geom, `${tier}`).toBeUndefined();
      expect(d.nearby[0].address, `${tier} nearby`).toBeUndefined();
      // Location only: everything else a tier gets survives the helper.
      expect(d.power_mw, `${tier}`).toBe(48.5);
      expect(d.provider, `${tier}`).toBe('Example Operator');
      expect(d.source, `${tier}`).toBe('example-registry');
    }
  });

  it('exact-location tiers get the SAME object back, address and all', () => {
    for (const tier of ['developer', 'paid', 'pro', 'founding', 'team', 'metered', 'enterprise', 'research_seed', 'admin', 'Pro']) {
      const input = sample();
      const out = S.gateFacilityLocation(input, tier);
      expect(out, tier).toBe(input);
      expect(out.data.latitude, tier).toBe(EXACT.lat);
      expect(out.data.address, tier).toBe(ADDRESS);
    }
  });

  it('pins the owner\'s exact-location list (2026-09-21) — starter is NOT on it, metered IS', () => {
    const exact = ['developer', 'paid', 'pro', 'founding', 'team', 'metered', 'enterprise', 'research_seed', 'admin'];
    const coarse = ['starter', 'identified', 'free', 'anonymous', 'anon', 'trial', 'trial_taste', '', null, undefined, 'bogus'];
    for (const t of exact) expect(S._isExactLocationTier(t), `${t} must be exact`).toBe(true);
    for (const t of coarse) expect(S._isExactLocationTier(t), `${t} must be coarsened`).toBe(false);
  });

  it('does not mutate its input', () => {
    const input = sample();
    const before = JSON.stringify(input);
    S.gateFacilityLocation(input, 'free');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('numeric strings, camelCase keys, GeoJSON points and free-text locations are coarsened too', () => {
    const out = S.gateFacilityLocation({
      name: 'Example Facility C', provider: 'Example Operator', power_mw: 5,
      latitude: '12.345678', centerLng: -45.678912,
      geometry: { type: 'Point', coordinates: [-45.678912, 12.345678] },
      location: `${ADDRESS}, Exampleville`, streetAddress: ADDRESS, zipCode: '00000', rawData: 'x',
    }, 'free');
    expect(out.latitude).toBe('12.35');
    expect(out.centerLng).toBe(-45.68);
    expect(out.geometry.coordinates).toEqual([-45.68, 12.35]);
    expect(out.location).toBeUndefined();
    expect(out.streetAddress).toBeUndefined();
    expect(out.zipCode).toBeUndefined();
    expect(out.rawData).toBeUndefined();
    expect(out.coordinates_status).toBe(COORDS_APPROX_STATUS);
  });

  it('a record that was already coarse is not relabelled approximate', () => {
    const out = S.gateFacilityLocation({ name: 'X', provider: 'Y', power_mw: 1, latitude: 12.3, longitude: -45.6 }, 'free');
    expect(out.latitude).toBe(12.3);
    expect(out.coordinates_status).toBeUndefined();
  });

  it('detect scope: facility rows coarsened; substations, plants and the caller\'s own point untouched; copies rounded', () => {
    const payload = {
      location: { lat: 1.234567, lon: 2.345678 },                                       // caller's own point
      nearest_substation: { name: 'Sub 1', voltage_kv: 230, operator: 'Grid Co', lat: 3.456789, lon: 4.567891 },
      plants: [{ name: 'Plant 1', operator: 'Gen Co', capacity_mw: 500, fuel: 'gas', lat: 5.678912, lon: 6.789123 }],
      recent_facilities: [{ name: 'Example Facility D', city: 'Exampleville', lat: EXACT.lat, lon: EXACT.lon }],
      fiber: { latency_target: { name: 'Example Carrier Hotel' }, latency_target_lat: PEER.lat, latency_target_lng: PEER.lon },
      site_evaluation_handoff: [{ tool: 'analyze_site', parameters: { lat: EXACT.lat, lon: EXACT.lon } }],
    };
    const out = S.gateFacilityLocation(payload, 'free', { scope: 'detect' });
    expect(out.location).toEqual({ lat: 1.234567, lon: 2.345678 });
    expect(out.nearest_substation.lat).toBe(3.456789);
    expect(out.plants[0].lat).toBe(5.678912);
    expect(out.recent_facilities[0].lat).toBe(ROUNDED.lat);
    expect(out.recent_facilities[0].coordinates_status).toBe(COORDS_APPROX_STATUS);
    expect(out.fiber.latency_target_lat).toBe(PEER_ROUNDED.lat);
    expect(out.fiber.latency_target_lng).toBe(PEER_ROUNDED.lon);
    expect(out.site_evaluation_handoff[0].parameters).toEqual({ lat: ROUNDED.lat, lon: ROUNDED.lon });
  });

  it('the facility detector does not claim open-infrastructure rows', () => {
    expect(looksLikeFacilityRecord({ name: 'Sub', voltage_kv: 500, operator: 'X', power_mw: 1, lat: 1, lon: 2 })).toBe(false);
    expect(looksLikeFacilityRecord({ name: 'Plant', operator: 'X', capacity_mw: 9, fuel: 'coal', lat: 1, lon: 2 })).toBe(false);
    expect(looksLikeFacilityRecord({ name: 'Plant', operator: 'X', power_mw: 9, primary_fuel: 'gas', lat: 1, lon: 2 })).toBe(false);
    expect(looksLikeFacilityRecord({ name: 'Example Facility', provider: 'Example Operator', power_mw: 9 })).toBe(true);
    expect(looksLikeFacilityRecord({ name: 'Example Facility', profile_url: 'https://dchub.cloud/facilities/x-00000000' })).toBe(true);
  });

  it('FAILS CLOSED on a hostile object: coordinates stripped, never passed, and it does not throw', () => {
    const hostile = {
      name: 'Example Facility E', provider: 'Example Operator', power_mw: 7,
      latitude: EXACT.lat, longitude: EXACT.lon, address: ADDRESS,
      get boom() { throw new Error('hostile getter'); },
    };
    let out;
    expect(() => { out = S.gateFacilityLocation({ data: hostile }, 'free'); }).not.toThrow();
    expect(out.data.name).toBe('Example Facility E');
    expect(out.data.latitude).toBeUndefined();
    expect(out.data.longitude).toBeUndefined();
    expect(out.data.address).toBeUndefined();
    expect(coarsenFacilityLocation({ data: hostile }, { scope: 'record' }).failed_closed).toBe(true);

    const cyclic = { name: 'Example Facility F', provider: 'P', power_mw: 1, latitude: EXACT.lat, longitude: EXACT.lon };
    cyclic.self = cyclic;
    const outCycle = S.gateFacilityLocation(cyclic, 'free');
    expect(coordValues(outCycle)).toEqual([]);

    const trap = new Proxy({ latitude: EXACT.lat }, { ownKeys() { throw new Error('hostile proxy'); } });
    let outTrap;
    expect(() => { outTrap = S.gateFacilityLocation({ name: 'G', provider: 'P', power_mw: 1, inner: trap }, 'free'); }).not.toThrow();
    expect(JSON.stringify(outTrap)).not.toContain(String(EXACT.lat));
  });

  it('the per-facility override leaves exactly the allowed record exact', () => {
    const payload = { success: true, data: facilityRecord() };
    const allowed = facilityRecord().slug;
    const { value } = coarsenFacilityLocation(payload, {
      scope: 'record', exactAllowed: (rec) => rec.slug === allowed,
    });
    expect(value.data.latitude).toBe(EXACT.lat);
    expect(value.data.address).toBe(ADDRESS);
    expect(value.data.nearby[0].lat).toBe(PEER_ROUNDED.lat);     // a different building
    expect(value.data.nearby[0].address).toBeUndefined();
    // and a hook that throws counts as "not allowed"
    const thrown = coarsenFacilityLocation(payload, { scope: 'record', exactAllowed: () => { throw new Error('x'); } });
    expect(thrown.value.data.latitude).toBe(ROUNDED.lat);
    // the server's hook grants nothing today
    expect(S._facilityExactLocationAllowed(facilityRecord(), { tier: 'free' })).toBe(false);
  });

  it('tool-result wrapper: JSON text with appended prose AND structuredContent are both gated; nothing to gate → same object', () => {
    const rec = facilityRecord();
    const result = {
      content: [
        { type: 'text', text: JSON.stringify({ data: rec }) + '\n\n→ **For your human:** relay line' },
        { type: 'text', text: 'plain prose, left alone' },
      ],
      structuredContent: { data: rec, _entity: 'facility' },
    };
    const out = coarsenToolResultLocation(result, { scope: 'record' });
    expect(out).not.toBe(result);
    expect(out.content[0].text.endsWith('\n\n→ **For your human:** relay line')).toBe(true);
    const p = leadingJson(out.content[0].text);
    expect(p.data.latitude).toBe(ROUNDED.lat);
    expect(p.data.address).toBeUndefined();
    expect(out.content[1].text).toBe('plain prose, left alone');
    expect(out.structuredContent.data.latitude).toBe(ROUNDED.lat);
    const clean = { content: [{ type: 'text', text: '{"ok":true,"count":3}' }], structuredContent: { ok: true } };
    expect(coarsenToolResultLocation(clean, { scope: 'record' })).toBe(clean);
  });
});

// ── 2. end to end, through POST /mcp ────────────────────────────────────────
describe('end to end — every tier, every channel, through the real handler', () => {
  it('anonymous get_facility: 2dp, no address, approximate_2dp — content AND structuredContent', async () => {
    const before = hits.facility;
    const { payload, sc } = await callTool('get_facility', { facility_id: '424242' });
    expect(hits.facility, 'stub never served the record — this asserted nothing').toBeGreaterThan(before);
    const rec = recordOf(payload);
    expect(rec, 'no facility record in the anonymous preview').toBeTruthy();
    expect(rec.latitude).toBe(ROUNDED.lat);
    expect(rec.longitude).toBe(ROUNDED.lon);
    expect(rec.coordinates_status).toBe(COORDS_APPROX_STATUS);
    expectCoarsened(payload, 'anon content');
    expectCoarsened(sc, 'anon structuredContent');
  });

  it('free key get_facility: 2dp, no address', async () => {
    const { payload, sc } = await callTool('get_facility', { facility_id: '424242' }, 'dch_live_test_free');
    const rec = recordOf(payload);
    expect(rec, 'no facility record for the free key').toBeTruthy();
    expect(rec.latitude).toBe(ROUNDED.lat);
    expect(rec.longitude).toBe(ROUNDED.lon);
    expectCoarsened(payload, 'free content');
    expectCoarsened(sc, 'free structuredContent');
  });

  it('identified key get_facility: 2dp, no address', async () => {
    const { payload, sc } = await callTool('get_facility', { facility_id: '424242' }, 'dch_live_test_identified');
    expect(recordOf(payload).latitude).toBe(ROUNDED.lat);
    expectCoarsened(payload, 'identified content');
    expectCoarsened(sc, 'identified structuredContent');
  });

  it('STARTER get_facility: location coarsened (nested nearby included) but every other paid field kept', async () => {
    const { payload, sc } = await callTool('get_facility', { facility_id: '424242' }, 'dch_live_test_starter');
    const rec = recordOf(payload);
    expect(rec, 'no facility record for starter').toBeTruthy();
    expect(rec.latitude).toBe(ROUNDED.lat);
    expect(rec.longitude).toBe(ROUNDED.lon);
    expect(rec.coordinates_status).toBe(COORDS_APPROX_STATUS);
    expect(rec.nearby[0].lat).toBe(PEER_ROUNDED.lat);
    expect(rec.nearby[0].lng).toBe(PEER_ROUNDED.lon);
    expect(rec.power_mw).toBe(48.5);
    expect(rec.provider).toBe('Example Operator');
    expect(rec.source).toBe('example-registry');
    expect(rec.fiber_carrier_count).toBe(2);
    expectCoarsened(payload, 'starter content');
    expectCoarsened(sc, 'starter structuredContent');
    expect(recordOf(sc).power_mw).toBe(48.5);
  });

  for (const [key, label] of [['dch_live_test_developer', 'developer'], ['dch_live_test_pro', 'pro'], ['dch_live_test_metered', 'metered ($10 pack)']]) {
    it(`${label} get_facility: EXACT coordinates + street address, nearby exact`, async () => {
      const { payload, sc } = await callTool('get_facility', { facility_id: '424242' }, key);
      for (const [ch, name] of [[payload, 'content'], [sc, 'structuredContent']]) {
        const rec = recordOf(ch);
        expect(rec, `${label} ${name}: no record`).toBeTruthy();
        expect(rec.latitude, `${label} ${name}`).toBe(EXACT.lat);
        expect(rec.longitude, `${label} ${name}`).toBe(EXACT.lon);
        expect(rec.address, `${label} ${name}`).toBe(ADDRESS);
        expect(rec.nearby[0].lat, `${label} ${name}`).toBe(PEER.lat);
        expect(rec.coordinates_status, `${label} ${name}`).toBeUndefined();
      }
    });
  }

  it('a free key holding a live $10 pack gets EXACT location — on the credit path AND on a free tool', async () => {
    const gf = await callTool('get_facility', { facility_id: '424242' }, 'dch_live_test_packholder');
    const rec = recordOf(gf.payload);
    expect(rec, 'no record for the pack holder').toBeTruthy();
    expect(rec.latitude).toBe(EXACT.lat);
    expect(rec.address).toBe(ADDRESS);
    const sf = await callTool('search_facilities', { query: 'example', limit: 3 }, 'dch_live_test_packholder');
    const rows = (sf.payload && sf.payload.data) || [];
    expect(rows.length, 'no rows for the pack holder').toBeGreaterThan(0);
    expect(rows[0].latitude).toBe(EXACT.lat);
  });

  it('the call that spends a pack\'s LAST credit is still served exact (the paid-rail marker, not the balance)', async () => {
    // After this call burns the only credit the cached balance reads 0, so only
    // the credits_full return path's own marker can keep the answer exact.
    const { payload } = await callTool('get_facility', { facility_id: '424242' }, 'dch_live_test_lastcredit');
    const rec = recordOf(payload);
    expect(rec, 'no record for the last-credit call').toBeTruthy();
    expect(rec.latitude).toBe(EXACT.lat);
    expect(rec.address).toBe(ADDRESS);
  });

  it('a balance lookup that FAILS coarsens (never fails open to exact)', async () => {
    const before = hits.credits;
    const { payload, sc } = await callTool('search_facilities', { query: 'example', limit: 3 }, 'dch_live_test_balancedown');
    expect(hits.credits, 'the balance was never consulted — this asserted nothing').toBeGreaterThan(before);
    const rows = (payload && payload.data) || [];
    expect(rows.length).toBe(3);
    expect(rows[0].latitude).toBe(ROUNDED.lat);
    expectCoarsened(payload, 'balance-down content');
    expectCoarsened(sc, 'balance-down structuredContent');
  });

  it('free key search_facilities: every row 2dp, no address — the follow-up handoff too', async () => {
    const before = hits.facilities;
    const { payload, sc } = await callTool('search_facilities', { query: 'example', limit: 3 }, 'dch_live_test_free');
    expect(hits.facilities, 'stub never served the rows').toBeGreaterThan(before);
    const rows = (payload && payload.data) || [];
    expect(rows.length, 'no rows for the free key').toBe(3);
    expect(rows[0].latitude).toBe(ROUNDED.lat);
    expect(rows[0].longitude).toBe(ROUNDED.lon);
    for (const row of rows) expect(row.coordinates_status).toBe(COORDS_APPROX_STATUS);
    expectCoarsened(payload, 'search content');
    expectCoarsened(sc, 'search structuredContent');
    const handoff = sc && sc.site_evaluation_handoff;
    if (handoff) {
      for (const h of [].concat(handoff)) {
        const p = h.parameters || {};
        if (p.lat !== undefined) expect(decimals(p.lat)).toBeLessThanOrEqual(2);
        if (p.lon !== undefined) expect(decimals(p.lon)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('developer search_facilities: exact coordinates on every row', async () => {
    const { payload } = await callTool('search_facilities', { query: 'example', limit: 3 }, 'dch_live_test_developer');
    const rows = (payload && payload.data) || [];
    expect(rows.length).toBe(3);
    expect(rows[0].latitude).toBe(EXACT.lat);
    expect(rows[0].address).toBe('100 Example Road');
  });

  it('anonymous get_facility_risk_delta: the facility block and its copied follow-up args are 2dp', async () => {
    const before = hits.riskDelta;
    const { payload, sc } = await callTool('get_facility_risk_delta', { facility_id: '424242' });
    expect(hits.riskDelta, 'stub never served the risk delta').toBeGreaterThan(before);
    expect(payload.facility.lat).toBe(ROUNDED.lat);
    expect(payload.facility.lon).toBe(ROUNDED.lon);
    expectCoarsened(payload, 'risk-delta content');
    expectCoarsened(sc, 'risk-delta structuredContent');
  });

  it('made no connection off loopback', () => {
    expect(foreign).toEqual([]);
  });
});
