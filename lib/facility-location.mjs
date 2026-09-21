// lib/facility-location.mjs — HOW a facility's location is coarsened for a
// caller who is not entitled to see exactly where it is.
//
// POLICY (owner-approved 2026-09-21): exact facility location — precise
// coordinates and a street address — is for the top paying tiers. Every other
// caller gets coordinates rounded to 2 decimal places (~1.1 km) and no street
// address. WHO is entitled is decided in server.mjs (gateFacilityLocation and
// the per-call exceptions next to it); this module only knows HOW to coarsen,
// so it can be tested without booting the server.
//
// WHY THE MCP SERVER NEEDS ITS OWN GATE: callAPI authenticates to the backend
// with X-Internal-Key, which the backend treats as a privileged caller, so the
// backend returns full records whatever tier the agent is on. The backend's
// own coordinate ladder never runs for MCP traffic; what this server forwards
// is what the agent gets.
//
// CONVENTIONS mirrored from the backend's facility gate, so an agent reading
// either surface reads the same thing:
//   * coordinate keys: latitude/lat, longitude/longitude_deg/lon/lng, plus
//     prefixed variants such as center_lat;
//   * a record whose coordinates were actually changed carries
//     coordinates_status: "approximate_2dp". Stamped only when a value moved,
//     so a record that was already coarse is never mislabelled;
//   * fail CLOSED: any exception strips coordinates instead of passing them.
//
// TWO SCOPES, because facilities reach callers in two shapes:
//   'record' — the whole payload describes facilities (get_facility,
//              search_facilities). Every coordinate anywhere in it is rounded,
//              including nested peers such as `nearby`.
//   'detect' — facility rows are embedded among other rows (a site read that
//              lists nearby facilities next to substations). Only objects that
//              look like facility records, or that sit under a facility
//              container key, are coarsened; open-infrastructure rows keep their
//              coordinates. A coordinate copied OUT of a coarsened facility into
//              another object (a pre-built follow-up call, an echo) is rounded
//              too, by exact value match.
//
// THE ONE PER-FACILITY OVERRIDE: `exactAllowed(record)` is asked for every
// facility record before it is coarsened. It is where a future per-facility
// entitlement plugs in (e.g. a monthly allowance of exact locations); returning
// true leaves that record, and only that record, exact. A hook that throws is
// treated as "not allowed".

export const LOCATION_COORD_DP = 2;
export const COORDS_APPROX_STATUS = `approximate_${LOCATION_COORD_DP}dp`;
export const SCOPE_RECORD = 'record';
export const SCOPE_DETECT = 'detect';

const MAX_DEPTH = 64;
const FACTOR = 10 ** LOCATION_COORD_DP;

// ── key vocabularies ────────────────────────────────────────────────────────
// Every test runs on the NORMALIZED key (camelCase → snake_case, lower-case),
// so `centerLat`, `addressLine1`, `postalCode` and `rawData` match the same
// rules as their snake_case spellings.
const normKey = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// A single coordinate. `(?:.*_)?` admits prefixed forms (center_lat,
// site_longitude) without matching words that merely end in the letters
// ("flat", "salon"): the prefix must end in an underscore.
const COORD_KEY_RE = /^(?:.*_)?(?:lat|lng|lon|latitude|longitude)(?:_?deg(?:rees)?)?$/;
// Containers whose VALUE is coordinates: GeoJSON `coordinates`, [lat,lng] pairs.
const COORD_ARRAY_KEY_RE = /^(?:coordinates|coords?|lat_?lngs?|lng_?lats?|lon_?lats?|lat_?lons?|centroid|center|point|position|bbox|geo_?point)$/;
// Street-address fields.
const ADDRESS_KEY_RE = /^(?:addr|address[a-z0-9_]*|street(?:_(?:address|name|number|line_?\d*))?|house_(?:number|no)|full_address|formatted_address|mailing_address|physical_address|site_address|facility_address|postal(?:_code)?|post_?code|zip(?:_?code)?|zip4)$/;
// Raw upstream blobs — an unparsed copy of the source row, which carries
// whatever the source had, address and coordinates included.
const RAW_KEY_RE = /^_?raw(?:_[a-z0-9_]*)?$|_raw$/;
// Encodings of a point that cannot be rounded in place: drop them.
const OPAQUE_GEO_KEY_RE = /^(?:geom|the_geom|geom_(?:wkb|wkt|geojson|text)|wkb|wkt|geo_?hash|plus_code|open_location_code|what3words|w3w|h3(?:_index|_cell)?|s2(?:_cell)?(?:_id)?|(?:[a-z]+_)?maps?_(?:url|link|href)|[a-z]maps(?:_url)?|street_view_url)$/;
// Keys that hold GeoJSON when they are objects, and WKT/WKB when strings.
const GEOMETRY_KEY_RE = /^(?:geometry|geojson)$/;
// Free-text location lines. City-level text ("<city>, <state>") is kept; a line
// carrying a digit is a street number, a postcode or a coordinate, so it goes.
const LOCATION_TEXT_KEY_RE = /^(?:.*_)?location$/;

