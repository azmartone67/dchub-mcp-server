// daedalmap-wildfire-hint.mjs — execute_plan names where wildfire events come from for a located site
// (owner approved 2026-11-19, list item "ECOSYSTEM HANDOFF: DaedalMap Wildfire Events").
//
// DC Hub reads hazard standing at a point (get_disaster_risk: FEMA NRI county ratings, Wildfire among them;
// get_climate_intel: USGS seismic + NOAA normals; get_facility_risk_delta: what changed). It holds no wildfire
// EVENT history. DaedalMap runs a remote MCP server for wildfire events and aggregates (its registry entry
// com.daedalmap/wildfires reads "Wildfire events and aggregates across global, U.S., and Canada sources";
// data 2015-2024). When a plan that bound a place already carries a DC Hub climate or hazard read that
// returned data, the answer gains ONE next step naming it, in the owner's exact words (DAEDALMAP_WILDFIRE_HINT).
//
// ROUTING ONLY. DC Hub never calls that server and never proxies it: this file holds no network code, and the
// hint is a sentence plus a plain link. Same shape as lib/parcel-gps-hint.mjs.
//
// COVERAGE. Global, U.S. and Canada, so no country filter. What gates the hint is a PLACE: a site point
// (lat/lon), a market or city the planner bound, a US state, or a named country. A bare region ("European
// markets") or no place at all does not count: a wildfire lookup needs a location.
//
// Pure: no network, no server state. server.mjs calls daedalmapWildfireHint() after the plan ran.
// Kill switch: DCHUB_DAEDALMAP_HINT=0 removes the sentence and the field everywhere.

export const DAEDALMAP_NAME = 'DaedalMap Wildfires';
// DaedalMap consolidated its MCP servers to ONE endpoint on 2026-11-19 (owner): every pack is served at
// https://app.daedalmap.com/mcp and an agent picks the pack by pack_id (get_catalog lists the packs and each
// pack's access). The per-pack URL this file first shipped with is retired.
export const DAEDALMAP_MCP_URL = 'https://app.daedalmap.com/mcp';
export const DAEDALMAP_PACK_ID = 'wildfires';
export const DAEDALMAP_SITE_URL = 'https://www.daedalmap.com';
export const DAEDALMAP_REGISTRY_NAME = 'com.daedalmap/wildfires';
export const DAEDALMAP_WILDFIRE_HINT = 'For wildfire events and aggregates at this location, use DaedalMap (https://app.daedalmap.com/mcp, pack_id wildfires; other hazard packs are on the same endpoint, and some, wildfires among them, need a DaedalMap account). Agents call DaedalMap directly; DC Hub does not proxy it.';

// The DC Hub reads that count as "a climate or hazard read" for the site. A step counts only when it came back
// with data (status 'executed'); a gated, failed, skipped or no-data step does not.
//   Out on purpose: get_water_risk (water stress and drought, not a fire hazard), get_composite_site_score and
//   analyze_site (blended verdicts; every planner class that runs them also runs get_disaster_risk at the point).
export const HAZARD_CLIMATE_TOOLS = Object.freeze(new Set([
  'get_climate_intel', 'get_disaster_risk', 'get_facility_risk_delta',
]));

export function daedalmapHintEnabled(env = process.env) {
  const v = String((env && env.DCHUB_DAEDALMAP_HINT) ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no');
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const finite = (v) => v !== null && v !== '' && Number.isFinite(Number(v));
const pointOf = (o) => isObj(o) && finite(o.lat ?? o.latitude) && finite(o.lon ?? o.lng ?? o.longitude);

/** True when at least one executed step is a DC Hub climate or hazard read that returned data. Pure. */
export function hasHazardRead(executed) {
  try {
    return Array.isArray(executed) && executed.some((e) => isObj(e) && e.status === 'executed'
      && HAZARD_CLIMATE_TOOLS.has(e.tool));
  } catch { return false; }
}

/**
 * The place the plan bound, as { kind, value }, or null. Reads, in order:
 *   signals.coords                 a site point (context lat/lon, coordinates in the text, a corridor point)
 *   an executed hazard step's args a point the step actually ran at
 *   signals.market / __outlook / __citySlug   a market or city the planner bound
 *   signals.state / stateFromPlace           a US state
 *   geographyScope.countries       a named country (lib/country-scope.mjs); regions alone do not count
 * Pure.
 */
export function boundLocation({ signals, geographyScope, executed } = {}) {
  try {
    const s = isObj(signals) ? signals : {};
    if (pointOf(s.coords)) return { kind: 'point', value: `${Number(s.coords.lat)},${Number(s.coords.lon)}` };
    if (Array.isArray(executed)) {
      for (const e of executed) {
        if (isObj(e) && e.status === 'executed' && HAZARD_CLIMATE_TOOLS.has(e.tool) && pointOf(e.args)) {
          return { kind: 'point', value: `${Number(e.args.lat ?? e.args.latitude)},${Number(e.args.lon ?? e.args.lng ?? e.args.longitude)}` };
        }
      }
    }
    const mk = str(s.market) || (isObj(s.__outlook) ? str(s.__outlook.slug) : null) || str(s.__citySlug);
    if (mk) return { kind: 'market', value: mk };
    const st = str(s.state) || str(s.stateFromPlace);
    if (st) return { kind: 'state', value: st.toUpperCase() };
    if (isObj(geographyScope) && Array.isArray(geographyScope.countries)) {
      for (const c of geographyScope.countries) {
        const cc = isObj(c) ? str(c.country) : null;
        if (cc) return { kind: 'country', value: cc.toUpperCase() };
      }
    }
  } catch { /* never break a plan */ }
  return null;
}

/**
 * The next step for a finished plan, or null:
 *   { sentence, field: { kind, name, text, mcp_url, pack_id, site_url, registry_name, location } }
 * Only when the plan bound a place and already has a DC Hub climate or hazard read that returned data. Pure.
 */
export function daedalmapWildfireHint({ signals, geographyScope, executed, env } = {}) {
  try {
    if (!daedalmapHintEnabled(env)) return null;
    if (!hasHazardRead(executed)) return null;
    const location = boundLocation({ signals, geographyScope, executed });
    if (!location) return null;
    return {
      sentence: DAEDALMAP_WILDFIRE_HINT,
      field: { kind: 'wildfire_events', name: DAEDALMAP_NAME, text: DAEDALMAP_WILDFIRE_HINT,
        mcp_url: DAEDALMAP_MCP_URL, pack_id: DAEDALMAP_PACK_ID, site_url: DAEDALMAP_SITE_URL,
        registry_name: DAEDALMAP_REGISTRY_NAME, location },
    };
  } catch { return null; }
}
