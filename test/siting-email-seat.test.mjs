// siting-email-seat.test.mjs — item 1 (owner 2026-10-16): the siting tools follow the email.
//
// WHAT THIS PINS (real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend, off-loopback
// connects refused):
//   A) a free key with NO bound email gets the keyless preview on find_sites,
//      site_selection_canvas and execute_plan (execute_plan's steps run keyless);
//   B) an email-bound key: find_sites returns every candidate at ~1 km with the anchor's
//      operator/kV still withheld; site_selection_canvas / execute_plan give ONE full answer per
//      UTC month through the backend monthly counter, then the preview; a backend that does not
//      list the tool (limit 0) fails closed to the preview;
//   C) keyless is unchanged;
//   D) DCHUB_NOEMAIL_PREVIEW_ONLY=0 restores the full answer for the no-email key;
//   E) the published clause is built from the enforced number and names no plan or price.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import * as L from '../lib/siting-email-seat.mjs';

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
// Fixture keys: test values only, never real credentials.
const NOEMAIL = 'dch_live_sitingnoemail0000000001';
const IDENT_NOEMAIL = 'dch_live_sitingidentnoemail00001';   // tier word 'identified', no email on the row
let keyN = 0;
const freshBound = () => 'dch_live_sitingbound' + String(100000 + (keyN++)).padStart(10, '0');

// 10 find_sites candidates at full precision, anchor detail present.
const FIND = {
  candidates: Array.from({ length: 10 }, (_, i) => ({
    lat: 40.123456 + i * 0.37, lon: -82.987654 - i * 0.41,
    gas_distance_km: 3.2 + i, fiber_distance_km: 1.1 + i,
    anchor: { type: 'substation', name: `Anchor Sub ${i}`, operator: `Operator ${i}`, voltage_kv: 345,
      capacity_mva: 900 + i, lat: 40.123456 + i * 0.37, lon: -82.987654 - i * 0.41, city: 'Columbus', state: 'OH', status: 'IN SERVICE' },
    next_calls: [`analyze_site lat=${(40.123456 + i * 0.37).toFixed(6)} lon=${(-82.987654 - i * 0.41).toFixed(6)}`],
  })),
  count: 10, constraint_coverage: {},
};
const CANVAS = {
  matched: 12, region: 'OH',
  shortlist: Array.from({ length: 12 }, (_, i) => ({ market: `Market ${i}`, slug: `market-${i}`, verdict: 'BUILD', iso: 'PJM' })),
  synthesis: { pick: 'Market 0', why: 'shortlist leader' },
};

let S, PORT, httpServer, stub, prevBase, prevSecret, prevPort, prevIsError, backendKnows = true;
const runs = new Map();          // `${key}|${tool}` -> used
const runHits = [];              // every lp-free-runs body
const dataHits = [];             // {path, key}
const LIMITS = { site_selection_canvas: 1, execute_plan: 1 };

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') {
        const k = (await readBody(req)).api_key || '';
        if (k === NOEMAIL) return send({ valid: true, tier: 'free', developer_id: 'd_noemail', email: null });
        if (k === IDENT_NOEMAIL) return send({ valid: true, tier: 'identified', developer_id: 'd_identne', email: null });
        if (k.startsWith('dch_live_sitingbound')) return send({ valid: true, tier: 'identified', developer_id: 'd_' + k.slice(-6), email: 'bound+' + k.slice(-6) + '@example.com' });
        return send({ valid: false, tier: 'free' });
      }
      if (p === '/api/v1/mcp/lp-free-runs') {
        const b = await readBody(req);
        runHits.push(b);
        const limit = backendKnows ? (LIMITS[b.tool] || 0) : 0;
        const id = `${b.api_key}|${b.tool}`;
        let used = runs.get(id) || 0;
        const out = (allowed) => send({ ok: true, allowed, used, limit, remaining: Math.max(0, limit - used),
          resets_at: '2026-11-01T00:00:00Z', email_bound: true, ...(allowed ? { source: 'free', charge_ref: 'free' } : {}) });
        if (limit <= 0) return out(false);
        if (b.op === 'consume') { if (used < limit) { used += 1; runs.set(id, used); return out(true); } return out(false); }
        if (b.op === 'release') { used = Math.max(0, used - 1); runs.set(id, used); return out(false); }
        return out(false);
      }
      if (p === '/api/v1/keys/auto-mint') return send({ ok: false });
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/mcp/signal-paywall') return send({ ok: true });
      if (p === '/api/v1/mcp/credits/balance') return send({ credits: 0 });
      dataHits.push({ path: p, key: req.headers['x-api-key'] || '' });
      if (p === '/api/v1/sites/find') return send(FIND);
      if (p === '/api/v1/site-selection/canvas') return send(CANVAS);
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  // execute_plan's steps loop back to 127.0.0.1:PORT, read once at import.
  prevPort = process.env.PORT;
  process.env.PORT = String(await freePort());
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  for (const [k, v] of [['DCHUB_PREVIEW_ISERROR', prevIsError], ['DCHUB_INTERNAL_KEY', prevSecret],
    ['DCHUB_API_BASE', prevBase], ['PORT', prevPort]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
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
let ipN = 20, rpcId = 100;
async function callAs(key, name, args) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  const text = (result.content || []).map((c) => c.text || '').join('\n');
  let data = {};
  try { data = JSON.parse((result.content || [])[0].text); } catch (_) { data = result.structuredContent || {}; }
  return { result, text, data };
}
const withEnv = async (k, v, fn) => { const prev = process.env[k]; process.env[k] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; } };
const PLAN_OR_PRICE = /\b(Developer|Pro|Starter|Enterprise|Founding)\b|\$\s?\d|\/mo\b|[Pp]er month|stripe\.com|1,000 (?:API )?credits|[Cc]redit pack|[Oo]ne-time pack/;
const decimals = (n) => { const s = String(n); return s.includes('.') ? s.split('.')[1].length : 0; };
const FIND_ARGS = { state: 'OH', min_voltage_kv: 230 };
const CANVAS_ARGS = { region: 'OH', capacity_mw: 100 };
const PLAN_ARGS = { intent: 'find sites for 100 MW in Ohio', state: 'OH', capacity_mw: 100 };

