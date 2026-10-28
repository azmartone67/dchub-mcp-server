// keyless-full-trial.test.mjs — the two-week keyless full-answer trial (owner 2026-10-28, "do 1").
//
// DCHUB_KEYLESS_FULL_TRIAL (default OFF): a keyless caller on /mcp, /mcp/claude or /mcp/core gets
// the FREE KEY's answer on get_facility / get_grid_data / get_market_dcpi_rank, 2 per tool per IP
// per UTC day, then today's preview.
//
// WHAT THIS PINS, through the REAL registered handlers under a real caller seat (_ctxALS), only
// the backend stubbed (every backend write captured):
//   A) flag off (unset, and every non-enabling spelling): the response is byte-identical to the
//      unset run, and no trial counter, consume or telemetry tag is written;
//   B) flag on: calls 1 and 2 return the free key's answer (same data, same masks), call 3 the
//      preview a flag-off call gets; the counter is per IP and per tool;
//   C) a tool outside the trial is unaffected, and the tools list can only narrow the three;
//   D) /mcp/chatgpt (and an execute_plan step started there) is unaffected;
//   E) QA and bot callers consume nothing and are tagged nothing; a QA caller sees the trial path
//      only with the test-only ctx override, still without a charge or a tag;
//   F) keyed callers (free and paid) are unaffected;
//   G) paid-only fields stay masked on a trial answer (facility MW/specs, DCPI sub-scores, kWh,
//      risk bullets, exact coordinates);
//   H) the funnel tag: the track row of a served trial answer carries status keyless_full_trial,
//      keyless_full_trial: true and the tool; a preview row does not; the counter is mirrored to
//      the durable store under the hashed per-IP identity, and a durable count of 2 from another
//      replica is honoured.
//   I) lib/keyless-full-trial.mjs parsing and the seat predicate.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as K from '../lib/keyless-full-trial.mjs';
import { assignArm, ARM_CONTROL } from '../lib/continuation.mjs';
import { CLAUDE_PROFILE } from '../lib/claude-directory.mjs';
import { CORE_PROFILE } from '../lib/core-profile.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
// Both decisions below change the same tools for every caller; they are pinned in their own files.
process.env.DCHUB_TOP_METROS_FREE = '0';
process.env.DCHUB_LEAN_RESPONSES = '0';

const BASE = 'https://backend.keyless-full-trial.test';
const SECRET = 'keyless-full-trial-internal-key-not-real';
// Backend fixtures as the backend answers this server's internal key (full depth).
const PHX = {
  id: 1346, market_slug: 'phoenix', market_name: 'Phoenix', state: 'AZ', iso: 'WECC', verdict: 'CAUTION',
  excess_power_score: 58.2, constraint_score: 62.1, composite_score: 41.9, quality_score: 88.0,
  time_to_power_months: 42.5, queue_wait_months: 41.5, avg_kwh_cents: '13.024', emergency_count_30d: 0,
  narrative: 'Phoenix is a constrained market.', signal_tier: 'partial',
  top_risks_json: ['42-month interconnection queue'], top_opportunities_json: ['500 MW behind-the-meter headroom'],
};
const DCPI_PAID_FRAGS = ['58.2', '62.1', '42.5', '41.5', '13.024', '42-month interconnection', '500 MW behind'];
const FACILITY = {
  id: 'fac_77', slug: 'trial-dc-77', name: 'Trial DC 77', operator: 'Equinix', provider: 'Equinix',
  city: 'Phoenix', state: 'AZ', country: 'US', market: 'phoenix', status: 'operational',
  latitude: 33.451234, longitude: -112.071234, power_mw: 48.5, square_feet: 250000, pue: 1.31,
  year_built: 2019, jv_partners: 'Partner Holdings LLC', investment_usd: 925000000,
};
// Value fragments unique enough to search a whole response for, plus the paid keys by name.
const FACILITY_PAID_FRAGS = ['Partner Holdings', '925000000', '33.451234', '-112.071234'];
const FACILITY_PAID_KEYS = ['power_mw', 'square_feet', 'pue', 'year_built', 'jv_partners', 'investment_usd'];
const GI = {
  demand_mw: 95021, demand_period: '2026-10-07T23', generation_mix_period: '2026-10-07T03',
  generation_mix: { COL: { mw: 13136 }, NG: { mw: 33582 }, NUC: { mw: 27692 } },
  peak_mw: 95021, min_mw: 74723, load_factor: 0.786,
  demand_24h: Array.from({ length: 8 }, (_, i) => ({ period: `2026-10-07T${String(i + 1).padStart(2, '0')}`, mw: 80000 + i * 500 })),
};
const ENERGY = { success: true, avg_rate_kwh: 0.2341, scope: 'iso_footprint_avg', filter: { iso: 'CAISO', sector: 'all', state: null },
  retail_rates: { avg_cents_kwh: 23.41, latest_period: '2026', max_cents_kwh: 30.1, min_cents_kwh: 18.2, states_covered: 1 } };

