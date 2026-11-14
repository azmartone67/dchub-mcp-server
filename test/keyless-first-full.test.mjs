// keyless-first-full.test.mjs — the first full answer of the day on the energy tools (owner 2026-11-14,
// lib/keyless-first-full.mjs). Real tool handlers through the dispatch, the backend stubbed at the fetch
// boundary (it answers this server's internal key at full depth, as production does).
//
//   A) DCHUB_KEYLESS_FIRST_FULL=0: today's preview, nothing charged or tagged.
//   B) on (the default): a keyless caller's first call per tool per IP per UTC day is the email-bound free
//      key's answer, says so, is charged under 'kff:' and tagged keyless_first_full_answer; the second call
//      from that IP is today's preview, byte for byte.
//   C) never above email-key depth: the first answer's data equals the email-bound key's.
//   D) who is not in it: a key, /mcp/chatgpt, a QA caller, a bot, a plan step without its plan's token,
//      a tool outside the five, CAP=0.
//   E) the plan step seat and its single-use token; F) the compact plan answer; G) the relay line.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as F from '../lib/keyless-first-full.mjs';
import { assignArm, ARM_CONTROL } from '../lib/continuation.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
process.env.DCHUB_TOP_METROS_FREE = '0';
process.env.DCHUB_LEAN_RESPONSES = '0';

const BASE = 'https://backend.keyless-first-full.test';
const SECRET = 'keyless-first-full-internal-key-not-real';
const GI = {
  iso: 'PJM', demand_mw: 93825, demand_period: '2026-11-14T14', peak_mw: 102346, min_mw: 85900, load_factor: 0.839,
  queue_depth_gw: 373.6, queue_depth_basis: 'generation_queue', market_count: 64, build_count: 0, build_rate_pct: 0,
  capacity_auction_price_usd_mw_day: 333.44, capacity_auction_delivery_year: '2027/2028',
  generation_mix: { NG: { mw: 40289 }, NUC: { mw: 30748 } }, as_of: '2026-11-14T14:00:00Z',
  demand_24h: Array.from({ length: 8 }, (_, i) => ({ period: `2026-11-14T${String(i + 1).padStart(2, '0')}`, mw: 90000 + i * 400 })),
};
const QUEUE = {
  iso: 'PJM', total_projects: 1174, total_gw: 373.6, as_of: '2026-11-14',
  by_fuel: { solar: 120.1, storage: 90.2, gas: 60.3 },
  projects: Array.from({ length: 6 }, (_, i) => ({ name: `Q${i}`, mw: 100 + i, fuel: 'solar', status: 'active', state: 'PA' })),
};
const ENERGY = { success: true, avg_rate_kwh: 0.2341, scope: 'iso_footprint_avg', filter: { iso: 'CAISO', sector: 'all', state: null },
  retail_rates: { avg_cents_kwh: 23.41, latest_period: '2026', max_cents_kwh: 30.1, min_cents_kwh: 18.2, states_covered: 1 } };
const ARGS = {
  get_grid_intelligence: { iso: 'PJM' },
  get_interconnection_queue: { iso: 'PJM' },
  get_grid_data: { iso: 'PJM' },
  get_energy_prices: { iso: 'CAISO' },
  get_market_intel: { market: 'phoenix' },
};
const DIRECT = ['get_grid_intelligence', 'get_interconnection_queue', 'get_grid_data', 'get_energy_prices'];

const writes = { track: [], consume: [], peek: [] };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, prevBase, prevInternal;

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = SECRET;
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    let u = null; try { u = new URL(url); } catch { /* not a URL */ }
    if (!url.startsWith(BASE)) throw new Error('network fence: ' + url);
    const p = u.pathname;
    let body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch { body = {}; }
    if (p === '/api/v1/mcp/track') { writes.track.push(body); return json({ ok: true }); }
    if (p === '/api/v1/mcp/full-cap/consume') { writes.consume.push(body); return json({ ok: false }); }
    if (p === '/api/v1/mcp/full-cap/peek') { writes.peek.push({ identity: u.searchParams.get('identity') }); return json({ ok: false }); }
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: 0, had_pack: false });
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    if (p.startsWith('/api/v1/grid/intelligence/')) return json(structuredClone(GI));
    if (p.startsWith('/api/v1/interconnection-queue/')) return json(structuredClone(QUEUE));
    if (p.startsWith('/api/v1/energy/')) return json(structuredClone(ENERGY));
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
const FLAG_VARS = ['DCHUB_KEYLESS_FIRST_FULL', 'DCHUB_KEYLESS_FIRST_FULL_CAP'];
afterEach(() => { for (const k of FLAG_VARS) delete process.env[k]; });

