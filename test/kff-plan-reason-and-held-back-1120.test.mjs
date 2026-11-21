// kff-plan-reason-and-held-back-1120.test.mjs — Grok's daily note 2026-11-20 (the 4th report): "the keyless
// full-depth plan is not served at the UTC reset". execute_plan detail:"full", keyless, 00:36 UTC: every gated step
// came back `depth: preview` and totals.tier_note said only "no key — steps returned preview depth".
//
// Measured: the Railway HTTP log for that call (00:36:40Z, 3814 ms, POST /mcp) carries the User-Agent
// "dchub-daily-lead/2026-11-20  (read-only; keyless; no forms)". The lane leaves our own callers out on purpose
// (isBotOrInternalCtxForSiteLane: the `dchub` token), so the plan was never the day's first full answer, and
// _kffPreviewReason had no branch for that seat, so the note gave no reason. An outside keyless caller IS served
// (section C2 runs one end to end).
//
// What this pins:
//   A) planStepDepths / utcClock, pure.
//   B) _kffPreviewReason names every refusal (our own User-Agent, lane off, no IP) and says WHEN the day's plan
//      answer was used.
//   C) end to end through execute_plan (in-process loopback steps): the reporter's UA, an outside caller's call 1
//      and call 2, and a first-full plan whose every step comes back as the data API's keyless stub, which is not
//      counted (no first_full_answer, no durable consume, no funnel tag; the next plan is still full).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as F from '../lib/keyless-first-full.mjs';
import { assignArm, ARM_CONTROL } from '../lib/continuation.mjs';

const _compactWas = process.env.DCHUB_PLAN_COMPACT;
beforeAll(() => { process.env.DCHUB_PLAN_COMPACT = '0'; });
afterAll(() => { if (_compactWas === undefined) delete process.env.DCHUB_PLAN_COMPACT; else process.env.DCHUB_PLAN_COMPACT = _compactWas; });
process.env.DCHUB_TOP_METROS_FREE = '0';
process.env.DCHUB_LEAN_RESPONSES = '0';

const REPORTER_UA = 'dchub-daily-lead/2026-11-20  (read-only; keyless; no forms)';
const BASE = 'https://backend.kff-plan-reason-1120.test';
const SECRET = 'kff-plan-reason-1120-internal-key-not-real';
const GI = {
  iso: 'ERCOT', demand_mw: 52000, peak_mw: 61000, queue_depth_gw: 400.1, as_of: '2026-11-21T00:00:00Z',
  generation_mix: { NG: { mw: 27000 } },
};
const QUEUE = { iso: 'ERCOT', total_projects: 10, total_gw: 400.1, as_of: '2026-11-21', projects: [{ name: 'Q0', mw: 100, fuel: 'solar' }] };
// The data API's keyless stub (main.py _has_key reads only X-API-Key): the shape mcp#1581 found on get_grid_data.
const STUB = { gated: true, iso: 'ERCOT', demand_mw: '<gated: identified-tier or higher>', note: 'keyless stub' };
const PLAN = { intent: 'how soon can a 100 MW load get power in ERCOT', detail: 'full' };

const writes = { track: [], consume: [] };
const mode = { stub: false };
const loopback = { emulate: false, ip: null };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, prevBase, prevInternal;

// The edge of a loopback step, in process: the step ctx the /mcp handler builds (loopback_step, and plan_first_full
// only when the plan's token is live), the step's tool handler, a JSON-RPC answer (as test/keyless-first-full J).
async function runStep(init) {
  const h = (init && init.headers) || {};
  const body = JSON.parse(init.body);
  const { name, arguments: a } = body.params;
  const T = TOOLS[name];
  if (!T) return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'unknown tool' } });
  const pf = F.consumePlanFirstFullToken(h[F.KEYLESS_FIRST_FULL_PLAN_HEADER]);
  const ctx = { tier: 'free', platform: 'cursor', client_name_raw: 'cursor', user_agent: 'cursor/1.0',
    client_ip: loopback.ip, session_id: null, loopback_step: true, ...(pf ? { plan_first_full: true } : {}) };
  const parsed = await T.inputSchema.safeParseAsync(a || {});
  const result = parsed.success
    ? await S._ctxALS.run(ctx, () => T.handler(parsed.data, { signal: new AbortController().signal }))
    : { isError: true, content: [{ type: 'text', text: 'invalid args' }] };
  return json({ jsonrpc: '2.0', id: body.id, result });
}

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = SECRET;
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (url.startsWith('http://127.0.0.1:') && loopback.emulate) return runStep(init);
    if (!url.startsWith(BASE)) throw new Error('network fence: ' + url);
    const p = new URL(url).pathname;
    let body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch { body = {}; }
    if (p === '/api/v1/mcp/track') { writes.track.push(body); return json({ ok: true }); }
    if (p === '/api/v1/mcp/full-cap/consume') { writes.consume.push(body); return json({ ok: false }); }
    if (p.startsWith('/api/v1/mcp/')) return json({ ok: false });
    if (mode.stub) return json(structuredClone(STUB));
    if (p.startsWith('/api/v1/grid/intelligence/')) return json(structuredClone(GI));
    if (p.startsWith('/api/v1/interconnection-queue/')) return json(structuredClone(QUEUE));
    return json({});
  };
  prevBase = process.env.DCHUB_API_BASE; process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});
