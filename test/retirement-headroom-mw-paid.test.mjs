// retirement-headroom-mw-paid.test.mjs — be#5886 parity (2026-09-29)
//
// ★THE DEFECT. dchub-backend#5886 made /api/v1/retirement-headroom null its MW
// figures (data[].generator.capacity_mw, data[].queue_pressure.competing_mw,
// total_retiring_mw) for every caller below Developer, the $10 pack included
// (pack_opens=False). It answers this server's X-Internal-Key in full, so the
// MCP tool had to mask on its own, and only the anonymous trim did: a FREE KEY
// got every MW figure.
//
// Drives the real get_retirement_headroom handler through POST /mcp on the real
// express app, at no key, free key, identified+pack key, starter, and Pro. The
// stub backend always returns the full figures, as it does to X-Internal-Key.
//
// HARD gate: deterministic, and its only network is two 127.0.0.1 listeners.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const K_FREE = 'dch_live_retiremw_free00001';
const K_PACK = 'dch_live_retiremw_packs0001';   // identified key holding a live $10 pack balance
const K_STARTER = 'dch_live_retiremw_start0001';
const K_DEV = 'dch_live_retiremw_devel0001';
const K_PRO = 'dch_live_retiremw_propro001';
const KEY_TIER = { [K_FREE]: 'free', [K_PACK]: 'identified', [K_STARTER]: 'starter',
  [K_DEV]: 'developer', [K_PRO]: 'pro' };
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};

// Full figures, deliberately ordered by MW (the paid ordering) so the masked
// re-order by date then name is observable.
// P0-1 tail (2026-10-05): the nearest substations' name and exact distance are
// Pro. Below Pro (the pack and Developer included) each is a distance band.
const BANDED = (rows) => rows.map((r) => ({ ...r,
  nearest_substations: r.nearest_substations.map(() => ({ distance_band: 'within 5 km' })) }));
const ROWS = [
  { generator: { name: 'Zeta Station', generator_id: '1', capacity_mw: 812.4, fuel_category: 'Coal',
      prime_mover: 'ST', retirement_date: '2026-12-31', state: 'IN', county: 'Pike' },
    iso_context: 'MISO', representative_point: { lat: 38.4, lng: -87.3 },
    nearest_substations: [{ name: 'Sub A', distance_km: 2.1 }], substations_within_25km: 7,
    queue_pressure: { competing_mw: 4417.3, competing_projects: 12, scope: 'county', county_state: 'Pike, IN' } },
  { generator: { name: 'Alpha Plant', generator_id: '2', capacity_mw: 377.9, fuel_category: 'Natural Gas',
      prime_mover: 'CT', retirement_date: '2026-12-31', state: 'IL', county: 'Will' },
    iso_context: 'MISO', representative_point: { lat: 41.4, lng: -88.1 },
    nearest_substations: [{ name: 'Sub B', distance_km: 3.4 }], substations_within_25km: 4,
    queue_pressure: { competing_mw: 2963.8, competing_projects: 9, scope: 'county', county_state: 'Will, IL' } },
];
const TOTAL = 1190.3;
const NEEDLES = ['812.4', '377.9', '4417.3', '2963.8', '1190.3'];
const leaks = (hay, needle) => new RegExp(`(?<![0-9A-Za-z_.])${needle.replace(/\./g, '\\.')}(?![0-9A-Za-z_])`).test(hay);

let S, PORT, httpServer, stub;
const targetSeen = [];
const burnSeen = [];

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
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_retiremw', email: 'x@example.com' }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (url.pathname === '/api/v1/mcp/credits/balance') {
        const key = url.searchParams.get('key') || '';
        res.end(JSON.stringify({ credits: key === K_PACK ? 900 : 0, had_pack: key === K_PACK }));
        return;
      }
      if (url.pathname === '/api/v1/mcp/credits/burn') {
        burnSeen.push(await readBody(req));
        res.end('{}');
        return;
      }
      if (url.pathname === '/api/v1/retirement-headroom') {
        targetSeen.push(url.searchParams.get('target_mw'));
        res.end(JSON.stringify({ _entity: 'retirement_headroom_results', ok: true,
          meta: { horizon_months: 18, caveat: 'filed dates are subject to ISO reliability reviews' },
          total_retiring_mw: TOTAL, data: ROWS, _cite: 'DC Hub (dchub.cloud)' }));
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

async function retirement(key, args = { target_mw: 50, horizon_months: 18, region_iso: 'MISO' }) {
  for (const m of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) m.clear();
  const headers = key ? { 'x-api-key': key } : {};
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'retire-mw-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  targetSeen.length = 0;
  const { json } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'get_retirement_headroom', arguments: args } });
  const r = JSON.parse(json).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('');
  return { text, sc: r.structuredContent || null, r };
}