// A fresh seat per call, in the CONTROL arm of the human-line experiment so seats compare byte for byte.
let n = 0;
function seat(over = {}) {
  n += 1;
  while (assignArm({ sessionId: `sess-kff-${n}`, eligible: true }) !== ARM_CONTROL) n += 1;
  return { tier: 'free', platform: 'cursor', client_name_raw: 'cursor', user_agent: 'cursor/1.0',
    client_ip: `203.0.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`, session_id: `sess-kff-${n}`, ...over };
}
async function call(name, s, args = ARGS[name]) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
function norm(r, s) {
  let t = JSON.stringify(r);
  for (const [v, ph] of [[s.session_id, 'SID'], [s.client_ip, 'IP']]) if (v) t = t.split(v).join(ph);
  return t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, 'TS')
    .replace(/\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]+/g, '/upgrade/h/TOKEN');
}
function head(r) {
  const t = (r.content || [])[0]?.text || '';
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return null; }
}
const VOLATILE = new Set(['_return_loop', 'human_url', 'for_your_human', 'citation', 'provenance', 'cite_as', 'next_ask',
  'retrieved_at', 'served_at', 'first_full_answer', '_metered_trial', 'next_call', 'freshness', 'quota', 'identity',
  'user_message', 'show_to_user', 'next_session', '_upgrade']);
function dataOf(r) {
  const h = head(r);
  if (!h || typeof h !== 'object') return h;
  return Object.fromEntries(Object.entries(h).filter(([k]) => !VOLATILE.has(k)));
}
const isPreview = (r) => {
  const h = head(r) || {};
  const sc = r.structuredContent || {};
  return !!(h.taste || h.free_preview_only || sc.trial_preview || h.trial_preview || h.preview_is_partial
    || (h._upgrade && /anonymous|anon/.test(String(h._upgrade.tier || ''))));
};
const kffId = (ip) => F.KEYLESS_FIRST_FULL_ID_PREFIX + 'ip-' + createHash('sha256').update(ip).digest('hex');
const kffConsumes = (ip) => writes.consume.filter((w) => w.identity === kffId(ip));
const kffTracks = () => writes.track.filter((w) => w.status === F.KEYLESS_FIRST_FULL_STATUS || w.keyless_first_full_answer === true);
const resetWrites = () => { writes.track.length = 0; writes.consume.length = 0; writes.peek.length = 0; };
const settle = () => new Promise((r) => setTimeout(r, 25));

describe('A) DCHUB_KEYLESS_FIRST_FULL=0: today\'s preview, nothing charged or tagged', () => {
  for (const tool of DIRECT) {
    it(`${tool}: the keyless call is today's preview`, async () => {
      resetWrites();
      process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
      const s = seat();
      const r = await call(tool, s);
      expect(r.structuredContent?.first_full_answer).toBeUndefined();
      expect(head(r)?.first_full_answer).toBeUndefined();
      await settle();
      expect(kffConsumes(s.client_ip)).toEqual([]);
      expect(kffTracks()).toEqual([]);
    });
  }
  it('the off-path answer for the grid read is a preview (the comparisons below are not vacuous)', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
    expect(isPreview(await call('get_grid_intelligence', seat()))).toBe(true);
  });
});