const TOOLS3 = ['get_grid_data', 'get_facility', 'get_market_dcpi_rank'];
const ARGS = {
  get_grid_data: { iso: 'PJM' },
  get_facility: { facility_id: 'trial-dc-77' },
  get_market_dcpi_rank: { market_slug: 'phoenix' },
  get_energy_prices: { iso: 'CAISO' },
};

const writes = { track: [], consume: [], peek: [] };
let peekN = new Map();   // identity|tool -> durable n another replica reported
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
    if (p === '/api/v1/mcp/full-cap/peek') {
      const id = u.searchParams.get('identity'); const tool = u.searchParams.get('tool');
      writes.peek.push({ identity: id, tool });
      const n = peekN.get(id + '|' + tool);
      return json(n ? { ok: true, n } : { ok: false });
    }
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: 0, had_pack: false });
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    if (p.startsWith('/api/v1/dcpi/scores/')) return json(structuredClone(PHX));
    if (p.startsWith('/api/v1/facilities/') || p.startsWith('/api/v1/facility/')) return json(structuredClone(FACILITY));
    if (p.startsWith('/api/v1/grid/intelligence/')) return json(structuredClone(GI));
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
const FLAG_VARS = ['DCHUB_KEYLESS_FULL_TRIAL', 'DCHUB_KEYLESS_FULL_TRIAL_TOOLS', 'DCHUB_KEYLESS_FULL_TRIAL_CAP'];
afterEach(() => { for (const k of FLAG_VARS) delete process.env[k]; peekN = new Map(); });
const flagOn = (extra = {}) => { process.env.DCHUB_KEYLESS_FULL_TRIAL = '1'; Object.assign(process.env, extra); };

