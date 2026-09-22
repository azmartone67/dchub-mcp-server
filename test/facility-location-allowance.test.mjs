// facility-location-allowance.test.mjs — r-location-allowance (2026-09-22, frontend#1534)
//
// ★THE GAP. Owner policy 2026-09-21: exact facility location is paid, except
// that free, identified, trial and starter accounts get 10 distinct facilities
// a UTC month. The backend meter shipped (dchub-backend#5108,
// POST /api/v1/facility/<slug>/location), and the web and REST single-record
// routes spend it. This server never asked it: _facilityExactLocationAllowed
// returned false for everyone, so a free key got approximate coordinates from
// get_facility forever. /pricing dropped the claim for that reason.
//
// ★THE RULE HERE. get_facility, a KEYED caller below the exact tiers, no live
// pack balance: ask the meter (POST, which spends one unless this facility is
// already revealed this month). "exact" leaves that ONE record exact and adds
// its street address and the allowance left; "limit_reached" keeps it
// approximate and says so. Nobody else calls the meter: the anonymous tier
// never gets an exact location, exact tiers and pack holders already see it,
// and a list tool (search_facilities) does not spend it.
//
// ★WHY REAL HTTP. The same reason as facility-location-tier.test.mjs: the
// masks live on different return paths. Everything runs through POST /mcp
// against a 127.0.0.1 stub backend that records every meter call it gets.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

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

const EXACT = { lat: 12.345678, lon: -45.678912 };      // → 12.35, -45.68
const ADDRESS = '123 Example Road';
const SLUG = 'example-operator-example-facility-a-0a1b2c3d';
function facilityRecord() {
  return {
    id: 424242, name: 'Example Facility A', slug: SLUG, provider: 'Example Operator',
    city: 'Exampleville', state: 'EX', country: 'ZZ',
    latitude: EXACT.lat, longitude: EXACT.lon, power_mw: 48.5, status: 'operational',
    address: ADDRESS, raw_data: JSON.stringify({ street: ADDRESS }),
  };
}
const ALLOWANCE_LEFT = { limit: 10, used: 3, remaining: 7, period: '2026-09', resets_at: '2026-10-01T00:00:00Z' };
const ALLOWANCE_SPENT = { limit: 10, used: 10, remaining: 0, period: '2026-09', resets_at: '2026-10-01T00:00:00Z' };

const KEYS = {
  dch_live_allow_free: 'free',
  dch_live_allow_identified: 'identified',
  dch_live_allow_spent: 'free',
  dch_live_allow_down: 'free',       // its meter call answers 500
  dch_live_allow_developer: 'developer',
  dch_live_allow_pack: 'free',       // holds a live $10 pack
};
const CREDITS = { dch_live_allow_pack: 800 };

let S, PORT, httpServer, stub, prevBase, prevInternal;
// Production sets it: the meter must see the internal key AND the caller's key.
const INTERNAL = 'test-internal-key-location-allowance';
const meter = [];   // every call the location endpoint got

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
        const k = url.searchParams.get('key') || '';
        return send(200, { credits: CREDITS[k] || 0, had_pack: !!CREDITS[k] });
      }
      const loc = url.pathname.match(/^\/api\/v1\/facility\/([^/]+)\/location$/);
      if (loc) {
        const key = req.headers['x-api-key'] || '';
        meter.push({ method: req.method, slug: decodeURIComponent(loc[1]), key,
                     internal: req.headers['x-internal-key'] === INTERNAL });
        if (key === 'dch_live_allow_down') return send(500, { error: 'meter unavailable' });
        if (key === 'dch_live_allow_spent') {
          return send(200, { status: 'limit_reached', slug: SLUG, tier: 'free', latitude: null,
            longitude: null, address: null, allowance: ALLOWANCE_SPENT,
            upgrade_url: 'https://dchub.cloud/pricing#developer' });
        }
        return send(200, { status: 'exact', slug: SLUG, tier: KEYS[key] || 'free', exact_via: 'allowance',
          latitude: EXACT.lat, longitude: EXACT.lon, address: ADDRESS, allowance: ALLOWANCE_LEFT });
      }
      if (url.pathname === '/api/v1/facilities/424242') return send(200, { success: true, data: facilityRecord() });
      if (url.pathname === '/api/v1/facility/424242') return send(200, { success: true, data: { fiber_carrier_count: 1 } });
      if (url.pathname === '/api/v1/facilities') {
        return send(200, { success: true, count: 1, data: [facilityRecord()] });
      }
      send(404, { error: 'not found', path: url.pathname });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = INTERNAL;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevInternal;
  net.Socket.prototype.connect = realConnect;
});

