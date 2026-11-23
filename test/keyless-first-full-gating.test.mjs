// keyless-first-full-gating.test.mjs — who gets the first full answer of the day, and what the quota stamp
// says about it (2026-11-15, follow-up to mcp#1438 / lib/keyless-first-full.mjs).
//
//   H) an agent calling through a plain HTTP client (curl, python-requests, wget, Go, HTTPie, Postman) gets
//      the first full answer: the lane uses the daily site lane's bot rule (isBotOrInternalCtxForSiteLane).
//   I) still refused: our own ('dchub', the dchub-internal self-tag), monitor and crawler callers, QA.
//   J) why clientInfo "sweep-check-1114" got the preview while "cursor"/"grok" from the same IP got full:
//      _INTERNAL_SELF_TAG tags harness-shaped names (…sweep…, …check…) platform 'dchub-internal', and
//      'dchub' is one of our own markers. Intended; proven here through the platform resolver itself.
//   K) the quota stamp on get_grid_intelligence / get_interconnection_queue no longer says "no daily
//      full-answer budget is charged here" to a keyless seat the lane charges.
//   L) one MCP session gets one first full answer per tool per day even when its egress IP changes
//      (Grok's re-test: a repeat call 8 s later came from another address and was served full again).
//   M) "<N> MW data center in <place>" is planned as a capacity search, not an inventory lookup, and the
//      compact first plan never leads with answer_guide's instruction to the agent.
//
// ★ Owner 2026-11-23 (lib/paid-full-only.mjs): the lane lists NO tools (KEYLESS_FIRST_FULL_TOOLS = []): grid, queue,
// energy, grid_data and execute_plan give a full answer only to a paid key. The flag and the lane code stay, so H-L
// now pin that the empty lane is safe: no first full answer, no charge, no "first full answer" stamp, for every
// caller. The caller rule the lane would apply (H, I, J) is pinned on keylessCallerSeat with the lane's own bot rule
// (isBotOrInternalCtxForSiteLane), so a future tool added back to the lane inherits a tested rule.
//
// Seats are built the way the /mcp handler builds them: platform from _resolvePlatform(body, UA, …).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as F from '../lib/keyless-first-full.mjs';
import { keylessCallerSeat } from '../lib/keyless-full-trial.mjs';
import { assignArm, ARM_CONTROL } from '../lib/continuation.mjs';
process.env.DCHUB_TOP_METROS_FREE = '0';
process.env.DCHUB_LEAN_RESPONSES = '0';

const BASE = 'https://backend.keyless-first-full-gating.test';
const SECRET = 'keyless-first-full-gating-internal-key-not-real';
const GI = {
  iso: 'PJM', demand_mw: 93825, demand_period: '2026-11-14T14', peak_mw: 102346, min_mw: 85900, load_factor: 0.839,
  queue_depth_gw: 373.6, queue_depth_basis: 'generation_queue', market_count: 64, build_count: 0, build_rate_pct: 0,
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
};
// The stamp on a paid-full-only decision tool, lane on or off: preview on every non-paid seat, no email promise.
const PREVIEW_REASON = (tool) => 'NOT APPLICABLE: `' + tool + '` is a preview on every non-paid seat (anonymous, DC Hub key, '
  + 'trial, email-bound); no daily full-answer budget is charged for it. This result is partial: some fields are not '
  + 'included at this access level.';

const writes = { track: [], consume: [] };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch;
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_QUOTA_HINT'];
const prevEnv = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  process.env.DCHUB_QUOTA_HINT = '1';   // on in production (the live envelope carries quota); read at load
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (!url.startsWith(BASE)) throw new Error('network fence: ' + url);
    const p = new URL(url).pathname;
    let body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch { body = {}; }
    if (p === '/api/v1/mcp/track') { writes.track.push(body); return json({ ok: true }); }
    if (p === '/api/v1/mcp/full-cap/consume') { writes.consume.push(body); return json({ ok: false }); }
    if (p === '/api/v1/mcp/full-cap/peek') return json({ ok: false });
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: 0, had_pack: false });
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    if (p.startsWith('/api/v1/grid/intelligence/')) return json(structuredClone(GI));
    if (p.startsWith('/api/v1/interconnection-queue/')) return json(structuredClone(QUEUE));
    if (p.startsWith('/api/v1/energy/')) return json(structuredClone(ENERGY));
    return json({});
  };
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});
afterEach(() => { delete process.env.DCHUB_KEYLESS_FIRST_FULL; delete process.env.DCHUB_KEYLESS_FIRST_FULL_CAP; });