// A fresh seat per call (fresh session, fresh IP unless one is given) so no other per-session or
// per-IP counter differs between the runs being compared. Every session id is drawn from the
// CONTROL arm of the human-line experiment (lib/continuation.mjs assignArm, a hash of the session
// id): two seats in different arms carry different human lines with the flag off.
let n = 0;
function seat(over = {}) {
  n += 1;
  while (assignArm({ sessionId: `sess-kft-${n}`, eligible: true }) !== ARM_CONTROL) n += 1;
  return { tier: 'free', platform: 'cursor', client_name_raw: 'cursor', user_agent: 'cursor/1.0',
    client_ip: `203.0.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`, session_id: `sess-kft-${n}`, ...over };
}
async function call(name, s, args = ARGS[name]) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
// Byte comparison with only what differs between two seats replaced: the seat's own session id
// and IP, the relay token signed over that session, and wall-clock timestamps.
function norm(r, s) {
  let t = JSON.stringify(r);
  for (const [v, ph] of [[s.session_id, 'SID'], [s.client_ip, 'IP']]) if (v) t = t.split(v).join(ph);
  return t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, 'TS')
    // The relay token is the seat's session signed (base64 payload + HMAC): seat-specific bytes.
    .replace(/\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]+/g, '/upgrade/h/TOKEN');
}
const text = (r) => (r.content || []).map((c) => c.text || '').join('\n');
function head(r) {
  const t = (r.content || [])[0]?.text || '';
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return null; }
}
// The data an answer carries: the leading JSON without the per-call envelope (timestamps, the
// keyed return loop, the relay link signed over the seat's own session or key, provenance/citation
// stamps that carry retrieved_at).
const VOLATILE = new Set(['_return_loop', 'human_url', 'for_your_human', 'citation', 'provenance', 'cite_as', 'next_ask', 'retrieved_at', 'served_at']);
function dataOf(r) {
  const h = head(r);
  if (!h || typeof h !== 'object') return h;
  return Object.fromEntries(Object.entries(h).filter(([k]) => !VOLATILE.has(k)));
}
const kftConsumes = () => writes.consume.filter((w) => String(w.identity || '').startsWith(K.KEYLESS_FULL_TRIAL_ID_PREFIX));
const trialTracks = () => writes.track.filter((w) => w.status === K.KEYLESS_FULL_TRIAL_STATUS || w.keyless_full_trial === true);
function resetWrites() { writes.track.length = 0; writes.consume.length = 0; writes.peek.length = 0; }
const ipId = (ip) => K.KEYLESS_FULL_TRIAL_ID_PREFIX + 'ip-' + createHash('sha256').update(ip).digest('hex');
// The track row is fire-and-forget: let it land.
const settle = () => new Promise((r) => setTimeout(r, 25));

// ── A) flag off ──────────────────────────────────────────────────────────────
describe('A) flag off: every response byte-identical, nothing written', () => {
  for (const tool of [...TOOLS3, 'get_energy_prices']) {
    it(`${tool}: unset vs every non-enabling spelling`, async () => {
      resetWrites();
      const s0 = seat();
      const base = norm(await call(tool, s0), s0);
      for (const v of ['', '0', 'false', 'off', 'no', 'enabled', '2', 'TRUE!']) {
        process.env.DCHUB_KEYLESS_FULL_TRIAL = v;
        const s = seat();
        expect(norm(await call(tool, s), s), `DCHUB_KEYLESS_FULL_TRIAL=${JSON.stringify(v)}`).toBe(base);
      }
      await settle();
      expect(kftConsumes()).toEqual([]);
      expect(writes.peek.filter((w) => String(w.identity).startsWith(K.KEYLESS_FULL_TRIAL_ID_PREFIX))).toEqual([]);
      expect(trialTracks()).toEqual([]);
    });
  }
  it('the keyless preview it pins is a preview (the comparison above is not vacuous)', async () => {
    const r = await call('get_grid_data', seat());
    expect(head(r).demand_mw).toBeNull();
    expect(r.structuredContent.trial_preview).toBe(true);
  });
});