// A coordinate whose NAME says it belongs to a facility, wherever it sits:
// the site report puts the nearest carrier hotel's point on the fiber block as
// flat `latency_target_lat` / `latency_target_lng`, outside any record.
const FACILITY_COORD_KEY_RE = /^(?:.*_)?(?:facility|dc|data_center|datacenter|colo|colocation|carrier_hotel|latency_target|target_facility|nearest_facility)_(?:lat|lng|lon|latitude|longitude)$/;

const isCoordKey = (k) => COORD_KEY_RE.test(normKey(k));
const isFacilityCoordKey = (k) => FACILITY_COORD_KEY_RE.test(normKey(k));
const isCoordArrayKey = (k) => COORD_ARRAY_KEY_RE.test(normKey(k));
const isAddrKey = (k) => ADDRESS_KEY_RE.test(normKey(k));
const isRawKey = (k) => RAW_KEY_RE.test(normKey(k));
const isOpaqueGeoKey = (k) => OPAQUE_GEO_KEY_RE.test(normKey(k));
const isGeometryKey = (k) => GEOMETRY_KEY_RE.test(normKey(k));
const isLocationTextKey = (k) => LOCATION_TEXT_KEY_RE.test(normKey(k));

// Keys that identify WHICH facility a record is — what the per-facility
// override needs, and what makes an object a record rather than a fragment.
const IDENTITY_KEYS = ['facility_id', 'id', 'slug', 'canonical_slug', 'dchub_id', 'name', 'facility_name'];

// Evidence that an object is a data-center facility record rather than a
// substation, a plant or a fiber route. Deliberately specific: an open-
// infrastructure row must never qualify by carrying a name and a latitude.
const FACILITY_MARKER_KEYS = new Set([
  'facility_id', 'facility_type', 'facility_name', 'dchub_id', 'dchub_facility_id',
  'canonical_slug', 'confidence_badge', 'fiber_carrier_count', 'fiber_providers',
  'on_net', 'colocation', 'white_space_sqft', 'floor_space_sqft', 'it_load_mw',
  'critical_it_mw', 'pue', 'tier_level', 'uptime_tier',
]);
const FACILITY_PROFILE_URL_RE = /\/facilit(?:y|ies)\//i;

// ── primitives ──────────────────────────────────────────────────────────────
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Round one coordinate value. Returns {value, changed, drop}. */
function roundCoordValue(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { value: v, changed: false };
    const r = Math.round(v * FACTOR) / FACTOR;
    return { value: r, changed: r !== v };
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return { value: v, changed: false };
    const n = Number(s);
    if (Number.isFinite(n)) {
      const r = Math.round(n * FACTOR) / FACTOR;
      return r === n ? { value: v, changed: false } : { value: String(r), changed: true };
    }
    // A coordinate we cannot parse ("39°02'N") cannot be rounded, so it is
    // withheld rather than passed through at whatever precision it carries.
    return { value: undefined, changed: true, drop: true };
  }
  return { value: v, changed: false };
}

