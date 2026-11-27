// GDL 2026-11-26 item 1: a stale EIA-930 demand hour is never said as "live" or "Right now".
//
// EIA's API stopped answering on 2026-11-26 and the newest stored ERCOT and PJM demand hours were 2026-11-10, yet
// answers read "Right now: ERCOT demand: 54,223 MW (2026-11-10 17:00 MST ...)" and "live demand was 54,223 MW". This
// reads the demand hour from any shape a get_grid_data step carries (the full payload's freshness_sla layer and
// demand_period, or the preview taste headline) and says whether it is older than DEMAND_FRESH_HOURS, measured from
// the END of the hour. A stale read is replaced by one sentence naming its date; it never leads.
import { phoenixDay } from './cite-day.mjs';

export const DEMAND_FRESH_HOURS = 3;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HOUR_ONLY = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

// An EIA hour "2026-11-10T21" is the hour STARTING 21:00 UTC; any other stamp is read as given (no zone = UTC).
export function demandHourEndMs(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  if (HOUR_ONLY.test(s)) { const t = Date.parse(`${s}:00:00Z`); return Number.isFinite(t) ? t + 3600e3 : null; }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : null;
}

// The demand hour a step's payload states, from the most specific field present.
export function demandHourOf(p) {
  if (!isObj(p)) return null;
  const fs = isObj(p.freshness_sla) && isObj(p.freshness_sla.layers) && isObj(p.freshness_sla.layers.demand)
    ? p.freshness_sla.layers.demand : null;
  if (fs && typeof fs.as_of === 'string' && fs.as_of) return fs.as_of;
  if (typeof p.demand_period === 'string' && p.demand_period) return p.demand_period;
  const h = isObj(p.taste) && isObj(p.taste.headline) ? p.taste.headline : null;
  if (h && h.name === 'demand_mw') return (typeof h.window === 'string' && h.window) || (typeof h.as_of === 'string' && h.as_of) || null;
  return null;
}

/** { stale, hour, age_hours, day } for the step's demand hour; null when the payload states no demand hour. */
export function demandFreshness(p, now = Date.now()) {
  const hour = demandHourOf(p);
  const end = demandHourEndMs(hour);
  if (end == null) return null;
  const ageH = Math.max(0, (now - end) / 3600e3);
  return { stale: ageH > DEMAND_FRESH_HOURS, hour, age_hours: Math.round(ageH * 10) / 10, day: phoenixDay(hour) || hour.slice(0, 10) };
}

/** The one sentence a stale read becomes (not_established), e.g. for ERCOT on 2026-11-10. */
export function staleDemandSentence(iso, fr) {
  const g = String(iso || '').trim() || 'this grid';
  return `The latest EIA-930 demand reading for ${g} is ${fr.day}; it is not shown as a current load.`;
}