beforeEach(() => { meter.length = 0; });

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
  const env = JSON.parse(decode(await res.text()));
  const r = env.result || {};
  return { r, payload: leadingJson((r.content || [])[0]?.text || '') };
}
function recordOf(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.data && typeof p.data === 'object' && !Array.isArray(p.data) && p.data.name) return p.data;
  if (Array.isArray(p.data)) return p.data[0] || null;
  return p.name ? p : null;
}
function decimals(v) { const s = String(v); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
function expectApproximate(rec, label) {
  expect(rec, `${label}: no record`).toBeTruthy();
  expect(typeof rec.latitude, `${label}: no latitude — vacuous`).toBe('number');
  expect(decimals(rec.latitude), `${label}: latitude finer than 2dp`).toBeLessThanOrEqual(2);
  expect(decimals(rec.longitude), `${label}: longitude finer than 2dp`).toBeLessThanOrEqual(2);
  expect(rec.address ?? null, `${label}: street address served`).toBeNull();
}

describe('get_facility spends the monthly exact-location allowance', () => {
  it.each(['dch_live_allow_free', 'dch_live_allow_identified'])(
    '%s: the meter says exact, so this record is exact, with its address and what is left', async (key) => {
      const { r, payload } = await callTool('get_facility', { facility_id: '424242' }, key);
      expect(r.isError).toBeFalsy();
      const rec = recordOf(payload);
      expect(rec.latitude).toBe(EXACT.lat);
      expect(rec.longitude).toBe(EXACT.lon);
      expect(rec.address).toBe(ADDRESS);
      expect(payload.exact_location).toMatchObject({ status: 'exact', via: 'allowance', allowance: ALLOWANCE_LEFT });
      expect(meter).toEqual([{ method: 'POST', slug: SLUG, key, internal: true }]);
    });

  it('the allowance is used up: approximate, and the answer says why', async () => {
    const { payload } = await callTool('get_facility', { facility_id: '424242' }, 'dch_live_allow_spent');
    expectApproximate(recordOf(payload), 'spent');
    expect(payload.exact_location).toMatchObject({ status: 'limit_reached', allowance: ALLOWANCE_SPENT,
      upgrade_url: 'https://dchub.cloud/pricing#developer' });
    expect(payload.exact_location.message).toMatch(/used up/);
    expect(meter).toHaveLength(1);
  });

  it('a meter that fails leaves the answer approximate and says nothing', async () => {
    const { r, payload } = await callTool('get_facility', { facility_id: '424242' }, 'dch_live_allow_down');
    expect(r.isError).toBeFalsy();
    expectApproximate(recordOf(payload), 'meter down');
    expect(payload.exact_location).toBeUndefined();
    expect(meter).toHaveLength(1);
  });
});

describe('nobody else asks the meter', () => {
  it('anonymous: approximate, never exact, no meter call', async () => {
    const { payload } = await callTool('get_facility', { facility_id: '424242' });
    expectApproximate(recordOf(payload), 'anonymous');
    expect(payload.exact_location).toBeUndefined();
    expect(meter).toEqual([]);
  });

  it.each(['dch_live_allow_developer', 'dch_live_allow_pack'])(
    '%s already sees exact: no meter call, nothing spent', async (key) => {
      const { payload } = await callTool('get_facility', { facility_id: '424242' }, key);
      expect(recordOf(payload).latitude).toBe(EXACT.lat);
      expect(payload.exact_location).toBeUndefined();
      expect(meter).toEqual([]);
    });

  it('search_facilities (a list) does not spend the allowance', async () => {
    const { payload } = await callTool('search_facilities', { query: 'Example' }, 'dch_live_allow_free');
    const rec = recordOf(payload);
    expect(rec, 'search returned no row: the assertion below would be vacuous').toBeTruthy();
    expectApproximate(rec, 'search');
    expect(meter).toEqual([]);
  });

  it('only get_facility spends it: the policy, pinned as the server states it', () => {
    expect(S._LOCATION_ALLOWANCE_TOOLS).toEqual(['get_facility']);
  });

  it('never reached off the loopback', () => { expect(foreign).toEqual([]); });
});