// ── B) flag on ───────────────────────────────────────────────────────────────
describe('B) flag on: the free key answer twice per tool per IP, then the preview', () => {
  for (const tool of TOOLS3) {
    it(`${tool}: calls 1-2 = the free key's answer, call 3 = today's preview`, async () => {
      const keyed = await call(tool, seat({ api_key: `dch_live_kft_parity_${tool}_${n}` }));
      const offSeat = seat();
      const preview = await call(tool, offSeat);
      flagOn();
      const ip = `198.18.7.${TOOLS3.indexOf(tool) + 10}`;
      const r1 = await call(tool, seat({ client_ip: ip }));
      const r2 = await call(tool, seat({ client_ip: ip }));
      const s3 = seat({ client_ip: ip });
      const r3 = await call(tool, s3);
      for (const [i, r] of [[1, r1], [2, r2]]) {
        expect(r.isError, `call ${i} is an answer, not a wall`).not.toBe(true);
        expect(dataOf(r), `call ${i} carries the free key's data`).toEqual(dataOf(keyed));
        expect(r.structuredContent && r.structuredContent.trial_preview, `call ${i}`).toBeUndefined();
      }
      // Call 3: exactly the flag-off preview (the seat's own ids aside).
      expect(norm(r3, s3)).toBe(norm(preview, offSeat));
    });
  }
  it('get_grid_data: the trial answer is full (not vacuous: the preview nulls these)', async () => {
    flagOn();
    const r = await call('get_grid_data', seat());
    const h = head(r);
    expect(h.demand_mw).toBe(95021);
    expect(h.peak_mw).toBe(95021);
    expect(h.demand_24h).toHaveLength(8);
  });
  it('the budget is per tool: 2 grid answers do not spend the facility or DCPI answers', async () => {
    flagOn();
    const ip = '198.18.8.1';
    for (let i = 0; i < 4; i++) await call('get_grid_data', seat({ client_ip: ip }));
    expect((await call('get_facility', seat({ client_ip: ip }))).isError).not.toBe(true);
    expect(head(await call('get_market_dcpi_rank', seat({ client_ip: ip })))._upgrade).toBeUndefined();
  });
  it('the budget is per IP: another IP gets its own two', async () => {
    flagOn();
    for (let i = 0; i < 3; i++) await call('get_grid_data', seat({ client_ip: '198.18.9.1' }));
    expect(head(await call('get_grid_data', seat({ client_ip: '198.18.9.2' }))).demand_mw).toBe(95021);
  });
  it('DCHUB_KEYLESS_FULL_TRIAL_CAP sets the per-tool budget (1 here; 0 = no trial)', async () => {
    flagOn({ DCHUB_KEYLESS_FULL_TRIAL_CAP: '1' });
    expect(head(await call('get_grid_data', seat({ client_ip: '198.18.10.1' }))).demand_mw).toBe(95021);
    expect(head(await call('get_grid_data', seat({ client_ip: '198.18.10.1' }))).demand_mw).toBeNull();
    process.env.DCHUB_KEYLESS_FULL_TRIAL_CAP = '0';
    expect(head(await call('get_grid_data', seat({ client_ip: '198.18.10.2' }))).demand_mw).toBeNull();
  });
  it('/mcp/claude and /mcp/core seats are in the trial', async () => {
    flagOn();
    for (const profile of [CLAUDE_PROFILE, CORE_PROFILE]) {
      expect(profile, 'profile constant exported').toBeTruthy();
      expect(head(await call('get_grid_data', seat({ profile }))).demand_mw, profile).toBe(95021);
    }
  });
  it('an execute_plan step (loopback IP) and a seat with no IP are not in the trial', async () => {
    flagOn();
    for (const client_ip of ['127.0.0.1', '::ffff:127.0.0.1', '::1', null]) {
      expect(head(await call('get_grid_data', seat({ client_ip }))).demand_mw, String(client_ip)).toBeNull();
    }
  });
});

// ── C) other tools ───────────────────────────────────────────────────────────
describe('C) a tool outside the trial is unaffected', () => {
  for (const tool of ['get_energy_prices']) {
    it(`${tool}: flag on is byte-identical to flag off`, async () => {
      const s0 = seat({ client_ip: '198.18.20.1' });
      const off = norm(await call(tool, s0), s0);
      flagOn();
      resetWrites();
      const s1 = seat({ client_ip: '198.18.20.2' });
      expect(norm(await call(tool, s1), s1)).toBe(off);
      await settle();
      expect(kftConsumes()).toEqual([]);
    });
  }
  it('DCHUB_KEYLESS_FULL_TRIAL_TOOLS narrows the three and cannot add a tool', async () => {
    flagOn({ DCHUB_KEYLESS_FULL_TRIAL_TOOLS: 'get_facility, get_energy_prices,get_grid_intelligence' });
    expect(head(await call('get_grid_data', seat())).demand_mw).toBeNull();
    expect((await call('get_facility', seat())).isError).not.toBe(true);
    const s0 = seat({ client_ip: '198.18.21.1' });
    const on = norm(await call('get_energy_prices', s0), s0);
    delete process.env.DCHUB_KEYLESS_FULL_TRIAL;
    const s1 = seat({ client_ip: '198.18.21.2' });
    expect(on).toBe(norm(await call('get_energy_prices', s1), s1));
  });
});

