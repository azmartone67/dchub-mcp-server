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
const MIDNIGHT_UTC = /^\d{4}-\d{2}-\d{2}[T ]00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?$/;
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

// The day a human-readable answer line says for a data date (Grok head-to-head 2026-11-23, 17:40 Phoenix):
// evidence lines read "(DCPI, as of 2026-11-24)" off a UTC timestamp cut at character 10 while the headline said
// 2026-11-23. Any string that starts with a date goes through phoenixDay; a "YYYY-MM-DD HH:MM" stamp is read as its
// T form; a shape phoenixDay cannot read keeps its leading date, as before. Anything else -> null.
export function spokenDay(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  // Exactly midnight UTC (or no zone) is a date serialized as a timestamp (a queue report date "2026-10-31T00:00:00Z"),
  // not a reading taken at 17:00 Phoenix the day before: it keeps its own date.
  if (MIDNIGHT_UTC.test(s)) return s.slice(0, 10);
  return phoenixDay(s.replace(/^(\d{4}-\d{2}-\d{2}) (?=\d{2}:)/, '$1T')) || s.slice(0, 10);
}

/** True when v is exactly midnight UTC (or zoneless): a date serialized as a timestamp, not a reading's time. */
export function isMidnightUtc(v) {
  return typeof v === 'string' && MIDNIGHT_UTC.test(v.trim());
}

// The time a human-readable answer line says for a live reading (an LMP interval, an EIA demand hour): the America/Phoenix
// clock, labelled MST (Phoenix keeps no DST), never a raw UTC stamp. Grok head-to-head 2026-11-23 17:40 Phoenix read
// "interval ending 2026-11-24T03:50:17Z" and "(2026-11-24T02, DC Hub, as of 2026-11-24)" under a 2026-11-23 headline.
// "2026-11-24T03:50:17Z" -> "2026-11-23 20:50 MST"; "2026-11-24T02" (an EIA UTC hour) -> "2026-11-23 19:00 MST".
// A plain date or any other shape -> null (the caller keeps its own text).
export function spokenTime(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  const m = STAMP.exec(s);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3] || '00'}:${m[4] || '00'}${m[5] || 'Z'}`);
  if (!Number.isFinite(t)) return null;
  const x = new Date(t + PHX_OFFSET_MS).toISOString();
  return `${x.slice(0, 10)} ${x.slice(11, 16)} MST`;
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
