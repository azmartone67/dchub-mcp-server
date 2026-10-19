// email-bound-decision-full.test.mjs — ITEM 3 PROPOSAL (owner draft 2026-10-16; modifies the
// 2026-10-08 "decision tools are previews on every non-paid seat" rule for EMAIL-BOUND keys only).
//
// WHAT THIS PINS
//   A) keyless: the grid / queue / market-intel previews are unchanged (labelled taste, decision
//      scalars absent) and the prose carries ONE claim_free_key line, with no plan name and no price.
//      On grid and queue it asks for the email in that same call and states the daily allowance.
//      The trailing "Or call claim_free_key ..." clause is gone (named once, not twice).
//   B) a key with a bound email: FULL get_grid_intelligence / get_interconnection_queue answers,
//      EMAIL_DECISION_DAILY_FULL_CAP (3) per tool per UTC day, counted on the key; answer 4 is the
//      taste with exactly one human link (the depth relay), no pack, no plan, no price, no stripe.
//      get_market_intel stays a preview for that key. A key without an email (free, or 'identified'
//      with no email on the row) stays preview-only and is told the bind_email step.
//   CONTROL: DCHUB_EMAIL_FULL_DECISION_TOOLS=0 restores the 10-08 behaviour on both halves.
//   D) the published clause is built from the enforced cap.
//
// Real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend, off-loopback connects refused.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../lib/free-decision-taste.mjs';

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

let ipN = 20;
let rpcId = 100;
// One fresh caller (own IP, own session) per call so per-IP counters never carry.
async function callAs({ client = 'claude-code', key = null } = {}, name, args) {
  const ip = `203.0.113.${ipN++}`;
  const h0 = { 'x-forwarded-for': ip, ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  const h = { ...h0, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
  const result = JSON.parse(body).result || {};
  const text = (result.content || []).map((c) => c.text || '').join('\n');
  let data = null;
  for (const c of result.content || []) {
    const t = typeof c.text === 'string' ? c.text : '';
    const i = t.indexOf('{');
    if (i < 0) continue;
    // first balanced JSON object in the block
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const ch = t[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { try { data = JSON.parse(t.slice(i, j + 1)); } catch (_) { data = null; } break; } }
    }
    if (data) break;
  }
  return { ip, sid, body, result, text, sc: result.structuredContent || {}, data: data || {} };
}


const GRID_FULL_FRAGS = ['"constraint_score"', '"demand_24h"'];
const QUEUE_FULL_FRAGS = ['AG1-100', '"queued_load_data_center_gw":40.2'];
// A plan NAME (capitalised word, as copy would print it; the machine field `unlocks_at: "developer"`
// every 10-08 taste carries is data, not copy) or any price / pack / checkout wording.
const PLAN_OR_PRICE = new RegExp('\\b(Developer|Pro|Starter|Enterprise|Founding)\\b|'
  + '(?:\\$\\s?\\d|\\/mo\\b|[Pp]er month|stripe\\.com|1,000 (?:API )?credits|[Cc]redit pack|[Oo]ne-time pack)');
let keyN = 0;
const freshBoundKey = () => 'dch_live_emailbound' + String(100000 + (keyN++)).padStart(10, '0');
const proseOf = (r) => (r.result.content || []).map((c) => c.text || '')
  .map((t) => { const i = t.indexOf('{'); if (i !== 0) return t; let d = 0, s = false, e = false;
    for (let j = 0; j < t.length; j++) { const ch = t[j]; if (s) { if (e) e = false; else if (ch === '\\') e = true; else if (ch === '"') s = false; continue; }
      if (ch === '"') s = true; else if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) return t.slice(j + 1); } } return ''; })
  .join('\n');
// A human ACTION link: a page a person opens to act (relay, short link, checkout, pricing, plans,
// unlock, a stripe URL). Documentation pointers an agent reads (/data-sources, the cookbook API,
// the DCPI method page) are not actions and are not counted.
const ACTION_LINK = /https:\/\/(?:[a-z0-9-]+\.)*(?:dchub\.cloud\/(?:upgrade|u|go|pricing|plans|unlock|buy|checkout|redeem|claim|connect|signup|install)\b|(?:buy\.)?stripe\.com\/)[^\s"'`)\]<>]*/gi;
const humanLinks = (s) => [...new Set((String(s).match(ACTION_LINK) || []).map((u) => u.replace(/[.,;:]+$/, '')))];
const withEnv = async (k, v, fn) => { const prev = process.env[k]; process.env[k] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; } };

