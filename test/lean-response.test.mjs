// lean-response.test.mjs — agent QA A (2026-10-20, owner-approved): one short ask per /mcp response.
//
// Mistral and Claude measured 30-50% of every response as repeated retention and marketing blocks
// (next_session, starter_pack, recipes, the execute_plan menu, "Next question to offer the user",
// watch offers, come-back nudges) and an upgrade message that carried the same link three ways.
// lib/lean-response.mjs trims each /mcp result to at most ONE ask paragraph and drops the retention
// keys. Unit tests pin the trim; the e2e half calls the real /mcp handler over loopback (stub backend,
// same harness as test/anon-top-tools-snapshot.test.mjs) with the step on and off and compares.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { leanResponseStep, leanObject, humanLine, LEAN_SKIP_TOOLS } from '../lib/lean-response.mjs';
import { createServer } from 'node:http';
import net from 'node:net';

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

const SECRET = 'lean-response-internal-key';
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


const SITE = { success: true, location: { lat: 39.04, lon: -77.48, state: 'VA' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, fiber_connectivity: 95.4 }, interpretation: 'Excellent site' };
const FAC = { success: true, id: 100, name: 'Site 100', city: 'Ashburn', state: 'VA', country: 'US', capacity_mw: 48.7, operator: 'Op', status: 'operational' };
const ROWS = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, name: 'Site ' + i, iso: 'PJM', score: 50 + i, lat: 39 + i / 10, lon: -77, city: 'Ashburn', state: 'VA', country: 'US' }));