export function isCoordinateKey(k) { return isCoordKey(k); }
export function isAddressKey(k) { return isAddrKey(k); }
export function isRawBlobKey(k) { return isRawKey(k); }

/** True when `o` carries evidence of being a data-center facility record. */
export function looksLikeFacilityRecord(o) {
  if (!isPlainObject(o)) return false;
  const hasIdentity = typeof o.name === 'string' || typeof o.facility_name === 'string'
    || o.facility_id !== undefined || typeof o.slug === 'string';
  if (!hasIdentity) return false;
  if (o._entity === 'facility') return true;
  for (const k of Object.keys(o)) if (FACILITY_MARKER_KEYS.has(k)) return true;
  if (typeof o.profile_url === 'string' && FACILITY_PROFILE_URL_RE.test(o.profile_url)) return true;
  // A provider/operator with a facility-scale power figure is a building; a
  // plant carries capacity_mw + fuel, a substation voltage.
  if ((o.provider !== undefined || o.operator !== undefined) && o.power_mw !== undefined
      && o.fuel === undefined && o.fuel_type === undefined && o.primary_fuel === undefined
      && o.voltage === undefined && o.voltage_kv === undefined && o.max_voltage === undefined) return true;
  return false;
}

function hasIdentity(o) {
  if (!isPlainObject(o)) return false;
  for (const k of IDENTITY_KEYS) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return true;
  return false;
}

// ── the walker ──────────────────────────────────────────────────────────────
/**
 * Coarsen facility location in `obj`. Returns a NEW structure (never mutates
 * the input) plus a tally. Throws on anything it cannot read — the public
 * wrapper catches that and fails closed.
 *
 * opts.scope            'record' | 'detect'
 * opts.containerKeys    Set of normalized (snake_case) keys whose value is
 *                       facility rows (detect scope)
 * opts.exactAllowed     (record) => boolean — the per-facility override
 */
