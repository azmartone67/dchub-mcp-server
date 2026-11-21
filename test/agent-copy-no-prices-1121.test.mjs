// agent-copy-no-prices-1121.test.mjs — owner decision 2 (no-free sweep, 2026-11-21): no prices, plan names, credits
// or calls-per-day in agent-facing copy; point to dchub.cloud/connect instead.
//
// The neutral connect step (lib/neutral-connect.mjs) already rewrites tool results on /mcp for callers below a paid
// plan. Measured 2026-11-21 on origin/main (every tool x anon / trial / identified / developer / pro, /mcp and
// /mcp/claude, backend stubbed, walls v2 off and on), what still reached an agent came from the paths that step
// does not touch:
//   * unlock_more_data, a skipped tool, for every caller: "a one-time pack of 1,000 API credits", the credit rule,
//     "previews plus 2 full answers per tool per day ..., 50/day with an email", "higher rate limits";
//   * plan_query / execute_plan coverage notes for a paid caller (the step skips paid callers): "a credit pack opens
//     them per call";
//   * the trial-key lines, whose sentences carry the key value, so the step keeps them whole: "(15 calls/day, 7d left)".
// This guard renders those surfaces and fails on the step's own offer wording (offerWording, under a CTA key: any
// "$<digit>"), a plan name, or a calls-per-day figure. /mcp/chatgpt is frozen for OpenAI review: there the same
// builders keep their origin/main bytes, which this file pins too.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { offerWording } from '../lib/neutral-connect.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';

const PLAN_NAME = /\b(?:Developer|Pro|Starter|Enterprise|Founding|Lite)\b/;
const PER_DAY = /\bcalls?\s*(?:\/|a|per)\s*day\b|\b\d[\d,]*\s*\/\s*day\b|\b\d[\d,]*\s+full\b[^.\n]{0,40}?\b(?:a|per)\s+day\b/i;
export function priceOffenders(strings) {
  return strings.filter((s) => typeof s === 'string' && (offerWording(s, true) || PLAN_NAME.test(s) || PER_DAY.test(s)));
}
const texts = (v, out = []) => {
  if (typeof v === 'string') {
    out.push(v);
    if (/^\s*[[{]/.test(v)) { try { texts(JSON.parse(v), out); } catch (_) { /* prose */ } }
  } else if (Array.isArray(v)) v.forEach((x) => texts(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => texts(x, out));
  return out;
};

let S, stub, prevBase;
beforeAll(async () => {
  stub = createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end('{}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
});
afterAll(async () => {
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

const SEATS = {
  anonymous: { tier: 'free' },
  trial: { tier: 'trial', api_key: 'dch_trial_guard0001' },
  identified: { tier: 'identified', api_key: 'dch_live_guard0001', email: 'guard@example.com' },
  developer: { tier: 'developer', api_key: 'dch_live_guard0002' },
  pro: { tier: 'pro', api_key: 'dch_live_guard0003' },
};
let _n = 0;
const run = (seat, fn) => S._ctxALS.run({ session_id: 'guard-1121-' + (++_n), client_ip: '198.51.100.7', ...seat }, fn);

describe('unlock_more_data names no price, credit pack, plan name or per-day allowance', () => {
  it.each(Object.keys(SEATS))('%s caller', (seat) => {
    for (const reason of ['', 'get_dchub_recommendation for a Dallas site']) {
      const r = run(SEATS[seat], () => S._unlockMoreDataEnvelope({ reason }));
      const all = texts(r);
      expect(all.length, 'rendered nothing: a check over nothing proves nothing').toBeGreaterThan(3);
      expect(priceOffenders(all)).toEqual([]);
    }
  });
  it('the frozen /mcp/chatgpt seat keeps its origin/main copy', () => {
    const r = run({ ...SEATS.anonymous, profile: DIRECTORY_PROFILE }, () => S._unlockMoreDataEnvelope({}));
    const all = texts(r).join('\n');
    expect(all).toContain('a one-time pack of 1,000 API credits (usage capacity, not a subscription)');
    expect(all).toContain('The one-time credit pack is API capacity');
  });
});

describe('plan coverage notes name no credit pack (paid callers skip the neutral step)', () => {
  const notes = () => S._PLAN_CLASSES.map((c) => c.coverage_notes).filter((s) => typeof s === 'string' && s);
  it('every class note, as /mcp and /mcp/claude serve it', () => {
    expect(notes().length).toBeGreaterThan(10);
    expect(priceOffenders(notes().map((n) => S._planCoverageNote(n, { tier: 'pro' })))).toEqual([]);
    expect(priceOffenders(notes().map((n) => S._planCoverageNote(n, { tier: 'pro', profile: 'claude' })))).toEqual([]);
  });
  it('/mcp/chatgpt reads the class table as it was', () => {
    for (const n of notes()) expect(S._planCoverageNote(n, { profile: DIRECTORY_PROFILE })).toBe(n);
  });
});

describe('trial-key lines state no calls-per-day figure', () => {
  const MINT = { api_key: 'dch_trial_guardmint01', tier: 'trial', daily_calls: 15, trial_days: 7, days_remaining: 7, daily_calls_when_email_bound: 50 };
  const lines = (seat, ...a) => run(seat, () => S.buildAutoMintBlock(MINT, ...a).text);
  it.each([[true, null], [false, null], [false, 2]])('autoBound=%s remainingFull=%s', (bound, rem) => {
    // search_facilities / get_water_risk take the key lines (the key value rides the sentence); the decision tools
    // take the preview-depth line ("Your trial key is active (...)").
    for (const tool of ['search_facilities', 'get_water_risk', 'get_market_intel', 'get_grid_intelligence']) {
      const t = lines(SEATS.anonymous, tool, bound, rem);
      if (!['get_market_intel', 'get_grid_intelligence'].includes(tool)) expect(t).toContain(MINT.api_key);
      expect(t).toContain('7d left');
      expect(t).not.toMatch(/calls\/day/);
    }
  });
  it('/mcp/chatgpt keeps "(15 calls/day, 7d left)"', () => {
    expect(lines({ ...SEATS.anonymous, profile: DIRECTORY_PROFILE }, 'get_market_intel', true, null)).toContain('(15 calls/day, 7d left)');
  });
});

describe('the pattern catches the 2026-11-21 copy (must-fail control)', () => {
  it.each([
    'a one-time pack of 1,000 API credits (usage capacity, not a subscription)',
    '1 credit per paid-tool call; the 4 heavy analysis tools use 5 each',
    'a DC Hub key, no email, previews plus 2 full answers per tool per day, 50/day with an email, all tools',
    'The one-time credit pack is API capacity',
    'a credit pack opens them per call, as full-access depth',
    '(15 calls/day, 7d left)',
    'Pro ($99/mo)',
    'the $10 pack',
  ])('%s', (bad) => { expect(priceOffenders([bad])).toEqual([bad]); });
});
