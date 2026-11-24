// state-queue-coverage.mjs -- which US states the ISO interconnection queues DC Hub reads actually cover, and how to say a
// state's queue count when they do not.
//
// WHY. The keyless head-to-head of 2026-11-23 (server 2.12.63) printed "GA: 0 active generation requests located in the
// state (DC Hub derived from ISO queues ...)" in three Georgia answers. Georgia is on no US ISO (Southern Company /
// Georgia Transmission run its interconnection), so the 0 is not a count of Georgia's queue: DC Hub simply holds no
// rows for it. A Phoenix answer said "AZ: 26 active generation requests located in the state (CAISO queue rows)",
// which reads as if Arizona were on CAISO: the rows are projects sited in Arizona that interconnect to CAISO, while
// Arizona's load is served by APS / SRP / TEP.
//
// WHAT. NON_ISO_STATES: the states whose load is served wholly (or, `partial`, mostly) outside the seven US ISO queues,
// with who runs interconnection there. queueCoverageLine(st, n, isos) returns the sentence to say in place of a bare
// count for such a state (or null for an ISO state, where the count stands):
//   * no rows:  "GA is outside ISO queue coverage (Southern Company / Georgia Transmission); DC Hub has no queue rows for it"
//   * rows from an ISO that does not serve the state's load: "26 active generation requests from the CAISO queue file
//     located in AZ (AZ load is served by APS / SRP / TEP, WECC, not by CAISO)".
// Pure; nothing here throws.

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

export const NON_ISO_STATES = Object.freeze({
  GA: { who: 'Southern Company / Georgia Transmission', region: 'SERC' },
  AL: { who: 'Southern Company / Alabama Power, TVA', region: 'SERC' },
  SC: { who: 'Duke Energy, Dominion Energy South Carolina, Santee Cooper', region: 'SERC' },
  NC: { who: 'Duke Energy', region: 'SERC', partial: ['PJM'] },
  FL: { who: 'FPL, Duke Energy Florida, TECO', region: 'SERC' },
  TN: { who: 'TVA', region: 'SERC' },
  MS: { who: 'Mississippi Power, TVA', region: 'SERC', partial: ['MISO'] },
  KY: { who: 'LG&E-KU, TVA', region: 'SERC', partial: ['PJM', 'MISO'] },
  AZ: { who: 'APS / SRP / TEP', region: 'WECC' },
  NV: { who: 'NV Energy', region: 'WECC' },
  UT: { who: 'Rocky Mountain Power', region: 'WECC' },
  ID: { who: 'Idaho Power, Rocky Mountain Power', region: 'WECC' },
  OR: { who: 'PGE / PacifiCorp, BPA', region: 'WECC' },
  WA: { who: 'Seattle City Light / PSE, BPA', region: 'WECC' },
  MT: { who: 'NorthWestern Energy', region: 'WECC' },
  CO: { who: 'Xcel Energy', region: 'WECC', partial: ['SPP'] },
  WY: { who: 'Rocky Mountain Power', region: 'WECC', partial: ['SPP'] },
  NM: { who: 'PNM, El Paso Electric', region: 'WECC', partial: ['SPP'] },
});

const normIso = (s) => { const u = String(s || '').toUpperCase().replace(/[^A-Z]/g, ''); return u === 'ISONE' ? 'ISO-NE' : u; };

/** The coverage entry for a non-ISO state, or null for a state on a US ISO (or an unknown code). */
export function nonIsoState(st) {
  const k = String(st || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(NON_ISO_STATES, k) ? NON_ISO_STATES[k] : null;
}

/**
 * The words for a non-ISO state's queue count, or null when the state is on a US ISO (say the count as before).
 * n: the row count (0 or more); isos: the ISO tags the rows came from.
 *   { zero: true, text } when DC Hub holds no rows;
 *   { foreign: [isos], text } when the rows come from ISOs that do not serve the state's load;
 *   null when the rows come from the ISO that serves part of the state (a `partial` state) -- the count stands.
 */
export function queueCoverageLine(st, n, isos) {
  try {
    const s = String(st || '').toUpperCase();
    const c = nonIsoState(s);
    if (!c) return null;
    const served = new Set((c.partial || []).map(normIso));
    if (!(typeof n === 'number' && n > 0)) {
      const text = c.partial
        ? `${s} is mostly outside ISO queue coverage (${c.who}; ${c.partial.join('/')} serves only part of the state); DC Hub has no queue rows located in ${s}`
        : `${s} is outside ISO queue coverage (${c.who}); DC Hub has no queue rows for it`;
      return { zero: true, text };
    }
    const tags = [...new Set((Array.isArray(isos) ? isos : []).map(normIso).filter(Boolean))];
    const foreign = tags.filter((i) => !served.has(i));
    if (tags.length && !foreign.length) return null;
    const src = foreign.length ? `the ${foreign.join(', ')} queue file${foreign.length === 1 ? '' : 's'}` : 'ISO queue files';
    return { foreign, src,
      text: `from ${src} located in ${s} (${s} load is served by ${c.who}, ${c.region}${foreign.length ? `, not by ${foreign.join(' or ')}` : ''}; their own queue is not in these rows)` };
  } catch (_e) { return null; }
}

/** The ISO tags a get_refined_queue result's rows came from (summary.by_iso, freshness_by_iso, row iso). */
export function refinedQueueIsos(p) {
  const out = new Set();
  if (!isObj(p)) return [];
  if (isObj(p.summary) && isObj(p.summary.by_iso)) for (const k of Object.keys(p.summary.by_iso)) out.add(normIso(k));
  if (isObj(p.freshness_by_iso)) for (const k of Object.keys(p.freshness_by_iso)) out.add(normIso(k));
  if (Array.isArray(p.results)) for (const r of p.results) if (isObj(r) && r.iso) out.add(normIso(r.iso));
  return [...out].filter(Boolean);
}
