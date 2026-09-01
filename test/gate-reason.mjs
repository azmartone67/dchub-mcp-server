// =============================================================================
// gateReason() — the ONE place that recognises a DC Hub gate response
// -----------------------------------------------------------------------------
// The live suites assert on payload CONTENT. A response that is a gate carries
// no data to assert on, so each suite skips its data checks when it sees one.
// That makes gate recognition load-bearing in both directions:
//
//   • a gate MISTAKEN for data  -> the suite asserts on fields a rejection never
//     had, and reports a product defect that does not exist.
//   • a gate MISTAKEN for a pass -> worse. `hasData` in regression.test.mjs is
//     `!__structured && !__raw.includes(...)`, which a plan-rejection satisfies.
//     The tool could be entirely broken behind the gate and the suite would
//     call it healthy, forever, silently.
//
// Both had happened. Until this file, `isGated` existed TWICE — mcp.test.mjs:111
// and regression.test.mjs:149 — and the copies had drifted apart:
//
//   mcp.test.mjs        matched buy\.stripe\.com, so it caught `plan_required`.
//   regression.test.mjs did not, so it did NOT — and since a parsed
//                       plan_required object also satisfies `hasData`, the
//                       PAID_ONLY assertion passed on a response containing
//                       nothing but a refusal to serve.
//
// Two copies of one predicate is how a fix lands in one and not the other. So
// there is one copy now, and it returns WHICH gate matched rather than a bare
// boolean — a named reason is checkable by a test and readable in a failure.
//
// ★ Each shape below was read out of the source that emits it, not guessed.
//   The edge gates come from dchub-frontend/_worker.js enforceMcpTier():
//   the daily wall at the `usage.calls > daily_limit` branch, and plan_required
//   at the `tier === 'free' && GATED_TOOLS.has(tool)` branch. Their payloads are
//   pinned in test/edge-gate-recognition.test.mjs, built the same way the worker
//   builds them, so a shape change there fails here rather than going quiet.
//
// ★ NOTE for whoever adds the next branch: the worker puts `_upgrade` on the
//   JSON-RPC ENVELOPE, as a sibling of `result` — not inside it. callTool()
//   reads `payload.result` and nothing else, so that `_upgrade` never reaches
//   this function. Do not add a branch that relies on it; match on the parsed
//   `result.content[0].text` payload, which is all a caller actually sees.
// =============================================================================

/**
 * Name the gate a response represents, or null if it carries real data.
 * @param {any} r  a response as returned by a suite's callTool()
 * @returns {string|null} a short gate name, or null
 */
export function gateReason(r) {
  if (!r) return null;                       // callers decide what a falsy response means
  const str = JSON.stringify(r);

  // Structured tier rejections the server emits directly.
  if (r.__structured && r.error === 'paid_only') return 'paid_only';
  // Matched as a STRING as well as a structured field: mcp.test.mjs's old copy
  // tested the serialised response for this marker, and narrowing it to the
  // structured form only would have quietly dropped a case it used to catch.
  if (r.error === 'scraper_pattern_blocked') return 'scraper_pattern_blocked';
  if (r.__structured && r.trial_preview) return 'trial_preview';

  // Edge gates (dchub-frontend/_worker.js enforceMcpTier).
  if (r.error === 'plan_required') return 'plan_required';
  if (/Daily rate limit exceeded/i.test(str)) return 'daily_limit';

  // Depth masking: a metric replaced by "[… — sign up to unlock]".
  if (/sign up to unlock/i.test(str)) return 'masked_metric';

  // Upsell markers on an otherwise-shaped response.
  if (r._upgrade || r.upgrade_url) return 'upgrade_offer';
  if (/trial_preview|dch_trial_|upgrade\?key=|buy\.stripe\.com|pick a plan|scraper_pattern_blocked/i.test(str)) return 'upgrade_offer';

  // Unparsed prose that is plainly an upsell rather than data.
  if (r.__raw && /sign up to unlock|upgrade|trial/i.test(r.__raw)) return 'upgrade_prose';
  if (r.raw && /upgrade|trial|preview|sign up|stripe/i.test(r.raw)) return 'upgrade_prose';

  // Transient upstream unavailability — no data to assert on either.
  if (/\bAPI 429\b|\bAPI 5\d\d\b|rate.?limit|too many requests/i.test(str)) return 'upstream_unavailable';

  return null;
}

// =============================================================================
// hasPayload() — does a response actually carry data?
// -----------------------------------------------------------------------------
// regression.test.mjs defined this inline as:
//
//     const hasData = r && !r.__structured && !r.__raw?.includes('sign up to unlock');
//
// which reads "has data" as "did NOT arrive as structuredContent". That is
// backwards: structuredContent is how a well-formed MCP response arrives, so the
// better a tool behaved, the more certainly it failed the check.
//
// Measured 2026-09-01 on the authenticated smoke run (tier: paid), the four
// tools failing that assertion returned:
//
//   get_grid_intelligence  __structured:true  iso, iso_name, demand_mw,
//                          generation_mix_pct, constraint_score,
//                          excess_power_score, retail_price_cents_kwh, …
//   get_dchub_recommendation __structured:true  recommendation,
//                          recommendation_live, related_intel, success, …
//   get_fiber_intel        __structured:true  features, total, type,
//                          freshness, provenance   (a GeoJSON FeatureCollection)
//   compare_sites          __structured:true  error  — and nothing else
//
// Three of the four were serving exactly what they document. Only the fourth is
// a real problem, and the old check could not tell them apart because it never
// looked at the payload — it looked at the transport.
//
// So look at the payload. A response has data when it carries at least one key
// that is not envelope furniture, and does not carry a top-level `error`.
//
// ★ ENVELOPE_KEYS is a DENYLIST, and that direction is deliberate: an allowlist
//   of expected data keys would have to be updated for every tool and would fail
//   closed on any new field — the same brittleness as asserting a fixed response
//   shape, which is what left two tests red for months. Adding a key here makes
//   the check STRICTER, so the risk of forgetting one is a false pass on a
//   response that is all envelope; test/edge-gate-recognition.test.mjs pins the
//   four real key sets above against that.
const ENVELOPE_KEYS = new Set([
  '_entity', 'quota', '_source', '_cite', 'citation', 'next_session', 'resume',
  '_return_loop', 'provenance', 'identity', '__structured', '__raw', 'tool',
  'starter_pack', 'first_call_nudge', 'platform', 'next_tools_hint',
]);

/**
 * True when a response carries payload rather than only envelope or an error.
 * @param {any} r a response as returned by a suite's callTool()
 */
export function hasPayload(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.error !== undefined) return false;
  if (typeof r.__raw === 'string') return !/sign up to unlock/i.test(r.__raw);
  return Object.keys(r).some((k) => !ENVELOPE_KEYS.has(k));
}
