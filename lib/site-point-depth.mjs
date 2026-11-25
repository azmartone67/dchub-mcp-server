// site-point-depth.mjs -- planner 5.50 (Grok daily note 2026-11-19, item 13): a site screen says the FEMA flood zone
// AT the point and how far the nearest transmission line is, not only county ratings and counts in a radius.
//
// WHY. "Screen a 100 MW site at 39.0438,-77.4874" answered flood with the county's FEMA National Risk Index rating
// ("a county rating, not the parcel's FEMA flood zone") and transmission with "N records within 10 km ... not a
// distance to the nearest line". Both point facts are public and cheap:
//   * FEMA's National Flood Hazard Layer answers a point query (layer 28, flood hazard zones) in ~0.3-0.6 s, and the
//     FIRM panel layer (3) dates the map the zone comes from.
//   * DC Hub's /api/v1/grid/transmission-proximity (public) places each EIA line at the HIFLD substation its from_sub
//     names and measures the distance to it (~76% of lines match a substation).
//
// WHAT.
//   * The NFHL zone at the point is read by the backend (dchub-backend util/flood_zone_point.py) and arrives on
//     get_disaster_risk as flood_zone_at_point: status measured | not_mapped | unavailable, never a guessed zone.
//   * nearestTransmission(payload): the transmission-proximity answer as { distance_km, voltage_kv, operator,
//     substation, ... } or a not-found / not-available status; `ehv` (same shape) when the backend sends nearest_ehv.
//   * floodZoneText / nearestLineText: the one-line wording the site screen uses.
// Nothing here throws.

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** The transmission-proximity payload as the nearest line, or a status. */
export function nearestTransmission(payload) {
  const p = isObj(payload) ? payload : null;
  const src = 'EIA transmission lines located at their HIFLD substation (DC Hub /api/v1/grid/transmission-proximity)';
  if (!p || p.available === false) {
    return { status: p && p.reason === 'outside_coverage' ? 'outside_coverage' : 'unavailable', source: src };
  }
  const n = isObj(p.nearest) ? p.nearest : null;
  if (!n || num(n.distance_km) == null) return { status: 'none_in_radius', source: src };
  // 2026-11-24 (be#9386): nearest_ehv is the nearest line at 230 kV or above, beside `nearest` (any voltage). Older
  // backends do not send it; the key is then absent and the object is what it was before.
  const e = isObj(p.nearest_ehv) && num(p.nearest_ehv.distance_km) != null && (num(p.nearest_ehv.voltage_kv) ?? 0) >= 230 ? p.nearest_ehv : null;
  const ehv = e ? { ehv: {
    distance_km: num(e.distance_km), voltage_kv: num(e.voltage_kv), operator: str(e.operator) || null,
    substation: str(e.from_sub) || null, to_substation: str(e.to_sub) || null, basis: str(p.nearest_ehv_basis) || null,
  } } : {};
  return {
    status: 'measured', distance_km: num(n.distance_km), voltage_kv: num(n.voltage_kv),
    operator: str(n.operator) || null, substation: str(n.from_sub) || null, to_substation: str(n.to_sub) || null,
    lines_in_radius: num(p.line_count), ehv_230kv_plus: num(p.ehv_230kv_plus), max_voltage_kv: num(p.max_voltage_kv),
    basis: 'distance to the substation the line\'s from_sub names; the line geometry itself is not held',
    source: src, ...ehv,
  };
}

const title = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** "FEMA flood zone X (area of minimal flood hazard) at the point, outside the ..." or null. */
export function floodZoneText(fz) {
  if (!isObj(fz)) return null;
  const panel = fz.firm_panel ? `FIRM panel ${fz.firm_panel}${fz.panel_effective_date ? `, effective ${fz.panel_effective_date}` : ''}` : '';
  if (fz.status === 'measured' && fz.zone) {
    const sub = fz.zone_subtype ? ` (${fz.zone_subtype.toLowerCase()})` : '';
    const sfha = fz.special_flood_hazard_area === true ? ', inside the Special Flood Hazard Area (1% annual chance)'
      : fz.special_flood_hazard_area === false ? ', outside the Special Flood Hazard Area' : '';
    return `FEMA flood zone ${fz.zone}${sub} at the point${sfha} (FEMA NFHL${panel ? `, ${panel}` : ''}).`;
  }
  if (fz.status === 'not_mapped') return 'FEMA flood zone at the point: none mapped (no NFHL digital flood map covers it; not the same as minimal hazard).';
  if (fz.status === 'unavailable') return `FEMA flood zone at the point: not available (${fz.reason || 'the NFHL query failed'}).`;
  return null;
}

/** "Nearest transmission line: 230 kV (Virginia Electric & Power Co), 1.3 km, ..." or null. */
export function nearestLineText(nt) {
  if (!isObj(nt)) return null;
  if (nt.status === 'measured') {
    const kv = nt.voltage_kv != null ? `${nt.voltage_kv % 1 ? nt.voltage_kv : nt.voltage_kv.toFixed(0)} kV` : 'voltage not filed';
    return `Nearest transmission line: ${kv}${nt.operator ? ` (${title(nt.operator)})` : ''}, ${nt.distance_km} km from the point`
      + `${nt.substation ? `, measured to its ${nt.substation} substation endpoint` : ''} (EIA/HIFLD).`;
  }
  if (nt.status === 'none_in_radius') return 'Nearest transmission line: none located within 25 km (EIA lines located by their substation).';
  if (nt.status === 'outside_coverage') return 'Nearest transmission line: outside DC Hub\'s US transmission coverage.';
  if (nt.status === 'unavailable') return 'Nearest transmission line: not available in this run.';
  return null;
}

export const NEAREST_LINE_RADIUS_KM = 25;