afterEach(() => {
  delete process.env.DCHUB_KEYLESS_FIRST_FULL; delete process.env.DCHUB_KEYLESS_FIRST_FULL_CAP;
  loopback.emulate = false; loopback.ip = null; mode.stub = false;
  vi.useRealTimers();
});

let n = 0;
function seat(over = {}) {
  n += 1;
  while (assignArm({ sessionId: `sess-kffr-${n}`, eligible: true }) !== ARM_CONTROL) n += 1;
  return { tier: 'free', platform: 'cursor', client_name_raw: 'cursor', user_agent: 'cursor/1.0',
    client_ip: `203.0.113.${(n % 250) + 1}`, session_id: `sess-kffr-${n}`, ...over };
}
async function plan(s) {
  const T = TOOLS.execute_plan;
  const parsed = await T.inputSchema.safeParseAsync(PLAN);
  if (!parsed.success) throw new Error('zod rejected execute_plan');
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
function head(r) {
  const blocks = (r.content || []).map((b) => (b && typeof b.text === 'string' ? b.text : ''));
  const t = blocks.find((x) => x.trimStart().startsWith('{')) || blocks[0] || '';
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; }
}
const tierNote = (r) => ((r.structuredContent && r.structuredContent.totals) || head(r).totals || {}).tier_note;
const executed = (r) => (r.structuredContent && r.structuredContent.executed) || head(r).executed || [];
const kffId = (ip) => F.KEYLESS_FIRST_FULL_ID_PREFIX + 'ip-' + createHash('sha256').update(ip).digest('hex');
const settle = () => new Promise((r) => setTimeout(r, 25));
const PREVIEW_TAIL = '; steps returned preview depth';

describe('A) planStepDepths and utcClock (pure)', () => {
  it('a data step is held back at preview depth, as gated_preview, or carrying the data API stub; the navigator does not count', () => {
    const full = new Map();
    const stubbed = { tool: 'get_interconnection_queue', status: 'executed', result: { iso: 'ERCOT' } };
    full.set(stubbed, { gated: true, iso: 'ERCOT' });
    const d = F.planStepDepths([
      { tool: 'discover_tools', status: 'executed', result: { ok: true } },
      { tool: 'get_grid_intelligence', status: 'executed', result: { iso: 'ERCOT' } },
      { tool: 'get_fiber_intel', status: 'gated_preview', result: { rows: [] } },
      { tool: 'get_water_risk', status: 'executed', depth: 'preview', result: { score: null } },
      stubbed,
      { tool: 'get_market_intel', status: 'failed', result: null },
    ], (e) => full.get(e));
    expect(d).toEqual({ full: ['get_grid_intelligence'], held: ['get_fiber_intel', 'get_water_risk', 'get_interconnection_queue'] });
    expect(F.planStepDepths(null)).toEqual({ full: [], held: [] });
  });
  it('utcClock is HH:MM UTC, null for no instant', () => {
    expect(F.utcClock(Date.parse('2026-11-21T00:12:59Z'))).toBe('00:12 UTC');
    expect(F.utcClock(0)).toBeNull();
    expect(F.utcClock(NaN)).toBeNull();
  });
});

