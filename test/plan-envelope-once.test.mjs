// plan-envelope-once.test.mjs — Grok note K item 9 (2026-11-15): an execute_plan answer emits identity,
// next_session, digest_offer and capacity_source ONCE, at its top level, never inside each step's result
// (lib/plan-provenance-once.mjs, ENVELOPE ONCE; kill switch DCHUB_PLAN_ENVELOPE_ONCE=0).
//
// Measured on main 2026-11-15 with the real /mcp handler (a cursor client from an outside peer, the backend stubbed):
// "Compare ERCOT vs PJM vs MISO for a 100 MW data center" carried capacity_source 4 times, "Texas or Arizona,
// 100 MW by 2028" next_session / digest_offer 2 times and capacity_source 5 times, the Northern Virginia pipeline plan
// next_session / digest_offer 3 times. Live (QA client) the same day: every grid / timeline / queue step carried its
// own capacity_source, and a search_facilities step carried the backend's upgrade_options [{plan:'pack'},
// {plan:'developer'}] (note K item 8: agent-facing output names no plans).
//
//   A) the pure step: each key once, merged capacity_source keeps every place, data untouched, idempotent, switch.
//   B) end to end through the real /mcp handler: three plans, each key exactly once in structuredContent AND in
//      block 0's JSON; the answer is smaller than with the switch off (sizes printed as evidence).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { planEnvelopeOnceObject, planProvenanceOnceStep, mergeCapacitySource, STEP_ENVELOPE_KEYS } from '../lib/plan-provenance-once.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
// The envelope pass alone: the later note L1 + L2 step (lib/neutral-cta.mjs) also drops step offer lists, which
// would make this file's switch-off control pass for the wrong reason. It only removes keys, never adds one.
process.env.DCHUB_PLAN_NEUTRAL_CTA = '0';
// Same for the answer budget's plan stage 1b (lib/answer-shape.mjs, test/plan-answer-budget): on an over-budget
// free plan it also drops each step's identity / next_session / capacity_source, so the switch-off control here
// would read as already-once. This file pins the envelope pass alone.
process.env.DCHUB_PLAN_BUDGET_DEDUPE = '0';

const KEYS = ['identity', 'next_session', 'digest_offer', 'capacity_source'];
const count = (s, k) => (String(s).match(new RegExp('"' + k + '":', 'g')) || []).length;

