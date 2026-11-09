// ask-once-per-tool.test.mjs: owner decision 2026-11-09 ("Ask once per tool per session: APPROVED").
//
// Before: every wall ask step (option A's email line, the rank_markets / ai_capacity_index rows asks, the depth
// wall's digest offer) sits on the wall's human line, and r-relay-cap sent that line once per SESSION across all
// tools. A session that walled on rank_markets and then on get_grid_intelligence got no human line on the second
// tool ("Your user was sent the full ask earlier in this session"), and a depth wall there got no digest offer.
// Live keyless probe 2026-11-09 (plain UA): exactly that. The gas ask, which needs no human line, went out on
// every masked answer, the same tool's repeats included.
// After: the wall's line, and so each ask, goes out once per (session, tool). The same tool again carries none.
// Depth walls keep the digest offer, never an email ask. /mcp/claude, /mcp/chatgpt and /mcp/core stay ask-free.
// Kill switch DCHUB_ASK_PER_TOOL=0 restores the per-session cap.
//
// Measured on the REAL handler (mcp#1330 shipped a hand-built wall and failed live): keyless calls on /mcp with a
// real MCP session, through the whole chain including the lean step, read as the agent receives them, plus the
// quota_wall_hit row the C3 step sends after the chain. The fake backend is the shared production-shaped one
// (helpers/claude-directory-harness.mjs: its rows carry the `_upgrade` /go/c pointer production sends, which is
// what makes r-relay-cap drop the repeat line). A plain client UA: the QA UA (`dchub-qa-readonly`) reads as
// internal (isBotOrInternalCtx) and never sees option A.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { RANK_EMAIL_ASK_LEAD } from '../lib/paid-sell-line.mjs';

const UA = 'Claude-User/1.0 (+https://claude.ai)';
const SHORT_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
const HUMAN = '→ **For your human:**';
const RANK_ASK = '`bind_email` with it shows all 10 markets in this ranking';
const DIGEST = '`subscribe_digest`';
const CAP_NET = '203.0.113.';   // the anon-usage stub reports these IPs at the daily cap; every other IP at 0
// DCHUB_PAID_SELL_LINE is on in production (the rank_markets rows ask rides its sell line).
const ENV = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_ANON_DAILY_CAP: '5', DCHUB_PAID_SELL_LINE: '1' };
const CLEAR = ['DCHUB_ASK_PER_TOOL', 'DCHUB_GAS_EMAIL_ASK', 'DCHUB_DEPTH_DIGEST_ASK', 'DCHUB_RANK_EMAIL_ASK', 'DCHUB_AICAP_EMAIL_ASK',
  'DCHUB_LEAN_RESPONSES', 'DCHUB_IDENTIFIED_TOOL_DAILY_FULL', 'DCHUB_TRIAL_TOOL_DAILY_FULL'];
const GAS = { success: true, region: 'TX', region_name: 'Texas', henry_hub_usd_mmbtu: 3.1, basis_usd_mmbtu: 0.42,
  delivered_price_usd_mmbtu: 3.52, gas_to_grid_usd_per_mwh: { new_ccgt: 48.1, existing_ccgt: 52.3, peaker: 88.0 },
  live_grid_gas_share_pct: 44.5, as_of: '2026-11-09T08:00:00Z' };
const RANK = { criteria: 'best_overall', region: 'us', result_count: 10,
  results: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, market: 'm' + i, name: 'Market ' + i, score: 90 - i,
    total_mw: 1000 - i * 10, facility_count: 50 - i, operator_count: 20 - i })) };

let H, fence, shortN = 0;
const events = [];   // quota_wall_hit bodies the server posted
const prev = {};
beforeAll(async () => {
  fence = fenceNetwork();
  for (const k of [...Object.keys(ENV), ...CLEAR]) prev[k] = process.env[k];
  for (const k of CLEAR) delete process.env[k];
  H = await startHarness({ env: ENV, extraRoutes: (p, req, body, u) => {
    if (p === '/api/v1/mcp/funnel-event') { if (body && body.event === 'quota_wall_hit') events.push(body); return { ok: true }; }
    if (p === '/api/v1/mcp/anon-usage') return { count: String(u.searchParams.get('ip') || '').startsWith(CAP_NET) ? 5 : 0 };
    if (p === '/api/v1/mcp/full-cap/peek') return { ok: true, n: 0 };
    if (p.startsWith('/api/v1/mcp/tools/rank_markets')) return RANK;
    if (p.startsWith('/api/v1/gas/intelligence/')) return GAS;
    if (p === '/api/v1/relay/short') {
      let n = ++shortN, code = '';
      for (let i = 0; i < 6; i++) { code += SHORT_ALPHA[n % SHORT_ALPHA.length]; n = Math.floor(n / SHORT_ALPHA.length); }
      return { ok: true, url: 'https://dchub.cloud/u/' + code };
    }
    return undefined;
  } });
}, 60_000);

afterAll(async () => {
  if (H) await H.stop();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (fence) fence.restore();
});

