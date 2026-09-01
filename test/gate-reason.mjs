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
