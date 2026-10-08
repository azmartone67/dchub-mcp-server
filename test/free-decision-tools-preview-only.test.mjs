// free-decision-tools-preview-only.test.mjs — owner decision 2026-10-08
// ("do tighten step 1, pro-demand tools preview-only on free").
//
// get_grid_intelligence, get_interconnection_queue and get_market_intel are
// previews on EVERY non-paid seat — anonymous, free key, trial key, email-bound.
// Measured before this change (QA sweep 2026-10-07, mcp lane F-2): one IP got
// two FULL grid briefs anonymously (trial_taste / inline_full), then a freshly
// minted key's first call was a preview with "You've used your 2 full answers";
// the keyed queue preview leaked 25 via `_projects_total_in_pro` while its
// headline GW and count were null; the market preview said `_gated:false`.
//
// WHAT THIS PINS
//   * 3 tools × 4 non-paid seats → the labelled taste: `taste.headline` present,
//     `withheld` non-empty with counts, every decision scalar ABSENT (not null),
//     no trial_taste / inline_full / _metered_trial, the per-(IP,tool,day)
//     counter untouched and no durable consume written;
//   * the honesty contract: completeness.status partial, provenance
//     withholding_proven with a non-empty withheld_fields, agent_hints never
//     "complete", next_ask + the wall block, a DEPTH relay (`w-depth` in the
//     token, never the capacity/pack page), Developer named before Pro and the
//     $10 pack never named as what returns these fields;
//   * ChatGPT platform: the hosted dchub.cloud/u/ (or long /upgrade/h/) link in
//     user_message, no stripe.com string;
//   * Developer and Pro: full, byte-for-byte the pre-change answer shape;
//   * DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY=0 → the old behaviour (a free key
//     gets its capped full grid brief again) — the control that proves the gate
//     discriminates rather than the stub never carrying the fields;
//   * copy canon: every emission of the published free-tier rule carries the
//     decision-tools clause, and the pinned B1 sentence itself is unchanged.
//
// Qualifies for the hard gate: real /mcp handler over loopback HTTP, a 127.0.0.1
// stub backend, every off-loopback connect refused and recorded.
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
    source: 'CBRE / JLL market reports, H1 2026 (as held by DC Hub)' },
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
const consumeHits = [];      // {identity, tool} of every /full-cap/consume the server wrote
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
      if (p === '/api/v1/keys/validate') { const k = (await readBody(req)).api_key || ''; return send(VALIDATE[k] || { valid: false, tier: 'free' }); }
      if (p === '/api/v1/keys/auto-mint') return send({ ...MINT, reused: false });
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/mcp/full-cap/consume') { consumeHits.push(await readBody(req)); return send({ ok: false }); }
      if (p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/mcp/monthly-usage') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/keys/claim') return send({ ok: true, api_key: 'dch_live_claimfixture000000001', tier: 'free', reused: false });
      dataHits.push({ path: p, key: req.headers['x-api-key'] || '' });
      if (p === '/api/v1/grid/intelligence/PJM') return send(GI);
      if (p === '/api/v1/dcpi/iso-comparison') return send(CMP);
      if (p === '/api/v1/interconnection-queue/snapshot') return send(QSNAP);
      if (p === '/api/v1/grid/extended/PJM') return send(EXT);
      if (p === '/api/v1/interconnection-queue/by-iso') return send(QUEUE_BY_ISO);
      if (p === '/api/v1/markets/northern-virginia') return send(MARKET);
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

const SEATS = [
  ['anonymous', {}],
  ['free key', { key: KEYS.free }],
  ['trial key', { key: KEYS.trial }],
  ['email-bound', { key: KEYS.bound }],
];
const relayTokenRaw = (url) => {
  const m = /\/upgrade\/h\/([A-Za-z0-9_-]+)\.[0-9a-f]{32}/.exec(String(url || ''));
  return m ? Buffer.from(m[1], 'base64url').toString('utf8') : '';
};
const counterKeysFor = (ip, tool) => [...S._trialDayCounts.keys()].filter((k) => k.startsWith(ip + ':') && k.includes(':' + tool + ':'));