// ── D) /mcp/chatgpt ──────────────────────────────────────────────────────────
describe('D) /mcp/chatgpt is unaffected', () => {
  for (const tool of TOOLS3) {
    it(`${tool}: the directory profile and its execute_plan steps get today's answer`, async () => {
      for (const over of [{ profile: DIRECTORY_PROFILE, platform: 'chatgpt', client_name_raw: 'openai-mcp' },
                          { legacy_wall_copy: true }]) {
        expect(over.profile === undefined || !!over.profile, 'profile constant exported').toBe(true);
        const s0 = seat(over);
        const off = norm(await call(tool, s0), s0);
        flagOn();
        resetWrites();
        const s1 = seat(over);
        expect(norm(await call(tool, s1), s1), JSON.stringify(over)).toBe(off);
        await settle();
        expect(kftConsumes()).toEqual([]);
        expect(trialTracks()).toEqual([]);
        delete process.env.DCHUB_KEYLESS_FULL_TRIAL;
      }
    });
  }
});

// ── E) QA and bots ───────────────────────────────────────────────────────────
const QA_SEATS = {
  'UA dchub-qa-readonly': { user_agent: 'dchub-qa-readonly/1.0' },
  'header X-DCHub-QA: 1': { qa_marker: true },
  'clientInfo dchub-qa-readonly': { client_name_raw: 'dchub-qa-readonly' },
  '/mcp/core header (qa_header)': { qa_header: true },
  'own self-test UA': { user_agent: 'dchub-probe-sweep/1.0' },
};
const BOT_SEATS = {
  'curl': { user_agent: 'curl/8.4.0' },
  'crawler': { user_agent: 'BrickBlueBot/0.1 (+https://brick.blue/bot)' },
  'uptime monitor': { user_agent: 'UptimeRobot/2.0', platform: 'uptimerobot' },
};
describe('E) QA and bot callers consume nothing and are tagged nothing', () => {
  for (const [label, over] of Object.entries({ ...QA_SEATS, ...BOT_SEATS })) {
    it(`${label}: today's answer, no charge, no tag`, async () => {
      const s0 = seat(over);
      const off = norm(await call('get_grid_data', s0), s0);
      flagOn();
      resetWrites();
      const s1 = seat(over);
      expect(norm(await call('get_grid_data', s1), s1)).toBe(off);
      await settle();
      expect(kftConsumes()).toEqual([]);
      expect(trialTracks()).toEqual([]);
    });
  }
  for (const [label, over] of Object.entries(QA_SEATS)) {
    it(`${label} + the test-only override: sees the trial answer, still no charge and no tag`, async () => {
      flagOn();
      resetWrites();
      const ip = '198.18.30.' + (Object.keys(QA_SEATS).indexOf(label) + 1);
      for (let i = 0; i < 3; i++) {
        const r = await call('get_grid_data', seat({ ...over, client_ip: ip, [K.KEYLESS_FULL_TRIAL_QA_OVERRIDE]: true }));
        expect(head(r).demand_mw, `call ${i + 1}: an observer is never capped, because it is never charged`).toBe(95021);
      }
      await settle();
      expect(kftConsumes()).toEqual([]);
      expect(trialTracks()).toEqual([]);
      // and it did not spend the IP's budget for a real caller behind it
      expect(head(await call('get_grid_data', seat({ client_ip: ip }))).demand_mw).toBe(95021);
    });
  }
  it('the override does nothing for a bot that is not a QA caller', async () => {
    flagOn();
    const r = await call('get_grid_data', seat({ user_agent: 'curl/8.4.0', [K.KEYLESS_FULL_TRIAL_QA_OVERRIDE]: true }));
    expect(head(r).demand_mw).toBeNull();
  });
});

