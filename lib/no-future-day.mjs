// No answer date later than the America/Phoenix day (Grok daily MCP leadership 2026-11-27, cd1).
//
// At 17:41 Phoenix on 11-27 the cd1 lead read "Under construction in Northern Virginia (DC Hub pipeline, as of
// 2026-11-28)" while its cite_as said 2026-11-27: get_pipeline's as_of is the request time in UTC (its rows carry no
// date), and that stamp was cut at character 10. The DCPI fact as_of and an xd collected_at showed the same UTC day.
// A data date cannot be later than the day the answer is read on, so on the plan's way out every date-only as_of /
// collected_at, and every "as of YYYY-MM-DD" in a string, later than the Phoenix day becomes the Phoenix day.
// Full timestamps (they carry their zone) and every earlier date are left as they are. Depth-capped and copy-on-write:
// a value that needs no change keeps its identity. Pure; nothing here throws.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_KEYS = new Set(['as_of', 'collected_at']);
const AS_OF_DAY = /\b(as of|read on) (\d{4}-\d{2}-\d{2})(?![T\d])/g;

export function noFutureDayText(s, today) {
  if (typeof s !== 'string' || !today || (!s.includes('as of ') && !s.includes('read on '))) return s;
  return s.replace(AS_OF_DAY, (all, w, d) => (d > today ? `${w} ${today}` : all));
}

export function noFutureDayDeep(v, today, depth = 0) {
  if (!today || depth > 8 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => {
      const y = typeof x === 'string' ? noFutureDayText(x, today) : noFutureDayDeep(x, today, depth + 1);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : v;
  }
  let out = null;
  for (const k of Object.keys(v)) {
    const x = v[k];
    let y = x;
    if (typeof x === 'string') {
      y = DAY_KEYS.has(k) && DATE_ONLY.test(x) ? (x > today ? today : x) : noFutureDayText(x, today);
    } else {
      y = noFutureDayDeep(x, today, depth + 1);
    }
    if (y !== x) { if (!out) out = { ...v }; out[k] = y; }
  }
  return out || v;
}

// True when a step's only date is the moment DC Hub served it (Grok 2026-11-27 cd1: get_pipeline's as_of is
// last_updated, the request time, when its rows carry no date): the as_of stamp sits within 10 minutes of the
// citation's retrieved_at. Such a date is said "read on <day>", not "as of <day>". Zoneless stamps read as UTC.
const ms = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : null;
};
export function asOfIsReadTime(p) {
  if (!p || typeof p !== 'object') return false;
  const c = p.citation && typeof p.citation === 'object' ? p.citation : {};
  const pv = p.provenance && typeof p.provenance === 'object' ? p.provenance : {};
  const stamp = ms(p.as_of) ?? ms(p.last_updated) ?? ms(c.as_of);
  const served = ms(c.retrieved_at) ?? ms(pv.retrieved_at);
  return stamp != null && served != null && Math.abs(served - stamp) <= 10 * 60e3;
}
