// get_fiber_intel payload budget (QA sweep 2026-11-14, v2.12.52).
//
// Live: get_fiber_intel market=northern-virginia returned 500 GeoJSON routes (the
// backend's row ceiling) with 54,014 vertices, 1.54 MB in content[0] and the same
// again in structuredContent: a 3.1 MB tool result. That does not fit a model's
// context, so an agent asking "what fiber is in NoVA" got a payload it could not read.
//
// The tool's inputSchema is frozen (ChatGPT directory review), so no `limit` param can
// be added. The cut is made here, on the response, and only when it is over budget:
//   1. round coordinates to 4 decimals (about 11 m) and drop repeated vertices;
//   2. simplify each line (Douglas-Peucker, 0.001 degrees, about 100 m);
//   3. return the leading routes, in the backend's order, that fit the budget.
// Every step that ran is recorded in `payload_trim`, with the counts and how to get the
// rest. A response already under budget is returned with its geometry untouched.
//
// Source vintage: a route's `properties.as_of` (e.g. "2016" on the Zayo wayback KMZ
// segments) is when the carrier dataset was captured, not when DC Hub loaded it
// (`dchub_ingest_date`) and not a current survey. Each such route is labelled
// `as_of_kind: "source_vintage"` and the response carries a `source_vintage` count.

export const FIBER_PAYLOAD_MAX_BYTES = 120_000;
export const FIBER_COORD_DECIMALS = 4;
export const FIBER_SIMPLIFY_TOLERANCE_DEG = 0.001;
export const FIBER_ROUTES_API = 'https://dchub.cloud/api/v1/fiber/routes';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function _round(n, d) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function _roundLine(line, d) {
  if (!Array.isArray(line)) return line;
  const out = [];
  for (const pt of line) {
    if (!Array.isArray(pt)) { out.push(pt); continue; }
    const q = pt.map((n) => _round(n, d));
    const prev = out[out.length - 1];
    if (Array.isArray(prev) && prev[0] === q[0] && prev[1] === q[1]) continue;
    out.push(q);
  }
  return out;
}

function _perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + tc * dx), p[1] - (a[1] + tc * dy));
}