function coarsen(obj, opts) {
  const scope = opts.scope === SCOPE_RECORD ? SCOPE_RECORD : SCOPE_DETECT;
  const containerKeys = opts.containerKeys instanceof Set ? opts.containerKeys : new Set();
  const exactAllowed = typeof opts.exactAllowed === 'function' ? opts.exactAllowed : null;
  const stats = { rounded: 0, removed: 0, records: 0 };
  // Exact values of every coordinate this pass coarsened, so a copy of one
  // outside a facility record (a follow-up call's parameters) can be caught.
  const coarsenedValues = new Set();
  const seen = new WeakSet();

  const allowedExact = (identity) => {
    if (!exactAllowed || !identity) return false;
    try { return exactAllowed(identity) === true; } catch (_) { return false; }
  };

  // Round the numbers inside a coordinate container ([lng, lat], rings, …).
  const roundArrayDeep = (arr, depth, ctx) => {
    if (depth > MAX_DEPTH) throw new Error('location gate: structure too deep');
    const out = [];
    let changed = false;
    for (let i = 0; i < arr.length; i += 1) {
      const v = arr[i];
      if (Array.isArray(v)) {
        const r = roundArrayDeep(v, depth + 1, ctx);
        out.push(r.value); changed = changed || r.changed;
      } else if (isPlainObject(v)) {
        out.push(visit(v, depth + 1, ctx));
      } else if (typeof v === 'number' || typeof v === 'string') {
        const r = roundCoordValue(v);
        if (r.drop) { changed = true; stats.removed += 1; continue; }
        if (r.changed) { changed = true; stats.rounded += 1; if (typeof v === 'number') coarsenedValues.add(v); }
        out.push(r.value);
      } else {
        out.push(v);
      }
    }
    return { value: out, changed };
  };

  // ctx.inFacility — we are inside a facility record's subtree
  // ctx.identity   — the nearest enclosing object that says WHICH facility
  // ctx.exact      — that facility was granted exact location by the override
  const visit = (node, depth, ctx) => {
    if (depth > MAX_DEPTH) throw new Error('location gate: structure too deep');
    if (Array.isArray(node)) {
      if (seen.has(node)) throw new Error('location gate: cycle');
      seen.add(node);
      const out = node.map((v) => visit(v, depth + 1, ctx));
      seen.delete(node);
      return out;
    }
    if (!isPlainObject(node)) return node;
    if (seen.has(node)) throw new Error('location gate: cycle');
    seen.add(node);

    let inFacility = ctx.inFacility;
    let identity = ctx.identity;
    let exact = ctx.exact;
    const own = hasIdentity(node);
    if (scope === SCOPE_RECORD) {
      inFacility = true;
    } else if (!inFacility && (ctx.facilityContainer || looksLikeFacilityRecord(node))) {
      inFacility = true;
    }
    if (inFacility && own) {
      // A record that names its own facility decides for itself — a peer in a
      // `nearby` list is a different building from the record it sits in.
      identity = node;
      exact = allowedExact(node);
    }

    const out = {};
    let coordsChanged = false;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (inFacility && !exact) {
        if (isAddrKey(k) || isRawKey(k) || isOpaqueGeoKey(k)) {
          if (v !== undefined && v !== null && v !== '') stats.removed += 1;
          continue;
        }
        if (isGeometryKey(k) && !isPlainObject(v) && !Array.isArray(v)) {
          if (v !== undefined && v !== null && v !== '') stats.removed += 1;
          continue;
        }
        if (isLocationTextKey(k) && typeof v === 'string' && /\d/.test(v)) {
          stats.removed += 1;
          continue;
        }
        if (isCoordKey(k) || isCoordArrayKey(k)) {
          if (Array.isArray(v)) {
            const r = roundArrayDeep(v, depth + 1, { inFacility, identity, exact, facilityContainer: false });
            out[k] = r.value; coordsChanged = coordsChanged || r.changed;
            continue;
          }
          if (typeof v === 'number' || typeof v === 'string') {
            const r = roundCoordValue(v);
            if (r.drop) { stats.removed += 1; coordsChanged = true; continue; }
            if (r.changed) {
              stats.rounded += 1; coordsChanged = true;
              if (typeof v === 'number') coarsenedValues.add(v);
            }
            out[k] = r.value;
            continue;
          }
          // objects fall through to the recursive visit below
        }
      } else if (!inFacility && (typeof v === 'number' || typeof v === 'string') && isFacilityCoordKey(k)) {
        // Outside any record, but the key itself names a facility's point.
        const r = roundCoordValue(v);
        if (r.drop) { stats.removed += 1; coordsChanged = true; continue; }
        if (r.changed) {
          stats.rounded += 1; coordsChanged = true;
          if (typeof v === 'number') coarsenedValues.add(v);
        }
        out[k] = r.value;
        continue;
      }
      if (v !== null && typeof v === 'object') {
        const childIsContainer = scope === SCOPE_DETECT && !inFacility
          && containerKeys.has(normKey(k));
        out[k] = visit(v, depth + 1, {
          inFacility, identity, exact,
          facilityContainer: childIsContainer,
        });
      } else {
        out[k] = v;
      }
    }
    if (coordsChanged) {
      out.coordinates_status = COORDS_APPROX_STATUS;
      stats.records += 1;
    }
    seen.delete(node);
    return out;
  };

  const value = visit(obj, 0, { inFacility: false, identity: null, exact: false, facilityContainer: false });
  return { value, stats, coarsenedValues };
}

