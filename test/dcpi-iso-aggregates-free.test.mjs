// dcpi-iso-aggregates-free.test.mjs — r-teaser-parity (2026-09-21)
//
// ★THE DEFECT. /api/v1/dcpi/iso-comparison nulls every per-ISO aggregate except
// the market counts for a caller it does not count as paid (routes/dcpi.py
// _mask_iso_rows_inplace). It counts the MCP server's own X-Internal-Key as
// paid, so the rows reached every MCP caller whole:
//   • get_grid_scoreboard (a free tool) published queue wait, curtailment and
//     30-day grid emergencies per US grid to keyless callers;
//   • the free previews of compare_isos and get_grid_intelligence kept
//     time-to-power, queue wait, retail price and grid emergencies — no preview
//     rule matched those four names.
// Measured through this file's harness before the fix: the keyless scoreboard
// carried avg_queue_wait_months 37.5791 for PJM; the keyless compare_isos
// preview carried retail_price_cents_kwh 8.6421 and grid_emergencies_30d 913.
//
// ★Paid tiers are pinned unchanged, and so is an identified key holding a live
// $10 pack balance. The scoreboard is ONE cached entry served to every caller,
// so its mask runs on the way out; the cold, fresh-hit and stale paths are each
// driven here, and the cache is shown to still hold the full rows.
//
// HARD gate: deterministic, and its only network is two 127.0.0.1 listeners
// (a stub backend and the real express app).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'node:http';

const K_FREE = 'dch_live_dcpiiso_free00001';
const K_IDENT = 'dch_live_dcpiiso_ident0001';
const K_TRIAL = 'dch_live_dcpiiso_trial0001';
const K_PACK = 'dch_live_dcpiiso_packs0001';    // identified key holding a live $10 pack balance
const K_STARTER = 'dch_live_dcpiiso_start0001';
const K_DEV = 'dch_live_dcpiiso_devel0001';
const K_PRO = 'dch_live_dcpiiso_propro001';
const KEY_TIER = { [K_FREE]: 'free', [K_IDENT]: 'identified', [K_TRIAL]: 'trial', [K_PACK]: 'identified',
  [K_STARTER]: 'starter', [K_DEV]: 'developer', [K_PRO]: 'pro' };
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};

// What the backend returns to a caller it counts as paid. Every aggregate is a
// distinct value so a leak names its field.
const ISOS = ['PJM', 'ERCOT', 'CAISO', 'MISO', 'SPP', 'NYISO', 'ISONE'];
const ROWS = ISOS.map((iso, i) => ({
  iso, iso_name: `${iso} grid`, market_count: 30 + i, build_count: 10 + i, latest_computed_at: '2026-09-21T00:00:00Z',
  avg_excess: 41.3571 + i, avg_constraint: 52.4681 + i, avg_queue_wait_months: 37.5791 + i,
  avg_kwh_cents: 8.6421 + i, avg_reserve_margin_pct: 17.2461 + i, total_stranded_capacity_mw: 12345.678 + i,
  avg_curtailment_pct: 3.14159 + i, sum_emergency_30d: 913 + i, avg_time_to_power_months: 29.8642 + i,
}));
const BY_ISO = Object.fromEntries(ROWS.map((r) => [r.iso, r]));
// The four DCPI fields shapeGridIntelligence publishes that no older preview rule matched.
const PREVIEW_FIELDS = { avg_time_to_power_months: 'avg_time_to_power_months', avg_queue_wait_months: 'avg_queue_wait_months',
  retail_price_cents_kwh: 'avg_kwh_cents', grid_emergencies_30d: 'sum_emergency_30d' };
const SCOREBOARD_FIELDS = { avg_queue_wait_months: 'avg_queue_wait_months', avg_curtailment_pct: 'avg_curtailment_pct',
  grid_emergencies_30d: 'sum_emergency_30d' };
const NEEDLES = ROWS.flatMap((r) => [String(r.avg_queue_wait_months), String(r.avg_kwh_cents),
  String(r.avg_curtailment_pct), String(r.avg_time_to_power_months), `":${r.sum_emergency_30d}`]);