describe('the three decision tools are previews on every non-paid seat (default ON)', () => {
  for (const tool of TOOLS) {
    for (const [seat, who] of SEATS) {
      it(`${tool} / ${seat}: labelled taste, decision scalars absent, counter untouched`, async () => {
        const consumeBefore = consumeHits.length;
        const r = await callAs(who, tool, ARGS[tool]);
        const views = { data: r.data, sc: r.sc };
        for (const [where, o] of Object.entries(views)) {
          expect(o.taste, `${where}: no taste block\n${r.text.slice(0, 600)}`).toBeTruthy();
          expect(o.taste.headline && typeof o.taste.headline === 'object', `${where}: headline`).toBe(true);
          expect(o.taste.headline.value, `${where}: the headline is present, not null`).not.toBeNull();
          expect(Array.isArray(o.withheld) && o.withheld.length > 0, `${where}: withheld list non-empty`).toBe(true);
          for (const w of o.withheld) {
            expect(typeof w.section).toBe('string');
            expect(w.count).toBeGreaterThan(0);
            expect(w.unlocks_at).toBe('developer');
          }
          for (const f of T.FREE_DECISION_STRIPPED_FIELDS[tool]) {
            expect(Object.prototype.hasOwnProperty.call(o, f), `${where}: decision field "${f}" must be ABSENT (not null)`).toBe(false);
          }
          // no silent nulls: nothing in the taste block itself is a bare null scalar from a withheld section
          expect(o.trial_taste).not.toBe(true);
          expect(o.inline_full).not.toBe(true);
          expect(o._metered_trial).toBeUndefined();
          expect(o.free_preview_only).toBe(true);
          expect(o.full_unlocks_at).toBe('developer');
        }
        // per-tool headline values come from the fixtures, so the taste is the data, not a label
        if (tool === 'get_grid_intelligence') {
          expect(r.data.taste.headline).toMatchObject({ name: 'demand_mw', value: 95021, unit: 'MW', window: '2026-10-07T23' });
          expect(r.data.taste.band.constraint).toMatch(/^(BUILD|CAUTION|AVOID)$/);
          expect(r.data.taste.band.excess_power).toMatch(/^(BUILD|CAUTION|AVOID)$/);
          expect(r.data.taste.share.name).toBe('renewable_share_pct');
          for (const frag of ['"constraint_score":49.2', '"excess_power_score":28.8', '"capacity_auction_price_usd_mw_day":333.44',
            '"forward_load_mw":105415', '"queue_depth_gw":135.1', '"avg_time_to_power_months":30.3', '"reserve_margin_pct":12.5',
            '"retail_price_cents_kwh":14.4', '"NG":33582', '"NG":39.2']) {
            expect(JSON.stringify(r.data), 'leaked ' + frag).not.toContain(frag);
          }
        }
        if (tool === 'get_interconnection_queue') {
          expect(r.data.taste.headline).toMatchObject({ name: 'queued_generation_gw', value: 135.1, unit: 'GW' });
          expect(r.data.taste.project_count.value).toBe(972);
          expect(r.data.taste.source).toMatchObject({ name: 'PJM queue', url: 'https://www.pjm.com/planning/service-requests' });
          for (const frag of ['AG1-100', 'Project 0', '"queued_load_data_center_gw":40.2', '"queued_load_dc_share_pct":29.7',
            '"new_applications_q_gw":12.3', '"historical_completion_pct":18.5', '"name":"Dominion"']) {
            expect(JSON.stringify(r.data), 'leaked ' + frag).not.toContain(frag);
          }
          expect(r.data._projects_total_in_pro).toBeUndefined();
        }
        if (tool === 'get_market_intel') {
          expect(r.data.taste.headline).toMatchObject({ name: 'dcpi_verdict', value: 'CAUTION', method_url: 'https://dchub.cloud/dcpi/methodology' });
          expect(r.data.taste.iso.code).toBe('PJM');
          expect(r.data.taste.utility.names).toEqual(['Dominion Energy Virginia']);
          expect(r.data._gated).toBe(true);
          for (const frag of ['"facility_count":857', '"total_power_mw":13366', '"asking_rate":160', '"asking_rate_range"', '"vacancy_percent"',
            'Provider 0', 'Facility 0', '"Ashburn"', 'signal_tier', '"operational":600']) {
            expect(JSON.stringify(r.data), 'leaked ' + frag).not.toContain(frag);
          }
          expect(r.data.pricing_source.source).toMatch(/CBRE/);
        }
        // the per-(IP,tool,day) counter is never charged, locally or durably
        expect(counterKeysFor(r.ip, tool)).toEqual([]);
        expect(consumeHits.slice(consumeBefore).filter((h) => h.tool === tool)).toEqual([]);
      });
    }
  }
});