// Iterative Douglas-Peucker; endpoints are always kept.
export function simplifyLine(line, tol) {
  if (!Array.isArray(line) || line.length < 3) return line;
  if (!line.every((p) => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = 1; keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = _perpDist(line[i], line[s], line[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

function _mapGeometry(g, fn) {
  if (!isObj(g)) return g;
  if (g.type === 'LineString') return { ...g, coordinates: fn(g.coordinates) };
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    return { ...g, coordinates: g.coordinates.map(fn) };
  }
  return g;
}

function _countVertices(features) {
  let n = 0;
  for (const f of features) {
    const g = f && f.geometry;
    if (!isObj(g) || !Array.isArray(g.coordinates)) continue;
    if (g.type === 'LineString') n += g.coordinates.length;
    else if (g.type === 'MultiLineString') for (const l of g.coordinates) n += Array.isArray(l) ? l.length : 0;
  }
  return n;
}

const _bytes = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');

// Label per-route source vintages and count them. Additive; never removes a field.
function _labelVintage(features) {
  const counts = {};
  let labelled = 0;
  const out = features.map((f) => {
    if (!isObj(f) || !isObj(f.properties)) return f;
    const v = f.properties.as_of;
    const key = (v === null || v === undefined || v === '') ? 'unstated' : String(v);
    counts[key] = (counts[key] || 0) + 1;
    if (key === 'unstated' || f.properties.as_of_kind) return f;
    labelled += 1;
    return { ...f, properties: { ...f.properties, as_of_kind: 'source_vintage' } };
  });
  return { features: out, counts, labelled };
}

/**
 * Shape a /api/v1/fiber/routes answer for an MCP tool result.
 * Pure; returns the input untouched when it is not a FeatureCollection-like object.
 */
export function shapeFiberPayload(resp, opts = {}) {
  try {
    if (!isObj(resp) || !Array.isArray(resp.features)) return resp;
    const maxBytes = Number.isFinite(opts.maxBytes) ? opts.maxBytes : FIBER_PAYLOAD_MAX_BYTES;
    const received = resp.features.length;

    const v = _labelVintage(resp.features);
    let out = { ...resp, features: v.features };
    if (v.labelled > 0) {
      out.source_vintage = {
        by_as_of: v.counts,
        basis: `counted over the ${received} routes the backend returned for this query`,
        note: 'properties.as_of is the year the carrier dataset was captured (a source vintage, e.g. the 2016 Zayo '
          + 'wayback KMZ), not a current survey and not when DC Hub loaded the route (properties.dchub_ingest_date). '
          + 'Describe a 2016 route as the 2016 map of that route.',
      };
    }

    const originalBytes = _bytes(resp);
    if (originalBytes <= maxBytes) return out;

    const verticesIn = _countVertices(out.features);
    const steps = [];

    // 1. coordinate precision
    out = { ...out, features: out.features.map((f) => (isObj(f)
      ? { ...f, geometry: _mapGeometry(f.geometry, (l) => _roundLine(l, FIBER_COORD_DECIMALS)) } : f)) };
    steps.push(`coordinates rounded to ${FIBER_COORD_DECIMALS} decimals (about 11 m)`);

    // 2. line simplification
    if (_bytes(out) > maxBytes) {
      out = { ...out, features: out.features.map((f) => (isObj(f)
        ? { ...f, geometry: _mapGeometry(f.geometry, (l) => simplifyLine(l, FIBER_SIMPLIFY_TOLERANCE_DEG)) } : f)) };
      steps.push(`lines simplified (Douglas-Peucker, ${FIBER_SIMPLIFY_TOLERANCE_DEG} degrees, about 100 m)`);
    }

    // 3. keep the leading routes, in backend order, that fit
    let kept = out.features;
    if (_bytes(out) > maxBytes) {
      const base = _bytes({ ...out, features: [] });
      let used = base, n = 0;
      for (const f of out.features) {
        const b = _bytes(f) + 1;
        if (used + b > maxBytes && n > 0) break;
        used += b; n += 1;
      }
      kept = out.features.slice(0, n);
      steps.push(`first ${n} of ${received} routes returned, in the backend's order`);
    }
    out = { ...out, features: kept };

    const omitted = received - kept.length;
    // Which carriers the omitted routes belong to, so "who has fiber here" survives the cut.
    const byCarrier = {};
    for (const f of resp.features) {
      const c = isObj(f) && isObj(f.properties) && typeof f.properties.carrier === 'string' && f.properties.carrier.trim()
        ? f.properties.carrier.trim() : 'unstated';
      byCarrier[c] = (byCarrier[c] || 0) + 1;
    }
    const carrierRows = Object.entries(byCarrier).sort((a, b) => b[1] - a[1]);
    const market = typeof opts.market === 'string' && opts.market.trim() ? opts.market.trim() : null;
    const restUrl = FIBER_ROUTES_API + (market ? `?market=${encodeURIComponent(market)}&limit=500` : '?limit=500');
    out.payload_trim = {
      reason: `the full answer was ${originalBytes} bytes, over this tool's ${maxBytes}-byte budget for one result`,
      routes_received: received,
      routes_returned: kept.length,
      routes_omitted: omitted,
      vertices_received: verticesIn,
      vertices_returned: _countVertices(kept),
      routes_received_by_carrier: Object.fromEntries(carrierRows.slice(0, 20)),
      ...(carrierRows.length > 20 ? { routes_received_other_carriers: carrierRows.slice(20).reduce((n, r) => n + r[1], 0) } : {}),
      steps,
      how_to_get_more: (omitted > 0
        ? `${omitted} matched routes are not in this result. `
        : 'Every matched route is here, with simplified geometry. ')
        + 'Narrow the call with carrier= (e.g. "Zayo") or route_type= (metro, longhaul, dark, ix) to get the other '
        + `routes; full-resolution geometry for every route is at ${restUrl} with your API key.`,
    };
    if (resp._truncated === true) {
      out.payload_trim.backend_note = 'The backend also capped this query at its own row ceiling (see _truncated, '
        + '_note_truncated): `total` is that ceiling, not a count of matching routes.';
    }
    return out;
  } catch (_) {
    return resp;
  }
}