// A seat as the /mcp handler builds it for a keyless call: platform from the resolver, the raw clientInfo
// name, the UA. In the CONTROL arm of the human-line experiment so answers compare byte for byte.
let n = 0;
function seat({ name = null, ua, ip, ...over }) {
  n += 1;
  while (assignArm({ sessionId: `sess-kffg-${n}`, eligible: true }) !== ARM_CONTROL) n += 1;
  const body = name ? { method: 'initialize', params: { clientInfo: { name } } } : {};
  return { tier: 'free', platform: S._resolvePlatform(body, ua, '', null), client_name_raw: name, user_agent: ua,
    client_ip: ip, session_id: `sess-kffg-${n}`, ...over };
}
async function call(name, s, args = ARGS[name]) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
function head(r) {
  const t = (r.content || [])[0]?.text || '';
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return null; }
}
const isFirstFull = (r) => !!(r.structuredContent?.first_full_answer || head(r)?.first_full_answer);
const quotaOf = (r) => r.structuredContent?.quota || head(r)?.quota || null;
const kffId = (ip) => F.KEYLESS_FIRST_FULL_ID_PREFIX + 'ip-' + createHash('sha256').update(ip).digest('hex');
const kffConsumes = (ip) => writes.consume.filter((w) => w.identity === kffId(ip));
const settle = () => new Promise((r) => setTimeout(r, 25));
const PLAN_OR_PRICE = /\b(Developer|Pro|Starter|Enterprise|Founding)\b|\$\s?\d|\/mo\b/;

// The lane's own caller rule, as server.mjs _keylessFirstFullSeat hands it to the lib.
const laneCaller = (c) => keylessCallerSeat(c, { isBot: S.isBotOrInternalCtxForSiteLane,
  isQa: (x) => S._isQaCaller(x) || x.qa_header === true || !!S._selfTestTelemetryTag(x) });
const LANE_TOOLS_BEFORE = ['get_grid_intelligence', 'get_interconnection_queue', 'get_energy_prices'];

describe('H) an agent behind a plain HTTP client: still a keyless caller, but the empty lane serves it no first full answer', () => {
  const UAS = ['curl/8.4.0', 'python-requests/2.31.0', 'Wget/1.21.4', 'Go-http-client/1.1', 'HTTPie/3.2.2',
    'PostmanRuntime/7.36.0', 'FastMCPClient/2.3'];
  it('the lane lists no tools', () => { expect([...F.KEYLESS_FIRST_FULL_TOOLS]).toEqual([]); });
  UAS.forEach((ua, i) => {
    it(`${ua}: the caller rule admits it; call 1 and call 2 are previews; nothing is charged`, async () => {
      const ip = `198.18.60.${i + 1}`;
      expect(laneCaller(seat({ ua, ip }))).toBe('charge');
      for (const t of LANE_TOOLS_BEFORE) expect(S._keylessFirstFullSeat(t, seat({ ua, ip })), t).toBeNull();
      const r1 = await call('get_interconnection_queue', seat({ ua, ip }));
      expect(isFirstFull(r1), 'no first_full_answer').toBe(false);
      expect(quotaOf(r1).full_answers_unavailable_reason).toBe(PREVIEW_REASON('get_interconnection_queue'));
      const r2 = await call('get_interconnection_queue', seat({ ua, ip }));
      expect(isFirstFull(r2)).toBe(false);
      await settle();
      expect(kffConsumes(ip)).toEqual([]);
    });
  });
});