describe('honesty contract on the taste (Grok completeness-contradiction detector)', () => {
  for (const tool of TOOLS) for (const [seat, who] of [['anonymous', {}], ['free key', { key: KEYS.free }]]) {
    it(`${tool} (${seat}): partial, withholding proven with names, next_ask, a depth wall, Developer then Pro`, async () => {
      const r = await callAs(who, tool, ARGS[tool]);
      const sc = r.sc;
      expect(sc.completeness && sc.completeness.status).toBe('partial');
      expect(sc.provenance && sc.provenance.completeness).toBe('partial_preview');
      expect(sc.provenance.preview.withholding_proven).toBe(true);
      expect(sc.provenance.preview.withheld_fields.length).toBeGreaterThan(0);
      // every per-field marker the taste carries is a named withheld field in provenance
      const marked = Object.keys(r.data).filter((k) => /^_.+_in_pro$/.test(k) && r.data[k] === true).map((k) => k.slice(1, -'_in_pro'.length));
      expect(marked.length).toBeGreaterThan(0);
      // detectGating lists up to 12 names: every one it lists is a marker the taste carries
      for (const f of sc.provenance.preview.withheld_fields) expect(marked, f).toContain(f);
      expect(marked).toContain({ get_grid_intelligence: 'constraint_score', get_interconnection_queue: 'projects', get_market_intel: 'top_providers' }[tool]);
      expect(r.data._withheld_unlocks_at).toBe('developer');
      expect(sc.next_ask && typeof sc.next_ask === 'object').toBe(true);
      expect(sc.preview_is_partial).toBe(true);
      if (sc.agent_hints && typeof sc.agent_hints.summary === 'string') {
        expect(sc.agent_hints.summary).not.toMatch(/answer is complete/i);
      }
      // the wall: a depth relay, never the capacity page
      expect(sc.human_url).toMatch(/^https:\/\/dchub\.cloud\/(upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}|u\/[2-9a-hj-km-np-z]{6})/);
      const raw = relayTokenRaw(sc.human_url) || relayTokenRaw(sc.for_your_human && sc.for_your_human.url);
      expect(raw, 'relay token decodes').toBeTruthy();
      expect(raw.split('|')).toContain('w-depth');
      expect(raw).not.toContain('w-capacity');
      // the ladder: Developer first, then Pro; the $10 pack is never what returns these fields
      // the taste's own ladder (content JSON); the cascade's generic `upgrade` object is machine links only
      const up = r.data._upgrade || sc._upgrade || sc.upgrade;
      expect(up && up.unlocks_at).toBe('developer');
      expect(up.message).toMatch(/DC Hub Developer/);
      expect(up.message.indexOf('Developer')).toBeLessThan(up.message.indexOf('Pro'));
      expect(up.message).not.toMatch(/\$10|1,000 (API )?credits|pack|https?:\/\//i);
      // the data block carries no checkout URL on any seat (the header and the relay line do)
      expect(JSON.stringify(up)).not.toMatch(/https?:\/\//);
      if (who.key) {
        // a keyed caller: the ladder is named in the text (the 🔒 header on the cascade tools,
        // the data block's message on the depth-tease path), and its human link is the relay
        expect(r.text).toMatch(/DC Hub Developer/);
        expect(sc.human_url).toMatch(/^https:\/\/dchub\.cloud\/(upgrade\/h\/|u\/)/);
      } else {
        // keyless: no checkout URL in the DATA, and one human link — the relay — in the text
        // (a minted trial's 👤 line keeps its rung pointers, as every keyless preview does today)
        expect(up.developer_url).toBeUndefined();
        expect(up.upgrade_url).toBeUndefined();
        expect(JSON.stringify(r.data)).not.toContain('dchub.cloud/go/c/');
        expect((r.text.match(/dchub\.cloud\/upgrade\/h\//g) || []).length).toBe(1);
      }
      // no monthly price anywhere (owner rule 09-27 stands; the plans are named, not priced)
      expect(r.body).not.toMatch(/\$49|\$99/);
      expect(r.result.isError).not.toBe(true);
    });
  }

  it('anonymous grid: the header is the taste line (Developer then Pro, one relay link), not the pack-led override', async () => {
    const r = await callAs({}, 'get_grid_intelligence', ARGS.get_grid_intelligence);
    // the missed-upgrade prompt names Developer as the rung (the gate's own record), never the pack
    const line = r.text.split('\n').find((l) => /This answer hid|is a preview on the free tier/.test(l));
    expect(line, r.text.slice(0, 600)).toBeTruthy();
    expect(line).toMatch(/DC Hub Developer/);
    expect(line).not.toMatch(/\$10|Free full answers left today/);
    expect(r.text).not.toMatch(/Free full answers left today/);
    expect(JSON.stringify(r.data)).not.toContain('dchub.cloud/go/c/');
    expect((r.text.match(/dchub\.cloud\/upgrade\/h\//g) || []).length).toBe(1);
    // the cascade's trial block tells the truth about depth: a trial key does not deepen it
    expect(r.text).not.toMatch(/call `get_grid_intelligence` again now for the full result/);
  });

  it('quota stamp: no per-tool full-answer meter is shown for a preview-only tool', async () => {
    const r = await callAs({ key: KEYS.free }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
    const q = r.sc.quota || r.data.quota;
    if (q) {
      expect(q.full_answers_cap_today).toBeNull();
      expect(q.full_answers_remaining_today).toBeNull();
      expect(q.full_answers_unavailable_reason).toMatch(/preview on every non-paid seat/);
    }
    expect(r.sc.remaining_full_today).toBeUndefined();
  });

  it('chatgpt platform: the hosted dchub.cloud link in user_message, no stripe.com string', async () => {
    const r = await callAs({ client: 'openai-mcp' }, 'get_interconnection_queue', ARGS.get_interconnection_queue);
    expect(r.data.taste).toBeTruthy();
    expect(r.body).not.toMatch(/stripe\.com/);
    expect(typeof r.sc.user_message).toBe('string');
    expect(r.sc.user_message).toMatch(/https:\/\/dchub\.cloud\/(u\/[2-9a-hj-km-np-z]{6}|upgrade\/h\/)/);
    expect(r.sc.human_url).toMatch(/^https:\/\/dchub\.cloud\/(u\/|upgrade\/h\/)/);
  });
});

describe('paid seats are untouched', () => {
  for (const [seat, key] of [['developer', KEYS.dev], ['pro', KEYS.pro]]) {
    it(`${seat}: full answers, no taste, decision scalars present`, async () => {
      const g = await callAs({ key }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
      expect(g.data.taste).toBeUndefined();
      expect(g.data.withheld).toBeUndefined();
      expect(g.data.constraint_score).toBe(49.2);
      expect(g.data.capacity_auction_price_usd_mw_day).toBe(333.44);
      expect(g.data.queue_depth_gw).toBe(135.1);
      const q = await callAs({ key }, 'get_interconnection_queue', ARGS.get_interconnection_queue);
      expect(q.data.taste).toBeUndefined();
      expect(Array.isArray(q.data.projects) && q.data.projects.length).toBe(25);
      expect(q.data.project_count).toBe(972);
      const m = await callAs({ key }, 'get_market_intel', ARGS.get_market_intel);
      expect(m.data.taste).toBeUndefined();
      expect(m.data.stats.facility_count).toBe(857);
      expect(m.data.market_pricing.asking_rate).toBe(160);
    });
  }
});

describe('kill switch DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY=0 restores the previous behaviour (control)', () => {
  it('free key grid: the capped full brief again (trial_taste), decision scalars present, counter charged', async () => {
    process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = '0';
    expect(S._freePreviewOnlyTool('get_grid_intelligence')).toBe(false);
    expect(S._freeTasteTool('get_grid_intelligence')).toBe(true);
    const consumeBefore = consumeHits.length;
    const r = await callAs({ key: KEYS.free }, 'get_grid_intelligence', ARGS.get_grid_intelligence);
    expect(r.data.taste).toBeUndefined();
    expect(r.data.constraint_score).toBe(49.2);
    expect(r.data._metered_trial && r.data._metered_trial.of).toBeGreaterThan(0);
    expect(counterKeysFor(r.ip, 'get_grid_intelligence').length).toBeGreaterThan(0);
    // the durable consume is write-behind (fire-and-forget POST, server.mjs _fullCapConsume):
    // it lands after the response, so wait for it rather than read the stub synchronously.
    const consumed = () => consumeHits.slice(consumeBefore).some((h) => h.tool === 'get_grid_intelligence');
    for (let i = 0; i < 40 && !consumed(); i++) await new Promise((res) => setTimeout(res, 50));
    expect(consumed(), 'no /full-cap/consume write within 2s').toBe(true);
  });
  it('free key market intel: the capped full taste again (trial_taste), rows and pricing intact', async () => {
    process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = '0';
    const r = await callAs({ key: KEYS.free }, 'get_market_intel', ARGS.get_market_intel);
    expect(r.data.taste).toBeUndefined();
    expect(r.data.market_pricing && r.data.market_pricing.asking_rate).toBe(160);
    expect(Array.isArray(r.data.top_providers) && r.data.top_providers.length).toBe(10);
    expect(r.data._metered_trial && r.data._metered_trial.of).toBeGreaterThan(0);
  });
  it('the switch is read per call, so flipping it back re-arms the gate', async () => {
    process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = '0';
    expect(S._freePreviewOnlyTool('get_market_intel')).toBe(false);
    delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
    expect(S._freePreviewOnlyTool('get_market_intel')).toBe(true);
    const r = await callAs({ key: KEYS.free }, 'get_market_intel', ARGS.get_market_intel);
    expect(r.data.taste).toBeTruthy();
  });
});

describe('the pure taste builder (lib/free-decision-taste.mjs)', () => {
  it('grid: demand falls back to the latest demand_24h hour when demand_mw is absent, and says so', () => {
    const parsed = { iso: 'PJM', as_of: '2026-10-07T23:00:00Z', demand_mw: null, demand_period: '2026-10-07T23',
      demand_24h: [{ period: '2026-10-07T22', mw: 90000 }, { period: '2026-10-07T23', mw: 95021 }], constraint_score: 49.2 };
    const out = T.buildFreeDecisionTaste('get_grid_intelligence', parsed, { bandFor: () => 'CAUTION' });
    expect(out.envelope.taste.headline).toMatchObject({ value: 95021, window: '2026-10-07T23' });
    expect(out.envelope.taste.headline.basis).toMatch(/demand_24h/);
    expect(out.envelope.withheld.map((w) => w.section)).toEqual(['dcpi_scores', 'demand_history']);
    expect(out.envelope._constraint_score_in_pro).toBe(true);
    expect(out.envelope._demand_24h_in_pro).toBe(true);
    expect(out.envelope).not.toHaveProperty('constraint_score');
    expect(out.envelope._withheld_unlocks_at).toBe('developer');
    expect(out.envelope.completeness).toEqual({ status: 'partial', withheld: ['dcpi_scores', 'demand_history'] });
    expect(JSON.stringify(out.envelope)).not.toContain('49.2');
    expect(out.figures.map((f) => f.key)).toContain('constraint_score');
  });
  it('queue: the all-ISO snapshot and an error envelope are not this shape (caller keeps its trim)', () => {
    expect(T.buildFreeDecisionTaste('get_interconnection_queue', { as_of: '2026-10-07', by_iso: [{ iso: 'PJM' }], projects: { total: 5559 } })).toBeNull();
    expect(T.buildFreeDecisionTaste('get_interconnection_queue', { error: 'invalid iso', valid: ['PJM'] })).toBeNull();
    expect(T.buildFreeDecisionTaste('get_market_intel', { error: 'API 404' })).toBeNull();
    expect(T.buildFreeDecisionTaste('search_facilities', MARKET)).toBeNull();
  });
  it('queue (ERCOT large-load basis): the generation total is the headline and the 474 GW large-load total is withheld', () => {
    const out = T.buildFreeDecisionTaste('get_interconnection_queue', { iso: 'ERCOT', as_of: '2026-10-07',
      queued_load_total_gw: 474.0, queued_load_total_gw_basis: 'large_load', queued_generation_gw: 454.5,
      queued_load_data_center_gw: 426.6, project_count: 1907, projects: [{ queue_id: 'x' }] });
    expect(out.envelope.taste.headline).toMatchObject({ name: 'queued_generation_gw', value: 454.5 });
    const lq = out.envelope.withheld.find((w) => w.section === 'load_queue');
    expect(lq.count).toBe(2);
    expect(JSON.stringify(out.envelope)).not.toContain('474');
  });
  it('market: no DCPI row → headline value null with an UNMEASURED basis, never a fabricated verdict', () => {
    const out = T.buildFreeDecisionTaste('get_market_intel', { ...MARKET, siting: { available: false, reason: 'no_dcpi_row', mw: { total_mw: 1 } } });
    expect(out.envelope.taste.headline.value).toBeNull();
    expect(out.envelope.taste.headline.basis).toMatch(/UNMEASURED/);
    expect(out.envelope._gated).toBe(true);
  });
  it('the Grok relay label for these tools names Developer, never the pack price', () => {
    expect(S._relayLinkLabel('grok', 'get_grid_intelligence')).toBe(S.GROK_RELAY_LABEL_DEV);
    expect(S.GROK_RELAY_LABEL_DEV).not.toMatch(/\$\d/);
    expect(S._relayLinkLabel('claude', 'get_market_intel')).toBe('[🔓 Open DC Hub — see what I found]');
    expect(S._relayLinkLabel('grok', 'list_transactions')).toBe(S.GROK_RELAY_LABEL);   // control: other tools unchanged
    expect(S._packOpensTool('get_interconnection_queue')).toBe(false);
    expect(S._packOpensTool('list_transactions')).toBe(true);                           // control
  });
  it('the flag parses like every other kill switch here', () => {
    expect(T.freeDecisionPreviewOnlyOn({})).toBe(true);
    expect(T.freeDecisionPreviewOnlyOn({ DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY: '1' })).toBe(true);
    for (const v of ['0', 'false', 'off', 'no', ' 0 ']) expect(T.freeDecisionPreviewOnlyOn({ DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY: v })).toBe(false);
  });
});

describe('copy canon: every emission of the free-tier rule carries the decision-tools clause', () => {
  const CLAUSE = T.FREE_DECISION_CLAUSE;
  const B1 = 'Anonymous: previews, no key needed. Free key: previews plus 2 full answers per tool per day. '
    + 'Add an email: 50 calls/day (up to 10 full answers per tool per day). Paid plans: dchub.cloud/pricing.';
  it('the clause names the three tools and the rung', () => {
    for (const t of TOOLS) expect(CLAUSE).toContain(t);
    expect(CLAUSE).toMatch(/previews on free; full needs Developer\.$/);
    expect(CLAUSE).not.toMatch(/\$\d/);
  });
  it('initialize instructions (full, lean) and the FREE TIER block carry the rule AND the clause', () => {
    expect(S._INSTR_FREE_TIER).toContain('Free key: previews plus 2 full answers per tool per day.');
    expect(S._INSTR_FREE_TIER).toContain(CLAUSE);
    expect(S._INSTRUCTIONS).toContain(CLAUSE);
    expect(S._INSTRUCTIONS_LEAN).toContain(CLAUSE);
    // the clause sits inside the FREE TIER block, before the PRO section the lean text appends
    const lean = S._INSTRUCTIONS_LEAN;
    expect(lean.indexOf('FREE TIER (quote verbatim):')).toBeLessThan(lean.indexOf(CLAUSE));
    expect(lean.indexOf(CLAUSE)).toBeLessThan(lean.indexOf('PRO: '));
  });
  it('claim_free_key: free_tier_rule is the pinned B1 sentence, byte for byte, and the clause rides beside it', async () => {
    const r = await callAs({}, 'claim_free_key', {});
    expect(r.sc.free_tier_rule).toBe(B1);
    expect(r.sc.free_tier_decision_tools).toBe(CLAUSE);
  });
  it('every repo doc that states the free-key sentence also states the clause (tool descriptions are frozen and excluded)', () => {
    const SKIP = new Set(['node_modules', '.git', 'test', 'upstream', 'sdk', 'dxt', 'state']);
    const FROZEN = /(?:^|\/)(toolspec\.json|mcp-server\.json|integrations\/packs\/[a-z-]+\.json)$/;
    const hits = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir)) {
        if (SKIP.has(e)) continue;
        const p = join(dir, e);
        const st = statSync(p);
        if (st.isDirectory()) { walk(p); continue; }
        if (!/\.(md|txt|yaml|yml|json|mjs)$/.test(e)) continue;
        if (FROZEN.test(p.replace(ROOT + '/', ''))) continue;
        const src = readFileSync(p, 'utf8');
        if (src.includes('2 full answers per tool per day')) hits.push(p.replace(ROOT + '/', ''));
      }
    };
    walk(ROOT);
    expect(hits.length, 'the sentence must still be emitted somewhere (a scan that finds nothing proves nothing)').toBeGreaterThan(3);
    const missing = hits.filter((p) => !readFileSync(join(ROOT, p), 'utf8').includes(
      p.endsWith('.mjs') ? 'FREE_DECISION_CLAUSE' : 'are previews on free; full needs Developer'));
    expect(missing, 'free-key sentence without the decision-tools clause').toEqual([]);
  });
});

describe('hard gate', () => {
  it('nothing left loopback', () => { expect(foreign).toEqual([]); });
});