describe('B) _kffPreviewReason names every refusal and when the day\'s plan answer was used', () => {
  it('the reporter\'s User-Agent (ours, left out on purpose) is said, not silent', () => {
    expect(S._kffPreviewReason({ client_ip: '198.51.100.81', user_agent: REPORTER_UA }))
      .toBe('this caller\u2019s User-Agent marks it as a DC Hub or automated client, which is not served the first full plan answer');
  });
  it('the lane switched off, or a cap of 0, is said', () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
    expect(S._kffPreviewReason({ client_ip: '198.51.100.82', user_agent: 'Mozilla/5.0' }))
      .toBe('the first full plan answer without a key is switched off on this server');
    delete process.env.DCHUB_KEYLESS_FIRST_FULL;
    process.env.DCHUB_KEYLESS_FIRST_FULL_CAP = '0';
    expect(S._kffPreviewReason({ client_ip: '198.51.100.82', user_agent: 'Mozilla/5.0' }))
      .toBe('the first full plan answer without a key is switched off on this server');
  });
  it('no readable caller IP is said', () => {
    expect(S._kffPreviewReason({ user_agent: 'Mozilla/5.0' }))
      .toBe('no caller network (IP) could be read, so the first full plan answer could not be counted');
  });
  it('an outside keyless caller with its answer unspent has no reason (it is served)', () => {
    expect(S._kffPreviewReason({ client_ip: '198.51.100.83', user_agent: 'Mozilla/5.0' })).toBe('');
  });
  it('after the charge, the reason says the clock time it was used', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T00:12:30Z'));
    const c = { client_ip: '198.51.100.84', user_agent: 'Mozilla/5.0' };
    expect(await S._keylessFirstFullCharge(c, 'execute_plan', 1)).toBe(true);
    vi.setSystemTime(new Date('2026-11-21T00:36:40Z'));
    expect(S._kffUsedAt(c, 'execute_plan')).toBe('00:12 UTC');
    expect(S._kffPreviewReason(c)).toBe('today\u2019s full plan answer without a key was used at 00:12 UTC on this network (IP) or in this session; the next is after 00:00 UTC');
  });
  it('a refunded charge forgets its time', async () => {
    const c = { client_ip: '198.51.100.85', user_agent: 'Mozilla/5.0' };
    expect(await S._keylessFirstFullCharge(c, 'execute_plan', 1, { defer: true })).toBe(true);
    expect(S._kffUsedAt(c, 'execute_plan')).toMatch(/^\d\d:\d\d UTC$/);
    expect(S._keylessFirstFullSettle(c, false)).toBe('refunded');
    expect(S._kffUsedAt(c, 'execute_plan')).toBeNull();
    expect(S._kffPreviewReason(c)).toBe('');
  });
});

describe('C) execute_plan detail:"full" end to end', () => {
  it('C1: the reporter\'s User-Agent: no first full answer, and the tier_note says why', async () => {
    const ip = '198.18.120.10';
    loopback.emulate = true; loopback.ip = ip;
    const r = await plan(seat({ client_ip: ip, user_agent: REPORTER_UA, platform: 'mcp', client_name_raw: null, session_id: null }));
    expect(head(r).first_full_answer).toBeUndefined();
    expect(tierNote(r)).toBe('no key — this caller\u2019s User-Agent marks it as a DC Hub or automated client, which is not served the first full plan answer' + PREVIEW_TAIL);
  }, 90_000);

  it('C2: an outside keyless caller: call 1 is full depth, call 2 says when the day\'s answer was used', async () => {
    const ip = '198.18.120.11';
    loopback.emulate = true; loopback.ip = ip;
    const r1 = await plan(seat({ client_ip: ip, session_id: null }));
    expect(head(r1).first_full_answer, JSON.stringify(executed(r1).map((e) => [e.tool, e.status, e.depth]))).toMatchObject({ used: 1, limit: 1 });
    expect(tierNote(r1)).toBe('no key — steps ran at full depth');
    await settle();
    const r2 = await plan(seat({ client_ip: ip, session_id: null }));
    expect(head(r2).first_full_answer).toBeUndefined();
    expect(tierNote(r2)).toMatch(/^no key — today’s full plan answer without a key was used at \d\d:\d\d UTC on this network \(IP\) or in this session; the next is after 00:00 UTC; steps returned preview depth$/);
  }, 90_000);

  it('C3: a first-full plan whose every step is the data API\'s keyless stub is not counted, and says so', async () => {
    const ip = '198.18.120.12';
    loopback.emulate = true; loopback.ip = ip; mode.stub = true;
    writes.track.length = 0; writes.consume.length = 0;
    const s1 = seat({ client_ip: ip, session_id: null });
    const r1 = await plan(s1);
    const ran = executed(r1).filter((e) => e.status === 'executed');
    expect(ran.length, JSON.stringify(executed(r1).map((e) => [e.tool, e.status, e.depth]))).toBeGreaterThan(0);
    expect(head(r1).first_full_answer).toBeUndefined();
    expect(tierNote(r1)).toBe('no key — every step came back at preview depth, so this plan was not counted as today\u2019s full plan answer' + PREVIEW_TAIL);
    expect(s1._kffPending, 'the deferred charge was settled').toBeUndefined();
    await settle();
    expect(writes.consume.filter((w) => w.identity === kffId(ip)), 'no durable charge').toEqual([]);
    expect(writes.track.filter((w) => w.tool === 'execute_plan' && w.status === F.KEYLESS_FIRST_FULL_STATUS), 'no first-full funnel tag').toEqual([]);
    // The seat was given back: the same IP's next plan, whose steps answer, is the day's full answer.
    mode.stub = false;
    const r2 = await plan(seat({ client_ip: ip, session_id: null }));
    expect(head(r2).first_full_answer).toMatchObject({ used: 1, limit: 1 });
    expect(tierNote(r2)).toBe('no key — steps ran at full depth');
  }, 90_000);
});
