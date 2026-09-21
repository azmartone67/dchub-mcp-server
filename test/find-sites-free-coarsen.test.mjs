// find-sites-free-coarsen.test.mjs — r-find-sites-free-coarsen (2026-09-21)
//
// ★THE DEFECT. find_sites' description says "Free tier coarsens coordinates to
// ~11 km and withholds operator/capacity". The backend endpoint builds exactly
// that preview for a caller it does not trust, but it trusts the MCP server's
// own X-Internal-Key, so every MCP caller, keyless ones included, got exact
// substation coordinates, operator and capacity_mva. Measured through this
// file's harness before the fix: the keyless call returned lat 39.04371,
// operator "Coarsen Power Co", capacity_mva 1200.
//
// ★THE DECISION, and why paid tiers are pinned unchanged. The free preview
// follows the description, the pricing page (full-precision coordinates are a
// paid line item) and the backend's own docstring ("exact coordinates, operator
// and capacity are the paid read"), so it applies to keyless, free and
// identified callers. Every paying tier keeps exactly the response it got
// before — a live $10 pack balance on a free key included, since a pack does
// not change the key's tier. Changing what a paid tier gets was out of scope,
// so those rows are asserted byte-for-byte against the backend payload.
//
// HARD gate: deterministic, and its only network is two 127.0.0.1 listeners
// (a stub backend and the real express app).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const K_IDENT = 'dch_live_coarsen_ident0001';
const K_PACK = 'dch_live_coarsen_packs0001';    // identified key holding a live $10 pack balance
const K_STARTER = 'dch_live_coarsen_start0001';
const K_DEV = 'dch_live_coarsen_devel0001';
const K_PRO = 'dch_live_coarsen_propro0001';
const KEY_TIER = { [K_IDENT]: 'identified', [K_PACK]: 'identified', [K_STARTER]: 'starter',
  [K_DEV]: 'developer', [K_PRO]: 'pro' };
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};

// What the backend returns to a caller it trusts. Two candidates: one west of
// Greenwich so a sign bug in the rounding shows, one with values that round up.
// Each site_ref is the one the backend mints for that caller, from the anchor
// name and the EXACT coordinates (routes/find_sites.py site_ref).
const CANDIDATES = [
  { site_ref: 'site_243ecb877c', lat: 39.04371, lon: -77.48749, coordinate_precision_km: 0.1,
    anchor: { type: 'substation', name: 'Coarsen Sub A', voltage_kv: 500, city: 'Ashburn', state: 'VA',
      status: 'IN SERVICE', operator: 'Coarsen Power Co', capacity_mva: 1200 },
    gas_distance_km: 3.2, fiber_distance_km: 1.1,
    next_calls: ['analyze_site lat=39.04371 lon=-77.48749', 'get_fiber_readiness lat=39.04371 lon=-77.48749',
      'get_permitting_intel state=VA'] },
  { site_ref: 'site_37293a1f84', lat: 38.96512, lon: -77.35988, coordinate_precision_km: 0.1,
    anchor: { type: 'substation', name: 'Coarsen Sub B', voltage_kv: 230, city: 'Reston', state: 'VA',
      status: 'IN SERVICE', operator: 'Coarsen Grid LLC', capacity_mva: 845 },
    gas_distance_km: 7.9, fiber_distance_km: 2.4,
    next_calls: ['analyze_site lat=38.96512 lon=-77.35988', 'get_fiber_readiness lat=38.96512 lon=-77.35988',
      'get_permitting_intel state=VA'] },
];
const EXACT_NEEDLES = ['39.04371', '77.48749', '38.96512', '77.35988', 'Coarsen Power Co', 'Coarsen Grid LLC',
  '"capacity_mva":1200', '"capacity_mva":845', 'site_243ecb877c', 'site_37293a1f84'];
// `ref` is what routes/find_sites.py site_ref returns for the same anchor name at
// the published coordinates — the ref the backend's own free preview carries.
const COARSE = [
  { lat: 39, lon: -77.5, ref: 'site_58e9b2345e',
    next: ['analyze_site lat=39 lon=-77.5', 'get_fiber_readiness lat=39 lon=-77.5'] },
  { lat: 39, lon: -77.4, ref: 'site_4993a5166e',
    next: ['analyze_site lat=39 lon=-77.4', 'get_fiber_readiness lat=39 lon=-77.4'] },
];

let S, PORT, httpServer, stub;
const creditHits = new Map();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(KEY_TIER[key]
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_coarsen', email: null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (url.pathname === '/api/v1/mcp/credits/balance') {
        const key = url.searchParams.get('key') || '';
        bump(creditHits, key || 'keyless');
        res.end(JSON.stringify({ credits: key === K_PACK ? 900 : 0, had_pack: key === K_PACK }));
        return;
      }
      if (url.pathname === '/api/v1/sites/find') {
        res.end(JSON.stringify({ success: true, _entity: 'site_candidates', count: CANDIDATES.length,
          anchors_considered: 7, filter: { state: 'VA', lat: null, lon: null }, candidates: CANDIDATES }));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, json };
}

/** One find_sites call on a fresh session: its text, structuredContent and leading JSON. */
async function findSites(key) {
  const headers = key ? { 'x-api-key': key } : {};
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'coarsen-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { json } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'find_sites', arguments: { state: 'VA' } } });
  const r = JSON.parse(json).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('');
  return { text, sc: r.structuredContent || null, lead: leadingJson(text) || {} };
}

