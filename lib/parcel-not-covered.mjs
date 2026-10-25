// analyze_parcel outside hosted parcel coverage (owner 2026-10-16).
//
// The backend's POST /api/v1/analyze-parcel answers a lat/lon point with no
// hosted parcel under it with a 404 (routes/interconnection_queues.py,
// api_analyze_parcel). Parcel boundaries are hosted county by county, so that
// 404 is the common answer (Phoenix, AZ today), and it was a dead end for the
// agent. In its place the tool now serves:
//   * status parcel_not_covered and one neutral line;
//   * the analyze_site PREVIEW at the point, built in server.mjs by the same
//     gate functions analyze_site's own preview uses for the caller's access
//     (keyless teaser, or the keyed Land & Power preview). Never the full
//     answer, and never a monthly free full run: nothing here asks the
//     /api/v1/mcp/lp-free-runs counter;
//   * the parcel coverage list from GET /api/v1/parcels/coverage (the
//     parcel_boundaries table itself; nothing hard-coded here).
// Everything else (a caller geometry, a bad coordinate, a 5xx, a transport
// error) keeps the earlier behaviour.
// Kill switch: DCHUB_PARCEL_FALLBACK=0 restores the 404 error byte for byte.

export const PARCEL_NOT_COVERED_STATUS = 'parcel_not_covered';
// 2026-10-25 (Grok #117020): a point inside a covered county that misses every
// polygon (a street, rail or water gap) is not "not covered". The backend 404
// says so with in_hosted_coverage + nearest_parcel (be#7837).
export const PARCEL_GAP_STATUS = 'no_parcel_at_point';
export const PARCEL_COVERAGE_PATH = '/api/v1/parcels/coverage';
export const PARCEL_NOT_COVERED_LINE = 'No hosted parcel boundary contains this point yet; parcel coverage is added '
  + 'market by market. site_preview scores the point itself, and parcel_coverage lists the counties with '
  + 'hosted parcels. To measure a boundary you already have, pass it as geometry.';

/**
 * The backend's nearest hosted parcel for a point that fell between parcels in a
 * covered county, or null. `body` is the 404 body.
 */
export function parcelGapFrom(body) {
  if (!body || typeof body !== 'object' || body.in_hosted_coverage !== true) return null;
  const n = body.nearest_parcel;
  if (!n || typeof n !== 'object') return null;
  const d = _num(n.distance_m);
  if (!Number.isFinite(d) || d < 0 || typeof n.county !== 'string' || !n.county.trim()) return null;
  return { county: n.county.trim(), state: typeof n.state === 'string' ? n.state.trim() : null,
           distance_m: Math.round(d * 10) / 10 };
}

export function parcelGapLine(gap) {
  const where = gap.county + ' County' + (gap.state ? ', ' + gap.state : '');
  return 'This point is inside hosted parcel coverage (' + where + ') but no parcel boundary contains it: '
    + 'it falls between parcels, usually a road, rail or water right-of-way. The nearest parcel is '
    + Math.max(1, Math.round(gap.distance_m)) + ' m away. Move the point onto the site, or pass the boundary as geometry. '
    + 'site_preview scores the point itself.';
}

export function parcelFallbackOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PARCEL_FALLBACK) || ''));
}

const _num = (v) => (typeof v === 'number' ? v
  : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN));

/**
 * True only for the backend's "no hosted parcel contains that point" 404 on a
 * point lookup with an in-range coordinate. `r` is callAPI's {withStatus:true}
 * envelope. A caller geometry never reaches the point lookup, so it never
 * matches; an out-of-range coordinate keeps the earlier error.
 */
