// chatgpt-first-full-answer.test.mjs — owner 2026-10-26 ("please"): on /mcp/chatgpt, the FIRST
// get_grid_intelligence / get_interconnection_queue / get_market_intel answer of each ChatGPT
// conversation is the full answer; later calls in that conversation get the unchanged 10-08
// preview. Behind DCHUB_CHATGPT_FIRST_FULL (default OFF: the app is in OpenAI review).
//
// WHAT THIS PINS
//   A) flag on, one conversation: call 1 full (decision fields present, broker rates nulled,
//      no plan/price/key/link), call 2 the preview with exactly the fields a flag-off call has.
//   B) a second conversation from the same IP gets its own first answer; the per-IP ceiling
//      stops a caller that forges a conversation id per call.
//   C) CONTROLS: flag off -> preview on call 1; flag on but /mcp (not the directory profile) or a
//      ChatGPT call with no openai/session -> preview.
//
// Harness copied from test/email-bound-decision-full.test.mjs (real handler, loopback stub backend).
// Real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend, off-loopback connects refused.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../lib/free-decision-taste.mjs';
import { leanResponseStep } from '../lib/lean-response.mjs';
import { EMAIL_ASK } from '../lib/claim-handoff.mjs';
// This file pins the copy the inner wall/retention steps build; the lean step (lib/lean-response.mjs,
// agent QA A 2026-10-20) trims it to one ask on /mcp. Off here so these guards keep testing the inner
// steps; test/lean-response.test.mjs guards the default.
process.env.DCHUB_LEAN_RESPONSES = '0';
// This file exercises the free-tier gate on markets (Northern Virginia, Dallas, Houston, Santa Clara)
// that the top-20-metros decision (owner 2026-10-20, lib/top-metros.mjs) now opens to every caller.
// The gate still applies to every other market, so it is tested here with that decision switched
// off; the open top-20 behaviour is pinned in test/agent-qa-a-signals-metros.test.mjs.
process.env.DCHUB_TOP_METROS_FREE = '0';

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-internal-key-not-a-real-secret';
const TOOLS = ['get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel'];
const ARGS = {
  get_grid_intelligence: { region_id: 'PJM' },
  get_interconnection_queue: { iso: 'PJM' },
  get_market_intel: { market: 'northern-virginia' },
};
// Fixture keys — test values only, never real credentials.
const KEYS = {
  free:  'dch_live_freedecisiontest0000001',
  trial: 'dch_trial_freedecisiontest000001',
  bound: 'dch_live_freedecisionbound000001',
  dev:   'dchub_dev_freedecisiontest000001',
  pro:   'dchub_pro_freedecisiontest000001',
};
const VALIDATE = {
  [KEYS.free]:  { valid: true, tier: 'free', developer_id: 'd_free', email: null },
  [KEYS.trial]: { valid: true, tier: 'free', developer_id: null, email: null, source: 'auto_trial' },
  [KEYS.bound]: { valid: true, tier: 'identified', developer_id: 'd_bound', email: 'bound@example.com' },
  [KEYS.dev]:   { valid: true, tier: 'developer', developer_id: 'd_dev', email: 'dev@example.com' },
  [KEYS.pro]:   { valid: true, tier: 'pro', developer_id: 'd_pro', email: 'pro@example.com' },
};
const MINT = { ok: true, api_key: KEYS.trial, tier: 'IDENTIFIED', expires_at: null, daily_calls: 15,
  trial_days: 7, days_remaining: 7 };