describe('B) on: the first call per tool per IP per day is full, the second is today\'s preview', () => {
  for (const tool of DIRECT) {
    it(`${tool}: call 1 full and said so, call 2 = the off-path preview byte for byte`, async () => {
      resetWrites();
      process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
      const sOff = seat();
      const off = norm(await call(tool, sOff), sOff);
      delete process.env.DCHUB_KEYLESS_FIRST_FULL;
      const ip = `198.18.40.${DIRECT.indexOf(tool) + 10}`;
      const r1 = await call(tool, seat({ client_ip: ip }));
      expect(r1.isError).not.toBe(true);
      expect(isPreview(r1), 'call 1 is not a preview').toBe(false);
      const blk = head(r1).first_full_answer;
      expect(blk).toMatchObject({ used: 1, limit: 1, resets: '00:00 UTC' });
      expect(blk.note).not.toMatch(/\b(Developer|Pro|Starter|Enterprise|Founding)\b|\$\s?\d/);
      const s2 = seat({ client_ip: ip });
      const r2 = await call(tool, s2);
      expect(norm(r2, s2), 'call 2 is exactly the preview a caller gets with the lane off').toBe(off);
      await settle();
      expect(kffConsumes(ip).map((w) => w.tool)).toEqual([tool]);
      const rows = kffTracks().filter((w) => w.tool === tool);
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({ status: F.KEYLESS_FIRST_FULL_STATUS, keyless_first_full_answer: true });
    });
  }
  it('the grid read carries the figures the preview withheld', async () => {
    const r = await call('get_grid_intelligence', seat({ client_ip: '198.18.41.1' }));
    const h = head(r);
    expect(h.demand_mw).toBe(93825);
    expect(h.peak_mw).toBe(102346);
    expect(Array.isArray(h.demand_24h) && h.demand_24h.length).toBe(8);
    expect(isPreview(r)).toBe(false);
  });
  it('a different IP gets its own first answer; CAP=2 serves two', async () => {
    expect(isPreview(await call('get_grid_data', seat({ client_ip: '198.18.42.1' })))).toBe(false);
    expect(isPreview(await call('get_grid_data', seat({ client_ip: '198.18.42.2' })))).toBe(false);
    process.env.DCHUB_KEYLESS_FIRST_FULL_CAP = '2';
    const ip = '198.18.42.3';
    expect(isPreview(await call('get_grid_data', seat({ client_ip: ip })))).toBe(false);
    expect(isPreview(await call('get_grid_data', seat({ client_ip: ip })))).toBe(false);
    expect(isPreview(await call('get_grid_data', seat({ client_ip: ip })))).toBe(true);
  });
});

describe('C) never above the email-bound free key\'s depth', () => {
  for (const tool of DIRECT) {
    it(`${tool}: the first answer's data = the email-bound key's`, async () => {
      const keyed = await call(tool, seat({ api_key: `dch_live_kff_parity_${tool}_${n}`, tier: 'free', email: 'kff@example.com' }));
      const first = await call(tool, seat({ client_ip: `198.18.43.${DIRECT.indexOf(tool) + 1}` }));
      expect(dataOf(first)).toEqual(dataOf(keyed));
    });
  }
});

describe('D) who is not in it', () => {
  const cases = [
    ['a key', { api_key: 'dch_live_kff_keyed_000001' }],
    ['/mcp/chatgpt', { profile: DIRECTORY_PROFILE }],
    ['a QA caller (X-DCHub-QA: 1)', { qa_marker: true, qa_header: true }],
    ['a QA caller (UA)', { user_agent: 'dchub-qa-readonly' }],
    ['a plan step without its plan\'s token', { loopback_step: true }],
    ['no usable IP', { client_ip: '' }],
  ];
  for (const [label, over] of cases) {
    it(`${label}: no first full answer, nothing charged`, async () => {
      resetWrites();
      const s = seat({ client_ip: '198.18.44.' + (cases.findIndex((c) => c[0] === label) + 1), ...over });
      const r = await call('get_grid_intelligence', s);
      expect(head(r)?.first_full_answer).toBeUndefined();
      await settle();
      expect(writes.consume.filter((w) => String(w.identity || '').startsWith(F.KEYLESS_FIRST_FULL_ID_PREFIX))).toEqual([]);
      expect(kffTracks()).toEqual([]);
    });
  }
  it('a tool outside the five is unchanged', async () => {
    const r = await call('get_market_intel', seat({ client_ip: '198.18.44.50' }));
    expect(head(r)?.first_full_answer).toBeUndefined();
  });
  it('CAP=0: no first full answer', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL_CAP = '0';
    expect(isPreview(await call('get_grid_intelligence', seat({ client_ip: '198.18.44.60' })))).toBe(true);
  });
  it('the seat helper: off, unknown tool, key, chatgpt', () => {
    const c = { client_ip: '198.18.44.70', user_agent: 'cursor/1.0' };
    expect(S._keylessFirstFullSeat('get_grid_data', c)).toBe('charge');
    expect(S._keylessFirstFullSeat('get_market_intel', c)).toBeNull();
    expect(S._keylessFirstFullSeat('get_grid_data', { ...c, api_key: 'k' })).toBeNull();
    expect(S._keylessFirstFullSeat('get_grid_data', { ...c, profile: DIRECTORY_PROFILE })).toBeNull();
    expect(S._keylessFirstFullSeat('get_grid_data', c, { DCHUB_KEYLESS_FIRST_FULL: 'off' })).toBeNull();
  });
});

