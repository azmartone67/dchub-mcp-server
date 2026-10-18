// ── siting scope: keep a geography-named plan inside its geography ─────────
//
// Grok 2026-10-18, P0-1 / P0-2 (live probes, 2.12.37):
//   execute_plan("live land + power screen for ~100 MW in Phoenix") ran
//   get_retirement_headroom NATIONWIDE (Sherburne MN, Alamitos CA, Comanche CO) and
//   get_refined_queue with no geography (one La Paz AZ row labelled CAISO), and ran no
//   land / site step at all. Phoenix is WECC, not an RTO, so the executor's ISO injection
//   (RTO-only, on purpose: the Dallas→CAISO failure class) correctly stayed out and
//   nothing else narrowed the call. Neither tool takes a state argument.
//   find_sites({state:'TX', target_mw:100}) dropped target_mw at the schema, so
//   unapplied_constraints stayed [] and the answer read as if it had been screened to 100 MW.
//
// The rule here: when the intent resolved to one US state, rows a state-less tool hands back
// are cut to that state AFTER the call, and the step says what it dropped. A cut that leaves
// nothing is NOT "no such rows": these two tools return a preview slice, so the note says
// the slice held none and names the direct call that widens the read.
// Nothing is guessed: a row whose state cannot be read is dropped, not assumed in-state.

const US_STATE = /^[A-Z]{2}$/;

// tool -> the array key its rows live under, and the aggregate fields a state cut invalidates.
export const STATE_CUT_TOOLS = Object.freeze({
  get_retirement_headroom: { rows: 'data', totals: ['total_retiring_mw', '_total_available', '_data_total_in_pro'], count: 'count_returned' },
  get_refined_queue: { rows: 'results', totals: ['total_queued_mw', 'count_total_matching', '_results_total_in_pro'], count: 'count_returned' },
});

function _st(v) {
  const u = String(v == null ? '' : v).trim().toUpperCase();
  return US_STATE.test(u) ? u : null;
}

export function rowState(row) {
  if (!row || typeof row !== 'object') return null;
  const direct = _st(row.state) || _st(row.state_code) || _st(row.generator && row.generator.state)
    || _st(row.location && row.location.state) || _st(row.site && row.site.state);
  if (direct) return direct;
  for (const s of [row.county_state, row.queue_pressure && row.queue_pressure.county_state]) {
    const m = /,\s*([A-Za-z]{2})\s*$/.exec(String(s || ''));
    if (m && _st(m[1])) return _st(m[1]);
  }
  return null;
}

// Mutates nothing. Returns {result, scope}; scope is null when the tool is not state-cut or no
// state is known, so the caller can pass the original through untouched.
export function cutResultToState(tool, result, state) {
  const spec = STATE_CUT_TOOLS[tool];
  const want = _st(state);
  if (!spec || !want || !result || typeof result !== 'object' || Array.isArray(result)) return { result, scope: null };
  const rows = result[spec.rows];
  if (!Array.isArray(rows)) return { result, scope: null };
  const kept = rows.filter((r) => rowState(r) === want);
  const unreadable = rows.filter((r) => rowState(r) == null).length;
  const out = { ...result, [spec.rows]: kept };
  if (spec.count in out) out[spec.count] = kept.length;
  const unscoped = {};
  for (const k of spec.totals) {
    if (k in out) { unscoped[k] = out[k]; out[k] = null; }
  }
  const scope = {
    state: want,
    kept: kept.length,
    dropped_out_of_state: rows.length - kept.length - unreadable,
    dropped_state_unreadable: unreadable,
    unscoped_totals: unscoped,
    basis: `${tool} takes no state argument; rows were cut to ${want} after the call. Aggregate totals above cover the whole unscoped read and are withheld (null), not recomputed.`,
    ...(kept.length === 0 ? {
      note: `No ${want} rows in the ${rows.length}-row slice this tool returned. That is not proof there are none in ${want}: call ${tool} directly with a narrower region to read further.`,
    } : {}),
  };
  out.scope = scope;
  return { result: out, scope };
}

// ── land / site step for capacity intents ──────────────────────────────────
// Nouns only: "site a 50 MW data center" uses site as a VERB and is a capacity search, not a land one.
const LAND_SITE = /\b(land|parcels?|sites|siting|buildable|greenfield|site\s+(?:screen\w*|search\w*|selection|candidates?)|(?:a|an|the|this|that|each|best|good|which|any)\s+sites?)\b/i;

export function isLandSiteIntent(text) {
  return LAND_SITE.test(String(text || ''));
}

// Same shape as _capacityProcurementStep: returns a step (without its number) or null. find_sites
// needs a geography; with none resolved it would 400, so no step is better than a failing one.
export function landSiteStep(text, d, toolsAlready) {
  if (!isLandSiteIntent(text)) return null;
  if ((toolsAlready || []).includes('find_sites')) return null;
  const st = _st(d && (d.state || d.stateFromPlace));
  const hasPoint = !!(d && d.coords && Number.isFinite(d.coords.lat) && Number.isFinite(d.coords.lon));
  if (!st && !hasPoint) return null;
  return {
    tool: 'find_sites', depends_on: [], estimated_calls: 1,
    why: 'The land step: candidate SEARCH AREAS anchored on real substations in the named geography, each with measured gas and fiber distance. A search area is not a parcel or a listing; score any coordinate with analyze_site. Independent of the power reads: run in parallel.',
    args_hint: hasPoint
      ? { lat: d.coords.lat, lon: d.coords.lon, radius_km: d.radiusKm || 60 }
      : { state: st },
  };
}

// ── find_sites: honest about target_mw ─────────────────────────────────────
// find_sites screens substations on voltage, gas, fiber and moratorium. Size is not a screening
// input, and a caller who passed target_mw must not read the list as sized to it.
export function annotateFindSites(payload, args) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const out = { ...payload };
  const raw = args && (args.target_mw != null ? args.target_mw : args.capacity_mw);
  const mw = typeof raw === 'number' ? raw : (raw != null && raw !== '' ? Number(raw) : NaN);
  if (Number.isFinite(mw)) {
    const prior = Array.isArray(out.unapplied_constraints) ? out.unapplied_constraints : [];
    if (!prior.includes('target_mw')) out.unapplied_constraints = [...prior, 'target_mw'];
    out.target_mw_note = `target_mw=${mw} was NOT applied: find_sites ranks search areas by substation voltage, gas and fiber distance, not by deliverable MW. For headroom at a size use get_retirement_headroom or analyze_site capacity_mw.`;
    const w = 'target_mw was not applied; the set is not sized to it.';
    out.unapplied_constraints_warning = out.unapplied_constraints_warning
      ? `${out.unapplied_constraints_warning} ${w}` : w;
  }
  if (Array.isArray(out.candidates)) {
    out.candidates = out.candidates.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const a = c.anchor;
      if (a && typeof a.name === 'string' && /^UNKNOWN\d*$/i.test(a.name.trim())) {
        return { ...c, anchor: { ...a, name: null, name_note: 'upstream record has no name' } };
      }
      if (typeof c.name === 'string' && /^UNKNOWN\d*$/i.test(c.name.trim())) return { ...c, name: null };
      return c;
    });
  }
  return out;
}
