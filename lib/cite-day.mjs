// The spoken citation date (Grok daily adoption loop 2026-11-23, item 1).
//
// The line an agent quotes says "as of YYYY-MM-DD", a date in America/Phoenix, never a time of day and
// never the UTC serve clock. Live answers had said "as of 2026-11-23T05:00:00.000Z" (a backend
// provenance cite_as passed through verbatim) and "(as of 2026-11-23T15:00Z)" (the hourly grid cite,
// G-1016-01). The hour is not lost: the machine-readable as_of fields beside the cite keep it.
//
// A plain date is a date: it is returned unchanged (no zone shift is invented for it). A timestamp is
// read as UTC when it states no zone, the backend's convention, and converted to its Phoenix calendar
// day. America/Phoenix keeps no DST, so it is a fixed UTC-7 (routes/press_facts.py says the same).
const PHX_OFFSET_MS = -7 * 3600e3;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

// "2026-11-23T05:00:00.000Z" -> "2026-11-22"; "2026-11-23" -> "2026-11-23"; anything else -> null.
export function phoenixDay(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  if (DATE_ONLY.test(s)) return s;
  const m = STAMP.exec(s);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:${m[3] || '00'}:${m[4] || '00'}${m[5] || 'Z'}`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + PHX_OFFSET_MS).toISOString().slice(0, 10) : null;
}

// Today's date in America/Phoenix (the serve-clock fallback, when a result states no data date).
export function phoenixToday(now = Date.now()) {
  return new Date(now + PHX_OFFSET_MS).toISOString().slice(0, 10);
}

// Every "as of <timestamp>" in a cite string becomes "as of <Phoenix day>"; a date-only cite is unchanged.
const AS_OF_STAMP = /\bas of (\d{4}-\d{2}-\d{2}T\d{2}(?::\d{2}(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?)/g;
export function citeDayText(s) {
  if (typeof s !== 'string' || !s.includes('as of ')) return s;
  return s.replace(AS_OF_STAMP, (all, stamp) => {
    const d = phoenixDay(stamp);
    return d ? `as of ${d}` : all;
  });
}

// Normalise every string under a `cite_as` key, at any depth (plan citations[], steps, facts), in a copy.
// Depth-capped; a value that needs no change keeps its identity.
export function citeDayDeep(v, depth = 0) {
  if (depth > 8 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => { const y = citeDayDeep(x, depth + 1); if (y !== x) changed = true; return y; });
    return changed ? out : v;
  }
  let out = null;
  for (const k of Object.keys(v)) {
    const x = v[k];
    const y = k === 'cite_as' ? citeDayText(x) : citeDayDeep(x, depth + 1);
    if (y !== x) { if (!out) out = { ...v }; out[k] = y; }
  }
  return out || v;
}
