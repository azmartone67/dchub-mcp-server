// anon-facility-free-fields.test.mjs — r-anon-facility-allowlist (2026-09-21)
//
// ★THE DEFECT. A keyed free/identified caller of search_facilities/get_facility
// has every facility row projected to the free allowlist (_FACILITY_FREE_FIELDS).
// The free-class trims that serve those two tools WITHOUT a key did not project:
// they ran trimForTrial, which nulls metric-named numbers and slices long lists
// but keeps every other field. So a row carrying jv_partners, power-procurement
// notes or investment_usd kept all three for an anonymous caller, who saw fields
// a keyed free caller does not. Measured through this file's harness before the
// fix, on each branch below: jv_partners, power_procurement_notes, investment_usd,
// acreage and total_sqft (as a key) all reached the anonymous answer.
//
// The branches, each of which ran trimForTrial alone: the anonymous preview, the
// capped-limit preview (limit above the free max), the anonymous over-daily-cap
// trim, and the depleted-pack re-up teaser (get_facility is PAID_ONLY, and a pack
// can be bound to a session with no key). Each now projects through
// _freeFacilityRows first. The stub serves the whole row on purpose: the MCP mask
// is the tier gate here and must not lean on the backend's own projection.
//
// ★Why the controls: every assertion below is an ABSENCE. The developer-key and
// pack-holder tests prove the stub really serves each paid field (and that paying
// callers keep them), so an absence is the mask's doing. A keyless session with a
// live pack balance is a paying caller, so its search_facilities rows must not be
// narrowed by this change either. Each anonymous test also
// asserts its branch's own _upgrade / _upgrade_notice signature, so a pass cannot
// come from a different branch that happens to strip more. The allowlist is not
// copied here: rows are compared against the keys a KEYED free caller gets from
// the same stub, which is the invariant this file exists for.
//
// HARD gate: deterministic, and its only network is two 127.0.0.1 listeners
// (a stub backend and the real express app).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const K_FREE = 'dch_live_anonmask_freekey01';
const K_DEV = 'dch_live_anonmask_develop01';
const KEY_TIER = { [K_FREE]: 'free', [K_DEV]: 'developer' };
const OVER_CAP_IP = '198.51.100.7';            // documentation range; the stub reports it over the cap
const ANON_CAP = 5;
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_TRIAL_PREVIEW_ROWS'];
const prevEnv = {};

// Every value a free-class caller must not see, each distinctive enough to grep for.
const PAID = {
  power_mw: 48.5, total_sqft: 250001, raw_data: { source_row: 'anonmask-raw-row' },
  address: '1 Anonmask Example Road', jv_partners: 'Anonmask JV Partner',
  power_procurement_notes: 'anonmask procurement note', investment_usd: 731000017,
  acreage: 131.5, confidence_score: 0.93,
};
const PAID_NEEDLES = ['power_mw', '48.5', 'total_sqft', '250001', 'raw_data', 'anonmask-raw-row',
  'Anonmask Example Road', 'jv_partners', 'Anonmask JV Partner', 'procurement', 'investment_usd',
  '731000017', 'acreage', '131.5', 'confidence_score'];
const ROWS = 5;                                  // more than the preview keeps, so the row trim is visible
const record = (i) => ({
  id: `fac-${i}`, name: `Anonmask DC ${i}`, slug: `anonmask-dc-${i}`, provider: 'Anonmask Provider',
  city: 'Ashburn', state: 'VA', country: 'US', status: 'operational',
  latitude: 39.1, longitude: -77.5, ...PAID,
});