describe('C) keyless is unchanged (the baseline the no-email key must equal)', () => {
  it('find_sites: 3 candidates at ~11 km, no anchor name/operator/kV', async () => {
    const r = await callAs(null, 'find_sites', FIND_ARGS);
    expect(r.data.candidates, r.text.slice(0, 600)).toHaveLength(3);
    for (const c of r.data.candidates) {
      expect(decimals(c.lat)).toBeLessThanOrEqual(1);
      expect(c.anchor.name).toBeUndefined();
      expect(c.anchor.operator ?? null).toBeNull();
      expect(c.anchor.voltage_kv).toBeUndefined();
    }
  });
  it('site_selection_canvas: the keyless trim (3 shortlist rows)', async () => {
    const r = await callAs(null, 'site_selection_canvas', CANVAS_ARGS);
    expect(r.data.shortlist, r.text.slice(0, 600)).toHaveLength(3);
  });
});

describe('A) a free key with no bound email gets the keyless preview', () => {
  for (const key of [NOEMAIL, IDENT_NOEMAIL]) {
    it(`find_sites (${key.slice(0, 26)}): 3 of 10 at ~11 km, anchor withheld, next step bind_email`, async () => {
      const r = await callAs(key, 'find_sites', FIND_ARGS);
      expect(r.data.candidates, r.text.slice(0, 600)).toHaveLength(3);
      for (const c of r.data.candidates) {
        expect(decimals(c.lat)).toBeLessThanOrEqual(1);
        expect(c.coordinate_precision_km).toBe(11);
        expect(c.anchor.name).toBeUndefined();
        expect(c.anchor.voltage_kv).toBeUndefined();
      }
      expect(r.data._upgrade).toMatchObject({ next_tool: 'bind_email' });
      expect(r.text).not.toContain('claim_free_key');
      expect(r.text).not.toMatch(PLAN_OR_PRICE);
    });
  }
  it('site_selection_canvas: the keyless trim, no monthly run spent', async () => {
    const before = runHits.length;
    const r = await callAs(NOEMAIL, 'site_selection_canvas', CANVAS_ARGS);
    expect(r.data.shortlist, r.text.slice(0, 600)).toHaveLength(3);
    expect(r.data._upgrade).toMatchObject({ next_tool: 'bind_email' });
    expect(runHits.length, 'a no-email key never asks the monthly counter').toBe(before);
    expect(r.text).not.toMatch(PLAN_OR_PRICE);
  });
  it('execute_plan: every step runs keyless (no backend call carries the key)', async () => {
    const before = dataHits.length;
    const r = await callAs(NOEMAIL, 'execute_plan', PLAN_ARGS);
    expect(Array.isArray(r.data.executed), r.text.slice(0, 600)).toBe(true);
    const stepHits = dataHits.slice(before);
    expect(stepHits.length, 'the plan ran steps').toBeGreaterThan(0);
    expect(stepHits.filter((h) => h.key === NOEMAIL), JSON.stringify(stepHits)).toEqual([]);
    expect(r.data._upgrade).toMatchObject({ next_tool: 'bind_email' });
  });
  it('D) CONTROL: DCHUB_NOEMAIL_PREVIEW_ONLY=0 restores the full answer', async () => {
    await withEnv('DCHUB_NOEMAIL_PREVIEW_ONLY', '0', async () => {
      const f = await callAs(NOEMAIL, 'find_sites', FIND_ARGS);
      expect(f.data.candidates).toHaveLength(10);
      const c = await callAs(NOEMAIL, 'site_selection_canvas', CANVAS_ARGS);
      expect(c.data.shortlist).toHaveLength(12);
      const before = dataHits.length;
      await callAs(NOEMAIL, 'execute_plan', PLAN_ARGS);
      expect(dataHits.slice(before).some((h) => h.key === NOEMAIL), 'steps carry the key again').toBe(true);
    });
  });
});