describe('A) the step: one envelope per plan', () => {
  const ident = { credential_source: 'none', tier: 'anonymous', means: 'm'.repeat(200) };
  const ns = (tools) => ({ come_back: { why: 'w'.repeat(200), tools }, tool: 'get_changes', digest_offer: { what: 'd'.repeat(100) } });
  const cap = (args, live = 0) => ({ live_listings_matching: live, program_status: 'upcoming',
    browse_call: { tool: 'source_capacity', arguments: args }, register_call: { tool: 'request_capacity_intro', arguments: {} },
    note: 'n', next_call: { tool: 'source_capacity', arguments: args } });
  const plan = () => ({
    _entity: 'plan_execution', identity: ident, next_session: ns(['set_market_alert']),
    executed: [
      { step: 1, tool: 'get_power_availability_timeline', status: 'executed',
        result: { rows: [{ mw: 1 }], identity: { ...ident, means: 'm…' }, next_session: ns(['set_site_alert']), capacity_source: cap({ state: 'TX', min_mw: 100 }) } },
      { step: 2, tool: 'get_power_availability_timeline', status: 'executed',
        result: { rows: [{ mw: 2 }], identity: { tier: 'kff' }, capacity_source: cap({ state: 'AZ', min_mw: 100 }, 2), digest_offer: { what: 'x' } } },
      { step: 3, tool: 'search_facilities', status: 'executed',
        result: { rows: [{ mw: 3 }], upgrade_options: [{ label: 'pack', plan: 'pack' }, { label: 'dev', plan: 'developer' }] } },
      { step: 4, tool: 'get_grid_intelligence', status: 'executed',
        result: { rows: [{ mw: 4 }], capacity_source: cap({ state: 'TX', min_mw: 100 }), next_session: ns(['x']) } },
    ],
  });

  it('identity, next_session, digest_offer and capacity_source appear exactly once, at the top', () => {
    const src = plan();
    const { value, steps } = planEnvelopeOnceObject(src);
    expect(steps).toBe(4);
    const s = JSON.stringify(value);
    for (const k of KEYS) expect(count(s, k), k).toBe(1);
    for (const k of KEYS) expect(value[k] !== undefined || (k === 'digest_offer' && value.next_session.digest_offer), k).toBeTruthy();
    for (const e of value.executed) for (const k of STEP_ENVELOPE_KEYS) expect(e.result[k], `${e.step}.${k}`).toBeUndefined();
    expect(value.identity).toEqual(ident);                       // the plan's own, not a step's truncated copy
    expect(value.next_session).toEqual(src.next_session);
    expect(value.executed[1].result.served_as).toBe('kff');      // a step served under another tier says so, briefly
    expect(value.executed[0].result.served_as).toBeUndefined();
    for (let i = 0; i < 4; i++) expect(value.executed[i].result.rows).toEqual(src.executed[i].result.rows);
    expect(s).not.toMatch(/"plan":"(?:pack|developer)"/);
    expect(s.length).toBeLessThan(JSON.stringify(src).length);
  });

  it('the merged capacity_source leads with the place that has listings and keeps every other place once', () => {
    const { value } = planEnvelopeOnceObject(plan());
    const cs = value.capacity_source;
    expect(cs.browse_call.arguments).toEqual({ state: 'AZ', min_mw: 100 });   // 2 live listings beat 0
    expect(cs.live_listings_matching).toBe(2);
    expect(cs.other_places).toEqual([{ tool: 'source_capacity', arguments: { state: 'TX', min_mw: 100 }, steps: [1, 4] }]);
    expect(cs.steps).toEqual([1, 2, 4]);
    expect(mergeCapacitySource([])).toBeNull();
  });

  it('a plan with no next_session of its own takes the first step\'s; idempotent; not a plan: untouched', () => {
    const src = plan(); delete src.next_session; delete src.identity;
    const { value } = planEnvelopeOnceObject(src);
    expect(value.next_session.come_back.tools).toEqual(['set_site_alert']);
    expect(value.identity.means).toBe('m…');
    const again = planEnvelopeOnceObject(value);
    expect(again.steps).toBe(0);
    expect(again.value).toBe(value);
    const x = { _entity: 'other', executed: [{ result: { identity: {} } }] };
    expect(planEnvelopeOnceObject(x).value).toBe(x);
  });

  it('both channels (structuredContent and block 0) are shaped; DCHUB_PLAN_ENVELOPE_ONCE=0 leaves the steps as D1 left them', () => {
    const r = { content: [{ type: 'text', text: JSON.stringify(plan()) }, { type: 'text', text: 'Source: DC Hub (dchub.cloud)' }], structuredContent: plan() };
    const on = planProvenanceOnceStep(r, { env: {} });
    for (const k of KEYS) {
      expect(count(JSON.stringify(on.structuredContent), k), 'sc ' + k).toBe(1);
      expect(count(on.content[0].text, k), 'block 0 ' + k).toBe(1);
    }
    const off = planProvenanceOnceStep(r, { env: { DCHUB_PLAN_ENVELOPE_ONCE: '0' } });
    expect(count(JSON.stringify(off.structuredContent), 'capacity_source')).toBe(3);
    expect(off.structuredContent.executed[2].result.upgrade_options).toHaveLength(2);
  });
});

// ── B) end to end ────────────────────────────────────────────────────────────────────────────────────
const GI = (iso) => ({ iso, demand_mw: 93825, demand_period: '2026-11-14T14', peak_mw: 102346, min_mw: 85900, load_factor: 0.839,
  queue_depth_gw: 373.6, queue_depth_basis: 'generation_queue', market_count: 64, build_count: 0, build_rate_pct: 0,
  capacity_auction_price_usd_mw_day: 333.44, generation_mix: { NG: { mw: 40289 }, NUC: { mw: 30748 } }, as_of: '2026-11-14T14:00:00Z',
  demand_24h: Array.from({ length: 24 }, (_, i) => ({ period: `2026-11-14T${String(i).padStart(2, '0')}`, mw: 90000 + i * 400 })) });
const QUEUE = (iso) => ({ iso, total_projects: 1174, total_gw: 373.6, as_of: '2026-11-14', by_fuel: { solar: 120.1, storage: 90.2 },
  projects: Array.from({ length: 12 }, (_, i) => ({ name: `Q${i}`, mw: 100 + i, fuel: 'solar', status: 'active', state: 'TX' })) });
const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Row ' + i, market: 'dallas', state: 'TX', capacity_mw: 100 + i }));
const PLANS = {
  iso3: 'Compare ERCOT vs PJM vs MISO for a 100 MW data center',
  txaz: 'Texas or Arizona, 100 MW by 2028',
  nova: 'What data center capacity is coming online in Northern Virginia in the next 18 months?',
};

