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
    // JSON followed by prose in ONE block (the later split into JSON-first + human
    // blocks has not run yet): JSON.parse fails, so the label was left as the backend
    // wrote it while structuredContent was corrected (Grok 10-08 item 2). Fix the
    // leading object's own label in place; first match only, text that opens with '{'.
    let proseFix = null;
    if (!obj && idx >= 0 && /^\s*\{/.test(items[idx].text)) {
      const m = /"caller_tier"\s*:\s*"([^"]*)"/.exec(items[idx].text);
      if (m && m[1] !== served) proseFix = m;
    }
    if (!scHas && !obj && !proseFix) return result;   // nothing claims a tier — nothing to correct

    const out = { ...result };
    if (scHas && sc.caller_tier !== served) out.structuredContent = { ...sc, caller_tier: served };
    if (obj && obj.caller_tier !== served) {
      obj.caller_tier = served;
      const next = items.slice();
      next[idx] = { ...next[idx], text: JSON.stringify(obj) };
      out.content = next;
    }
    if (proseFix) {
      const next = items.slice();
      const t = items[idx].text;
      next[idx] = { ...items[idx], text: t.slice(0, proseFix.index) + '"caller_tier":' + JSON.stringify(served) + t.slice(proseFix.index + proseFix[0].length) };
      out.content = next;
    }
    return out;
  } catch (_) { return result; }
}

// ── mcp#245 (owner-approved 2026-10-20): ONE meaning for `tier` ─────────────────
// The top-level `tier` meant the CALLER's plan on one tool and the plan that UNLOCKS
// full depth on another: anonymous search_facilities said `tier: "free"`, anonymous
// rank_markets said `tier: "developer"` (the backend's gate, passed through) beside
// `_results_total_in_pro` (a third word for the same gate). An agent reading `tier`
// could not tell which it got. Now every envelope that states a tier states BOTH,
// in fields that cannot be confused:
//   caller_tier    the tier THIS response was served at (same as identity.tier)
//   required_tier  the lowest set that returns what this response withheld, read from
//                  the `_<k>_total_unlocks_at` markers (free / developer / pro);
//                  null when the response names nothing withheld
//   tier           kept, and only ever the caller's tier (= caller_tier)
// Fields only: no sentence here names a plan. A top-level `tier` whose value is not an
// access tier (a facility's "Tier III" rating) is data and is never touched.
const ACCESS_TIER_WORDS = new Set(['anonymous', 'anon', 'free', 'identified', 'trial', 'starter',
  'developer', 'pro', 'founding', 'enterprise', 'paid', 'team', 'metered']);
const REQUIRED_RUNG_ORDER = ['free', 'identified', 'starter', 'developer', 'pro', 'founding', 'enterprise'];
const UNLOCKS_AT_RE = /^_.+_total_unlocks_at$/;

export function requiredTierOf(obj) {
  let best = null;
  for (const [k, v] of Object.entries(obj || {})) {
    if (!UNLOCKS_AT_RE.test(k) || typeof v !== 'string') continue;
    const r = REQUIRED_RUNG_ORDER.indexOf(v.toLowerCase());
    if (r < 0) continue;
    if (best === null || r > REQUIRED_RUNG_ORDER.indexOf(best)) best = REQUIRED_RUNG_ORDER[r];
  }
  return best;
}

function _pairOn(obj, served) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const hasTierKey = Object.prototype.hasOwnProperty.call(obj, 'tier');
  const accessTier = hasTierKey && typeof obj.tier === 'string' && ACCESS_TIER_WORDS.has(obj.tier.trim().toLowerCase());
  const req = requiredTierOf(obj);
  if (!accessTier && req === null) return null;               // states no tier: nothing to pair
  const next = { ...obj, caller_tier: served, required_tier: req };
  if (accessTier) next.tier = served;
  if (next.tier === obj.tier && obj.caller_tier === served && obj.required_tier === req
      && Object.prototype.hasOwnProperty.call(obj, 'required_tier')) return null;   // already right
  return next;
}

// The leading balanced JSON object of a text block, for a block that is JSON followed by
// prose (the later JSON-first split has not run yet). null when the text does not open
// with one.
function _leadingObject(text) {
  const s = String(text || '');
  const start = s.search(/\S/);
  if (start < 0 || s[start] !== '{') return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return { obj: JSON.parse(s.slice(start, i + 1)), start, end: i + 1 }; } catch (_) { return null; }
      }
    }
  }
  return null;
}

export function stampTierPair(result, c) {
  try {
    if (!result || typeof result !== 'object') return result;
    const served = String((c && c.tier) || 'anonymous').trim().toLowerCase() || 'anonymous';
    let out = result;
    const sc = _pairOn(result.structuredContent, served);
    if (sc) out = { ...out, structuredContent: sc };
    const items = Array.isArray(result.content) ? result.content : null;
    const idx = items ? items.findIndex((x) => x && x.type === 'text' && typeof x.text === 'string') : -1;
    if (idx >= 0) {
      const t = items[idx].text;
      let parsed = null;
      try { parsed = JSON.parse(t); } catch (_) { parsed = null; }
      let text = null;
      if (parsed) {
        const fixed = _pairOn(parsed, served);
        if (fixed) text = JSON.stringify(fixed);
      } else {
        // JSON + prose in one block: fix the leading object in place, keep the prose,
        // or the two channels would state two tiers (the bug this exists to close).
        const lead = _leadingObject(t);
        const fixed = lead && _pairOn(lead.obj, served);
        if (fixed) text = t.slice(0, lead.start) + JSON.stringify(fixed) + t.slice(lead.end);
      }
      if (text !== null) {
        const next = items.slice();
        next[idx] = { ...next[idx], text };
        out = { ...out, content: next };
      }
    }
    return out;
  } catch (_) { return result; }
}