describe('I) still refused: our own, monitor, crawler and QA callers', () => {
  const cases = [
    ['a dchub-named clientInfo', { name: 'dchub-sweep-test', ua: 'node' }],
    ['a dchub-named UA behind curl', { ua: 'dchub-monitor curl/8.4.0' }],
    ['a monitor UA', { ua: 'UptimeRobot/2.0 (+http://www.uptimerobot.com/)' }],
    ['a self-declared crawler', { ua: 'BrickBlueBot/0.1 (+https://brick.blue/bot)' }],
    ['a harness-shaped clientInfo (dchub-internal self-tag)', { name: 'verify-run-7', ua: 'curl/8.4.0' }],
    ['a QA caller behind curl', { ua: 'curl/8.4.0 dchub-qa-readonly' }],
  ];
  cases.forEach(([label, sp], i) => {
    it(`${label}: the caller rule refuses it, no first full answer, nothing charged`, async () => {
      const ip = `198.18.61.${i + 1}`;
      expect(laneCaller(seat({ ...sp, ip }))).toBeNull();
      expect(S._keylessFirstFullSeat('get_interconnection_queue', seat({ ...sp, ip }))).toBeNull();
      const r = await call('get_interconnection_queue', seat({ ...sp, ip }));
      expect(isFirstFull(r)).toBe(false);
      await settle();
      expect(kffConsumes(ip)).toEqual([]);
    });
  });
});

describe('J) "sweep-check-1114" is tagged as our own; with the empty lane nobody on its IP gets a first full answer', () => {
  const UA = (nm) => `Mozilla/5.0 (Macintosh) ${nm}/1.0`;
  it('the resolver tags it dchub-internal (clientInfo and X-MCP-Client), and cursor / grok keep their names', () => {
    expect(S._resolvePlatform({ params: { clientInfo: { name: 'sweep-check-1114' } } }, UA('sweep-check-1114'), '', null))
      .toBe('dchub-internal');
    expect(S._resolvePlatform({}, UA('sweep-check-1114'), '', null, 'sweep-check-1114')).toBe('dchub-internal');
    expect(S._resolvePlatform({ params: { clientInfo: { name: 'cursor' } } }, UA('cursor'), '', null)).toBe('cursor');
    expect(S._resolvePlatform({ params: { clientInfo: { name: 'grok' } } }, UA('grok'), '', null)).toBe('grok');
  });
  it('only the platform tag refuses it under the caller rule: the raw name and UA match no bot, QA or self-test rule', () => {
    const raw = { client_name_raw: 'sweep-check-1114', user_agent: UA('sweep-check-1114'), client_ip: '198.18.62.9' };
    expect(S.isBotOrInternalCtx(raw)).toBe(false);
    expect(S._isQaCaller(raw)).toBe(false);
    expect(S._selfTestTelemetryTag(raw)).toBe('');
    expect(laneCaller(raw)).toBe('charge');
    expect(S._keylessFirstFullSeat('get_interconnection_queue', raw)).toBeNull();   // the lane lists no tools
  });
  it('from one IP: sweep-check-1114, cursor and grok all get previews, and nothing is charged', async () => {
    const ip = '198.18.62.1';
    const rs = [
      await call('get_grid_intelligence', seat({ name: 'sweep-check-1114', ua: UA('sweep-check-1114'), ip })),
      await call('get_interconnection_queue', seat({ name: 'sweep-check-1114', ua: UA('sweep-check-1114'), ip })),
      await call('get_grid_intelligence', seat({ name: 'cursor', ua: UA('cursor'), ip })),
      await call('get_interconnection_queue', seat({ name: 'grok', ua: UA('grok'), ip })),
    ];
    for (const r of rs) expect(isFirstFull(r)).toBe(false);
    await settle();
    expect(kffConsumes(ip)).toEqual([]);
  });
});

describe('K) the quota stamp: no first-full line on a paid-full-only tool, lane on or off', () => {
  for (const tool of ['get_grid_intelligence', 'get_interconnection_queue']) {
    it(`${tool}: both calls are previews and the stamp says preview on every non-paid seat, with no email promise`, async () => {
      const ip = `198.18.63.${tool.length}`;
      for (let i = 0; i < 2; i++) {
        const r = await call(tool, seat({ name: 'cursor', ua: 'cursor/1.0', ip }));
        expect(isFirstFull(r)).toBe(false);
        const q = quotaOf(r);
        expect(q).toMatchObject({ tier: 'anonymous', full_answers_cap_today: null, full_answers_remaining_today: null });
        expect(q.full_answers_basis).toBeUndefined();
        expect(q.full_answers_unavailable_reason).toBe(PREVIEW_REASON(tool));
        expect(JSON.stringify(q)).not.toMatch(/USED: |first full|bound email gets full/);
        expect(JSON.stringify(q)).not.toMatch(PLAN_OR_PRICE);
      }
    });
  }
  it('lane off: the same preview stamp', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
    const q = quotaOf(await call('get_grid_intelligence', seat({ name: 'cursor', ua: 'cursor/1.0', ip: '198.18.63.101' })));
    expect(q.full_answers_cap_today).toBeNull();
    expect(q.full_answers_remaining_today).toBeNull();
    expect(q.full_answers_basis).toBeUndefined();
    expect(q.full_answers_unavailable_reason).toBe(PREVIEW_REASON('get_grid_intelligence'));
  });
  it('CAP=0: the same preview stamp', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL_CAP = '0';
    const q = quotaOf(await call('get_interconnection_queue', seat({ name: 'cursor', ua: 'cursor/1.0', ip: '198.18.63.102' })));
    expect(q.full_answers_unavailable_reason).toBe(PREVIEW_REASON('get_interconnection_queue'));
  });
  it('a caller the lane refuses (our own self-tag): the same preview stamp', async () => {
    const q = quotaOf(await call('get_grid_intelligence',
      seat({ name: 'sweep-check-1114', ua: 'Mozilla/5.0 (Macintosh) sweep-check-1114/1.0', ip: '198.18.63.103' })));
    expect(q.full_answers_unavailable_reason).toBe(PREVIEW_REASON('get_grid_intelligence'));
  });
});

