// mapledger-hint.mjs — execute_plan names where parcel zoning, flood and tax context come from for a site in
// Austin or Nashville (owner 2026-11-23: MapLedger goes in "work alongside DC Hub" on /ecosystem and llms.txt;
// this is the execute_plan side of the same entry, as lib/parcel-gps-hint.mjs and lib/daedalmap-wildfire-hint.mjs).
//
// DC Hub reads power, grid headroom and interconnection queues for a site. It holds no parcel zoning, flood zone or
// property tax record. MapLedger runs a remote MCP server (Streamable HTTP, no sign-in) that answers those from public
// records. When a plan that bound a place in MapLedger's coverage already carries a DC Hub power or grid read that
// returned data, the answer gains ONE next step naming it (MAPLEDGER_HINT).
//
// ROUTING ONLY. DC Hub never calls that server and never proxies it: this file holds no network code, and the hint is
// a sentence plus plain links.
//
// COVERAGE. MapLedger's llms.txt (read 2026-11-23, https://mapledger.app/llms.txt) says its MCP tools answer for any
// spot in Austin, Texas or Nashville (Davidson County), Tennessee. Denver, Chicago and Washington DC are map pages
// there, "not yet in the MCP tools", so they do not count. What gates the hint is a place in one of the two cities:
//   - a city or market slug the planner bound (austin-tx / nashville-tn, or a market slug austin / nashville);
//   - a site point inside the box below (the plan's own point, or the point a power step ran at).
// The boxes are coarse rectangles around Austin's city limits and Davidson County. A point near the edge may fall in
// the box but outside MapLedger's coverage; MapLedger then answers for itself. A state alone (TX, TN) does not count.
//
// Pure: no network, no server state. server.mjs calls mapledgerHint() after the plan ran.
// Kill switch: DCHUB_MAPLEDGER_HINT=0 removes the sentence and the field everywhere.

export const MAPLEDGER_NAME = 'MapLedger';
export const MAPLEDGER_MCP_URL = 'https://mapledger.app/mcp';
// MapLedger's docs link for this cross-link. utm_medium=referral (owner, 2026-11-24), matching /ecosystem and /llms.txt.
export const MAPLEDGER_DOCS_URL = 'https://mapledger.app/docs?utm_source=dchub&utm_medium=referral&utm_campaign=mcp_crosslink#agents';
export const MAPLEDGER_HINT = 'For parcel zoning, flood and tax context at this site, use MapLedger (https://mapledger.app/mcp; it covers Austin, TX and Nashville, TN). Agents call MapLedger directly; DC Hub does not proxy it.';

export const MAPLEDGER_CITIES = Object.freeze({
  austin: Object.freeze({ label: 'Austin, TX', slugs: ['austin-tx', 'austin'], box: { s: 30.07, n: 30.52, w: -97.94, e: -97.56 } }),
  nashville: Object.freeze({ label: 'Nashville (Davidson County), TN', slugs: ['nashville-tn', 'nashville'], box: { s: 35.96, n: 36.41, w: -87.06, e: -86.51 } }),
});

// The DC Hub reads that count as "a power or grid read" for the site. A step counts only when it came back with data
// (status 'executed'); a gated, failed, skipped or no-data step does not.
export const POWER_GRID_TOOLS = Object.freeze(new Set([
  'get_grid_data', 'get_grid_intelligence', 'compare_isos', 'get_energy_prices',
  'get_power_availability_timeline', 'get_power_pipeline', 'get_retirement_headroom',
  'get_hosting_capacity', 'get_interconnection_queue', 'get_refined_queue', 'get_infrastructure',
]));

export function mapledgerHintEnabled(env = process.env) {
  const v = String((env && env.DCHUB_MAPLEDGER_HINT) ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no');
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
const finite = (v) => v !== null && v !== '' && Number.isFinite(Number(v));
const latOf = (o) => Number(o.lat ?? o.latitude);
const lonOf = (o) => Number(o.lon ?? o.lng ?? o.longitude);
const pointOf = (o) => isObj(o) && finite(o.lat ?? o.latitude) && finite(o.lon ?? o.lng ?? o.longitude);

/** The city key whose box holds the point, or null. Pure. */
export function cityAtPoint(lat, lon) {
  for (const [k, c] of Object.entries(MAPLEDGER_CITIES)) {
    const b = c.box;
    if (lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e) return k;
  }
  return null;
}

const cityOfSlug = (s) => {
  if (!s) return null;
  for (const [k, c] of Object.entries(MAPLEDGER_CITIES)) if (c.slugs.includes(s)) return k;
  return null;
};

/** True when at least one executed step is a DC Hub power or grid read that returned data. Pure. */
export function hasPowerRead(executed) {
  try {
    return Array.isArray(executed) && executed.some((e) => isObj(e) && e.status === 'executed' && POWER_GRID_TOOLS.has(e.tool));
  } catch { return false; }
}

/**
 * The covered city the plan bound, as { city, kind, value }, or null. Reads, in order:
 *   signals.coords                         a site point
 *   an executed power step's args          a point the step actually ran at
 *   signals.__citySlug / market / __outlook.slug   a city or market the planner bound
 * A point outside both boxes wins over a slug: a site at a stated point is not "in Austin" because the text said so. Pure.
 */
export function coveredPlace({ signals, executed } = {}) {
  try {
    const s = isObj(signals) ? signals : {};
    let pt = pointOf(s.coords) ? s.coords : null;
    if (!pt && Array.isArray(executed)) {
      const e = executed.find((x) => isObj(x) && x.status === 'executed' && POWER_GRID_TOOLS.has(x.tool) && pointOf(x.args));
      if (e) pt = e.args;
    }
    if (pt) {
      const lat = latOf(pt), lon = lonOf(pt);
      const city = cityAtPoint(lat, lon);
      return city ? { city, kind: 'point', value: `${lat},${lon}` } : null;
    }
    for (const slug of [str(s.__citySlug), str(s.market), isObj(s.__outlook) ? str(s.__outlook.slug) : null]) {
      const city = cityOfSlug(slug);
      if (city) return { city, kind: 'market', value: slug };
    }
  } catch { /* never break a plan */ }
  return null;
}

/**
 * The next step for a finished plan, or null:
 *   { sentence, field: { kind, name, text, mcp_url, docs_url, city, location } }
 * Only when the plan bound a place in Austin or Nashville and already has a DC Hub power or grid read that returned
 * data. Pure.
 */
export function mapledgerHint({ signals, executed, env } = {}) {
  try {
    if (!mapledgerHintEnabled(env)) return null;
    if (!hasPowerRead(executed)) return null;
    const place = coveredPlace({ signals, executed });
    if (!place) return null;
    return {
      sentence: MAPLEDGER_HINT,
      field: { kind: 'parcel_zoning', name: MAPLEDGER_NAME, text: MAPLEDGER_HINT, mcp_url: MAPLEDGER_MCP_URL,
        docs_url: MAPLEDGER_DOCS_URL, city: MAPLEDGER_CITIES[place.city].label, location: { kind: place.kind, value: place.value } },
    };
  } catch { return null; }
}