// A coordinate copied out of a coarsened facility into another object keeps its
// full precision unless it is caught here: a handler that pre-builds a follow-up
// call (`site_evaluation_handoff` parameters) or echoes a point outside the
// record would otherwise carry the exact value past the record-level rounding.
// Rounds coordinate-keyed numbers whose exact value was coarsened in this pass.
// An open-infrastructure coordinate is only touched if it is bit-for-bit the
// same number as a facility's, i.e. it is that copy.
function roundCopies(node, values, depth, seen) {
  if (!values.size || node === null || typeof node !== 'object') return node;
  if (depth > MAX_DEPTH) throw new Error('location gate: structure too deep');
  if (seen.has(node)) throw new Error('location gate: cycle');
  seen.add(node);
  let out;
  if (Array.isArray(node)) {
    out = node.map((v) => roundCopies(v, values, depth + 1, seen));
  } else {
    out = {};
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'number' && values.has(v) && isCoordKey(k)) {
        out[k] = roundCoordValue(v).value;
      } else if (Array.isArray(v) && isCoordArrayKey(k)) {
        out[k] = v.map((x) => (typeof x === 'number' && values.has(x)) ? roundCoordValue(x).value
          : roundCopies(x, values, depth + 1, seen));
      } else {
        out[k] = roundCopies(v, values, depth + 1, seen);
      }
    }
  }
  seen.delete(node);
  return out;
}

// ── fail-closed fallback ────────────────────────────────────────────────────
// Used when the walker throws. Removes every coordinate, address, raw blob and
// point encoding it can find, at any depth, reading each key in its own try so
// a hostile getter costs only that key. Never throws: the worst case is an
// empty object. It must not re-enter the operation that just failed, so it
// PULLS keys one at a time instead of spreading or serializing the input.
export function stripLocationDeep(node, depth = 0, seen = new WeakSet()) {
  try {
    if (node === null || typeof node !== 'object') return node;
    if (depth > MAX_DEPTH) return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      const out = [];
      let n = 0;
      try { n = Math.min(Number(node.length) || 0, 100000); } catch (_) { n = 0; }
      for (let i = 0; i < n; i += 1) {
        let v;
        try { v = node[i]; } catch (_) { continue; }
        out.push(stripLocationDeep(v, depth + 1, seen));
      }
      return out;
    }
    let keys = [];
    try { keys = Object.keys(node); } catch (_) { return {}; }
    const out = {};
    for (const k of keys) {
      let drop = true;
      try {
        drop = isCoordKey(k) || isCoordArrayKey(k) || isAddrKey(k) || isRawKey(k)
          || isOpaqueGeoKey(k) || isGeometryKey(k) || isLocationTextKey(k);
      } catch (_) { drop = true; }
      if (drop) continue;
      let v;
      try { v = node[k]; } catch (_) { continue; }
      out[k] = stripLocationDeep(v, depth + 1, seen);
    }
    return out;
  } catch (_) {
    return null;
  }
}

/**
 * Coarsen facility location in any JSON-shaped value. Never throws.
 * Returns { value, changed, failed_closed }.
 */
export function coarsenFacilityLocation(obj, opts = {}) {
  try {
    const { value, stats, coarsenedValues } = coarsen(obj, opts || {});
    let v = value;
    if (coarsenedValues.size) v = roundCopies(v, coarsenedValues, 0, new WeakSet());
    const changed = stats.rounded > 0 || stats.removed > 0;
    return { value: v, changed, failed_closed: false, stats };
  } catch (_) {
    return { value: stripLocationDeep(obj), changed: true, failed_closed: true, stats: null };
  }
}

// ── tool-result wrapper ─────────────────────────────────────────────────────
// A tool result carries the same payload twice: as JSON in content[].text and
// as structuredContent. Both must be gated, or one channel serves what the
// other withholds. content[0].text is often JSON FOLLOWED BY an appended prose
// block, so the leading JSON value is split off, gated and re-joined.

