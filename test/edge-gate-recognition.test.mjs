// =============================================================================
// The live suites must recognise every gate the edge can return
// -----------------------------------------------------------------------------
// mcp.test.mjs and regression.test.mjs assert on payload CONTENT, and skip those
// assertions when a response is a gate. So an unrecognised gate is not a cosmetic
// miss — it decides whether a refusal is read as a bug, or as data.
//
// Measured 2026-09-01 against dchub-frontend/_worker.js enforceMcpTier(), by
// running the suites' own callTool() parsing and their own isGated() over the two
// payloads that function actually emits:
//
//   daily wall     regression.test.mjs isGated -> TRUE   (via /rate.?limit/
//                  matching the literal "Daily rate limit exceeded")
//   plan_required  regression.test.mjs isGated -> FALSE, and the parsed object
//                  ALSO satisfies `hasData` (no __structured, no __raw), so the
//                  PAID_ONLY assertion PASSED on a payload whose entire content
//                  is a refusal to serve. A false pass, not a false failure.
//
// mcp.test.mjs's copy caught plan_required, because its regex happened to include
// buy\.stripe\.com and the rejection carries a checkout URL. One predicate, two
// copies, one of them right — which is the actual defect this file guards.
//
// ★ WHY THE PAYLOADS ARE BUILT HERE RATHER THAN FETCHED
//   A live call cannot reach these branches on demand: plan_required needs a free
//   key calling a gated tool, the wall needs a quota already spent, and CI now
//   runs Developer-tier so it reaches NEITHER. A test that only ran when the gate
//   happened to fire would guard nothing on an ordinary day. So each payload is
//   constructed exactly as the worker constructs it, with the source line named,
//   and `wrap()` reproduces the JSON-RPC envelope shape — including that the
//   worker puts `_upgrade` OUTSIDE `result`, where callTool() never sees it.
//
//   That means this file's fidelity is a claim about _worker.js, and it can rot
//   if that file changes. It is pinned prose-and-payload here, deliberately, as
//   the best available: dchub-frontend is a different repository, so an import
//   is not possible and a copied constant would rot just as silently, without
//   saying why it existed.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { gateReason } from './gate-reason.mjs';

// callTool()'s parsing, verbatim from test/regression.test.mjs — what a suite
// actually holds by the time it calls gateReason().
function asCallToolWouldParse(payload) {
  const result = payload.result;
  if (result?.structuredContent) return { ...result.structuredContent, __structured: true };
  const c = result?.content;
  if (Array.isArray(c) && c[0]?.type === 'text') {
    const t = c[0].text;
    const divider = '\n\n---\n\n';
    const idx = t.indexOf(divider);
    const cleaned = idx > 0 && /free trial|preview|upgrade|sign up/i.test(t.slice(idx + divider.length))
      ? t.slice(0, idx).trim() : t;
    try { return JSON.parse(cleaned); } catch { return { __raw: t }; }
  }
  return result;
}

const wrap = (obj, envelope = {}) => ({
  jsonrpc: '2.0', id: 2,
  result: { content: [{ type: 'text', text: JSON.stringify(obj) }], isError: true },
  ...envelope,
});

// ── _worker.js enforceMcpTier(): usage.calls > tierConfig.daily_limit ──
const DAILY_WALL = wrap({
  error: 'Daily rate limit exceeded',
  message: "You've used 11/10 calls today on the Free plan.",
  upgrade: 'Get a Developer API key ($49/mo) for 500 calls/day → https://dchub.cloud/pricing/upgrade?tier=developer&ref=edge&direct=1',
  reset: 'Limits reset at midnight UTC',
  current_plan: 'free',
}, { _upgrade: { tier: 'free', limit: 10, used: 11, url: 'https://dchub.cloud/pricing/upgrade?tier=developer&ref=edge&direct=1' } });

// ── _worker.js enforceMcpTier(): tier === 'free' && GATED_TOOLS.has(toolName) ──
const PLAN_REQUIRED = wrap({
  error: 'plan_required',
  tool: 'analyze_site',
  message: 'analyze_site requires a Developer plan or higher.',
  free_tier_tools: 'search_facilities, get_facility, list_transactions, get_market_intel',
  upgrade: 'Developer plan ($49/mo) unlocks all tools with full data and 500 calls/day → https://dchub.cloud/pricing/upgrade?tier=developer&ref=edge&direct=1',
  checkout: 'https://buy.stripe.com/7sY5kE8F4fs13ml0PEaZi0c',
});