describe('E) a plan\'s steps: one charge, the step token', () => {
  it('a step of a first-full plan takes the lane without a charge; a Land & Power step does not', () => {
    const c = { client_ip: '198.18.45.1', user_agent: 'cursor/1.0', loopback_step: true, plan_first_full: true };
    expect(S._keylessFirstFullSeat('get_refined_queue', c)).toBe('step');
    expect(S._keylessFirstFullSeat('get_grid_intelligence', c)).toBe('step');
    expect(S._keylessFirstFullSeat('analyze_site', c)).toBeNull();
    expect(S._keylessFirstFullSeat('get_grid_intelligence', { ...c, plan_first_full: false })).toBeNull();
    expect(S._keylessFirstFullSeat('get_grid_intelligence', { ...c, api_key: 'k' })).toBeNull();
  });
  it('the token is single-use, in-process and expires', () => {
    const t = F.mintPlanFirstFullToken();
    expect(F.consumePlanFirstFullToken(t)).toBe(true);
    expect(F.consumePlanFirstFullToken(t)).toBe(false);
    expect(F.consumePlanFirstFullToken('forged-' + t)).toBe(false);
    expect(F.consumePlanFirstFullToken(undefined)).toBe(false);
    const old = F.mintPlanFirstFullToken(Date.now() - 10 * 60_000);
    expect(F.consumePlanFirstFullToken(old)).toBe(false);
  });
  it('a promoted step is not charged and not tagged', async () => {
    resetWrites();
    const s = seat({ client_ip: '198.18.45.2', loopback_step: true, plan_first_full: true });
    const r = await call('get_grid_intelligence', s);
    expect(isPreview(r)).toBe(false);
    expect(head(r).first_full_answer).toBeUndefined();   // the plan's answer carries the block
    expect(S._execStepPreview(head(r), s), 'the plan does not label the step a preview').toBe(false);
    await settle();
    expect(kffConsumes('198.18.45.2')).toEqual([]);
    expect(kffTracks()).toEqual([]);
  });
});

