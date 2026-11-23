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
// Seats are built the way the /mcp handler builds them: platform from _resolvePlatform(body, UA, …).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as F from '../lib/keyless-first-full.mjs';
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
const OLD_REASON = (tool) => 'NOT APPLICABLE: `' + tool + '` is a preview for anonymous callers and keys without a bound '
  + 'email; no daily full-answer budget is charged here. A key with a bound email gets full answers.';   // option A: no daily allowance

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

describe('H) an agent behind a plain HTTP client gets the first full answer', () => {
  const UAS = ['curl/8.4.0', 'python-requests/2.31.0', 'Wget/1.21.4', 'Go-http-client/1.1', 'HTTPie/3.2.2',
    'PostmanRuntime/7.36.0', 'FastMCPClient/2.3'];
  UAS.forEach((ua, i) => {
    it(`${ua}: call 1 is the full answer and is charged; call 2 is the preview`, async () => {
      const ip = `198.18.60.${i + 1}`;
      expect(S._keylessFirstFullSeat('get_interconnection_queue', seat({ ua, ip }))).toBe('charge');
      const r1 = await call('get_interconnection_queue', seat({ ua, ip }));
      expect(r1.isError).not.toBe(true);
      expect(isFirstFull(r1), 'call 1 carries first_full_answer').toBe(true);
      const r2 = await call('get_interconnection_queue', seat({ ua, ip }));
      expect(isFirstFull(r2)).toBe(false);
      await settle();
      expect(kffConsumes(ip).map((w) => w.tool)).toEqual(['get_interconnection_queue']);
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
    it(`${label}: no first full answer, nothing charged`, async () => {
      const ip = `198.18.61.${i + 1}`;
      expect(S._keylessFirstFullSeat('get_interconnection_queue', seat({ ...sp, ip }))).toBeNull();
      const r = await call('get_interconnection_queue', seat({ ...sp, ip }));
      expect(isFirstFull(r)).toBe(false);
      await settle();
      expect(kffConsumes(ip)).toEqual([]);
    });
  });
});

describe('J) "sweep-check-1114" got the preview because its name is tagged as our own, not because of the budget', () => {
  const UA = (nm) => `Mozilla/5.0 (Macintosh) ${nm}/1.0`;
  it('the resolver tags it dchub-internal (clientInfo and X-MCP-Client), and cursor / grok keep their names', () => {
    expect(S._resolvePlatform({ params: { clientInfo: { name: 'sweep-check-1114' } } }, UA('sweep-check-1114'), '', null))
      .toBe('dchub-internal');
    expect(S._resolvePlatform({}, UA('sweep-check-1114'), '', null, 'sweep-check-1114')).toBe('dchub-internal');
    expect(S._resolvePlatform({ params: { clientInfo: { name: 'cursor' } } }, UA('cursor'), '', null)).toBe('cursor');
    expect(S._resolvePlatform({ params: { clientInfo: { name: 'grok' } } }, UA('grok'), '', null)).toBe('grok');
  });
  it('only the platform tag refuses it: the raw name and UA match no bot, QA or self-test rule', () => {
    const raw = { client_name_raw: 'sweep-check-1114', user_agent: UA('sweep-check-1114'), client_ip: '198.18.62.9' };
    expect(S.isBotOrInternalCtx(raw)).toBe(false);
    expect(S._isQaCaller(raw)).toBe(false);
    expect(S._selfTestTelemetryTag(raw)).toBe('');
    expect(S._keylessFirstFullSeat('get_interconnection_queue', raw)).toBe('charge');
    expect(S._keylessFirstFullSeat('get_interconnection_queue', { ...raw, platform: 'dchub-internal' })).toBeNull();
  });
  it('from one IP: sweep-check-1114 previews and charges nothing; cursor and grok then get full answers', async () => {
    const ip = '198.18.62.1';
    const sw1 = await call('get_grid_intelligence', seat({ name: 'sweep-check-1114', ua: UA('sweep-check-1114'), ip }));
    const sw2 = await call('get_interconnection_queue', seat({ name: 'sweep-check-1114', ua: UA('sweep-check-1114'), ip }));
    expect(isFirstFull(sw1)).toBe(false);
    expect(isFirstFull(sw2)).toBe(false);
    await settle();
    expect(kffConsumes(ip), 'the preview spent nothing').toEqual([]);
    expect(isFirstFull(await call('get_grid_intelligence', seat({ name: 'cursor', ua: UA('cursor'), ip })))).toBe(true);
    expect(isFirstFull(await call('get_interconnection_queue', seat({ name: 'grok', ua: UA('grok'), ip })))).toBe(true);
  });
});

describe('K) the quota stamp says what the lane does', () => {
  for (const tool of ['get_grid_intelligence', 'get_interconnection_queue']) {
    it(`${tool}: the first answer says it was today's one; the next preview says it was used and when it resets`, async () => {
      const ip = `198.18.63.${tool.length}`;
      const r1 = await call(tool, seat({ name: 'cursor', ua: 'cursor/1.0', ip }));
      expect(isFirstFull(r1)).toBe(true);
      const q1 = quotaOf(r1);
      expect(q1).toMatchObject({ tier: 'anonymous', full_answers_cap_today: 1, full_answers_remaining_today: 0 });
      expect(q1.full_answers_unavailable_reason).toBeUndefined();
      expect(q1.full_answers_basis).toMatch(/^1 full `[a-z_]+` answer per caller network \(IP\) and per session, per UTC day, without a key; resets next 00:00 UTC\. A key with a bound email gets full answers\.$/);
      const r2 = await call(tool, seat({ name: 'cursor', ua: 'cursor/1.0', ip }));
      expect(isFirstFull(r2)).toBe(false);
      const q2 = quotaOf(r2);
      expect(q2.full_answers_remaining_today).toBe(0);
      expect(q2.full_answers_unavailable_reason).toBe('USED: today’s full `' + tool + '` answer without a key on this '
        + 'network (IP) or in this session was used, so this call is the preview. The next one is after 00:00 UTC. A key with a bound '
        + 'email gets full answers.');
      for (const q of [q1, q2]) {
        expect(JSON.stringify(q)).not.toMatch(/NOT APPLICABLE|no daily full-answer budget/);
        expect(JSON.stringify(q)).not.toMatch(PLAN_OR_PRICE);
      }
    });
  }
  it('lane off: the stamp is today\'s line, byte for byte', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
    const q = quotaOf(await call('get_grid_intelligence', seat({ name: 'cursor', ua: 'cursor/1.0', ip: '198.18.63.101' })));
    expect(q.full_answers_cap_today).toBeNull();
    expect(q.full_answers_remaining_today).toBeNull();
    expect(q.full_answers_basis).toBeUndefined();
    expect(q.full_answers_unavailable_reason).toBe(OLD_REASON('get_grid_intelligence'));
  });
  it('CAP=0: today\'s line', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL_CAP = '0';
    const q = quotaOf(await call('get_interconnection_queue', seat({ name: 'cursor', ua: 'cursor/1.0', ip: '198.18.63.102' })));
    expect(q.full_answers_unavailable_reason).toBe(OLD_REASON('get_interconnection_queue'));
  });
  it('a caller the lane refuses (our own self-tag) keeps today\'s line', async () => {
    const q = quotaOf(await call('get_grid_intelligence',
      seat({ name: 'sweep-check-1114', ua: 'Mozilla/5.0 (Macintosh) sweep-check-1114/1.0', ip: '198.18.63.103' })));
    expect(q.full_answers_unavailable_reason).toBe(OLD_REASON('get_grid_intelligence'));
  });
});