// ── backend fixtures: the live shapes, with every decision scalar PRESENT ────
const GI = {
  demand_mw: 95021, demand_period: '2026-10-07T23', generation_mix_period: '2026-10-07T03',
  generation_mix: { COL: { mw: 13136 }, NG: { mw: 33582 }, NUC: { mw: 27692 }, OIL: { mw: 248 },
    OTH: { mw: 3490 }, SUN: { mw: 28 }, WAT: { mw: 1517 }, WND: { mw: 5943 } },
  peak_mw: 95021, min_mw: 74723, load_factor: 0.786,
  demand_24h: Array.from({ length: 22 }, (_, i) => ({ period: `2026-10-07T${String(i + 1).padStart(2, '0')}`, mw: 80000 + i * 500 })),
  related_intel: Array.from({ length: 4 }, (_, i) => ({ title: `intel ${i}`, url: `https://dchub.cloud/intel/${i}` })),
};
const CMP = { isos: [{ iso: 'PJM', iso_name: 'PJM Interconnection (mid-Atlantic + Ohio Valley)',
  avg_constraint: 49.2, avg_excess: 28.8, avg_time_to_power_months: 30.3, avg_queue_wait_months: 30.4,
  avg_curtailment_pct: 1, avg_reserve_margin_pct: 12.5, avg_kwh_cents: 14.4, total_stranded_capacity_mw: 1200,
  sum_emergency_30d: 0, market_count: 64, build_count: 0, latest_computed_at: '2026-10-07T18:34:37Z' }] };
const QSNAP = { by_iso: [{ iso: 'PJM', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue',
  queued_generation_gw: 135.1, as_of: '2026-10-07' }] };
const EXT = { available: true, forward_load_mw: 105415, committed_capacity_mw: 142206.4, operating_reserve_mw: 15859,
  grid_carbon_intensity_lb_mwh: 801.66, capacity_auction_price_usd_mw_day: 333.44,
  capacity_auction_delivery_year: '2027/2028', capacity_auction_source: 'PJM 2027/2028 BRA report' };
const QUEUE_BY_ISO = {
  iso: 'PJM', as_of: '2026-10-07', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue',
  queued_load_data_center_gw: 40.2, queued_load_dc_share_pct: 29.7, new_applications_q_gw: 12.3,
  new_applications_period: '2026-Q2', historical_completion_pct: 18.5, queued_generation_gw: 135.1,
  queued_generation_gw_as_of: '2026-10-07', top_subregions: [{ name: 'Dominion', gw: 41.0 }],
  source_url: 'https://www.pjm.com/planning/service-requests', source_name: 'PJM queue', v: 'published',
  project_count: 972,
  projects: Array.from({ length: 25 }, (_, i) => ({ queue_id: `AG1-${100 + i}`, project_name: `Project ${i}`,
    capacity_mw: 100 + i, fuel_type: 'SOLAR', state: 'VA', queue_status: 'active' })),
};
const MARKET = {
  success: true,
  market: { id: 'northern-virginia', name: 'Northern Virginia',
    cities: ['Ashburn', 'Sterling', 'Reston', 'Herndon', 'Manassas', 'Leesburg', 'Chantilly', 'Dulles'] },
  stats: { facility_count: 857, total_power_mw: 13366.0, avg_power_mw: 41.2, provider_count: 90, mw_reporting_count: 320 },
  as_of: '2026-10-06T14:22:31Z', as_of_basis: 'MAX(discovered_at) over the facilities this response counts',
  top_providers: Array.from({ length: 10 }, (_, i) => ({ name: `Provider ${i}`, facilities: 30 - i, power_mw: 900 - i * 40 })),
  by_status: { operational: 600, under_construction: 150, planned: 107 },
  recent_facilities: Array.from({ length: 5 }, (_, i) => ({ name: `Facility ${i}`, city: 'Ashburn', capacity_mw: 60 + i })),
  market_pricing: { available: true, basis: 'broker_report', asking_rate: 160.0, asking_rate_range: [160.0, 185.0],
    unit: '$/kW/mo', deal_size: '250-500 kW wholesale', vacancy_percent: 4.0, period: 'H1 2026', stale: false,
    source: 'CBRE / JLL market reports, H1 2026 (as held by DC Hub) $160-185/kW/mo' },
  siting: { available: true,
    iso: { code: 'PJM', class: 'RTO', operator: 'PJM Interconnection', as_of: '2026-10-07' },
    utilities: { names: ['Dominion Energy Virginia'], kind: 'IOU', source_url: 'https://www.scc.virginia.gov/' },
    dcpi: { verdict: 'CAUTION', band: 'excess-power score at least 40 and grid-constraint score at most 60',
      definition: 'Thresholds are the published DCPI method, not this market\'s scores. The scores are a paid field.',
      signal_tier: 'full', data_basis: 'measured', as_of: '2026-10-07', method_url: 'https://dchub.cloud/dcpi/methodology' },
    time_to_power: { band: '24_to_48_months', edges_months: [24, 48], as_of: '2026-10-07' },
    mw: { total_mw: 13366.0, rows_reporting: 320, rows_total: 857, coverage_pct: 37.3, coverage: 'PARTIAL' } },
  _gated: false,
  related_intel: Array.from({ length: 4 }, (_, i) => ({ title: `nova intel ${i}` })),
};