/** Split `text` into its leading JSON value and the trailing remainder. */
export function splitLeadingJson(text) {
  const s = typeof text === 'string' ? text : '';
  const start = s.length - s.trimStart().length;
  const open = s[start];
  if (open !== '{' && open !== '[') return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return { head: s.slice(0, start), json: JSON.parse(s.slice(start, i + 1)), rest: s.slice(i + 1) };
        } catch (_) { return null; }
      }
    }
  }
  return null;
}

// Last resort for text that LOOKS like JSON but does not parse: round every
// coordinate-keyed number and null every address / raw value in place. Crude,
// but it runs only where the alternative is forwarding the text unread.
const TEXT_COORD_RE = /("(?:(?:[A-Za-z0-9]*_)?(?:lat|lng|lon|latitude|longitude|LAT|LNG|LON|LATITUDE|LONGITUDE)|[a-z][A-Za-z0-9]*(?:Lat|Lng|Lon|Latitude|Longitude))(?:_?deg(?:rees)?|Deg(?:rees)?)?"\s*:\s*"?)(-?\d+\.\d{3,})/g;
const TEXT_ADDRESS_RE = /("(?:addr|address[a-z0-9_]*|street(?:_?(?:address|name|number))?|full_?address|formatted_?address|postal(?:_?code)?|post_?code|zip(?:_?code)?|zipcode|_?raw(?:_?[a-z0-9_]*)?)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;
export function scrubLocationText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(TEXT_COORD_RE, (_m, pre, num) => pre + String(Math.round(Number(num) * FACTOR) / FACTOR))
    .replace(TEXT_ADDRESS_RE, (_m, pre) => pre + 'null');
}

/**
 * Gate every channel of an MCP tool result. Returns the SAME object when
 * nothing needed to change, so a caller can tell "nothing to gate" by identity.
 */
export function coarsenToolResultLocation(result, opts = {}) {
  try {
    if (!result || typeof result !== 'object') return result;
    let changed = false;
    let content = result.content;
    if (Array.isArray(content)) {
      const next = content.map((item) => {
        if (!item || item.type !== 'text' || typeof item.text !== 'string') return item;
        const split = splitLeadingJson(item.text);
        if (split) {
          if (split.json === null || typeof split.json !== 'object') return item;
          const g = coarsenFacilityLocation(split.json, opts);
          if (!g.changed) return item;
          changed = true;
          return { ...item, text: split.head + JSON.stringify(g.value) + split.rest };
        }
        const t = item.text.trimStart();
        if (t.startsWith('{') || t.startsWith('[')) {
          const scrubbed = scrubLocationText(item.text);
          if (scrubbed !== item.text) { changed = true; return { ...item, text: scrubbed }; }
        }
        return item;
      });
      if (changed) content = next;
    }
    let sc = result.structuredContent;
    let scChanged = false;
    if (sc && typeof sc === 'object') {
      const g = coarsenFacilityLocation(sc, opts);
      if (g.changed) { sc = g.value; scChanged = true; }
    }
    if (!changed && !scChanged) return result;
    const out = { ...result };
    if (changed) out.content = content;
    if (scChanged) out.structuredContent = sc;
    return out;
  } catch (_) {
    // Fail closed on the whole result: strip what can be stripped from both
    // channels rather than forwarding either unread.
    try {
      const out = {};
      for (const k of Object.keys(result)) {
        if (k === 'content' || k === 'structuredContent') continue;
        try { out[k] = result[k]; } catch (_e) { /* skip unreadable key */ }
      }
      out.content = [{ type: 'text', text: JSON.stringify({
        error: 'location_withheld',
        detail: 'Facility location could not be safely coarsened for your tier, so it was withheld.',
      }) }];
      let sc = null;
      try { sc = stripLocationDeep(result.structuredContent); } catch (_e) { sc = null; }
      out.structuredContent = (sc && typeof sc === 'object' && !Array.isArray(sc)) ? sc : { _entity: 'response' };
      return out;
    } catch (_e) {
      return { content: [{ type: 'text', text: '{"error":"location_withheld"}' }], structuredContent: { _entity: 'response' } };
    }
  }
}
