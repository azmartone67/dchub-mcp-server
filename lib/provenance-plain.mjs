// provenance-plain.mjs — no SQL fragments or table/column names in tool OUTPUT
// (owner request via Grok, 2026-09-28).
//
// WHY. The backend's facility provenance block explains itself in database
// terms. Measured live 2026-09-28 on search_facilities (/mcp), after #617:
//
//   "source": "DC Hub facilities registry (discovered_facilities)"
//   "method": "multi-source discovery + dedup verification; per-record v:
//              verified = passes the canonical fleet filter, … verification_counts
//              describe discovered_facilities … verified = distinct canonical_slug
//              passing the fleet filter COALESCE(is_duplicate,0)=0)"
//   "verification_counts_basis": "tracked records, not a corroborated facility
//              count (corroboration pending). verified = COUNT(DISTINCT
//              canonical_slug) WHERE is_duplicate=0 over discovered_facilities …"
//
// and the RAG layer labels rows `"source_table": "discovered_facilities"`. An
// agent cannot use any of that, and it quotes it. Backend sources (fix there
// too): dchub-backend routes/provenance.py (VERIFICATION_COUNTS_BASIS,
// COUNTS_BASIS_DISCOVERED) and main.py's three _pv_attach calls (source= /
// method= for the facility list, detail-by-id and detail-by-slug paths);
// routes/rag for source_table / corpus.
//
// WHAT THIS DOES. One step in the tool-result chain, next to #617's
// verification-counts strip (server.mjs), rewrites structuredContent and every
// JSON text item:
//   - `verification_counts_basis` is dropped (omitted, not nulled — provenance
//     is z.looseObject({}).optional() in every declared outputSchema);
//   - a `method` that explains itself in SQL/table terms becomes PLAIN_METHOD;
//   - any other string carrying a token loses the parenthetical that holds it
//     ("… registry (discovered_facilities)" → "… registry"), and the bare
//     corpus value "discovered_facilities" reads "facilities".
// source, as_of, license, cite_as and the rest of the block are untouched.
//
// Fail-soft: anything unexpected returns the result unchanged.

export const PLAIN_METHOD = 'Records are de-duplicated. Corroboration is pending.';

// SQL fragments and table/column names that must not reach an agent. WHERE is
// matched only as SQL (upper-case, followed by a predicate), never as English.
export const SQL_TOKEN_RE = /COALESCE|is_duplicate|duplicate_of_id|canonical_slug|discovered_facilities|facilities_verified|[Ff]leet[ -]filter|fleet-verified|COUNT\s*\(\s*(?:DISTINCT\b|\*)|\bWHERE\s+[a-z_]+\s*(?:=|IS\b)|\bIS NULL\b/;

const BASIS_KEY = 'verification_counts_basis';
const TOKEN_G = new RegExp(SQL_TOKEN_RE.source, 'g');
// A parenthetical (one level of nesting allowed) — scanned for tokens.
const PAREN_RE = /\s*\((?:[^()]|\([^()]*\))*\)/g;
// A method string that defines the verification flags in filter terms.
const FLAG_DEF_RE = /\bverified\s*=|\btracked\s*=/;

function _needs(s) {
  return typeof s === 'string' && (SQL_TOKEN_RE.test(s) || s.includes(BASIS_KEY));
}

function _jsonish(s) {
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

/** One free-text string with tokens removed (same string when clean). */
export function plainString(s) {
  if (typeof s !== 'string' || !_needs(s)) return s;
  if (s === 'discovered_facilities') return 'facilities';
  // JSON embedded as a string (execute_plan step results): rewrite structurally.
  if (_jsonish(s)) {
    try { return JSON.stringify(_plainDeep(JSON.parse(s))); } catch (_) { /* not JSON */ }
  }
  let out = s.replace(/COUNT\s*\(\s*(?:DISTINCT\s+[a-z_]+|\*)\s*\)/g, 'count')
    .replace(PAREN_RE, (m) => (SQL_TOKEN_RE.test(m) ? '' : m));
  if (SQL_TOKEN_RE.test(out)) {
    out = out
      .replace(/COALESCE\s*\([^()]*\)\s*(?:=\s*\d+)?/g, '')
      .replace(/\bWHERE\s+[a-z_]+\s*(?:=\s*\S+|IS\s+(?:NOT\s+)?NULL)/g, '')
      .replace(/\b(?:the\s+)?(?:canonical\s+)?(?:dedup\s+)?[Ff]leet[ -]filter\b/g, 'de-duplication')
      .replace(/\bfleet-verified\b/g, 'de-duplicated')
      .replace(/\bdiscovered_facilities\b/g, 'facilities')
      .replace(/\bcanonical_slug\b/g, 'slug')
      .replace(TOKEN_G, '');
  }
  return out.replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ').replace(/[ \t]+([,;.])/g, '$1').replace(/[ \t]+$/, '');
}

function _plainDeep(v, key, depth = 0) {
  if (depth > 64) return v;
  if (typeof v === 'string') {
    if (key === 'method' && _needs(v)) return PLAIN_METHOD;
    if (key === 'method' && FLAG_DEF_RE.test(v) && /\bfleet\b|\bdedup/.test(v)) return PLAIN_METHOD;
    return plainString(v);
  }
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => _plainDeep(x, key, depth + 1));
  const out = {};
  for (const k of Object.keys(v)) {
    if (k === BASIS_KEY) continue;
    out[k] = _plainDeep(v[k], k, depth + 1);
  }
  return out;
}

function _triggers(s) {
  return SQL_TOKEN_RE.test(s) || s.includes(BASIS_KEY)
    || (s.includes('"method"') && FLAG_DEF_RE.test(s) && /\bfleet\b/.test(s));
}

/** A copy of `obj` with provenance made plain (same ref when nothing to do). */
export function plainProvenanceDeep(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  let s;
  try { s = JSON.stringify(obj); } catch (_) { return obj; }
  if (typeof s !== 'string' || !_triggers(s)) return obj;
  return _plainDeep(JSON.parse(s));
}

/** One text item's text made plain (same string when nothing to do). */
export function plainProvenanceText(text) {
  if (typeof text !== 'string' || !_triggers(text)) return text;
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { parsed = undefined; }
  if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
    const indent = /^[{[]\n(\s+)["{[]/.exec(text);
    return JSON.stringify(_plainDeep(parsed), null, indent ? indent[1].length : undefined);
  }
  // Free text (markdown, footers): drop any JSON-ish basis pair, then scrub.
  const cut = text.replace(/(,\s*)?\\?"verification_counts_basis\\?"\s*:\s*\\?"(?:[^"\\]|\\[^"])*\\?"(\s*,)?/g,
    (_m, lead, trail) => ((lead && trail) ? ',' : ''));
  return cut.split('\n').map((line) => plainString(line)).join('\n');
}

/** The tool result with SQL/table provenance text removed. */
export function plainProvenance(result) {
  try {
    if (!result || typeof result !== 'object') return result;
    let out = result;
    if (Array.isArray(result.content)) {
      let changed = false;
      const content = result.content.map((it) => {
        if (!it || it.type !== 'text' || typeof it.text !== 'string') return it;
        const t = plainProvenanceText(it.text);
        if (t === it.text) return it;
        changed = true;
        return { ...it, text: t };
      });
      if (changed) out = { ...out, content };
    }
    if (result.structuredContent && typeof result.structuredContent === 'object') {
      const sc = plainProvenanceDeep(result.structuredContent);
      if (sc !== result.structuredContent) out = { ...out, structuredContent: sc };
    }
    return out;
  } catch (_) {
    return result;
  }
}
