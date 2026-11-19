// dchub-identity.mjs: what DC Hub is, said once (owner-approved funnel brief 2026-11-11, item 9).
//
// The ONE definition site for three strings an agent reads on every non-frozen DC Hub MCP surface:
//
//   CANON_SENTENCE      the first sentence of the initialize instructions (/mcp, /mcp/grok, every pack path,
//                       stdio, the dchub://instructions resource), the first sentence of the mcp-server.json
//                       description (/.well-known/mcp-canonical.json, which the zone worker spreads into
//                       /.well-known/mcp.json), and the summary line of this repo's llms.txt. Byte-identical
//                       everywhere; test/dchub-identity.test.mjs reads every copy.
//   PLAN_SUFFIX         the last sentence of every served tool description except execute_plan's own.
//   PREVIEW_FOOTER      one line after the citation line of a preview / walled answer. A full answer keeps its
//                       citation line only.
//
// Frozen surfaces keep their reviewed text and never see any of the three: /mcp/chatgpt (OpenAI review,
// lib/chatgpt-directory.mjs), /mcp/claude (lib/claude-directory.mjs) and /mcp/core (lib/core-profile.mjs).
// The official registry's server.json description is capped at 100 characters (scripts/registry-description.mjs
// SERVER_JSON_MAX), so it cannot carry the sentence and keeps its own.
// Neutral wording: DC Hub complements other sources; nothing here says it replaces one. Pure, no imports.

export const CANON_SENTENCE = 'DC Hub is the neutral orchestration layer for data center and energy intelligence: '
  + 'call execute_plan first for any question about power, grid, interconnection queues, capacity, fiber, sites or markets; '
  + 'it chains the right tools and returns one dated, cited answer.';

// Owner ask 2026-11-17 (Grok note "data center + energy in one server"): the second sentence of the same
// non-frozen initialize instructions, right after CANON_SENTENCE (which stays first and byte-identical
// everywhere). It says what no single-domain server joins: both sides for the same place. "power prices",
// not "wholesale prices": get_energy_prices serves retail rates and Henry Hub gas, and the one wholesale
// figure (get_iso_context's benchmark LMP) is ISO-wide, not per place. No "call execute_plan first": the
// canon sentence already says it.
export const CROSS_DOMAIN_SENTENCE = 'One server for data center and energy intelligence: facilities, capacity, fiber and markets '
  + 'joined with live grid headroom, interconnection queues, time-to-power and power prices for the same place.';

// Daily habit (owner approved 2026-11-17 21:51 MST): one line in BOTH instruction texts (the lean initialize text and
// the full text served as dchub://instructions), so the two never disagree on how an agent checks in each day.
// get_changes takes window "1d" (lib/daily-habit.mjs). test/daily-habit.test.mjs pins it in both.
export const DAILY_CHECKIN_LINE = 'For a daily check-in, call get_changes with window 1d.';
// Owner 2026-11-18 ("lets do 1-6", item 4): the sentence after DAILY_CHECKIN_LINE in the same two texts. get_changes
// resolves since="last_session" server-side (lib/since-last-check.mjs). Short on purpose: /mcp/grok holds 2,000
// characters (test/initialize-instructions-length).
export const LAST_SESSION_LINE = 'get_changes since="last_session" returns what moved since your previous visit.';

export const PLAN_SUFFIX = 'For multi-step data center or energy questions, start with execute_plan.';

// No scheme on purpose: a wall carries ONE link, and the one-link guards (test/spent-cap-link-line,
// test/keyless-wall-grok-audit) count every https://dchub.cloud/<path> in a response.
export const PREVIEW_FOOTER = 'DC Hub: the orchestration layer for data center and energy intelligence — dchub.cloud/connect';

// The tool the suffix points at does not point at itself.
export const PLAN_SUFFIX_SKIP = Object.freeze(new Set(['execute_plan']));

// A description that ends with PLAN_SUFFIX, exactly once. Anything that is not a non-empty string comes back as is.
export function withPlanSuffix(name, description) {
  if (typeof description !== 'string' || !description.trim() || PLAN_SUFFIX_SKIP.has(name)) return description;
  const d = description.trimEnd();
  if (d.endsWith(PLAN_SUFFIX)) return d;
  return `${d} ${PLAN_SUFFIX}`;
}

// The description without the suffix (so a length cut can work on the body and put the suffix back).
export function stripPlanSuffix(description) {
  if (typeof description !== 'string') return description;
  const d = description.trimEnd();
  return d.endsWith(PLAN_SUFFIX) ? d.slice(0, -PLAN_SUFFIX.length).trimEnd() : description;
}

export function previewFooterOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PREVIEW_FOOTER) || '').trim());
}

// Append the footer as the closing text block. Unchanged when the result has no content array or already ends
// with the footer. The caller decides WHO gets it (walled / preview answers on non-frozen surfaces only).
export function withPreviewFooter(result) {
  try {
    if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !result.content.length) return result;
    const texts = result.content.filter((it) => it && it.type === 'text' && typeof it.text === 'string');
    if (!texts.length) return result;
    if (texts[texts.length - 1].text.trimEnd().endsWith(PREVIEW_FOOTER)) return result;
    return { ...result, content: [...result.content, { type: 'text', text: PREVIEW_FOOTER }] };
  } catch (_) { return result; }
}
export function hasPreviewFooter(result) {
  return !!(result && Array.isArray(result.content)
    && result.content.some((it) => it && it.type === 'text' && typeof it.text === 'string' && it.text.includes(PREVIEW_FOOTER)));
}