export function isParcelNotCovered(r, args) {
  if (!r || r.http_status !== 404) return false;
  const a = (args && typeof args === 'object') ? args : {};
  if (a.geometry) return false;
  const lat = _num(a.lat), lon = _num(a.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  const b = r.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  return typeof b.coverage_url === 'string'
    || (typeof b.error === 'string' && /no hosted parcel/i.test(b.error));
}

// The coverage list, as the backend publishes it. A failed read says so; it is
// never replaced by a guess.
export function parcelCoverageBlock(r, asOf = new Date().toISOString()) {
  const src = 'https://dchub.cloud' + PARCEL_COVERAGE_PATH;
  const b = r && r.ok && r.body && typeof r.body === 'object' && !Array.isArray(r.body) ? r.body : null;
  if (!b || !Array.isArray(b.markets)) {
    return { available: false, reason: 'coverage list unavailable right now', source_url: src };
  }
  const markets = b.markets
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({ state: m.state ?? null, county: m.county ?? null,
                   parcels: Number.isFinite(Number(m.parcels)) ? Number(m.parcels) : null,
                   last_ingest: m.last_ingest ?? null, source: m.source ?? null }));
  return { available: true, markets, market_count: markets.length,
           total_parcels: Number.isFinite(Number(b.total_parcels)) ? Number(b.total_parcels) : null,
           source_url: src, as_of: asOf };
}

// Monetization fields that a gated analyze_site preview carries for its own
// wall. This answer is analyze_parcel's, it names no plan and no price, and it
// carries no checkout link, so they go (keys removed, not nulled).
const _DROP_KEYS = new Set(['required_plan', 'tier_required', '_required_tier', '_substation_required_tier',
  'upgrade_url', 'pricing_url', 'checkout_url', 'human_url', 'credits_url', 'signup_url',
  '_preview_note', '_gated', '_scores_in_pro', '_preview_only', 'free_full_runs', 'free_monthly_runs']);
const _PITCH = /\b(pro|starter|developer|enterprise|trial|plan|pricing|upgrade|checkout)\b|\$\s?\d|\/mo\b|human_url/i;
const _NEUTRAL_LOCKED = 'Locked in the preview.';
export function scrubPreviewForParcel(v, depth = 0) {
  if (depth > 8 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => scrubPreviewForParcel(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (_DROP_KEYS.has(k)) continue;
    // Free-text notes on a locked view pitch the wall that owns them; the
    // locked_fields / locked lists beside them already say what is withheld.
    if (typeof x === 'string' && /(^|_)note$/.test(k) && _PITCH.test(x)) { out[k] = _NEUTRAL_LOCKED; continue; }
    out[k] = scrubPreviewForParcel(x, depth + 1);
  }
  return out;
}

export function buildParcelNotCovered({ lat, lon, capacityMw, preview, coverage, gap = null }) {
  const point = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  const site = { lat: point.lat, lon: point.lon };
  if (Number.isFinite(_num(capacityMw)) && _num(capacityMw) > 0) site.capacity_mw = _num(capacityMw);
  return {
    _entity: 'parcel_analysis',
    ok: true,
    status: gap ? PARCEL_GAP_STATUS : PARCEL_NOT_COVERED_STATUS,
    parcel_found: false,
    in_hosted_coverage: !!gap,
    message: gap ? parcelGapLine(gap) : PARCEL_NOT_COVERED_LINE,
    point,
    ...(gap ? { nearest_parcel: gap } : {}),
    site_preview: (preview && preview.payload) || null,
    site_preview_basis: {
      tool: 'analyze_site',
      access: (preview && preview.access) || null,
      ...(preview && preview.reason ? { unavailable_reason: preview.reason } : {}),
      note: 'The analyze_site preview at this point, at your access level. No full site run was used.',
    },
    parcel_coverage: coverage,
    next_calls: [
      { tool: 'analyze_site', args: site, why: 'The site read at this point.' },
      { tool: 'analyze_parcel', args: { geometry: '<your GeoJSON Polygon/MultiPolygon>' },
        why: 'Measures any boundary you supply, inside or outside hosted coverage.' },
    ],
    data_basis: {
      parcel_lookup: gap
        ? 'DC Hub hosted county/state GIS parcel layer: this county is hosted, but no polygon contains this point'
        : 'DC Hub hosted county/state GIS parcel layer: no polygon contains this point',
      coverage_source: 'parcel_boundaries table, GET ' + PARCEL_COVERAGE_PATH,
    },
    _source: 'DC Hub — dchub.cloud',
  };
}
