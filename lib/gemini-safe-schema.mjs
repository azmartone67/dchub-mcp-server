// Gemini-safe tools/list schemas (Grok -> Brain, 2026-11-27, change 2).
//
// Measured live 2026-11-27 on /mcp (99 tools): 14 input properties carry no "type" (they are z.any() on the
// server so a caller may send "6" for 6, a comma string for an array, or a JSON string for an object), 7 carry
// an anyOf type union, and report_finding.args carries additionalProperties: {} plus propertyNames. Gemini's
// function-declaration subset (gemini-cli, Google ADK) wants a "type" on every property and does not take a
// union of bare types or propertyNames, and one bad tool can drop the whole server.
//
// This rewrites the ADVERTISED schema only. Validation stays zod's and stays lenient: a caller that sends a
// number where the list now says string, or a comma string where it says array, is still accepted.
//
// Kill switch: DCHUB_GEMINI_SAFE_SCHEMA=0 (or false/no/off) serves the schemas unchanged. Default on.
// /mcp/chatgpt is not touched: that catalog is frozen byte for byte (test/chatgpt-toolset-frozen.test.mjs);
// the caller passes skip=true for it.

export const GEMINI_SAFE_FLAG = 'DCHUB_GEMINI_SAFE_SCHEMA';

export function geminiSafeOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[GEMINI_SAFE_FLAG]) || '').trim());
}

const OBJ = Object.freeze({ type: 'object' });
const INT = Object.freeze({ type: 'integer' });
const STR = Object.freeze({ type: 'string' });
const ARR_OBJ = Object.freeze({ type: 'array', items: { type: 'object' } });
const ARR_STR = Object.freeze({ type: 'array', items: { type: 'string' } });

// tool -> property -> the type to advertise for a property that has none. Named one by one (not inferred), so
// a new untyped property shows up in test/gemini-safe-schema.test.mjs instead of getting a guessed type.
export const UNTYPED_TYPES = Object.freeze({
  execute_plan: { context: OBJ, max_steps: INT, max_fanout: INT, cohort: STR },
  analyze_parcel: { geometry: OBJ },
  rank_sites: { candidates: ARR_OBJ, constraints: OBJ, objectives: OBJ },
  plan_query: { context: OBJ },
  save_to_shortlist: { site: OBJ, objectives: OBJ },
  set_shortlist_alert: { notify: OBJ },
  compare_sites: { sites: ARR_OBJ },
  cluster_sites_by_latency: { candidate_ids: ARR_STR },
});

const COMBINATORS = ['type', 'anyOf', 'oneOf', 'allOf', '$ref', 'enum', 'const'];
const hasType = (s) => !!s && typeof s === 'object' && COMBINATORS.some((k) => Object.prototype.hasOwnProperty.call(s, k));

// anyOf of bare types -> one type. Preference: the structured type a caller should send (object, array), then
// string (a number id is also accepted as a string by the handlers), then whatever is first.
const PREF = ['object', 'array', 'string', 'integer', 'number', 'boolean'];
function collapseBareUnion(s) {
  if (!Array.isArray(s.anyOf) || !s.anyOf.length) return null;
  const types = [];
  for (const raw of s.anyOf) {
    if (!raw || typeof raw !== 'object') return null;
    const b = cleanNode(raw);   // a branch's own additionalProperties: {} / propertyNames go first
    const keys = Object.keys(b).filter((k) => k !== 'description');
    if (!keys.length || !keys.every((k) => k === 'type' || k === 'items')) return null;
    if (typeof b.type !== 'string') return null;
    types.push(b);
  }
  const pick = PREF.map((t) => types.find((b) => b.type === t)).find(Boolean) || types[0];
  const { anyOf: _drop, ...rest } = s;
  const out = { ...rest, type: pick.type };
  if (pick.type === 'array') out.items = pick.items && typeof pick.items === 'object' ? pick.items : { type: 'string' };
  return out;
}

function cleanNode(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return s;
  let out = collapseBareUnion(s) || { ...s };
  if (out.additionalProperties && typeof out.additionalProperties === 'object' && !Array.isArray(out.additionalProperties)
      && Object.keys(out.additionalProperties).length === 0) delete out.additionalProperties;
  if (Object.prototype.hasOwnProperty.call(out, 'propertyNames')) delete out.propertyNames;
  if (out.properties && typeof out.properties === 'object') {
    const props = {};
    for (const [k, v] of Object.entries(out.properties)) props[k] = cleanNode(v);
    out.properties = props;
  }
  if (out.items && typeof out.items === 'object' && !Array.isArray(out.items)) out.items = cleanNode(out.items);
  return out;
}

// The served inputSchema for one tool. Never throws; returns the input unchanged when off or skipped.
export function geminiSafeInputSchema(schema, toolName, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !geminiSafeOn(env) || !schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
    const out = cleanNode(schema);
    const table = UNTYPED_TYPES[toolName];
    if (table && out.properties) {
      for (const [k, t] of Object.entries(table)) {
        const p = out.properties[k];
        if (p && typeof p === 'object' && !hasType(p)) out.properties[k] = { ...JSON.parse(JSON.stringify(t)), ...p };
      }
    }
    return out;
  } catch (_) { return schema; }
}

// For tests and the live check: [tool, path] of every property still without a type, union or combinator.
export function untypedProperties(tools) {
  const found = [];
  const walk = (tn, path, s) => {
    if (!s || typeof s !== 'object') return;
    if (path && !hasType(s)) found.push([tn, path]);
    for (const [k, v] of Object.entries(s.properties || {})) walk(tn, `${path}.${k}`, v);
    if (s.items && typeof s.items === 'object' && !Array.isArray(s.items)) walk(tn, `${path}[]`, s.items);
  };
  for (const t of tools || []) walk(t && t.name, '', t && t.inputSchema);
  return found;
}