let S, PORT, httpServer, stub, prevBase, prevSecret, prevIsError, prevFlag;

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
      if (p === '/api/v1/keys/validate') return send({ valid: false, tier: 'free' });
      if (p === '/api/v1/keys/auto-mint') return send({ error: 'no' }, 404);
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/mcp/full-cap/consume') return send({ ok: false });
      if (p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/mcp/monthly-usage') return send({ error: 'not found' }, 404);
      if (p === '/api/v1/mcp/should-mint-claim') return send({ should_mint: false });
      if (p === '/api/v1/grid/intelligence/PJM') return send(GI);
      if (p === '/api/v1/dcpi/iso-comparison') return send(CMP);
      if (p === '/api/v1/interconnection-queue/snapshot') return send(QSNAP);
      if (p === '/api/v1/grid/extended/PJM') return send(EXT);
      if (p === '/api/v1/interconnection-queue/by-iso') return send(QUEUE_BY_ISO);
      if (p === '/api/v1/markets/northern-virginia') return send(MARKET);
      if (p === '/api/site-score') return send(SITE);
      if (/^\/api\/v1\/facilit(y|ies)\/\d+/.test(p)) return send(FAC);
      if (p.startsWith('/api/v1/energy/')) return send({ success: true, caller_tier: 'pro', avg_rate_kwh: 0.2341, scope: 'iso_footprint_avg', filter: { iso: 'PJM', sector: 'all', state: null }, retail_rates: { avg_cents_kwh: 23.41, latest_period: '2026', max_cents_kwh: 30.1, min_cents_kwh: 18.2, states_covered: 1 } });
      return send({ success: true, count: ROWS.length, data: ROWS, results: ROWS, as_of: '2026-10-08' });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  prevFlag = process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
  delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;   // default ON
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  if (prevIsError === undefined) delete process.env.DCHUB_PREVIEW_ISERROR; else process.env.DCHUB_PREVIEW_ISERROR = prevIsError;
  if (prevFlag === undefined) delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY; else process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = prevFlag;
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
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



const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const HU = 'https://dchub.cloud/upgrade/h/AAAA.' + 'c'.repeat(32);
const BLOATED = () => {
  const sc = {
    ok: true, tool: 'get_market_intel', market: { id: 'dallas' }, rows: [{ name: 'x', next_session: 'row data stays' }],
    provenance: { source: 'DC Hub', as_of: '2026-10-19' }, citation: { cite_as: 'DC Hub, dchub.cloud' },
    human_url: HU, human_message: `Open ${HU} to see the full answer.`,
    for_your_human: { text: `Open ${HU} to see the full answer.`, url: HU },
    agent_instruction: 'When a result is partial, show your user the human_message (or for_your_human) text and its link.',
    next_ask: { tool: 'get_market_dcpi_rank', question: 'Is Dallas a BUILD market?' },
    next_session: { tool: 'get_changes', why: 'x'.repeat(400) }, starter_pack: { recipes: [1, 2, 3] },
    digest_offer: { a: 1 }, come_back: { a: 1 }, watch_offer: { steps: [] }, first_call_nudge: { a: 'y'.repeat(300) },
    continuation: { continuations: [{ url: 'https://dchub.cloud/continue?x=1' }] },
    upgrade: { signup_url: 'https://dchub.cloud/signup', developer_url: 'https://buy.stripe.com/abc' },
    upgrade_url: HU, upgrade_options: [{ plan: 'pack' }],
    _upgrade: { tier: 'anonymous', next_tool: 'claim_free_key', message: 'long pitch', redeem_url: 'https://dchub.cloud/api/v1/redeem/x',
      developer_url: 'https://buy.stripe.com/abc', pro_url: 'https://buy.stripe.com/def', pro_hint: 'The plan with every tool' },
  };
  return {
    isError: true,
    content: [
      { type: 'text', text: JSON.stringify(sc) + '\n\n---\n\nAsk your user for their email, then call `bind_email` with it.\n\n\u{1F512} **This answer hid 9 fields.** The page shows the options → https://buy.stripe.com/abc.' },
      { type: 'text', text: '\u{1F9ED} **Next:** one `execute_plan` call answers a whole multi-step question. Try any of these verbatim:\n  • **market_selection** → `execute_plan intent="rank markets"`\nSingle-capability lookups go direct to their tool.' },
      { type: 'text', text: `→ **For your human:** this answer hid 9 fields; open ${HU}` },
      { type: 'text', text: 'Next question to offer the user: "Want the full siting picture?" (DC Hub tool: execute_plan).' },
      { type: 'text', text: '(agent) Watch offer (optional): tell your user “I can watch these markets”' },
      { type: 'text', text: 'Source: DC Hub (dchub.cloud/markets/dallas), as of 2026-10-19' },
    ],
    structuredContent: sc,
  };
};
const ASK = /claim_free_key|bind_email|\/upgrade\/h\/|buy\.stripe\.com|For your human|\u{1F512}/u;
const askParas = (r) => r.content.flatMap((b) => String(b.text || '').split(/\n{2,}/)).filter((p) => !p.trim().startsWith('{') && ASK.test(p));

describe('leanResponseStep (unit)', () => {
  it('drops the retention keys and duplicate link carriers; keeps data, provenance and the relay contract', () => {
    const r = leanResponseStep(deepFreeze(BLOATED()), 'get_market_intel');   // frozen: never mutates a shared entry
    const sc = r.structuredContent;
    for (const k of ['next_session', 'starter_pack', 'digest_offer', 'come_back', 'watch_offer', 'first_call_nudge',
      'continuation', 'upgrade', 'upgrade_url', 'upgrade_options']) expect(sc, k).not.toHaveProperty(k);
    expect(sc._upgrade).toEqual({ tier: 'anonymous', next_tool: 'claim_free_key' });
    for (const k of ['ok', 'market', 'rows', 'provenance', 'citation', 'human_url', 'human_message', 'for_your_human',
      'agent_instruction', 'next_ask']) expect(sc, k).toHaveProperty(k);
    expect(sc.rows[0].next_session).toBe('row data stays');            // top level only: rows are data
    const j = JSON.parse(r.content[0].text);                              // the JSON text block is leaned the same way
    expect(j).not.toHaveProperty('next_session');
    expect(j).not.toHaveProperty('upgrade');
    expect(j._upgrade).toEqual(sc._upgrade);
    expect(r.isError).toBe(true);                                          // flags are never changed
  });
  it('drops the menu, next-question and watch blocks and keeps ONE ask: the paragraph with human_url', () => {
    const r = leanResponseStep(BLOATED(), 'get_market_intel');
    const text = r.content.map((b) => b.text).join('\n');
    expect(text).not.toMatch(/Next question to offer|Watch offer|execute_plan intent=|\u{1F9ED}|Single-capability/u);
    expect(askParas(r)).toEqual([`→ **For your human:** this answer hid 9 fields; open ${HU}`]);
    expect(text).not.toContain('buy.stripe.com');
    expect(r.content[r.content.length - 1].text).toMatch(/^Source: DC Hub \(/);   // the citation line stays, last
  });
  it('the anonymous daily cap keeps its claim line, not the link line', () => {
    const b = BLOATED();
    b.content.splice(1, 0, { type: 'text', text: "This IP has used today's anonymous allowance. Free, one call: `claim_free_key`." });
    const r = leanResponseStep(b, 'get_market_context');
    expect(askParas(r)).toEqual(["This IP has used today's anonymous allowance. Free, one call: `claim_free_key`."]);
  });
  it('a gated result whose prose carried no ask gets one line from human_message', () => {
    const b = BLOATED();
    b.content = [b.content[0], b.content[5]].map((x, i) => (i === 0 ? { ...x, text: JSON.stringify(b.structuredContent) } : x));
    const r = leanResponseStep(b, 'get_market_intel');
    expect(askParas(r)).toEqual([`Open ${HU} to see the full answer.`]);
    expect(humanLine(HU, 'no link here')).toBe(`This answer is partial; the full answer is at ${HU}`);
  });
  it('leaves untouched: the kill switch, the key/account tools, the skip flag, plain data prose', () => {
    const b = BLOATED();
    process.env.DCHUB_LEAN_RESPONSES = '0';
    try { expect(leanResponseStep(b, 'get_market_intel')).toBe(b); } finally { delete process.env.DCHUB_LEAN_RESPONSES; }
    for (const t of ['claim_free_key', 'bind_email', 'recover_my_key']) {
      expect(LEAN_SKIP_TOOLS.has(t)).toBe(true);
      expect(leanResponseStep(b, t)).toBe(b);
    }
    expect(leanResponseStep(b, 'get_market_intel', { skip: true })).toBe(b);
    const plain = { content: [{ type: 'text', text: '{"ok":true,"rows":[1]}' }, { type: 'text', text: 'Dallas: 236 facilities.\n\nSource: DC Hub (dchub.cloud)' }], structuredContent: { ok: true, rows: [1] } };
    const pr = leanResponseStep(plain, 'search_facilities');
    expect(pr.content[0]).toBe(plain.content[0]);
    expect(pr.content[1]).toBe(plain.content[1]);
    expect(leanObject({ a: 1 })).toEqual({ a: 1 });
  });
});

const size = (r) => Buffer.byteLength(JSON.stringify(r.result));
describe('/mcp end to end: the same anonymous call with the step on and off', () => {
  const TOOLS = [
    ['get_grid_intelligence', { region_id: 'PJM' }],
    ['get_market_intel', { market: 'northern-virginia' }],
    ['get_interconnection_queue', { iso: 'PJM' }],
    ['get_fiber_intel', { metro: 'ashburn' }],
    ['rank_markets', {}],
  ];
  for (const [tool, args] of TOOLS) {
    it(tool + ': no retention block, at most one ask, smaller than the step-off answer', async () => {
      process.env.DCHUB_LEAN_RESPONSES = '0';
      let off;
      try { off = await callAs({ client: 'claude-code' }, tool, args); } finally { delete process.env.DCHUB_LEAN_RESPONSES; }
      const on = await callAs({ client: 'claude-code' }, tool, args);
      // The control proves the check is not vacuous: the step-off answer carries the blocks.
      expect(JSON.stringify(off.result)).toMatch(/next_session|starter_pack|Next question to offer|"continuation"|"upgrade"/);
      const scOn = on.sc;
      for (const k of ['next_session', 'starter_pack', 'continuation', 'upgrade', 'first_call_nudge', 'watch_offer'])
        expect(scOn, `${tool}: ${k}`).not.toHaveProperty(k);
      expect(on.text).not.toMatch(/Next question to offer|Watch offer|\u{1F9ED}|Try any of these verbatim/u);
      expect(askParas(on.result).length, `${tool}: ask paragraphs`).toBeLessThanOrEqual(1);
      if (off.sc.human_url) expect(scOn.human_url, `${tool}: the one human link stays`).toBeTruthy();
      expect(size(on), `${tool}: bytes on vs off`).toBeLessThan(size(off));
    }, 30_000);
  }
  it('no off-loopback connection was attempted', () => { expect(foreign).toEqual([]); });
});
