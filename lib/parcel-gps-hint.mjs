// parcel-gps-hint.mjs — execute_plan names where the parcel polygon comes from for a European site
// (owner agreed 2026-11-18).
//
// DC Hub holds no cadastre outside the US: analyze_parcel reads hosted boundaries for a set of US
// counties only. Parcel GPS runs a remote MCP server that returns cadastral parcels for European
// countries. When a plan for a site in one of those countries already carries a DC Hub power or fiber
// read, the answer gains ONE next step naming it, in the owner's exact words (PARCEL_GPS_HINT).
//
// ROUTING ONLY. DC Hub never calls that server and never proxies it: this file holds no network code,
// and the hint is a sentence plus a plain link. The Works with registry (dchub-backend
// data/partners_works_with.json, row id parcel-gps) lists the same organisation with its coverage.
//
// COVERAGE. The countries below are the ones Parcel GPS's developer page lists for its cadastre
// (re-read 2026-11-18, https://www.parcelgps.com/en/developers). The United Kingdom is listed there
// for Scotland only and only in part, so a UK site earns the hint only when the question names
// Scotland or a Scottish city. A US site, a region with no site ("European markets") and a country
// outside the list never do.
//
// Pure: no network, no server state. server.mjs calls parcelGpsHint() after the plan ran.
// Kill switch: DCHUB_PARCEL_GPS_HINT=0 removes the sentence and the field everywhere.

export const PARCEL_GPS_NAME = 'Parcel GPS';
export const PARCEL_GPS_MCP_URL = 'https://mcp.parcelgps.com/mcp';
export const PARCEL_GPS_DOCS_URL = 'https://www.parcelgps.com/en/developers';
export const PARCEL_GPS_HINT = 'For the official parcel polygon and cadastral reference, use Parcel GPS (https://mcp.parcelgps.com/mcp).';

// ISO 3166-1 alpha-2 codes of the countries whose cadastre Parcel GPS lists.
export const PARCEL_GPS_COUNTRIES = Object.freeze(new Set([
  'ES', 'PT', 'FR', 'IT', 'DE', 'AT', 'PL', 'NL', 'BE', 'LU', 'CH', 'LI', 'CZ', 'SK', 'SI', 'HR',
  'BG', 'GR', 'CY', 'DK', 'SE', 'NO', 'FI', 'IS', 'EE', 'LV', 'LT', 'IE',
]));
// The UK counts only for a Scottish site (partial coverage there, none elsewhere in the UK).
const SCOTLAND_RE = /\b(scotland|scottish|edinburgh|glasgow|aberdeen|dundee|inverness)\b/i;

// The DC Hub reads that count as "a power or fiber read" for the site: grid, power, energy-price,
// transmission/substation and fiber tools. A step counts only when it came back with data
// (status 'executed'); a gated, failed, skipped or no-data step does not.
export const POWER_FIBER_TOOLS = Object.freeze(new Set([
  // power and grid
  'get_grid_data', 'get_grid_intelligence', 'get_grid_scoreboard', 'compare_isos', 'get_energy_prices',
  'get_power_availability_timeline', 'get_power_pipeline', 'get_renewable_energy', 'get_retirement_headroom',
  'get_hosting_capacity', 'get_interconnection_queue', 'get_refined_queue', 'get_infrastructure',
  'grid_transition_radar', 'get_global_power',
  // fiber
  'get_fiber_intel', 'get_fiber_readiness', 'get_metro_fiber', 'plan_fiber_leadin', 'get_peering_intel',
  'get_subsea_cables',
]));

export function parcelGpsHintEnabled(env = process.env) {
  const v = String((env && env.DCHUB_PARCEL_GPS_HINT) ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no');
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const iso2Of = (v) => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && /^[A-Za-z]{2}$/.test(s.trim()) ? s.trim().toUpperCase() : null;
};

/**
 * The ISO2 country of the European site the plan bound, or null. Reads, in order:
 *   geographyScope   the plan's country scope (lib/country-scope.mjs), its named countries
 *   outlook          the tracked DCPI market the planner bound (_planSignals __outlook), when it is a
 *                    market outside the US grids (its `iso` is not a US grid label: isNonUs decides)
 * A UK site counts only when the intent names Scotland or a Scottish city. Pure.
 */
export function europeanSiteCountry({ geographyScope, outlook, intent, isNonUsMarket } = {}) {
  try {
    const text = String(intent == null ? '' : intent).slice(0, 2000);
    const ok = (cc) => !!cc && (PARCEL_GPS_COUNTRIES.has(cc) || (cc === 'GB' && SCOTLAND_RE.test(text)));
    if (isObj(geographyScope) && Array.isArray(geographyScope.countries)) {
      for (const c of geographyScope.countries) {
        const cc = isObj(c) ? iso2Of(c.country) : null;
        if (ok(cc)) return cc;
      }
    }
    if (isObj(outlook) && typeof isNonUsMarket === 'function' && isNonUsMarket(outlook)) {
      const cc = iso2Of(outlook.state);
      if (ok(cc)) return cc;
    }
  } catch { /* never break a plan */ }
  return null;
}

/** True when at least one executed step is a DC Hub power or fiber read that returned data. Pure. */
export function hasPowerOrFiberRead(executed) {
  try {
    return Array.isArray(executed) && executed.some((e) => isObj(e) && e.status === 'executed'
      && POWER_FIBER_TOOLS.has(e.tool));
  } catch { return false; }
}

/**
 * The next step for a finished plan, or null:
 *   { sentence, field: { kind, name, text, mcp_url, docs_url, country } }
 * Only for a European site in the coverage list, and only when the plan already has a DC Hub power or
 * fiber read. Pure.
 */
export function parcelGpsHint({ geographyScope, outlook, intent, executed, isNonUsMarket, env } = {}) {
  try {
    if (!parcelGpsHintEnabled(env)) return null;
    if (!hasPowerOrFiberRead(executed)) return null;
    const country = europeanSiteCountry({ geographyScope, outlook, intent, isNonUsMarket });
    if (!country) return null;
    return {
      sentence: PARCEL_GPS_HINT,
      field: { kind: 'parcel_reference', name: PARCEL_GPS_NAME, text: PARCEL_GPS_HINT,
        mcp_url: PARCEL_GPS_MCP_URL, docs_url: PARCEL_GPS_DOCS_URL, country },
    };
  } catch { return null; }
}
