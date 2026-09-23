// tier-collapse-fix.test.mjs — Developer ($49) vs Pro ($99) at the MCP gate.
//
// THE DEFECT (dchub-backend + dchub-mcp-server, 2026-09-23)
// ───────────────────────────────────────────────────────────────────────────
// main.py's checkout webhook stamps mcp_dev_keys.tier with the literal string
// 'paid' for Developer, Pro AND Founding purchases alike — the column's CHECK
// constraint allows only free/paid/enterprise, so the Developer/Pro distinction
// is destroyed at WRITE time, not just misread somewhere. Every Node-side gate
// that short-circuited on `tier === 'paid'` (applyTierGate's first line,
// _lpAccessFor's rank check) therefore granted a $49 Developer key the SAME
// access as a $99 Pro one on every Pro-only tool — no preview, no wall.
//
// THE FIX
// ───────────────────────────────────────────────────────────────────────────
// validate_key() already resolves the real plan via users.plan
// (_tier_cross_check) and has always returned it, unused until now, as
// tier_detail.users_plan. _validateKeyUncached carries it through as
// .plan_tier on the cached validation. _paidKeyIsProOrAbove re-validates
// (cache-hit, cheap) and consults THAT to disambiguate an otherwise-ambiguous
// 'paid', instead of trusting the literal. Fails OPEN (grants) when the plan
// truly cannot be resolved — a caller already reading 'paid' is never left
// worse off than before this fix; only a POSITIVELY-confirmed sub-Pro plan
// denies. See _isUnambiguousProOrAbove + applyTierGate/_lpAccessFor in
// server.mjs for the call sites.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'https://backend.tier-collapse-fix.test';
let S, realFetch;
const validateCalls = [];
// api_key -> users_plan the stubbed backend answers for THAT key's
// /api/v1/keys/validate call. Undefined -> tier_detail.users_plan: null
// (the "cannot disambiguate" case).
let planFor = {};

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (p === '/api/v1/keys/validate') {
      const body = JSON.parse((init && init.body) || '{}');
      validateCalls.push(body.api_key);
      const plan = Object.prototype.hasOwnProperty.call(planFor, body.api_key) ? planFor[body.api_key] : undefined;
      return json({
        valid: true,
        tier: 'paid',
        developer_id: null,
        email: 'caller@example.com',
        tier_detail: { mcp_dev_keys: 'paid', users_plan: plan === undefined ? null : plan,
                       api_key_tier: null, effective: 'paid' },
      });
    }
    return json({});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
});
afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => { validateCalls.length = 0; planFor = {}; S.keyCache.clear(); });

describe('_isUnambiguousProOrAbove — no network, a pure string check', () => {
  it('is true for pro/founding/team/metered/enterprise/research_seed — every synonym "paid" collapses', () => {
    for (const t of ['pro', 'founding', 'team', 'metered', 'enterprise', 'research_seed']) {
      expect(S._isUnambiguousProOrAbove(t), t).toBe(true);
    }
  });
  it('is false for the ambiguous literal itself, even though it ranks alongside pro', () => {
    expect(S._tierRank('paid')).toBe(S._tierRank('pro'));   // the rank collision that caused the bug
    expect(S._isUnambiguousProOrAbove('paid')).toBe(false);  // but the literal is never trusted alone
  });
  it('is false for anything below Pro, and for junk/empty input', () => {
    for (const t of ['free', 'identified', 'starter', 'developer', '', null, undefined, 'not-a-tier']) {
      expect(S._isUnambiguousProOrAbove(t), String(t)).toBe(false);
    }
  });
});

describe('_paidKeyIsProOrAbove — resolves the real plan behind an ambiguous "paid"', () => {
  it('confirms Pro when the backend\'s real plan is pro', async () => {
    planFor['dch_live_tcf_pro'] = 'pro';
    expect(await S._paidKeyIsProOrAbove('dch_live_tcf_pro')).toBe(true);
    expect(validateCalls).toEqual(['dch_live_tcf_pro']);
  });
  it('confirms Pro when the real plan is founding (bills $99, grants pro)', async () => {
    planFor['dch_live_tcf_founding'] = 'founding';
    expect(await S._paidKeyIsProOrAbove('dch_live_tcf_founding')).toBe(true);
  });
  // ★ THE BUG, pinned directly at the helper that fixes it.
  it('DENIES Pro when the real plan is developer — the exact leak this fix closes', async () => {
    planFor['dch_live_tcf_developer'] = 'developer';
    expect(await S._paidKeyIsProOrAbove('dch_live_tcf_developer')).toBe(false);
  });
  it('denies Pro for starter too', async () => {
    planFor['dch_live_tcf_starter'] = 'starter';
    expect(await S._paidKeyIsProOrAbove('dch_live_tcf_starter')).toBe(false);
  });
  it('fails OPEN (grants) when the plan cannot be resolved at all — never worse than pre-fix', async () => {
    // planFor has no entry for this key -> tier_detail.users_plan: null.
    expect(await S._paidKeyIsProOrAbove('dch_live_tcf_unresolvable')).toBe(true);
  });
  it('fails OPEN on a network error — a backend hiccup must never wall an already-paid caller', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('backend unreachable'); };
    try {
      expect(await S._paidKeyIsProOrAbove('dch_live_tcf_network_error')).toBe(true);
    } finally { globalThis.fetch = prevFetch; }
  });
  it('denies (never grants on nothing) when there is no key to disambiguate', async () => {
    expect(await S._paidKeyIsProOrAbove(null)).toBe(false);
    expect(await S._paidKeyIsProOrAbove('')).toBe(false);
    expect(validateCalls).toEqual([]);   // never even asked the backend
  });
  it('re-validates through the existing 5-min keyCache, not a fresh network hop every time', async () => {
    planFor['dch_live_tcf_cached'] = 'pro';
    await S.validateKey('dch_live_tcf_cached');            // primes the cache, as a real request would
    expect(validateCalls).toEqual(['dch_live_tcf_cached']);
    expect(await S._paidKeyIsProOrAbove('dch_live_tcf_cached')).toBe(true);
    expect(validateCalls).toEqual(['dch_live_tcf_cached']); // still one call — served from cache
  });
});

describe('applyTierGate end-to-end via _paidKeyIsProOrAbove — a PRO_ONLY_TOOLS member', () => {
  // get_grid_intelligence: PRO_ONLY_TOOLS, deliberately NOT in LP_TOOLS, so this
  // exercises applyTierGate's own fix in isolation from _lpAccessFor's.
  it('a Developer purchase whose key collapsed to "paid" gets the capped taste, not full access', async () => {
    planFor['dch_live_tcf_gi_dev'] = 'developer';
    const confirmed = await S._paidKeyIsProOrAbove('dch_live_tcf_gi_dev');
    const gate = S.applyTierGate('get_grid_intelligence', {}, 'paid', true, false, confirmed);
    expect(gate.allowed).toBe(true);
    expect(gate.trial_taste).toBe(true);
    expect(gate.paid_taste).toBe(true);
    // Not the unconditional-bypass shape a real Pro/enterprise caller gets.
    expect(gate).not.toEqual({ allowed: true, params: {} });
  });
  it('a genuine Pro purchase whose key ALSO reads "paid" still gets full access', async () => {
    planFor['dch_live_tcf_gi_pro'] = 'pro';
    const confirmed = await S._paidKeyIsProOrAbove('dch_live_tcf_gi_pro');
    const gate = S.applyTierGate('get_grid_intelligence', {}, 'paid', true, false, confirmed);
    expect(gate).toEqual({ allowed: true, params: {} });
  });
});