let S, PORT, httpServer, stub;
let isoCmpHits = 0;
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
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_dcpiiso', email: null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (url.pathname === '/api/v1/mcp/credits/balance') {
        const key = url.searchParams.get('key') || '';
        bump(creditHits, key || 'keyless');
        res.end(JSON.stringify({ credits: key === K_PACK ? 900 : 0, had_pack: key === K_PACK }));
        return;
      }
      if (url.pathname === '/api/v1/dcpi/iso-comparison') {
        isoCmpHits += 1;
        res.end(JSON.stringify({ as_of: '2026-09-21T00:00:00Z', count: ROWS.length, isos: ROWS }));
        return;
      }
      const gi = url.pathname.match(/^\/api\/v1\/grid\/intelligence\/([A-Za-z-]+)$/);
      if (gi) {
        res.end(JSON.stringify({ iso: gi[1].toUpperCase(), demand_mw: 50000, demand_period: '2026-09-21T10',
          generation_mix_period: '2026-09-21T06', generation_mix: { NG: 20000, WND: 10000, SUN: 5000, NUC: 8000 } }));
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
  vi.restoreAllMocks();
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

/** One tool call on a fresh session, with the per-IP anonymous counters cleared. */
async function callTool(key, name, args = {}) {
  for (const m of [S._anonUsageCounts, S._trialDayCounts, S._fullCapHydrated]) m.clear();
  const headers = key ? { 'x-api-key': key } : {};
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dcpi-iso-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { json } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
  const r = JSON.parse(json).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('');
  return { text, sc: r.structuredContent || null, lead: leadingJson(text) || {} };
}

function expectNoNeedles(out, label) {
  for (const needle of NEEDLES) {
    expect(out.text.includes(needle), `${label}: "${needle}" reached the text`).toBe(false);
    expect(JSON.stringify(out.sc || {}).includes(needle), `${label}: "${needle}" reached structuredContent`).toBe(false);
  }
}

// ── get_grid_scoreboard ─────────────────────────────────────────────────────
function scoreboardBodies(out) {
  const list = [['text', out.lead]];
  if (out.sc && Array.isArray(out.sc.grids)) list.push(['structuredContent', out.sc]);
  return list;
}
function enriched(body) {
  return (body.grids || []).filter((g) => g && g.dcpi_detail);
}
const normIso = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

function expectScoreboardLocked(out, label) {
  for (const [where, body] of scoreboardBodies(out)) {
    const grids = enriched(body);
    expect(grids.length, `${label} ${where}: no grid carried dcpi_detail — the checks below would be vacuous`).toBe(ISOS.length);
    for (const g of grids) {
      const row = BY_ISO[normIso(g.iso)];
      expect(row, `${label} ${where}: ${g.iso} has no stub row`).toBeTruthy();
      for (const f of Object.keys(SCOREBOARD_FIELDS)) {
        expect(g.dcpi_detail[f], `${label} ${where} ${g.iso}.${f}`).toBeNull();
      }
      expect(g.dcpi_detail._locked_fields, `${label} ${where} ${g.iso}._locked_fields`).toEqual(Object.keys(SCOREBOARD_FIELDS));
      // The market counts are free on the backend and stay free here.
      expect(g.dcpi_detail.build_markets, `${label} ${where} ${g.iso}.build_markets`).toBe(row.build_count);
      expect(g.dcpi_detail.total_markets, `${label} ${where} ${g.iso}.total_markets`).toBe(row.market_count);
      expect(g.dcpi_detail.build_rate_pct, `${label} ${where} ${g.iso}.build_rate_pct`)
        .toBe(Math.round((row.build_count / row.market_count) * 1000) / 10);
    }
  }
  expectNoNeedles(out, label);
}

function expectScoreboardFull(out, label) {
  for (const [where, body] of scoreboardBodies(out)) {
    const grids = enriched(body);
    expect(grids.length, `${label} ${where}: no grid carried dcpi_detail`).toBe(ISOS.length);
    for (const g of grids) {
      const row = BY_ISO[normIso(g.iso)];
      for (const [f, src] of Object.entries(SCOREBOARD_FIELDS)) {
        expect(g.dcpi_detail[f], `${label} ${where} ${g.iso}.${f}`).toBe(row[src]);
      }
      expect(g.dcpi_detail._locked_fields, `${label} ${where} ${g.iso}: a paid answer was marked locked`).toBeUndefined();
    }
  }
}

async function until(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return pred();
}

// ── compare_isos / get_grid_intelligence previews ─────────────────────────
function expectPreviewLocked(row, label) {
  expect(row && row.iso_name, `${label}: the DCPI-joined row is missing — the checks below would be vacuous`)
    .toMatch(/ grid$/);
  for (const f of Object.keys(PREVIEW_FIELDS)) {
    expect(row[f], `${label}.${f}`).toBeNull();
    expect(row[`_${f}_in_pro`], `${label}._${f}_in_pro`).toBe(true);
  }
}
function expectPreviewFull(row, iso, label) {
  expect(row && row.iso_name, `${label}: the DCPI-joined row is missing`).toBe(`${iso} grid`);
  for (const [f, src] of Object.entries(PREVIEW_FIELDS)) {
    expect(row[f], `${label}.${f}`).toBe(BY_ISO[iso][src]);
  }
}

describe('r-teaser-parity — DCPI per-ISO aggregates stay paid', () => {
  it('get_grid_scoreboard: masked on the cold, fresh-hit and stale paths; the cache keeps the full rows', async () => {
    // Cold: the first call in this process builds the entry.
    expect(isoCmpHits, 'the scoreboard was already built before this test').toBe(0);
    expectScoreboardLocked(await callTool(null, 'get_grid_scoreboard'), 'keyless (cold build)');
    expect(isoCmpHits, 'the cold call did not build the scoreboard').toBe(1);

    // Fresh hit, built by a keyless caller: a paid caller still gets every value.
    expectScoreboardFull(await callTool(K_PRO, 'get_grid_scoreboard'), 'pro (fresh hit)');
    expectScoreboardLocked(await callTool(null, 'get_grid_scoreboard'), 'keyless (fresh hit)');
    expect(isoCmpHits, 'a fresh hit rebuilt the scoreboard').toBe(1);

    // Stale: served at once, refreshed behind the response.
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 91_000);
    try {
      expectScoreboardLocked(await callTool(null, 'get_grid_scoreboard'), 'keyless (stale)');
      expect(await until(() => isoCmpHits === 2), 'the stale call did not start the background refresh').toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  for (const [key, label] of [[K_FREE, 'free'], [K_IDENT, 'identified'], [K_TRIAL, 'trial']]) {
    it(`get_grid_scoreboard: a ${label} key gets the locked detail`, async () => {
      expectScoreboardLocked(await callTool(key, 'get_grid_scoreboard'), label);
    });
  }

  for (const [key, label] of [[K_STARTER, 'starter'], [K_DEV, 'developer'], [K_PRO, 'pro']]) {
    it(`get_grid_scoreboard: ${label} is unchanged`, async () => {
      expectScoreboardFull(await callTool(key, 'get_grid_scoreboard'), label);
      expect(creditHits.get(key) || 0, `${label}: a paid tier should not need the pack-balance lookup`).toBe(0);
    });
  }

  it('get_grid_scoreboard: an identified key holding a live $10 pack balance is unchanged', async () => {
    expectScoreboardFull(await callTool(K_PACK, 'get_grid_scoreboard'), 'identified + pack');
    expect(creditHits.get(K_PACK), 'the pack balance was never read').toBeGreaterThan(0);
  });

  for (const [key, label] of [[null, 'keyless'], [K_IDENT, 'identified']]) {
    it(`compare_isos: the ${label} preview withholds the four DCPI aggregates`, async () => {
      const out = await callTool(key, 'compare_isos', { isos: 'PJM,ERCOT' });
      for (const iso of ['PJM', 'ERCOT']) expectPreviewLocked((out.lead.comparison || {})[iso], `${label} ${iso}`);
      expectNoNeedles(out, `compare_isos ${label}`);
    });
  }

  it('get_grid_intelligence: the keyless preview withholds the four DCPI aggregates', async () => {
    const out = await callTool(null, 'get_grid_intelligence', { iso: 'ERCOT' });
    expectPreviewLocked(out.lead, 'keyless ERCOT');
    expectNoNeedles(out, 'get_grid_intelligence keyless');
  });

  for (const [key, label] of [[K_STARTER, 'starter'], [K_PRO, 'pro']]) {
    it(`compare_isos and get_grid_intelligence: ${label} is unchanged`, async () => {
      const cmp = await callTool(key, 'compare_isos', { isos: 'PJM,ERCOT' });
      for (const iso of ['PJM', 'ERCOT']) expectPreviewFull((cmp.lead.comparison || {})[iso], iso, `${label} compare_isos ${iso}`);
      expectPreviewFull((await callTool(key, 'get_grid_intelligence', { iso: 'ERCOT' })).lead, 'ERCOT', `${label} get_grid_intelligence`);
    });
  }
});