function expectMasked(out, label) {
  const body = out.sc || {};
  const rows = body.data || [];
  expect(rows.length, `${label}: no rows reached the answer — the checks below would be vacuous`).toBeGreaterThan(0);
  rows.forEach((row, i) => {
    expect(row.generator.capacity_mw, `${label} #${i} capacity_mw`).toBeNull();
    if (row.queue_pressure) expect(row.queue_pressure.competing_mw, `${label} #${i} competing_mw`).toBeNull();
    expect(typeof row.generator.name, `${label} #${i}: the generator name was dropped`).toBe('string');
  });
  expect(body.total_retiring_mw, `${label}: total_retiring_mw`).toBeNull();
  for (const needle of NEEDLES) {
    expect(leaks(out.text, needle), `${label}: MW "${needle}" reached the text`).toBe(false);
    expect(leaks(JSON.stringify(out.sc || {}), needle), `${label}: MW "${needle}" reached structuredContent`).toBe(false);
  }
}

describe('be#5886 parity — get_retirement_headroom MW is Developer+', () => {
  it('no key: MW null', async () => {
    expectMasked(await retirement(null), 'keyless');
  });

  it('THE REPRO: a free key gets every row with the MW null, the marker and the upgrade hint', async () => {
    const out = await retirement(K_FREE);
    expectMasked(out, 'free');
    const b = out.sc;
    expect(b.data.length, 'free: a keyed preview keeps every row').toBe(ROWS.length);
    expect(b._gated).toBe(true);
    expect(b._preview_only).toBe(true);
    expect(b._locked_fields).toEqual(['data[].generator.capacity_mw', 'data[].queue_pressure.competing_mw', 'total_retiring_mw']);
    expect(b._upgrade && b._upgrade.tier_required).toBe('developer');
    expect(b._upgrade.next_tool).toBe('unlock_more_data');
    // rows are ordered by date then name, not by the MW they hide
    expect(b.data.map((r) => r.generator.name)).toEqual(['Alpha Plant', 'Zeta Station']);
    // everything else is kept
    expect(b.data[0].nearest_substations).toEqual([{ distance_band: 'within 5 km' }]);
    expect(b.data[0].queue_pressure.competing_projects).toBe(9);
  });

  it('a free key cannot sweep target_mw: it is pinned to the default and the answer says so', async () => {
    const out = await retirement(K_FREE, { target_mw: 400, horizon_months: 18 });
    expect(targetSeen, 'the backend was not called — the check is vacuous').not.toHaveLength(0);
    expect(targetSeen.every((t) => t === '50'), `backend saw target_mw ${JSON.stringify(targetSeen)}`).toBe(true);
    expect(out.sc._ignored_params && out.sc._ignored_params.target_mw).toContain('paid filter');
  });

  // ladder stage 1 (owner 2026-09-29): the $10 pack is Developer depth paid per
  // call, so a pack balance opens the MW here and the call burns its credits. REST
  // (be#5886) still masks it for a pack — a backend follow-up.
  it('an identified key holding a $10 pack balance: every MW figure, target_mw passed through, credits burned', async () => {
    burnSeen.length = 0;
    const out = await retirement(K_PACK, { target_mw: 400, horizon_months: 18 });
    expect(targetSeen).toEqual(['400']);
    const b = out.sc || {};
    expect(b.data, 'pack: rows differ from the backend payload').toEqual(BANDED(ROWS));
    expect(b.total_retiring_mw).toBe(TOTAL);
    expect(b._gated).toBeUndefined();
    for (let i = 0; i < 50 && !burnSeen.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(burnSeen.map((x) => x.tool)).toEqual(['get_retirement_headroom']);
  });

  it('starter: masked (Starter is below Developer)', async () => {
    expectMasked(await retirement(K_STARTER), 'starter');
  });

  for (const [key, label] of [[K_DEV, 'developer'], [K_PRO, 'pro']]) {
    it(`${label}: unchanged — every MW figure as the backend sent it, target_mw passed through`, async () => {
      const out = await retirement(key, { target_mw: 400, horizon_months: 18 });
      expect(targetSeen).toEqual(['400']);
      const b = out.sc || {};
      expect(b.data, `${label}: rows differ from the backend payload`).toEqual(label === 'pro' ? ROWS : BANDED(ROWS));
      expect(b.total_retiring_mw).toBe(TOTAL);
      expect(b._gated).toBeUndefined();
      expect(b._locked_fields).toBeUndefined();
    });
  }

  it('the tier predicate: only Developer and above open the MW', () => {
    for (const t of ['developer', 'paid', 'pro', 'founding', 'team', 'enterprise', 'research_seed', 'admin']) {
      expect(S._retirementMwFull(t), t).toBe(true);
    }
    for (const t of ['', undefined, 'anonymous', 'free', 'identified', 'trial', 'starter', 'metered', 'bogus']) {
      expect(S._retirementMwFull(t), String(t)).toBe(false);
    }
  });

  it('an error body passes through the mask untouched', () => {
    const err = { error: 'API 503' };
    expect(S._maskRetirementHeadroom(err)).toBe(err);
  });
});