let H, fence;
// The server tells a plan's own loopback steps from an outside caller by the peer address (every-wall harness):
// this file's client sockets read as 203.0.113.7, the plan's step sockets stay 127.0.0.1.
const CLIENT_PORTS = new Set();
const _peer = net.Socket.prototype._getpeername;
beforeAll(async () => {
  net.Socket.prototype._getpeername = function _getpeername() {
    const p = _peer.call(this);
    if (H && this.server && this.localPort === H.PORT && p && CLIENT_PORTS.has(p.port)) return { ...p, address: '203.0.113.7' };
    return p;
  };
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_ANON_DAILY_CAP: '500' },
    extraRoutes: (p) => {
      if (p === '/api/v1/listings/summary') return { ok: true, program_status: 'upcoming', live_count: 0, total_mw: 0, markets: [], generated_at: '2026-11-15T00:00:00Z' };
      if (p === '/api/v1/relay/short') return { ok: true, url: 'https://dchub.cloud/u/abcdef' };
      if (p === '/api/v1/mcp/anon-usage') return { count: 0 };
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      const iso = ((p.match(/\/(ERCOT|PJM|MISO|CAISO|SPP)\b/i) || [])[1] || 'ERCOT').toUpperCase();
      if (p.startsWith('/api/v1/grid/')) return GI(iso);
      if (p.includes('queue')) return QUEUE(iso);
      // The backend's own offer list, as a live search_facilities step carried it on 2026-11-15.
      return { success: true, count: 12, total_count: 12, as_of: '2026-11-14', data: ROWS, results: ROWS,
        upgrade_options: [{ label: 'A one-time pack', opens: 'rest', plan: 'pack' }, { label: 'A paid plan', opens: 'rest', plan: 'developer' }] };
    },
  });
  // The capacity summary is read in the background and armed at listen() in production; arm and warm it here.
  if (H.S._capacitySummary) { H.S._capacitySummary.arm(); await H.S._capacitySummary.refresh(); }
  await plan(PLANS.iso3);
  await new Promise((r) => setTimeout(r, 300));
}, 120_000);
afterAll(async () => {
  net.Socket.prototype._getpeername = _peer;
  if (H) await H.stop();
  if (fence) fence.restore();
});

function rpc(headers, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: H.PORT, path: '/mcp', method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (ch) => { raw += ch; });
      res.on('end', () => {
        const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
        let msg = null; try { msg = JSON.parse(b); } catch (_) { /* not JSON */ }
        resolve({ raw, msg });
      });
    });
    req.on('socket', (sock) => {
      const note = () => { const lp = sock.localPort; CLIENT_PORTS.add(lp); sock.once('close', () => CLIENT_PORTS.delete(lp)); };
      if (sock.localPort) note(); else sock.once('connect', note);
    });
    req.on('error', reject);
    req.end(data);
  });
}
let ip = 1, rid = 9000;
async function plan(intent) {
  const r = await rpc({ 'user-agent': 'cursor/1.0', 'x-dc-client-ip': `198.51.110.${ip++}` },
    { jsonrpc: '2.0', id: rid++, method: 'tools/call', params: { name: 'execute_plan', arguments: { intent } } });
  return { raw: r.raw, result: r.msg && r.msg.result };
}
// execute_plan's block 0 is the plain-language lead since 2026-11-17 (lib/plan-lead-text.mjs); the JSON is block 1.
const block0Json = (result) => {
  const t = result.content.map((b) => b.text).find((x) => typeof x === 'string' && x.trimStart().startsWith('{'));
  return t.slice(t.indexOf('{'));
};

describe('B) execute_plan end to end: each envelope key exactly once', () => {
  const sizes = {};
  afterAll(() => { console.warn('plan-envelope-once sizes (bytes, wire / structuredContent, off -> on):', JSON.stringify(sizes)); });

  it.each(Object.entries(PLANS))('%s: identity, next_session, digest_offer, capacity_source once; no step offer list; smaller than off', async (k, intent) => {
    process.env.DCHUB_PLAN_ENVELOPE_ONCE = '0';
    let off;
    try { off = await plan(intent); } finally { delete process.env.DCHUB_PLAN_ENVELOPE_ONCE; }
    const on = await plan(intent);
    const sc = JSON.stringify(on.result.structuredContent);
    const b0 = block0Json(on.result);
    expect(on.result.structuredContent._entity).toBe('plan_execution');
    expect(on.result.structuredContent.executed.length).toBeGreaterThan(1);
    for (const key of KEYS) {
      expect(count(sc, key), `${k} structuredContent ${key}`).toBe(1);
      expect(count(b0, key), `${k} block 0 ${key}`).toBe(1);
    }
    for (const e of on.result.structuredContent.executed) {
      for (const key of STEP_ENVELOPE_KEYS) expect(e.result && e.result[key], `${k} step ${e.step} ${key}`).toBeUndefined();
    }
    expect(sc).not.toMatch(/"plan":"(?:pack|developer)"/);
    // CONTROL: with the switch off the same plan repeats at least one key or carries a step offer list.
    const offSc = JSON.stringify(off.result.structuredContent);
    expect(KEYS.some((key) => count(offSc, key) > 1) || /"plan":"(?:pack|developer)"/.test(offSc), `${k} off is not a control`).toBe(true);
    expect(Buffer.byteLength(on.raw)).toBeLessThan(Buffer.byteLength(off.raw));
    sizes[k] = { wire: [Buffer.byteLength(off.raw), Buffer.byteLength(on.raw)], sc: [offSc.length, sc.length] };
  }, 120_000);
});