let S, PORT, httpServer, stub, prevBase, prevSecret, prevFlag, prevContract, prevIsError;
const consumeHits = [];
const signalHits = [];       // every paywall signal the server wrote      // {identity, tool} of every /full-cap/consume the server wrote
const dataHits = [];         // {path, key} of every data call the handler made

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
      const p = url.pathname;
      res.setHeader('content-type', 'application/json');
      const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
      if (p === '/api/v1/keys/validate') {
        const k = (await readBody(req)).api_key || '';
        // per-test email-bound keys (fresh per test, so the per-key counter starts at 0)
        if (k.startsWith('dch_live_emailbound')) return send({ valid: true, tier: 'identified', developer_id: 'd_' + k.slice(-6), email: 'bound+' + k.slice(-6) + '@example.com' });
        // a key whose row says 'identified' but carries NO email (the claim-time default)
        if (k.startsWith('dch_live_identnoemail')) return send({ valid: true, tier: 'identified', developer_id: 'd_' + k.slice(-6), email: null });
        return send(VALIDATE[k] || { valid: false, tier: 'free' });
      }
      if (p === '/api/v1/keys/auto-mint') return send({ ...MINT, reused: false });
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/mcp/full-cap/consume') { consumeHits.push(await readBody(req)); return send({ ok: false }); }
      if (p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/mcp/signal-paywall') { signalHits.push(await readBody(req)); return send({ ok: true }); }
      if (p === '/api/v1/mcp/monthly-usage') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/keys/claim') return send({ ok: true, api_key: 'dch_live_claimfixture000000001', tier: 'free', reused: false });
      dataHits.push({ path: p, key: req.headers['x-api-key'] || '' });
      if (p === '/api/v1/grid/intelligence/PJM') return send(GI);
      if (p === '/api/v1/dcpi/iso-comparison') return send(CMP);
      if (p === '/api/v1/interconnection-queue/snapshot') return send(QSNAP);
      if (p === '/api/v1/grid/extended/PJM') return send(EXT);
      if (p === '/api/v1/interconnection-queue/by-iso') return send(QUEUE_BY_ISO);
      if (p === '/api/v1/markets/northern-virginia') return send(MARKET);
      // No `market` or `stats` object, so no taste shape: the spent allowance takes the generic fallback.
      if (p === '/api/v1/markets/no-shape') { const { market: _m, siting: _s, stats: _st, ...rest } = MARKET; return send({ ...rest, markets: Array.from({ length: 6 }, (_, i) => ({ name: `Shape ${i}`, dcpi_score: 61.5 + i })) }); }
      if (p.startsWith('/api/v1/energy/')) return send({ success: true, caller_tier: 'pro', avg_rate_kwh: 0.2341, scope: 'iso_footprint_avg', filter: { iso: 'CAISO', sector: 'all', state: null }, retail_rates: { avg_cents_kwh: 23.41, latest_period: '2026', max_cents_kwh: 30.1, min_cents_kwh: 18.2, states_covered: 1 } });
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevFlag = process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
  delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;   // default ON
  prevContract = process.env.DCHUB_PAYWALL_CONTRACT;
  delete process.env.DCHUB_PAYWALL_CONTRACT;
  // Production transport: DCHUB_PREVIEW_ISERROR=0 (set before 2026-08-20, see the
  // r-wall-transport comment at the flag in server.mjs; the 2026-10-07 sweep's anon
  // previews left with isError:false). This PR changes depth, not transport, so the
  // isError assertion below is made against the transport production runs.
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterEach(() => {
  if (prevFlag === undefined) delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
  else process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = prevFlag;
  if (prevContract === undefined) delete process.env.DCHUB_PAYWALL_CONTRACT;
  else process.env.DCHUB_PAYWALL_CONTRACT = prevContract;
});

afterAll(async () => {
  if (prevIsError === undefined) delete process.env.DCHUB_PREVIEW_ISERROR;
  else process.env.DCHUB_PREVIEW_ISERROR = prevIsError;
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});


let ipN = 20;
let rpcId = 100;
const OAI_UA = 'openai-mcp/1.0.0';
// ChatGPT calls tools/call statelessly, carrying its conversation id in _meta["openai/session"].
async function cgCall({ path = '/mcp/chatgpt', conv = null, ip = null, key = null } = {}, name, args) {
  const addr = ip || `198.51.100.${ipN++}`;
  const params = { name, arguments: args };
  if (conv) params._meta = { 'openai/session': conv };
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'user-agent': OAI_UA, 'x-forwarded-for': addr, ...(key ? { 'x-api-key': key } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params }),
  });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  const result = JSON.parse(b).result || {};
  const text = (result.content || []).map((c) => c.text || '').join('\n');
  let data = {};
  try { data = JSON.parse((result.content || [])[0]?.text || '{}'); } catch (_) { data = {}; }
  return { result, text, data };
}