describe('A) keyless previews carry one claim_free_key line, no plan, no price', () => {
  for (const tool of TOOLS) {
    it(`${tool}: taste unchanged, the claim line once in prose, the old trailing clause gone`, async () => {
      const r = await callAs({}, tool, ARGS[tool]);
      expect(r.data.taste && r.data.taste.headline, 'still the labelled taste').toBeTruthy();
      for (const f of T.FREE_DECISION_STRIPPED_FIELDS[tool]) expect(Object.prototype.hasOwnProperty.call(r.data, f), f).toBe(false);
      const prose = proseOf(r);
      const lines = prose.split('\n').filter((l) => l.includes('claim_free_key'));
      expect(lines, 'claim_free_key named exactly once in prose\n' + prose.slice(0, 1500)).toHaveLength(1);
      const line = lines[0];
      // Grok/owner 2026-10-17: the email-bound tools lead with the email ask; market intel keeps the plain line.
      expect(line).toMatch(T.EMAIL_FULL_DECISION_TOOLS.includes(tool) ? /^Ask your user for their email, then call `bind_email` with it to unlock the full answer\./ : /^Free, one call/);
      expect(line, 'no plan name or price on the claim line').not.toMatch(PLAN_OR_PRICE);
      expect(line, 'no link on the claim line').not.toMatch(/https?:\/\//);
      expect(prose).not.toContain('for a durable free-tier key');   // CLAIM_ALT_TAIL dropped, not duplicated
      if (T.EMAIL_FULL_DECISION_TOOLS.includes(tool)) {
        // one email ask, not two: bind_email is named on the claim line and nowhere else in prose
        expect(prose.split('\n').filter((l) => l.includes('bind_email')), 'bind_email only on the claim line').toEqual([line]);
        expect(line.indexOf('bind_email'), 'bind_email before claim_free_key').toBeLessThan(line.indexOf('claim_free_key'));
        expect(line).toContain('Ask your user for their email, then call `bind_email` with it to unlock the full answer.');
        expect(line).toContain('3 full `' + tool + '` answers a day');
      } else {
        expect(line).toContain('their email first');
        expect(line, 'market intel: the key does not deepen it, so nothing is promised').not.toMatch(/full .* answers/);
      }
    });
  }
  it('CONTROL: DCHUB_EMAIL_FULL_DECISION_TOOLS=0 restores the 10-08 keyless wall (no handoff line)', async () => {
    await withEnv('DCHUB_EMAIL_FULL_DECISION_TOOLS', '0', async () => {
      const r = await callAs({}, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      expect(proseOf(r)).not.toMatch(/^Free(, one call|: ask your human)/m);
    });
  });
});

describe('B) email-bound key: full grid / queue answers up to the cap, then a capped preview with one link', () => {
  for (const tool of T.EMAIL_FULL_DECISION_TOOLS) {
    it(`${tool}: answers 1-3 full and metered, answer 4 the taste with exactly one human link`, async () => {
      const key = freshBoundKey();
      const frags = tool === 'get_grid_intelligence' ? GRID_FULL_FRAGS : QUEUE_FULL_FRAGS;
      for (let n = 1; n <= 3; n++) {
        const r = await callAs({ key }, tool, ARGS[tool]);
        const raw = JSON.stringify(r.data);
        for (const f of frags) expect(raw, `answer ${n} is full: ${f}\n${r.text.slice(0, 800)}`).toContain(f);
        expect(r.data.taste, `answer ${n} is not the taste`).toBeUndefined();
        expect(r.data._metered_trial).toMatchObject({ call: n, of: 3, remaining_today: 3 - n, allowance: 'email_bound_decision' });
        { const m = r.text.match(new RegExp(PLAN_OR_PRICE.source, "gi")); const i = r.text.search(PLAN_OR_PRICE); expect(m, `answer ${n}: plan/price ${JSON.stringify(m)} ctx: ${r.text.slice(Math.max(0,i-300), i+200)}`).toBeNull(); }
        expect(r.data.agent_payment, 'no pay-per-call offer rides the email allowance').toBeUndefined();
      }
      expect(signalHits.filter((h) => h.api_key === key), 'no wall signal while full answers are served').toEqual([]);
      const r4 = await callAs({ key }, tool, ARGS[tool]);
      await new Promise((res) => setTimeout(res, 50));   // the signal is fire-and-forget
      const sig = signalHits.filter((h) => h.api_key === key);
      expect(sig, 'the spent allowance writes ONE wall signal').toHaveLength(1);
      expect(sig[0]).toMatchObject({ tool, signal_type: 'trial_cap_exceeded', message_shown: 'email_decision_cap', daily_limit: 3 });
      expect(r4.data.taste && r4.data.taste.headline, 'answer 4 is the labelled taste\n' + r4.text.slice(0, 800)).toBeTruthy();
      for (const f of T.FREE_DECISION_STRIPPED_FIELDS[tool]) expect(Object.prototype.hasOwnProperty.call(r4.data, f), 'answer 4 withholds ' + f).toBe(false);
      expect(r4.data.free_preview_only).toBe(true);
      const links = humanLinks(r4.text + '\n' + JSON.stringify(r4.sc));
      expect(links, 'exactly one human link ' + JSON.stringify(links)).toHaveLength(1);
      expect(links[0]).toMatch(/^https:\/\/dchub\.cloud\/(upgrade\/h|u)\//);
      // the one link is the DEPTH page (the pack opens neither tool), never the capacity / pack page
      const raw = r4.text.match(/https:\/\/dchub\.cloud\/upgrade\/h\/([A-Za-z0-9_-]+)\./);
      if (raw) expect(Buffer.from(raw[1], 'base64url').toString('utf8').split('|')).toContain('w-depth');
      // the prose a person reads carries that one link and no other https link at all
      expect((proseOf(r4).match(/https?:\/\/\S+/g) || []).length, proseOf(r4)).toBe(1);
      { const i = r4.text.search(PLAN_OR_PRICE); expect(i, 'no pack, plan name or price on the capped preview: ' + r4.text.slice(Math.max(0, i - 300), i + 200)).toBe(-1); }
      expect(r4.text).not.toContain('bind_email');                    // this key already has an email
      expect(r4.text).toContain('used; they reset at 00:00 UTC');
    });
  }
  it('no pay-per-call offer rides the allowance even with the machine-pay rail live (MPP on)', async () => {
    // The rail is "live" only by env here; its sidecar URL is a closed loopback port, never contacted
    // for an under-cap offer (mppUndercapOffer is synchronous).
    await withEnv('MPP_ENABLED', '1', () => withEnv('MPP_SIDECAR_URL', 'http://127.0.0.1:9', async () => {
      const key = freshBoundKey();
      for (let n = 1; n <= 3; n++) {
        const r = await callAs({ key }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
        expect(r.data._metered_trial && r.data._metered_trial.call, 'full answer ' + n).toBe(n);
        expect(r.data.agent_payment, 'answer ' + n + ': no agent_payment').toBeUndefined();
        expect(r.sc.agent_payment, 'answer ' + n + ': no agent_payment (structured)').toBeUndefined();
      }
    }));
  });
  it('the allowance is counted on the KEY: a second bound key on the same IP still gets its own 3', async () => {
    const a = freshBoundKey(), b = freshBoundKey();
    for (let n = 0; n < 3; n++) await callAs({ key: a }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
    const rb = await callAs({ key: b }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
    expect(rb.data._metered_trial).toMatchObject({ call: 1, of: 3 });
  });
  it('get_market_intel stays a preview for an email-bound key (not a grid, queue or price read)', async () => {
    const r = await callAs({ key: freshBoundKey() }, 'get_market_intel', ARGS.get_market_intel);
    expect(r.data.taste && r.data.taste.headline).toBeTruthy();
    expect(JSON.stringify(r.data)).not.toContain('"asking_rate":160');
  });
  it('a key with no email stays preview-only and is told the bind_email step (free tier key and an identified row without an email)', async () => {
    for (const key of [KEYS.free, 'dch_live_identnoemail0000000001']) {
      const r = await callAs({ key }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      expect(r.data.taste && r.data.taste.headline, key).toBeTruthy();
      expect(JSON.stringify(r.data)).not.toContain('"constraint_score"');
      expect(r.text).toContain('call `bind_email` with your human');
      expect(r.text).toContain('3 full `get_grid_intelligence` answers a day');
    }
  });
  it('CONTROL: DCHUB_EMAIL_FULL_DECISION_TOOLS=0 gives the email-bound key the 10-08 preview again', async () => {
    await withEnv('DCHUB_EMAIL_FULL_DECISION_TOOLS', '0', async () => {
      const r = await callAs({ key: freshBoundKey() }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      expect(r.data.taste && r.data.taste.headline).toBeTruthy();
      expect(JSON.stringify(r.data)).not.toContain('"constraint_score"');
      expect(r.data._taste_note).toContain('a bound email does not deepen it');
    });
  });
  it('a spent allowance is a DEPTH wall, never the capacity (pack) page, whichever field says it is spent', () => {
    const c = { api_key: 'dch_live_x', email: 'a@example.com', tier: 'identified' };
    const spentByQuota = { preview_is_partial: true, quota: { full_answers_remaining_today: 0 }, _upgrade: {} };
    const spentByCopy = { preview_is_partial: true, _upgrade: { message: 'This key\u2019s 3 full `get_grid_intelligence` answers for today are used' } };
    for (const sc of [spentByQuota, spentByCopy]) {
      expect(S._wallKindFor(sc, c, 'get_grid_intelligence')).toBe('');
      expect(S._wallKindFor(sc, c, 'get_interconnection_queue')).toBe('');
      // CONTROL: the same spent signals on a tool outside the allowance still read as capacity
      expect(S._wallKindFor(sc, c, 'get_fiber_intel')).toBe('w-capacity');
    }
  });
  it('the gate opens only for the request path that passes emailBound (hints and lists keep the 10-08 answer)', () => {
    expect(S.applyTierGate('get_grid_intelligence', {}, 'identified', true, false, undefined, true)).toMatchObject({ allowed: true, trial_taste: true, email_full: true });
    expect(S.applyTierGate('get_interconnection_queue', {}, 'free', true, false, undefined, true)).toMatchObject({ allowed: true, email_full: true });
    expect(S.applyTierGate('get_grid_intelligence', {}, 'identified', true, false).email_full).toBeUndefined();
    expect(S.applyTierGate('get_grid_intelligence', {}, 'identified', false, false, undefined, true).email_full).toBeUndefined();   // no key
    expect(S.applyTierGate('get_market_intel', {}, 'identified', true, false, undefined, true).email_full).toBeUndefined();
    expect(S._trialUnlockedTools()).not.toContain('get_grid_intelligence');
  });
});

describe('D) the published clause is built from the enforced cap', () => {
  it('names the allowance, no plan name, and falls back to the 10-08 clause with the switch off', async () => {
    expect(S._freeDecisionClause()).toBe(T.freeDecisionClause(S._emailDecisionDailyFullCap()));
    expect(S._freeDecisionClause()).toBe(T.FREE_DECISION_CLAUSE);
    expect(T.FREE_DECISION_CLAUSE).toBe('Grid/queue/market-intel tools: previews on free; an email adds 3 full grid/queue answers/day.');
    expect(T.FREE_DECISION_CLAUSE).not.toMatch(PLAN_OR_PRICE);
    await withEnv('DCHUB_EMAIL_FULL_DECISION_TOOLS', '0', async () => {
      expect(S._freeDecisionClause()).toBe(T.FREE_DECISION_CLAUSE_PREVIEW_ONLY);
    });
  });
});

describe('hard gate', () => {
  it('nothing left loopback', () => { expect(foreign).toEqual([]); });
});