// ── F) keyed callers ─────────────────────────────────────────────────────────
describe('F) keyed callers of any tier are unaffected', () => {
  for (const tier of ['free', 'identified', 'pro']) {
    for (const tool of TOOLS3) {
      it(`${tier} key, ${tool}: flag on is byte-identical to flag off`, async () => {
        const s0 = seat({ tier, api_key: `dch_live_kft_${tier}_${tool}_a` });
        const off = norm(await call(tool, s0), s0).split(s0.api_key).join('KEY');
        flagOn();
        resetWrites();
        const s1 = seat({ tier, api_key: `dch_live_kft_${tier}_${tool}_b` });
        expect(norm(await call(tool, s1), s1).split(s1.api_key).join('KEY')).toBe(off);
        await settle();
        expect(kftConsumes()).toEqual([]);
        expect(trialTracks()).toEqual([]);
      });
    }
  }
});

// ── G) paid-only fields ──────────────────────────────────────────────────────
describe('G) paid-only fields stay masked on a trial answer', () => {
  it('get_facility: MW, specs, deal fields and exact coordinates withheld', async () => {
    flagOn();
    const r = await call('get_facility', seat());
    expect(r.isError).not.toBe(true);
    const t = text(r) + JSON.stringify(r.structuredContent || {});
    expect(t).toContain('Trial DC 77');
    for (const f of FACILITY_PAID_FRAGS) expect(t, f).not.toContain(f);
    for (const k of FACILITY_PAID_KEYS) expect(t, k).not.toMatch(new RegExp('\\\\?"' + k + '\\\\?":(?!null)'));
    expect(head(r).latitude).toBe(33.45);
  });
  it('get_market_dcpi_rank: verdict and composite free; sub-scores, kWh and risk bullets withheld', async () => {
    flagOn();
    const r = await call('get_market_dcpi_rank', seat());
    const h = head(r);
    expect(h.verdict).toBe('CAUTION');
    expect(h.composite_score).toBe(41.9);
    const t = text(r) + JSON.stringify(r.structuredContent || {});
    for (const f of DCPI_PAID_FRAGS) expect(t, f).not.toContain(f);
  });
});

// ── H) telemetry and the counter ─────────────────────────────────────────────
describe('H) the funnel tag and the durable counter', () => {
  it('a served trial answer is tagged with its tool; the capped preview is not', async () => {
    flagOn();
    resetWrites();
    const ip = '198.18.40.1';
    for (let i = 0; i < 3; i++) await call('get_market_dcpi_rank', seat({ client_ip: ip }));
    await settle();
    const rows = writes.track.filter((w) => w.tool === 'get_market_dcpi_rank');
    expect(rows).toHaveLength(3);
    expect(rows.slice(0, 2).map((w) => [w.status, w.keyless_full_trial, w.tool]))
      .toEqual([['keyless_full_trial', true, 'get_market_dcpi_rank'], ['keyless_full_trial', true, 'get_market_dcpi_rank']]);
    expect(rows[2].status).not.toBe('keyless_full_trial');
    expect(rows[2].keyless_full_trial).toBeUndefined();
  });
  it('each charged answer is mirrored to the durable counter under the hashed per-IP identity; a spent bucket is not', async () => {
    flagOn();
    resetWrites();
    const ip = '198.18.41.1';
    for (let i = 0; i < 4; i++) await call('get_facility', seat({ client_ip: ip }));
    expect(kftConsumes()).toEqual([
      { identity: ipId(ip), tool: 'get_facility', cap: 2 },
      { identity: ipId(ip), tool: 'get_facility', cap: 2 },
    ]);
    expect(JSON.stringify(writes.consume)).not.toContain(ip);   // the raw IP never leaves
  });
  it('a durable count of 2 from another replica means this replica serves the preview', async () => {
    flagOn();
    const ip = '198.18.42.1';
    peekN.set(ipId(ip) + '|get_grid_data', 2);
    expect(head(await call('get_grid_data', seat({ client_ip: ip }))).demand_mw).toBeNull();
    peekN.set(ipId('198.18.42.2') + '|get_grid_data', 1);
    expect(head(await call('get_grid_data', seat({ client_ip: '198.18.42.2' }))).demand_mw).toBe(95021);
    expect(head(await call('get_grid_data', seat({ client_ip: '198.18.42.2' }))).demand_mw).toBeNull();
  });
});

