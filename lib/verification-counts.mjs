// verification-counts.mjs — keep `provenance.verification_counts` out of tool
// OUTPUT (owner decision 2026-09-28).
//
// WHY. The backend stamps a collection-level provenance block on facility
// responses, and until now this server passed its `verification_counts`
// through untouched. Measured live 2026-09-28 on search_facilities:
//
//   "verification_counts": {"tracked": 31198, "verified": 23484}
//
// right beside `facility_count_status: "corroboration_pending"`. Agents quoted
// those two numbers as DC Hub's facility count — the one number the owner has
// withdrawn everywhere until a corroborated count exists. (They were never the
// count anyway: `verified` is the de-duplicated keeper set and `tracked` the raw
// discovery pile, so one reads below any published floor and one above.)
//
// WHAT THIS DOES. One step in the tool-result chain (server.mjs, directly
// outside _stampAttribution — the last step that could add the key) removes
// every `verification_counts` key from structuredContent and from every JSON
// text item, and strips the counts from the compact "📎 provenance:" footer.
// Nothing else in the result changes. The key is OMITTED, not nulled: every
// declared outputSchema lists `provenance` as z.looseObject({}).optional()
// with no required members, on /mcp and on /mcp/chatgpt alike, so nothing a
// client validates against requires it.
//
// Fail-soft: anything unexpected returns the result unchanged.

const KEY = 'verification_counts';
// The key and its value inside a JSON text: a flat object (the block has no
// nested objects) or null, with an optional leading and trailing comma so the
// surrounding object stays valid. `\\?"` also covers JSON embedded as a string
// inside JSON (execute_plan step results).
const TEXT_RE = /(,\s*)?\\?"verification_counts\\?"\s*:\s*(?:\{[^{}]*\}|null)(\s*,)?/g;
// "📎 provenance: 23,484/31,198 verified · as_of …" — the footer
// lib/result-shaping.mjs used to print.
const FOOTER_RE = /(\u{1F4CE} provenance:) (?:[\d,]+\/[\d,]+ verified|[\d,]+ verified|[\d,]+ tracked)(?: · |(?=\s*$))/gmu;

function _dropDeep(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 64) return;
  if (Array.isArray(v)) { for (const x of v) _dropDeep(x, depth + 1); return; }
  if (Object.prototype.hasOwnProperty.call(v, KEY)) delete v[KEY];
  for (const k of Object.keys(v)) _dropDeep(v[k], depth + 1);
}

/** A copy of `obj` with every verification_counts key removed (same ref when absent). */
export function dropVerificationCountsDeep(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  let s;
  try { s = JSON.stringify(obj); } catch (_) { return obj; }
  if (typeof s !== 'string' || !s.includes(`"${KEY}"`)) return obj;
  const copy = JSON.parse(s);
  _dropDeep(copy);
  return copy;
}

function _isJson(t) {
  try { JSON.parse(t); return true; } catch (_) { return false; }
}

/** One text item's text with the counts removed (same string when absent). */
export function dropVerificationCountsText(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  if (out.includes(KEY)) {
    const wasJson = _isJson(out);
    const cut = out.replace(TEXT_RE, (_m, lead, trail) => ((lead && trail) ? ',' : ''));
    if (!wasJson || _isJson(cut)) {
      out = cut;
    } else {
      // The regex left a JSON document invalid (an unexpected shape): fall back
      // to a structural rewrite, keeping the original's indentation.
      const indent = /^\{\n(\s+)"/.exec(text);
      out = JSON.stringify(dropVerificationCountsDeep(JSON.parse(text)), null, indent ? indent[1].length : undefined);
    }
  }
  if (out.includes('\u{1F4CE} provenance:')) {
    out = out.replace(FOOTER_RE, (_m, mark) => `${mark} `)
      .replace(/^\u{1F4CE} provenance:\s*$/gmu, '')      // nothing left on the line
      .replace(/(\u{1F4CE} provenance:) +/gu, '$1 ');
  }
  return out;
}

/** The tool result with every verification_counts key and footer count removed. */
export function dropVerificationCounts(result) {
  try {
    if (!result || typeof result !== 'object') return result;
    let out = result;
    if (Array.isArray(result.content)) {
      let changed = false;
      const content = result.content.map((it) => {
        if (!it || it.type !== 'text' || typeof it.text !== 'string') return it;
        const t = dropVerificationCountsText(it.text);
        if (t === it.text) return it;
        changed = true;
        return { ...it, text: t };
      });
      if (changed) out = { ...out, content };
    }
    if (result.structuredContent && typeof result.structuredContent === 'object') {
      const sc = dropVerificationCountsDeep(result.structuredContent);
      if (sc !== result.structuredContent) out = { ...out, structuredContent: sc };
    }
    return out;
  } catch (_) {
    return result;
  }
}