// Values, not field names: a preview names withheld fields (demand_24h, top_providers) too.
const FULL_FRAGS = {
  get_grid_intelligence: ['"demand_mw":95021'],
  get_interconnection_queue: ['AG1-100', '"queued_load_data_center_gw":40.2'],
  get_market_intel: ['"total_power_mw":13366'],
};
const BROKER_RATE_FRAGS = ['"asking_rate":160', '160,185]', '160-185', '"vacancy_percent":4'];
const PLAN_OR_PRICE = new RegExp('\\b(Developer|Pro|Starter|Enterprise|Founding)\\b|'
  + '(?:\\$\\s?\\d|\\/mo\\b|[Pp]er month|stripe\\.com|credits\\b|claim_free_key|bind_email|api[_ ]key)', 'i');
const withEnv = async (k, v, fn) => { const prev = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; } };
const isFull = (r, tool) => FULL_FRAGS[tool].every((f) => JSON.stringify(r.data).includes(f));
let convN = 0;
const freshConv = () => 'conv-cgfirst-' + (convN++) + '-' + Math.random().toString(36).slice(2);

describe('A) flag on: the first answer per conversation is full, the next is the unchanged preview', () => {
  for (const tool of TOOLS) {
    it(`${tool}: call 1 full and clean, call 2 the preview`, async () => {
      await withEnv('DCHUB_CHATGPT_FIRST_FULL', '1', async () => {
        const conv = freshConv();
        const ip = `198.51.100.${ipN++}`;
        const r1 = await cgCall({ conv, ip }, tool, ARGS[tool]);
        expect(isFull(r1, tool), 'call 1 is the full answer\n' + r1.text.slice(0, 900)).toBe(true);
        expect(r1.data._metered_trial).toMatchObject({ call: 1, of: 1, allowance: 'chatgpt_first_answer' });
        expect(r1.data.taste, 'call 1 is not the taste').toBeUndefined();
        const scan = r1.text.replace(/https?:\/\/[^\s"\\)]+/g, '<url>');
        for (const f of BROKER_RATE_FRAGS) expect(scan, 'broker rates stay withheld: ' + f).not.toContain(f);
        { const i = r1.text.search(PLAN_OR_PRICE); expect(i, 'no plan/price/key copy: ' + r1.text.slice(Math.max(0, i - 200), i + 200)).toBe(-1); }
        const r2 = await cgCall({ conv, ip }, tool, ARGS[tool]);
        expect(isFull(r2, tool), 'call 2 is the preview\n' + r2.text.slice(0, 600)).toBe(false);
        expect(r2.data._metered_trial, 'no meter on the preview').toBeUndefined();
        // The spent conversation gets exactly the preview a flag-off caller gets.
        const off = await withEnv('DCHUB_CHATGPT_FIRST_FULL', '0', () => cgCall({ conv: freshConv() }, tool, ARGS[tool]));
        expect(Object.keys(r2.data).sort()).toEqual(Object.keys(off.data).sort());
      });
    });
  }
});

describe('B) per conversation, with a per-IP ceiling', () => {
  it('a second conversation from the same IP gets its own first answer', async () => {
    await withEnv('DCHUB_CHATGPT_FIRST_FULL', '1', async () => {
      const ip = `198.51.100.${ipN++}`;
      const a = await cgCall({ conv: freshConv(), ip }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      const b = await cgCall({ conv: freshConv(), ip }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      expect(isFull(a, 'get_grid_intelligence')).toBe(true);
      expect(isFull(b, 'get_grid_intelligence')).toBe(true);
    });
  });
  it('forging a new conversation per call stops at the per-IP ceiling', async () => {
    await withEnv('DCHUB_CHATGPT_FIRST_FULL', '1', async () => {
      const ip = `198.51.100.${ipN++}`;
      const cap = S.CHATGPT_FIRST_FULL_IP_CAP;
      expect(cap).toBeGreaterThan(0);
      let full = 0;
      for (let n = 0; n < cap + 2; n++) {
        const r = await cgCall({ conv: freshConv(), ip }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
        if (isFull(r, 'get_grid_intelligence')) full++;
      }
      expect(full).toBe(cap);
    });
  });
});

describe('C) controls', () => {
  it('flag off (the default): call 1 on /mcp/chatgpt is the preview', async () => {
    await withEnv('DCHUB_CHATGPT_FIRST_FULL', undefined, async () => {
      const r = await cgCall({ conv: freshConv() }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      expect(isFull(r, 'get_grid_intelligence')).toBe(false);
    });
  });
  it('flag on, but /mcp (not the directory profile): preview', async () => {
    await withEnv('DCHUB_CHATGPT_FIRST_FULL', '1', async () => {
      const r = await cgCall({ path: '/mcp', conv: freshConv() }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      expect(isFull(r, 'get_grid_intelligence')).toBe(false);
    });
  });
  it('flag on, but no openai/session on the call: preview', async () => {
    await withEnv('DCHUB_CHATGPT_FIRST_FULL', '1', async () => {
      const r = await cgCall({}, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      expect(isFull(r, 'get_grid_intelligence')).toBe(false);
    });
  });
  it('flag on, but a keyed caller (free key, no email): its own 10-08 preview, no first-answer meter', async () => {
    await withEnv('DCHUB_CHATGPT_FIRST_FULL', '1', async () => {
      const r = await cgCall({ conv: freshConv(), key: KEYS.free }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      expect(isFull(r, 'get_grid_intelligence'), r.text.slice(0, 600)).toBe(false);
      expect(r.data._metered_trial?.allowance).not.toBe('chatgpt_first_answer');
    });
  });
  it('no off-loopback connection was attempted', () => { expect(foreign).toEqual([]); });
});