// ── I) the lib ───────────────────────────────────────────────────────────────
describe('I) lib/keyless-full-trial.mjs', () => {
  it('only 1/on/true/yes turn it on', () => {
    for (const v of ['1', 'on', 'true', 'yes', 'ON', ' Yes ']) expect(K.keylessFullTrialOn({ DCHUB_KEYLESS_FULL_TRIAL: v }), v).toBe(true);
    for (const v of [undefined, '', '0', 'off', 'false', 'no', 'enabled', '2', 'y']) expect(K.keylessFullTrialOn({ DCHUB_KEYLESS_FULL_TRIAL: v }), String(v)).toBe(false);
  });
  it('tools: default three; a list narrows; unknown names are dropped', () => {
    expect([...K.keylessFullTrialTools({})].sort()).toEqual(['get_facility', 'get_grid_data', 'get_market_dcpi_rank']);
    expect([...K.keylessFullTrialTools({ DCHUB_KEYLESS_FULL_TRIAL_TOOLS: ' get_grid_data ,analyze_site' })]).toEqual(['get_grid_data']);
    expect([...K.keylessFullTrialTools({ DCHUB_KEYLESS_FULL_TRIAL_TOOLS: 'analyze_site' })]).toEqual([]);
  });
  it('cap: default 2, clamped to 0..1000, junk = default', () => {
    expect(K.keylessFullTrialCap({})).toBe(2);
    expect(K.keylessFullTrialCap({ DCHUB_KEYLESS_FULL_TRIAL_CAP: '5' })).toBe(5);
    expect(K.keylessFullTrialCap({ DCHUB_KEYLESS_FULL_TRIAL_CAP: '-3' })).toBe(0);
    expect(K.keylessFullTrialCap({ DCHUB_KEYLESS_FULL_TRIAL_CAP: '99999' })).toBe(1000);
    expect(K.keylessFullTrialCap({ DCHUB_KEYLESS_FULL_TRIAL_CAP: 'lots' })).toBe(2);
  });
  it('the seat predicate', () => {
    const env = { DCHUB_KEYLESS_FULL_TRIAL: '1' };
    const deps = { env, directoryProfile: 'dir', allowedProfiles: ['claude', 'core'], isQa: (c) => c.qa === true, isBot: (c) => c.bot === true };
    const c = { client_ip: '198.51.100.7' };
    expect(K.keylessFullTrialSeat('get_grid_data', c, deps)).toBe('charge');
    expect(K.keylessFullTrialSeat('get_grid_data', c, { ...deps, env: {} })).toBeNull();
    expect(K.keylessFullTrialSeat('get_energy_prices', c, deps)).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, api_key: 'k' }, deps)).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, profile: 'dir' }, deps)).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, profile: 'other' }, deps)).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, profile: 'claude' }, deps)).toBe('charge');
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, legacy_wall_copy: true }, deps)).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, qa: true }, deps)).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, qa: true, [K.KEYLESS_FULL_TRIAL_QA_OVERRIDE]: true }, deps)).toBe('observe');
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, bot: true, [K.KEYLESS_FULL_TRIAL_QA_OVERRIDE]: true }, deps)).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, qa: true, [K.KEYLESS_FULL_TRIAL_QA_OVERRIDE]: 'true' }, deps)).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', { ...c, isQaThrows: 1 }, { ...deps, isQa: () => { throw new Error('x'); } })).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', { client_ip: '' }, deps)).toBeNull();
    expect(K.keylessFullTrialSeat('get_grid_data', null, deps)).toBeNull();
  });
});