const ARGS = { execute_plan: { intent: 'rank markets for a 200 MW AI campus and check PJM grid headroom' }, rank_markets: { limit: 10 }, get_grid_intelligence: { iso: 'PJM' }, get_grid_data: { iso: 'PJM' },
  list_transactions: { limit: 10 }, get_gas_intelligence: { region: 'TX' } };
let ipN = 10;
// One MCP session (initialize + initialized) where the surface has sessions, then tool calls on it, as the agent
// receives them.
async function session({ path = '/mcp', net = '198.51.100.', needSession = true } = {}) {
  const hdr0 = { 'user-agent': UA, 'x-dc-client-ip': `${net}${ipN++}` };
  const init = await H.init(path, 'Claude Code', hdr0);
  const sid = init.headers.get('mcp-session-id');
  if (needSession) expect(sid, 'no MCP session: the memo is per session').toBeTruthy();
  const hdr = { ...hdr0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await H.post(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, hdr);
  return async (tool) => {
    const before = events.length;
    const r = await H.call(path, tool, ARGS[tool] || {}, hdr);
    const result = (r.msg && r.msg.result) || {};
    // The wall-hit row leaves after the chain (C3 _finishWallRow, fire and forget): wait for this call's.
    for (let i = 0; i < 50 && events.length === before; i++) await new Promise((res) => setTimeout(res, 20));
    const ev = events.slice(before).find((e) => e.tool === tool) || null;
    const texts = (result.content || []).map((c) => c.text || '');
    return { sid, text: texts.join('\n'), sc: result.structuredContent || {}, ev };
  };
}
const withEnv = async (k, v, fn) => {
  const was = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { if (was === undefined) delete process.env[k]; else process.env[k] = was; }
};
const count = (t, s) => t.split(s).length - 1;
// Any ask the chain emits, in the text the agent reads.
const anyAsk = (t) => /`bind_email`|`subscribe_digest`|`claim_free_key`|Reply with your email|enter your email/i.test(t)
  || t.includes(RANK_EMAIL_ASK_LEAD);

describe('ask once per tool per session (/mcp, keyless, real handler)', () => {
  it('rank_markets wall, then get_grid_intelligence wall, then rank_markets again: asks on the 1st and 2nd, none on the 3rd', async () => {
    const call = await session();
    const r1 = await call('rank_markets');
    expect(r1.sc.preview_is_partial || r1.sc.trial_preview, 'rank_markets did not wall').toBeTruthy();
    expect(count(r1.text, RANK_ASK)).toBe(1);
    expect(count(r1.text, HUMAN)).toBe(1);
    expect(r1.ev && r1.ev.email_ask).toBe('line');

    const r2 = await call('get_grid_intelligence');
    expect(r2.sc.preview_is_partial || r2.sc.trial_preview, 'get_grid_intelligence did not wall').toBeTruthy();
    // The second tool's own human line, with option A's email sentence on it.
    expect(count(r2.text, HUMAN)).toBe(1);
    const line2 = r2.text.split('\n').find((l) => l.includes(HUMAN));
    expect(line2).toMatch(/Reply with your email/);
    expect(r2.text).not.toContain('sent the full ask earlier in this session');
    expect(r2.ev && r2.ev.email_ask).toBe('line');
    expect(r2.ev.offers_shown).toContain('email_unlock');

    const r3 = await call('rank_markets');
    expect(r3.sc.preview_is_partial || r3.sc.trial_preview, 'rank_markets did not wall the second time').toBeTruthy();
    expect(r3.text).not.toContain(RANK_EMAIL_ASK_LEAD);
    expect(count(r3.text, HUMAN)).toBe(0);
    expect(r3.text).not.toMatch(/`bind_email`|`subscribe_digest`|Reply with your email/);
    expect(r3.ev).toBeTruthy();
    expect(r3.ev.email_ask).toBeUndefined();
    expect(r3.ev.offers_shown || []).not.toContain('email_unlock');   // C3: the row names only what was delivered
  });

  it('a depth wall as the second tool gets the digest offer, never an email ask; its repeat gets neither', async () => {
    const call = await session();
    expect(count((await call('rank_markets')).text, RANK_ASK)).toBe(1);
    const d1 = await call('list_transactions');
    expect(d1.sc.preview_is_partial || d1.sc.trial_preview, 'list_transactions did not wall').toBeTruthy();
    expect(count(d1.text, DIGEST)).toBe(1);
    expect(d1.text).not.toMatch(/`bind_email`|`claim_free_key`|Reply with your email/);
    expect(d1.text).not.toContain(RANK_EMAIL_ASK_LEAD);
    expect(d1.ev && d1.ev.email_ask).toBe('digest_line');
    const d2 = await call('list_transactions');
    expect(anyAsk(d2.text)).toBe(false);
    expect(d2.ev && d2.ev.email_ask).toBeUndefined();
    expect(d2.ev.offers_shown || []).not.toContain('digest');
  });

  it('a free-key wall as the second tool shows its email line; the same tool again does not', async () => {
    const call = await session();
    await call('rank_markets');
    const g1 = await call('get_grid_data');
    expect(g1.sc.preview_is_partial || g1.sc.trial_preview, 'get_grid_data did not wall').toBeTruthy();
    expect(g1.text).toMatch(/Reply with your email/);
    expect(count(g1.text, 'Ask your user for their email, then call `bind_email`')).toBe(1);
    const g2 = await call('get_grid_data');
    expect(g2.text).not.toMatch(/Reply with your email|`bind_email`/);
    expect(count(g2.text, HUMAN)).toBe(0);
  });

  it('the gas ask (no human line) goes out once per tool: first answer asks, the repeat does not', async () => {
    const call = await session();
    const a = await call('get_gas_intelligence');
    expect(count(a.text, RANK_EMAIL_ASK_LEAD)).toBe(1);
    const b = await call('get_gas_intelligence');
    expect(JSON.parse(b.text.split('\n')[0]).tier_masked, 'the repeat was not masked').toBeTruthy();
    expect(b.text).not.toContain(RANK_EMAIL_ASK_LEAD);
    expect(b.text).not.toContain('`bind_email`');
  });

  it('kill switch DCHUB_ASK_PER_TOOL=0: the per-session cap of 11-09 (no human line, no digest on the second tool; gas asks every time)', async () => {
    await withEnv('DCHUB_ASK_PER_TOOL', '0', async () => {
      const call = await session();
      expect(count((await call('rank_markets')).text, RANK_ASK)).toBe(1);
      const r2 = await call('get_grid_intelligence');
      expect(count(r2.text, HUMAN)).toBe(0);
      expect(r2.text).toContain('sent the full ask earlier in this session');
      const d = await call('list_transactions');
      expect(d.text).not.toContain(DIGEST);
      const gas = await session();
      expect(count((await gas('get_gas_intelligence')).text, RANK_EMAIL_ASK_LEAD)).toBe(1);
      expect(count((await gas('get_gas_intelligence')).text, RANK_EMAIL_ASK_LEAD)).toBe(1);
    });
  });
});

// mcp#1331: on the anonymous daily cap the claim hand-off / cap link line already asks for the email, and the gas
// ask must not make it two. Per tool must not reopen that: here the cap wall comes AFTER another tool's wall in
// the same session, so the gas tool's (session, tool) key is fresh.
describe('the anonymous daily-cap wall keeps exactly one ask (mcp#1331) as a second tool', () => {
  it('get_grid_intelligence wall, then get_gas_intelligence on the cap: one email ask, no gas line', async () => {
    const call = await session({ net: CAP_NET });
    await call('get_grid_intelligence');
    const r = await call('get_gas_intelligence');
    expect(r.sc._upgrade && r.sc._upgrade.tier).toBe('anon_daily_cap');
    expect(count(r.text, RANK_EMAIL_ASK_LEAD)).toBe(0);
    expect(count(r.text, '`bind_email`')).toBe(0);
    expect(count(r.text, HUMAN)).toBe(0);
    // the one ask: the email link (option C, the day's first cap wall), and the row says so
    expect(r.ev && r.ev.email_ask).toBe('link');
    const prose = r.text.split('\n').filter((l) => !/^\s*\{/.test(l));
    expect(prose.filter((l) => /https:\/\/dchub\.cloud\/(u|upgrade\/h)\//.test(l)).length).toBe(1);
  });
});

// An execute_plan step runs on loopback with the caller's session id. Its steps keep the per-session memo: per tool
// there grew the plan's step results (measured: +696 chars of step text, no line in the plan answer) and marked
// each step's tool for the session, so a later direct get_grid_intelligence wall lost its ask.
describe('execute_plan steps keep the per-session memo', () => {
  const norm = (t) => t.replace(/https:\/\/\S+/g, 'URL').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'TS')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID');
  it('the plan answer is the same with the switch on and off; the direct walls after it each ask once', async () => {
    const on = await session();
    const pOn = await on('execute_plan');
    const pOff = await withEnv('DCHUB_ASK_PER_TOOL', '0', async () => (await session())('execute_plan'));
    expect(pOn.text.length).toBeGreaterThan(1000);
    expect(norm(pOn.text).length).toBe(norm(pOff.text).length);
    expect(count((await on('rank_markets')).text, RANK_ASK)).toBe(1);
    expect(count((await on('get_grid_intelligence')).text, HUMAN)).toBe(1);
  });
});

describe('directory and core surfaces stay ask-free on every tool', () => {
  it.each(['/mcp/claude', '/mcp/chatgpt', '/mcp/core'])('%s: three walled tools from one client, no ask on any', async (path) => {
    const call = await session({ path, needSession: false });
    for (const t of ['rank_markets', 'get_grid_intelligence', 'list_transactions']) {
      const r = await call(t);
      expect(r.text, path + ' ' + t).not.toMatch(/`bind_email`|`subscribe_digest`|Reply with your email/);
      expect(r.text, path + ' ' + t).not.toContain(RANK_EMAIL_ASK_LEAD);
      expect(r.text, path + ' ' + t).not.toContain(HUMAN);
    }
  });
});