describe('F) the compact first plan answer', () => {
  const big = Array.from({ length: 400 }, (_, i) => ({ name: 'project ' + i, mw: 100 + i, state: 'PA', status: 'active' }));
  const executed = [
    { step: 1, tool: 'get_grid_intelligence', args: { iso: 'PJM' }, status: 'executed', result: { iso: 'PJM' } },
    { step: 2, tool: 'get_refined_queue', args: { iso: 'PJM', min_mw: 100 }, status: 'executed', result: { results: big.slice(0, 3) } },
  ];
  const full = new Map([[executed[0], { ...GI, identity: { tier: 'anonymous' }, citation: { x: 1 } }],
                        [executed[1], { count_total_matching: 1174, results: big }]]);
  const out = {
    _entity: 'plan_execution', ok: true, intent: 'time to power for 100 MW in PJM', intent_class: 'grid_headroom',
    planner_version: '5.27', executed, constraint_iso: ['PJM'], totals: { steps_run: 2 },
    answer_guide: 'COLLECTED, NOT REPORT-DATED — long guide.', replay: { big: 'x'.repeat(30_000) },
    power_evidence: [{ step: 1, tool: 'get_grid_intelligence', as_of: '2026-11-14T14:00:00Z', ok: true }],
    intent_answer: { kind: 'power_timing', requested_mw: 100, geography: 'PJM (ISO)',
      headline: 'Time to 100 MW of power for PJM (ISO) is not measurable from this run: time-to-power and queue wait are withheld at this tier.',
      verdict: null, evidence: ['1174 active interconnection-queue projects of every size (queue data as of 2026-11-14).'],
      not_established: [], as_of: '2026-11-14', relay: null, source: 'Source: DC Hub (dchub.cloud/grid/pjm)' },
    _source: 'DC Hub — dchub.cloud',
  };
  it('leads with a direct answer and its as_of, never "not measurable" or a queue sample', () => {
    const c = F.compactFirstPlan(out, full);
    expect(Object.keys(c).slice(0, 2)).toEqual(['answer', 'as_of']);
    expect(c.as_of).toBe('2026-11-14');
    expect(c.answer).toMatch(/^PJM: 373\.6 GW waiting in the interconnection queue; the 2027\/2028 capacity auction cleared at \$333\.44\/MW-day/);
    expect(c.answer).not.toMatch(/not measurable|withheld|tier/i);
    expect(c.intent_answer.not_established.join(' ')).toMatch(/month estimate of time to power for 100 MW in PJM \(ISO\) is not part of this answer/);
  });
  it('stays under the budget with every step present, and points at the full rows', () => {
    const c = F.compactFirstPlan(out, full);
    expect(Buffer.byteLength(JSON.stringify(c))).toBeLessThan(F.FIRST_PLAN_BUDGET_BYTES);
    expect(c.replay).toBeUndefined();
    expect(c.executed.map((e) => e.tool)).toEqual(['get_grid_intelligence', 'get_refined_queue']);
    const q = c.executed[1].figures;
    expect(q).toMatchObject({ rows_field: 'results', rows_total: 400, count_total_matching: 1174 });
    expect(q.results.length).toBe(q.rows_shown);
    expect(c.executed[0].figures.identity).toBeUndefined();
    expect(c.more_detail.calls).toEqual([{ tool: 'get_grid_intelligence', args: { iso: 'PJM' } },
      { tool: 'get_refined_queue', args: { iso: 'PJM', min_mw: 100 } }]);
    expect(c.more_detail.url).toBe('https://dchub.cloud/grid/pjm');
    expect(c.first_full_answer).toMatchObject({ used: 1, limit: 1 });
  });
  it('a measurable headline leads as it is', () => {
    const ia = { ...out.intent_answer, headline: 'Siting read for 100 MW, PJM (ISO): DCPI CAUTION (ISO-level).' };
    expect(F.compactFirstPlan({ ...out, intent_answer: ia }, full).answer).toBe(ia.headline);
  });
  it('a time-to-power figure leads when the run read one', () => {
    const ia = { ...out.intent_answer, evidence: ['PJM average time-to-power: 41 months.'] };
    expect(F.compactFirstPlan({ ...out, intent_answer: ia }, full).answer)
      .toBe('Time to power for 100 MW in PJM (ISO): PJM average time-to-power: 41 months.');
  });
});

describe('G) the relay line says "free-tier limit" only when a limit was hit', () => {
  it('a depth preview is a preview, and says what an email gets, with no plan name', () => {
    const line = S._ctxALS.run(seat(), () => S._relayLead('get_grid_intelligence', {}));
    expect(line).toMatch(/^Your AI assistant got a preview of get_grid_intelligence from DC Hub; with an email it gets \d+ full answers a day on this tool, free$/);
    expect(line).not.toMatch(/limit|\b(Developer|Pro|Starter)\b|\$/);
  });
  for (const st of ['anon_daily_cap', 'anon_hard_wall', 'trial_used', 'trial_cap_exceeded']) {
    it(`${st}: a real limit keeps the line and adds what an email gets`, () => {
      const c = seat();
      S._limitHit(c, st);
      const line = S._ctxALS.run(c, () => S._relayLead('get_grid_data', {}));
      expect(line).toMatch(/^Your AI assistant hit DC Hub’s free-tier limit on get_grid_data; an email gets a free key with \d+ calls a day$/);
    });
  }
  it('a caller with an email on file is not told to add one; a paid boundary is unchanged', () => {
    expect(S._ctxALS.run(seat({ api_key: 'k', email: 'a@example.com' }), () => S._relayLead('get_grid_intelligence', {})))
      .toBe('Your AI assistant got a preview of get_grid_intelligence from DC Hub');
    expect(S._ctxALS.run(seat(), () => S._relayLead('analyze_site', {}))).toBe('Your AI assistant hit DC Hub’s paid data boundary on analyze_site');
  });
});