/** The JSON object the tool leads its text with (prose may follow it). */
function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

function expectFreePreview(out, label) {
  for (const [where, body] of [['text', out.lead], ['structuredContent', out.sc || {}]]) {
    const cands = body.candidates || [];
    expect(cands.length, `${label} ${where}: candidates missing — the checks below would be vacuous`).toBe(2);
    cands.forEach((c, i) => {
      expect(c.lat, `${label} ${where} #${i} lat`).toBe(COARSE[i].lat);
      expect(c.lon, `${label} ${where} #${i} lon`).toBe(COARSE[i].lon);
      expect(c.coordinate_precision_km, `${label} ${where} #${i} precision`).toBe(11);
      expect(c.site_ref, `${label} ${where} #${i} site_ref`).toBe(COARSE[i].ref);
      expect(c.anchor.operator, `${label} ${where} #${i} operator`).toBeNull();
      expect(c.anchor.capacity_mva, `${label} ${where} #${i} capacity_mva`).toBeNull();
      // The public fields a free caller steers by survive.
      expect(c.anchor.name, `${label} ${where} #${i} anchor name`).toBe(CANDIDATES[i].anchor.name);
      expect(c.anchor.voltage_kv, `${label} ${where} #${i} voltage`).toBe(CANDIDATES[i].anchor.voltage_kv);
      expect(c.gas_distance_km, `${label} ${where} #${i} gas distance`).toBe(CANDIDATES[i].gas_distance_km);
      expect(c.next_calls.slice(0, 2), `${label} ${where} #${i} next_calls`).toEqual(COARSE[i].next);
    });
    expect(body._gated, `${label} ${where}: _gated`).toBe(true);
    // `_upgrade` is not asserted: a keyless answer's is replaced downstream by the
    // anonymous claim-first CTA. This line is the one that names what is withheld.
    expect(String(body._upgrade_cta || ''), `${label} ${where}: _upgrade_cta`).toContain('coarsened to ~11 km');
  }
  for (const needle of EXACT_NEEDLES) {
    expect(out.text.includes(needle), `${label}: exact value "${needle}" reached the text`).toBe(false);
    expect(JSON.stringify(out.sc || {}).includes(needle), `${label}: exact value "${needle}" reached structuredContent`).toBe(false);
  }
}

function expectUnchanged(out, label) {
  for (const [where, body] of [['text', out.lead], ['structuredContent', out.sc || {}]]) {
    expect(body.candidates, `${label} ${where}: candidates differ from the backend payload`).toEqual(CANDIDATES);
    expect(body._gated, `${label} ${where}: a paid answer was marked gated`).toBeUndefined();
  }
}

describe('r-find-sites-free-coarsen — find_sites keeps its free-tier promise', () => {
  it('THE REPRO: a keyless caller gets ~11 km coordinates, no operator or capacity', async () => {
    expectFreePreview(await findSites(null), 'keyless');
  });

  it('a free (identified) key gets the same preview', async () => {
    expectFreePreview(await findSites(K_IDENT), 'identified');
  });

  for (const [key, label] of [[K_STARTER, 'starter'], [K_DEV, 'developer'], [K_PRO, 'pro']]) {
    it(`${label}: unchanged — exact coordinates, operator and capacity as the backend sent them`, async () => {
      expectUnchanged(await findSites(key), label);
      expect(creditHits.get(key) || 0, `${label}: a paid tier should not need the pack-balance lookup`).toBe(0);
    });
  }

  it('free site_ref is the same anywhere inside the published cell, distinct per anchor, never passed through', () => {
    const ref = (cand) => S._coarsenFindSites({ candidates: [cand] }).candidates[0].site_ref;
    const base = CANDIDATES[0];
    // Four exact positions that all publish as (39, -77.5), each arriving with its
    // own backend ref: the free ref must not move with the exact position.
    const inCell = [[39.04371, -77.48749], [38.96122, -77.53911], [39.03881, -77.46021], [38.95127, -77.54012]]
      .map(([lat, lon], i) => ref({ ...base, lat, lon, site_ref: `site_exact_${i}` }));
    expect(new Set(inCell), 'free site_ref varies inside one published cell').toEqual(new Set([COARSE[0].ref]));
    expect(ref({ ...base, anchor: { ...base.anchor, name: 'Another Sub' } }), 'distinct anchors share a ref')
      .not.toBe(COARSE[0].ref);
    expect(ref({ ...base, lat: 39.14371 }), 'the next cell over shares a ref').not.toBe(COARSE[0].ref);
    // Coordinates that are not numbers: no ref at all, never the backend's.
    for (const bad of [null, undefined, '', 'n/a', true]) {
      expect(ref({ ...base, lat: bad }), `lat=${String(bad)}`).toBeNull();
    }
    // A candidate the backend sent without a site_ref does not gain one.
    const { site_ref: _drop, ...noRef } = base;
    expect('site_ref' in S._coarsenFindSites({ candidates: [noRef] }).candidates[0]).toBe(false);
  });

  it('an identified key holding a live $10 pack balance: unchanged (the pack is a paid read)', async () => {
    expectUnchanged(await findSites(K_PACK), 'identified + pack');
    expect(creditHits.get(K_PACK), 'the pack balance was never read').toBeGreaterThan(0);
  });
});
