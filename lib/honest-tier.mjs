// Extracted from server.mjs so it can be TESTED.
// This session's own lesson, twice over: logic living inside a
// network-calling function is untested by default, and the paid-vs-anon probe
// missed this defect for the same structural reason it missed its own — a
// check that compares field NAMES cannot see a name whose VALUE is wrong.

// ★ THE TIER WE SAY WE SERVED AT MUST BE THE TIER WE SERVED AT.
//
// `caller_tier` is declared in the output schema as "Tier the response was
// served at", but its VALUE arrives from the backend, where the caller is THIS
// SERVER — not the agent. So a fully anonymous MCP session was handed
// `caller_tier: 'pro'` by get_energy_prices, in the same envelope that gated it
// down to a 1-result preview. The gating was correct; the label described
// somebody else.
//
// It costs conversion, not data: an agent that reads caller_tier to decide
// whether to surface an upgrade prompt concludes its human already pays, and
// never asks. Silent, and invisible to any check that compares field NAMES —
// which is why the paid-vs-anon probe could not see it (the name is present in
// both seats; only the value lies).
//
// Rewrites BOTH structuredContent and the mirrored content[0] JSON. Correcting
// one and not the other would leave the envelope contradicting itself, which is
// the same bug wearing a smaller hat. Fail-soft: any parse problem returns the
// result untouched.
export function honestCallerTier(result, c) {
  try {
    if (!result || typeof result !== 'object') return result;
    const served = String((c && c.tier) || 'free').toLowerCase();
    const sc = result.structuredContent;
    const scHas = sc && typeof sc === 'object' && !Array.isArray(sc)
      && Object.prototype.hasOwnProperty.call(sc, 'caller_tier');

    let items = Array.isArray(result.content) ? result.content : null;
    let idx = -1, obj = null;
    if (items) {
      idx = items.findIndex(x => x && x.type === 'text' && typeof x.text === 'string');
      if (idx >= 0) {
        try {
          const parsed = JSON.parse(items[idx].text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              && Object.prototype.hasOwnProperty.call(parsed, 'caller_tier')) obj = parsed;
        } catch (_) { obj = null; }
      }
    }
    if (!scHas && !obj) return result;   // nothing claims a tier — nothing to correct

    const out = { ...result };
    if (scHas && sc.caller_tier !== served) out.structuredContent = { ...sc, caller_tier: served };
    if (obj && obj.caller_tier !== served) {
      obj.caller_tier = served;
      const next = items.slice();
      next[idx] = { ...next[idx], text: JSON.stringify(obj) };
      out.content = next;
    }
    return out;
  } catch (_) { return result; }
}