describe('L) rotating egress inside one session: no bucket is charged on either IP or the session', () => {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0.0.0 Safari/537.36';
  const sessId = (sid) => F.KEYLESS_FIRST_FULL_ID_PREFIX + 'sk-' + createHash('sha256').update(sid).digest('hex');
  it('same session, two IPs, energy and grid: previews only, no kff consume on the session or either IP', async () => {
    const s1 = seat({ name: 'grok', ua: UA, ip: '198.18.64.1' });
    for (const t of ['get_energy_prices', 'get_grid_intelligence']) {
      expect(isFirstFull(await call(t, s1))).toBe(false);
      expect(isFirstFull(await call(t, { ...seat({ name: 'grok', ua: UA, ip: '198.18.64.2' }), session_id: s1.session_id }))).toBe(false);
    }
    await settle();
    expect(writes.consume.filter((w) => w.identity === sessId(s1.session_id))).toEqual([]);
    expect(kffConsumes('198.18.64.1')).toEqual([]);
    expect(kffConsumes('198.18.64.2')).toEqual([]);
  });
  it('no session id: the IP bucket is not charged either', async () => {
    const ip = '198.18.64.31';
    expect(isFirstFull(await call('get_interconnection_queue', { ...seat({ name: 'grok', ua: UA, ip }), session_id: '' }))).toBe(false);
    await settle();
    expect(kffConsumes(ip)).toEqual([]);
  });
});

describe('M) a sited build is planned as a capacity search; the first plan leads with prose, not an instruction', () => {
  it('"50 MW data center in Dallas, TX" is a capacity search; inventory asks stay facility_search', () => {
    for (const q of ['50 MW data center in Dallas, TX', 'a 100 MW AI data center near Columbus']) {
      const p = S._planQuery(q, {});
      expect(p.intent_class, q).toBe('capacity_search');
      expect(p.recommended_sequence.map((x) => x.tool), q).not.toContain('get_facility');
    }
    for (const q of ['50 MW data centers in Texas', 'data centers in Dallas', 'who operates a 50 MW data center in Ashburn']) {
      expect(S._planQuery(q, {}).intent_class, q).toBe('facility_search');
    }
  });
  it('answer_guide\'s "Compose the answer ..." never becomes the answer; the reads that ran do', () => {
    const out = { ok: true, intent: 'x', intent_class: 'facility_search', answer_guide: 'Compose the answer from executed[].result (each already tier-honest). More.',
      executed: [{ step: 1, tool: 'search_facilities', status: 'executed', depth: 'preview', result: { total: 3 } },
                 { step: 2, tool: 'get_facility', status: 'failed', result: { error: 'API 404' } }] };
    const c = F.compactFirstPlan(out, new Map(), { cap: 1 });
    expect(c.answer).not.toMatch(/^Compose/);
    expect(c.answer).toBe('1 read ran for this question: search_facilities (preview). Each one’s key figures are in executed[].');
    // A guide sentence that is prose still leads, as before.
    expect(F.compactFirstPlan({ ...out, answer_guide: 'Dallas has 40 tracked facilities. More.' }, new Map(), { cap: 1 }).answer)
      .toBe('Dallas has 40 tracked facilities.');
  });
});