describe('B) an email-bound key', () => {
  it('find_sites: all 10 candidates at ~1 km, anchor operator/kV still withheld', async () => {
    const r = await callAs(freshBound(), 'find_sites', FIND_ARGS);
    expect(r.data.candidates, r.text.slice(0, 600)).toHaveLength(10);
    expect(r.data.candidates.some((c) => decimals(c.lat) === 2), 'two decimals, not one').toBe(true);
    for (const c of r.data.candidates) {
      expect(decimals(c.lat)).toBeLessThanOrEqual(2);
      expect(c.coordinate_precision_km).toBe(1.1);
      expect(c.anchor.operator).toBeUndefined();
      expect(c.anchor.voltage_kv).toBeUndefined();
      expect(c.anchor.kv_band).toBe('345-499 kV');
      expect(c.next_calls[0]).toMatch(/lat=\d+\.\d{1,2} /);
    }
    expect(r.text).not.toMatch(PLAN_OR_PRICE);
  });
  it('site_selection_canvas: 1 full answer this month, then the preview', async () => {
    const key = freshBound();
    const r1 = await callAs(key, 'site_selection_canvas', CANVAS_ARGS);
    expect(r1.data.shortlist, r1.text.slice(0, 600)).toHaveLength(12);
    expect(r1.data.free_full_runs).toMatchObject({ used: 1, limit: L.SITING_FREE_PLANS_PER_MONTH, remaining: 0 });
    expect(r1.data.free_full_runs.note).toContain('That was the last one this month');
    const r2 = await callAs(key, 'site_selection_canvas', CANVAS_ARGS);
    expect(r2.data.shortlist, r2.text.slice(0, 600)).toHaveLength(3);
    expect(r2.data._upgrade).toMatchObject({ next_tool: 'unlock_more_data', free_full_runs: { used: 1, limit: 1, remaining: 0 } });
    expect(r2.text).not.toMatch(PLAN_OR_PRICE);
  });
  it('execute_plan: 1 full plan (steps keyed), then steps keyless', async () => {
    const key = freshBound();
    let before = dataHits.length;
    const r1 = await callAs(key, 'execute_plan', PLAN_ARGS);
    expect(r1.data.free_full_runs, r1.text.slice(0, 600)).toMatchObject({ used: 1, limit: 1 });
    expect(dataHits.slice(before).some((h) => h.key === key), 'the full plan runs its steps under the key').toBe(true);
    before = dataHits.length;
    const r2 = await callAs(key, 'execute_plan', PLAN_ARGS);
    expect(r2.data.free_full_runs).toBeUndefined();
    const hits2 = dataHits.slice(before);
    expect(hits2.length).toBeGreaterThan(0);
    expect(hits2.filter((h) => h.key === key), 'the spent plan runs keyless').toEqual([]);
  });
  it('a backend that does not list the tool (limit 0) fails closed to the preview', async () => {
    backendKnows = false;
    try {
      const r = await callAs(freshBound(), 'site_selection_canvas', CANVAS_ARGS);
      expect(r.data.shortlist, r.text.slice(0, 600)).toHaveLength(3);
      expect(r.data._upgrade.message).toContain('not open on this key');
      expect(r.data._upgrade.free_full_runs).toBeUndefined();
    } finally { backendKnows = true; }
  });
});

describe('E) the published clause', () => {
  it('is built from the enforced number, rides the handshake and the claim/bind siblings, names no plan or price', () => {
    const clause = L.sitingFreeClause(L.SITING_FREE_PLANS_PER_MONTH);
    expect(clause).toContain(L.SITING_FREE_PLANS_PER_MONTH + ' full site_selection_canvas and execute_plan each a month');
    expect(L.sitingFreeClause(2)).toContain('2 full site_selection_canvas');
    expect(clause).not.toMatch(PLAN_OR_PRICE);
    expect(S._INSTRUCTIONS_LEAN).toContain(clause);
    expect(S._INSTRUCTIONS).toContain(clause);
    expect(S._INSTRUCTIONS_LEAN).not.toContain('need a paid DC Hub plan');
    expect(S._sitingFreeClause({ DCHUB_NOEMAIL_PREVIEW_ONLY: '0' })).toBe('');
  });
  it('no off-loopback connection was attempted', () => {
    expect(foreign).toEqual([]);
  });
});