describe('edge gate recognition', () => {
  it('names the daily-quota wall', () => {
    expect(gateReason(asCallToolWouldParse(DAILY_WALL))).toBe('daily_limit');
  });

  it('names the free-tier plan_required rejection', () => {
    // The regression suite's own isGated returned FALSE here before this change,
    // and the payload also satisfies its `hasData`, so the gate read as data.
    expect(gateReason(asCallToolWouldParse(PLAN_REQUIRED))).toBe('plan_required');
  });

  it('recognises plan_required WITHOUT relying on the stripe checkout URL', () => {
    // mcp.test.mjs only caught this because the rejection happened to carry a
    // buy.stripe.com link. Drop the checkout and the old regex goes blind — the
    // `error: 'plan_required'` field is the load-bearing signal, so match on it.
    const noCheckout = { ...JSON.parse(PLAN_REQUIRED.result.content[0].text) };
    delete noCheckout.checkout;
    delete noCheckout.upgrade;
    expect(gateReason(asCallToolWouldParse(wrap(noCheckout)))).toBe('plan_required');
  });

  it('does not depend on the envelope _upgrade the worker puts outside result', () => {
    // The worker sets _upgrade as a SIBLING of result; callTool reads result only.
    // If recognition ever starts depending on it, this catches that: strip the
    // envelope field entirely and the wall must still be named.
    const { _upgrade, ...envelopeless } = DAILY_WALL;
    expect(_upgrade).toBeTruthy();                       // the field really is out there
    expect(asCallToolWouldParse(DAILY_WALL)._upgrade).toBeUndefined();  // and never arrives
    expect(gateReason(asCallToolWouldParse(envelopeless))).toBe('daily_limit');
  });

  it('structured tier rejections are still named', () => {
    expect(gateReason({ __structured: true, error: 'paid_only' })).toBe('paid_only');
    expect(gateReason({ __structured: true, trial_preview: true })).toBe('trial_preview');
    expect(gateReason({ __structured: true, error: 'scraper_pattern_blocked' })).toBe('scraper_pattern_blocked');
  });

  it('keeps the UNSTRUCTURED cases mcp.test.mjs used to catch by string match', () => {
    // Its old regex tested the serialised response, so these were gates there
    // even without structuredContent. Narrowing to the structured field alone
    // would have silently dropped them when the two copies were merged.
    expect(gateReason({ error: 'scraper_pattern_blocked' })).toBe('scraper_pattern_blocked');
    expect(gateReason({ note: 'includes dch_trial_ABC123' })).toBe('upgrade_offer');
    expect(gateReason({ cta: 'https://dchub.cloud/upgrade?key=x' })).toBe('upgrade_offer');
    expect(gateReason({ cta: 'https://buy.stripe.com/abc' })).toBe('upgrade_offer');
    expect(gateReason({ msg: 'API 429 from upstream' })).toBe('upstream_unavailable');
    expect(gateReason({ msg: 'too many requests' })).toBe('upstream_unavailable');
  });

  it('a masked metric is named', () => {
    expect(gateReason({ vacancy_pct: '[7.2 — sign up to unlock]' })).toBe('masked_metric');
  });

  // ── anti-vacuous controls: real data must NOT be read as a gate ──
  it('a genuine full-data response is not a gate', () => {
    const real = wrap({
      data: [{ id: 'e8f23d31', name: 'Aligned Ashburn (IAD-01)', country: 'US', power_mw: 72 }],
      success: true,
      provenance: { source: 'DC Hub', as_of: '2026-09-01T00:00:00Z' },
    });
    expect(gateReason(asCallToolWouldParse(real))).toBeNull();
  });

  it('the word "upgrade" alone in prose does not make a payload a gate', () => {
    // A tool description or news item may legitimately contain the word. Only
    // the upsell SHAPES above count, or every response becomes a gate and the
    // suites stop asserting anything at all — silent green by over-matching.
    const newsy = wrap({
      articles: [{ title: 'Dominion to upgrade the Ashburn 500kV corridor', date: '2026-08-30' }],
      success: true,
    });
    expect(gateReason(asCallToolWouldParse(newsy))).toBeNull();
  });

  it('a falsy response is left to the caller, not called a gate', () => {
    // The two suites disagree on purpose: mcp.test.mjs treats a null response as
    // gated (skip), regression.test.mjs does not (let hasData decide). Flattening
    // that here would silently change one of them, so gateReason stays out of it.
    expect(gateReason(undefined)).toBeNull();
    expect(gateReason(null)).toBeNull();
  });
});
