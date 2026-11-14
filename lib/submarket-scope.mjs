// ── submarket scope: keep a submarket-named plan's sample rows inside the submarket ──────────
//
// Grok live agent reviews 2026-11-13 (planner 5.25, item 2): "How much data center capacity is
// coming online in Ashburn?" came back with pipeline rows from Manassas, and the answer labelled
// them Ashburn. get_pipeline takes no market or city, and the market a row carries
// (northern-virginia) holds Ashburn and Manassas alike, so the row's market cannot tell them apart.
//
// The rule here, same shape as lib/siting-scope.mjs cutResultToState: when the intent names ONE
// city, rows a tool hands back are read against that city AFTER the call, and the step says what it
// did. A row is placed by, in order: its own city field; its coordinates against the city's
// centroid and radius (when the plan has them); its name naming the city, or naming another place
// the planner knows. A row placed elsewhere is cut and counted by place. A row that cannot be
// placed stays, marked submarket_match 'unverified', so the answer can say it may sit elsewhere in
// the wider market; it is never labelled as the city. Nothing is guessed.

export const SUBMARKET_CUT_TOOLS = Object.freeze({
  get_pipeline: { rows: ['projects', 'data', 'results'], totals: ['total', 'count_total'] },
  search_facilities: { rows: ['facilities', 'data', 'results'], totals: ['total', 'count_total', 'total_count'] },
});

const _norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const _esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function _km(a, b) {
  const r = (x) => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function _rowCity(row) {
  const v = row.city || (row.location && row.location.city) || (row.address && typeof row.address === 'object' && row.address.city);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function _rowPoint(row) {
  const lat = Number(row.lat ?? row.latitude ?? (row.location && row.location.lat));
  const lon = Number(row.lon ?? row.lng ?? row.longitude ?? (row.location && (row.location.lon ?? row.location.lng)));
  return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) ? { lat, lon } : null;
}

// 'in' | 'out' | 'unverified', and the place an 'out' row was read to.
export function placeRow(row, sub, otherPlaces = []) {
  if (!row || typeof row !== 'object') return { match: 'unverified' };
  const want = _norm(sub.city);
  const city = _rowCity(row);
  if (city) return _norm(city) === want ? { match: 'in' } : { match: 'out', place: city };
  const pt = _rowPoint(row);
  if (pt && Number.isFinite(sub.lat) && Number.isFinite(sub.lon) && Number.isFinite(sub.radius_km)) {
    return _km(pt, sub) <= sub.radius_km ? { match: 'in' } : { match: 'out', place: `${Math.round(_km(pt, sub))} km from ${sub.city}` };
  }
  const name = `${row.name || ''} ${row.title || ''} ${typeof row.address === 'string' ? row.address : ''}`;
  if (new RegExp('\\b' + _esc(sub.city) + '\\b', 'i').test(name)) return { match: 'in' };
  for (const p of otherPlaces) {
    if (!p || _norm(p) === want) continue;
    if (new RegExp('\\b' + _esc(p) + '\\b', 'i').test(name)) return { match: 'out', place: p };
  }
  return { match: 'unverified' };
}

// Mutates nothing. Returns {result, scope}; scope is null when the tool is not cut here, no city is
// named, or the result has no row array, so the caller passes the original through untouched.
export function cutRowsToSubmarket(tool, result, sub, otherPlaces = []) {
  const spec = SUBMARKET_CUT_TOOLS[tool];
  if (!spec || !sub || !sub.city || !result || typeof result !== 'object' || Array.isArray(result)) return { result, scope: null };
  const key = spec.rows.find((k) => Array.isArray(result[k]));
  if (!key) return { result, scope: null };
  const rows = result[key];
  const kept = [];
  const outside = new Map();
  let unverified = 0;
  for (const r of rows) {
    const p = placeRow(r, sub, otherPlaces);
    if (p.match === 'out') { outside.set(p.place, (outside.get(p.place) || 0) + 1); continue; }
    if (p.match === 'unverified') unverified += 1;
    kept.push(r && typeof r === 'object' ? { ...r, submarket_match: p.match } : r);
  }
  const dropped = rows.length - kept.length;
  const out = { ...result, [key]: kept };
  const unscoped = {};
  if (dropped > 0) {
    for (const k of spec.totals) {
      if (k in out && typeof out[k] === 'number') { unscoped[k] = out[k]; out[k] = null; }
    }
  }
  const scope = {
    submarket: sub.city,
    kept: kept.length,
    dropped_outside_submarket: dropped,
    ...(outside.size ? { outside_places: [...outside.entries()].slice(0, 8).map(([place, n]) => ({ place, rows: n })) } : {}),
    unverified,
    ...(Object.keys(unscoped).length ? { unscoped_totals: unscoped } : {}),
    basis: `Rows were read against ${sub.city} after the call (city field, then coordinates, then the row name). `
      + `${dropped} row(s) placed outside ${sub.city} were cut; never describe them as ${sub.city}.`
      + (unverified ? ` ${unverified} row(s) could not be placed and are marked submarket_match 'unverified': they may sit elsewhere in the wider market.` : ''),
    ...(kept.length === 0 ? {
      note: `No row in the ${rows.length}-row slice could be placed in ${sub.city}. That is not proof there is none: this tool returned a slice of a wider read.`,
    } : {}),
  };
  out.submarket_scope = scope;
  return { result: out, scope };
}
