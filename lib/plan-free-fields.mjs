// QA B P1 (2026-10-19), owner rule 2026-10-10: agent-facing text and fields name no plan and no price.
//
// The free-tier trimmers (trimForTrial, the substation locks) mark what they withheld with field names
// that carry a plan: `_<k>_in_pro: true`, `_<k>_total_in_pro: N`, `_<k>_total_unlocks_at: 'pro'`,
// `_required_tier: 'pro'`. Everything inside the server READS those names (sell lines, relay-wall
// detection, attribution, upgrade-missed, execute_plan's scope readers), so they cannot be renamed at
// the source. This step runs LAST on the final result of a siting-family tool and rewrites the two
// serialised channels (structuredContent and every JSON text block) with the neutral names the
// directory profile already uses (lib/chatgpt-directory.mjs renameKey):
//   _<k>_in_pro        -> _<k>_withheld
//   _<k>_total_in_pro  -> _<k>_total_available
// and drops the keys whose only content is a plan name (`_required_tier`, `_substation_required_tier`,
// `_<k>_total_unlocks_at`, `_<k>_total_in_developer`, `pro_hint`).
//
// Pure: returns new objects and never mutates its input, because a trimmed answer can be a shared cache
// entry (feedback_tier_and_field_gating). An execute_plan step (an in-process loopback call) is skipped
// by the caller so execute_plan's own readers still see the original markers; the plan's final result
// goes through this step once, nested results included.

export const PLAN_FREE_FIELD_TOOLS = new Set([
  'find_sites', 'site_selection_canvas', 'execute_plan', 'get_retirement_headroom', 'get_hosting_capacity',
]);

const DROP_KEY = /^(?:_*(?:substation_)?required_tier|_.+_total_unlocks_at|_.+_total_in_developer|pro_hint)$/;
const TOTAL_IN_PRO = /^(_.+)_total_in_pro$/;
const IN_PRO = /^(_.+)_in_pro$/;

export function planFreeKey(k) {
  let m = TOTAL_IN_PRO.exec(k);
  if (m) return m[1] + '_total_available';
  m = IN_PRO.exec(k);
  if (m) return m[1] + '_withheld';
  return k;
}

export function planFreeString(s) {
  return s.replace(/_total_in_pro\b/g, '_total_available').replace(/_in_pro\b/g, '_withheld');
}

export function planFreeValue(v, depth = 0) {
  if (typeof v === 'string') return planFreeString(v);
  if (!v || typeof v !== 'object' || depth > 40) return v;
  if (Array.isArray(v)) return v.map((x) => planFreeValue(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (DROP_KEY.test(k)) continue;
    out[planFreeKey(k)] = planFreeValue(x, depth + 1);
  }
  return out;
}

export function planFreeFieldsOn() {
  return !/^(0|false|no|off)$/i.test(String(process.env.DCHUB_PLAN_FREE_FIELDS_V1 || ''));
}

// result: an MCP tool result. Returns it unchanged when nothing is to be done.
export function planFreeFieldsStep(result, name, { skip = false } = {}) {
  try {
    if (skip || !planFreeFieldsOn() || !PLAN_FREE_FIELD_TOOLS.has(name)) return result;
    if (!result || typeof result !== 'object' || result.isError) return result;
    let out = result;
    const sc = result.structuredContent;
    if (sc && typeof sc === 'object') out = { ...out, structuredContent: planFreeValue(sc) };
    if (Array.isArray(result.content)) {
      out = { ...out, content: result.content.map((b) => {
        if (!b || typeof b.text !== 'string') return b;
        const t = b.text;
        const lead = t.charAt(0);
        if (lead === '{' || lead === '[') {
          try {
            const parsed = JSON.parse(t);
            return { ...b, text: JSON.stringify(planFreeValue(parsed), null, /^[{[]\s*\n/.test(t) ? 2 : 0) };
          } catch (_) { /* not pure JSON: token pass below */ }
        }
        return { ...b, text: planFreeString(t) };
      }) };
    }
    return out;
  } catch (_) { return result; }   // a rename is never worth failing a response over
}