let S, PORT, httpServer, stub;
const depleted = new Set();      // session ids whose pack is spent (credits 0, had_pack)
const holding = new Set();       // session ids holding pack credits
const facilityLimits = [];       // the `limit` each /api/v1/facilities call carried

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const u = new URL(req.url, 'http://_');
      const p = u.pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/keys/validate') {
        let b = '';
        for await (const ch of req) b += ch;
        let key = '';
        try { key = JSON.parse(b || '{}').api_key || ''; } catch (_) { /* empty body */ }
        res.end(JSON.stringify(KEY_TIER[key]
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_anonmask', email: null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: true, prior_calls: 1 })); return; }
      if (p === '/api/v1/mcp/anon-usage') {
        res.end(JSON.stringify({ count: u.searchParams.get('ip') === OVER_CAP_IP ? ANON_CAP : 0 }));
        return;
      }
      if (p === '/api/v1/mcp/credits/balance') {
        const sid = u.searchParams.get('session') || '';
        res.end(JSON.stringify(holding.has(sid) ? { credits: 1000, had_pack: true }
          : depleted.has(sid) ? { credits: 0, had_pack: true } : { credits: 0, had_pack: false }));
        return;
      }
      if (p === '/api/v1/facilities/fac-1') { res.end(JSON.stringify({ success: true, data: record(1) })); return; }
      if (p === '/api/v1/facilities') {
        facilityLimits.push(u.searchParams.get('limit'));
        const data = Array.from({ length: ROWS }, (_, i) => record(i + 1));
        res.end(JSON.stringify({ success: true, data, pagination: { page: 1, limit: 50, total: ROWS, pages: 1 } }));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  process.env.DCHUB_ANON_DAILY_CAP = String(ANON_CAP);   // arms the over-cap branch; every other IP reads 0
  delete process.env.DCHUB_TRIAL_PREVIEW_ROWS;
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

async function openSession(headers = {}) {
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'anonmask-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 1;
  return {
    sid,
    async call(name, args) {
      id += 1;
      const { json } = await post(h, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
      const r = JSON.parse(json).result || {};
      const text = (r.content || []).map((c) => c.text || '').join('');
      return { text, sc: r.structuredContent || null, lead: leadingJson(text) || {} };
    },
  };
}

/** The JSON object a data tool leads its text with (prose may follow it). */
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

/** The facility row an answer carries: the first row of a list, or the one record. */
const rowOf = (lead) => (Array.isArray(lead.data) ? lead.data[0] : lead.data) || {};

// The keys a KEYED free caller's search_facilities row carries from this stub —
// the reference every anonymous row is held to. Read once, from the real path.
let _freeKeys = null;
async function keyedFreeRowKeys() {
  if (_freeKeys) return _freeKeys;
  const out = await (await openSession({ 'x-api-key': K_FREE })).call('search_facilities', { state: 'VA' });
  expect(String((out.lead._upgrade || {}).message || ''), 'the reference row did not come from the keyed free mask')
    .toContain('Free tier: facility capacity (MW)');
  const row = rowOf(out.lead);
  expect(row.name, 'the keyed free reference row is empty').toMatch(/^Anonmask DC /);
  _freeKeys = new Set(Object.keys(row));
  return _freeKeys;
}

async function expectFreeAllowlist(out, label) {
  const row = rowOf(out.lead);
  expect(row.name, `${label}: no facility row came back — the absences below would be vacuous`).toMatch(/^Anonmask DC /);
  expect(row.provider, `${label}: a free field went missing`).toBe('Anonmask Provider');
  expect(row.slug, `${label}: a free field went missing`).toMatch(/^anonmask-dc-/);
  for (const needle of PAID_NEEDLES) {
    expect(out.text.includes(needle), `${label}: paid field "${needle}" reached the text`).toBe(false);
    expect(JSON.stringify(out.sc || {}).includes(needle), `${label}: paid field "${needle}" reached structuredContent`).toBe(false);
  }
  const free = await keyedFreeRowKeys();
  const extra = Object.keys(row).filter((k) => !free.has(k));
  expect(extra, `${label}: the anonymous row carries keys a keyed free row does not`).toEqual([]);
}

describe('r-anon-facility-allowlist — facility rows served without a key follow the free allowlist', () => {
  it('THE REPRO: anonymous preview (search_facilities) — paid fields gone, row trim and claim-first CTA kept', async () => {
    const out = await (await openSession()).call('search_facilities', { state: 'VA' });
    const up = out.lead._upgrade || {};
    expect(up.tier, 'not the anonymous preview').toBe('anonymous');
    expect(up.next_tool, 'the claim-first CTA went missing').toBe('claim_free_key');
    expect(out.lead.data.length, 'the preview row trim went missing').toBeLessThan(ROWS);
    expect(out.lead._data_total_in_pro, 'the honest full-length sibling went missing').toBe(ROWS);
    await expectFreeAllowlist(out, 'anonymous preview');
  });

  it('anonymous capped limit (search_facilities limit above the free max) — paid fields gone', async () => {
    const before = facilityLimits.length;
    const out = await (await openSession()).call('search_facilities', { state: 'VA', limit: 100 });
    expect(facilityLimits.slice(before), 'the backend call was not capped').toEqual(['25']);
    expect(String((out.lead._upgrade_notice || {}).message || ''), 'not the capped-limit branch').toContain('capped results at 25');
    expect(out.lead._data_total_in_pro, 'the preview row trim went missing').toBe(ROWS);
    await expectFreeAllowlist(out, 'capped anonymous');
  });

  it('anonymous over the daily cap (search_facilities) — paid fields gone', async () => {
    const out = await (await openSession({ 'x-forwarded-for': OVER_CAP_IP })).call('search_facilities', { state: 'VA' });
    expect((out.lead._upgrade || {}).tier, 'not the over-cap branch').toBe('anon_daily_cap');
    expect(out.lead._data_total_in_pro, 'the preview row trim went missing').toBe(ROWS);
    await expectFreeAllowlist(out, 'over-cap anonymous');
  });

  it('depleted pack on a keyless session (get_facility) — the re-up teaser carries no paid field', async () => {
    const s = await openSession();
    depleted.add(s.sid);
    const out = await s.call('get_facility', { id: 'fac-1' });
    expect((out.lead._upgrade || {}).tier, 'not the depleted-pack teaser').toBe('credits_depleted');
    await expectFreeAllowlist(out, 'depleted-pack get_facility');
  });

  it('CONTROL: a developer key gets every paid field the stub serves', async () => {
    const s = await openSession({ 'x-api-key': K_DEV });
    for (const [tool, args] of [['get_facility', { id: 'fac-1' }], ['search_facilities', { state: 'VA' }]]) {
      const row = rowOf((await s.call(tool, args)).lead);
      expect(row.jv_partners, `${tool}: jv_partners`).toBe('Anonmask JV Partner');
      expect(row.power_procurement_notes, `${tool}: procurement notes`).toBe('anonmask procurement note');
      expect(row.investment_usd, `${tool}: investment_usd`).toBe(731000017);
      expect(row.acreage, `${tool}: acreage`).toBe(131.5);
      expect(row.power_mw, `${tool}: power_mw`).toBe(48.5);
      expect(row.total_sqft, `${tool}: total_sqft`).toBe(250001);
      expect(row.confidence_score, `${tool}: confidence_score`).toBe(0.93);
      expect((row.raw_data || {}).source_row, `${tool}: raw_data`).toBe('anonmask-raw-row');
      expect(row.address, `${tool}: address`).toBe('1 Anonmask Example Road');
    }
  });

  it('CONTROL: a keyless session holding pack credits gets the full get_facility record', async () => {
    const s = await openSession();
    holding.add(s.sid);
    const out = await s.call('get_facility', { id: 'fac-1' });
    const row = rowOf(out.lead);
    expect(out.lead._upgrade, 'a paid pack call was trimmed').toBeUndefined();
    expect(row.jv_partners).toBe('Anonmask JV Partner');
    expect(row.power_procurement_notes).toBe('anonmask procurement note');
    expect(row.investment_usd).toBe(731000017);
    expect(row.power_mw).toBe(48.5);
  });

  it('CONTROL: a keyless session holding pack credits is not narrowed on search_facilities', async () => {
    const s = await openSession();
    holding.add(s.sid);
    const row = rowOf((await s.call('search_facilities', { state: 'VA' })).lead);
    expect(row.name, 'no facility row came back').toMatch(/^Anonmask DC /);
    expect(row.jv_partners, 'a paying caller lost jv_partners').toBe('Anonmask JV Partner');
    expect(row.power_procurement_notes, 'a paying caller lost the procurement note').toBe('anonmask procurement note');
    expect(row.investment_usd, 'a paying caller lost investment_usd').toBe(731000017);
  });
});
