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
