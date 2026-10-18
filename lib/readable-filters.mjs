// readable-filters.mjs: a filter on a field is applied only for a caller who can read
// that field.
//
// callAPI reaches the backend with the server's own credential, so the backend answers
// every MCP call at its full depth and this server's masks are what shape the answer for
// the real caller. A mask runs on the OUTPUT. A filter the caller supplies runs on the
// INPUT, before any mask, so it has to follow the same rule: capacity and facility-tier
// filters on search_facilities are forwarded only when the answer would carry those fields.
//
// Pure: no I/O. server.mjs decides `canRead` (paid depth, a live pack balance, or a
// payment on this call) and calls stripUnreadableFilters before the handler runs.

// tool -> the params that filter on a field only paid-depth callers read
export const READ_GATED_FILTERS = {
  search_facilities: ['min_capacity_mw', 'max_capacity_mw', 'tier'],
  // rank_markets rows carry total_mw only at paid depth; the floor filters on it (measured 2026-10-18:
  // anonymous floor 5000 took 3 rows to 1 with total_mw null).
  rank_markets: ['min_capacity_mw'],
};

const present = (v) => {
  if (v === undefined || v === null || v === '' || v === false) return false;
  const n = Number(v);
  return Number.isFinite(n) ? n !== 0 : true;     // 0 is the no-op the backend treats as "unset"
};

/** True when `params` carries any filter this tool gates (cheap: no I/O, decides if a lookup is needed). */
export function hasReadGatedFilter(tool, params) {
  const keys = READ_GATED_FILTERS[tool];
  if (!keys || !params || typeof params !== 'object') return false;
  return keys.some((k) => present(params[k]));
}

/**
 * -> { params, ignored }. `params` is a NEW object (the input is never mutated) without
 * the gated filters when `canRead` is false; `ignored` names the ones that were dropped.
 * A caller who can read the field gets their params back untouched.
 */
export function stripUnreadableFilters(tool, params, canRead) {
  const keys = READ_GATED_FILTERS[tool];
  if (canRead === true || !keys || !params || typeof params !== 'object') return { params, ignored: [] };
  const out = { ...params };
  const ignored = [];
  for (const k of keys) {
    if (k in out) {
      if (present(out[k])) ignored.push(k);
      delete out[k];
    }
  }
  return { params: out, ignored };
}

/**
 * Same rule, applied IN PLACE to the original args object (the tier gate and several
 * branches call handler(args) directly, so the original must carry the decision, the
 * way the cohort tag is normalised once at the top of the wrapper). -> the names ignored.
 */
export function dropUnreadableFilters(tool, args, canRead) {
  const r = stripUnreadableFilters(tool, args, canRead);
  if (!r.ignored.length) return [];
  for (const k of READ_GATED_FILTERS[tool]) delete args[k];
  return r.ignored;
}