describe('L) the session bucket: rotating egress inside one session does not re-qualify', () => {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0.0.0 Safari/537.36';
  const sessId = (sid) => F.KEYLESS_FIRST_FULL_ID_PREFIX + 'sk-' + createHash('sha256').update(sid).digest('hex');
  it('same session, second call from another IP: the preview, and only the first call is charged', async () => {
    const s1 = seat({ name: 'grok', ua: UA, ip: '198.18.64.1' });
    const r1 = await call('get_energy_prices', s1);
    expect(isFirstFull(r1)).toBe(true);
    const r2 = await call('get_energy_prices', { ...seat({ name: 'grok', ua: UA, ip: '198.18.64.2' }), session_id: s1.session_id });
    expect(isFirstFull(r2), 'the session bucket is spent').toBe(false);
    await settle();
    expect(writes.consume.filter((w) => w.identity === sessId(s1.session_id)).map((w) => w.tool)).toEqual(['get_energy_prices']);
    expect(kffConsumes('198.18.64.2'), 'the refused call charged its IP nothing').toEqual([]);
  });
  it('the used line names the session too, on the stamp of the refused call', async () => {
    const s1 = seat({ name: 'grok', ua: UA, ip: '198.18.64.11' });
    expect(isFirstFull(await call('get_grid_intelligence', s1))).toBe(true);
    const q = quotaOf(await call('get_grid_intelligence', { ...seat({ name: 'grok', ua: UA, ip: '198.18.64.12' }), session_id: s1.session_id }));
    expect(q.full_answers_remaining_today).toBe(0);
    expect(q.full_answers_unavailable_reason).toMatch(/^USED: .* or in this session was used/);
  });
  it('a new session from a new IP still gets its first full answer (the budget is per caller, not global)', async () => {
    expect(isFirstFull(await call('get_energy_prices', seat({ name: 'grok', ua: UA, ip: '198.18.64.21' })))).toBe(true);
    expect(isFirstFull(await call('get_energy_prices', seat({ name: 'grok', ua: UA, ip: '198.18.64.22' })))).toBe(true);
  });
  it('no session id: the IP bucket alone decides, as before', async () => {
    const ip = '198.18.64.31';
    expect(isFirstFull(await call('get_interconnection_queue', { ...seat({ name: 'grok', ua: UA, ip }), session_id: '' }))).toBe(true);
    expect(isFirstFull(await call('get_interconnection_queue', { ...seat({ name: 'grok', ua: UA, ip }), session_id: 'no-session' }))).toBe(false);
    await settle();
    expect(writes.consume.filter((w) => w.identity === sessId('no-session'))).toEqual([]);
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
