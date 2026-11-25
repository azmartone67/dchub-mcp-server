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

// ── The market's serving grid (QA 2026-11-24, Charlotte NC) ──────────────────────────────────────────────────────────
// Keyless execute_plan for Charlotte (SERC / Duke Energy) said "NC: 32 active generation requests located in the state
// (PJM queue rows)": NC is a `partial` PJM state (Dominion's north-east corner), so queueCoverageLine let the PJM count
// stand, and a Duke market read PJM's rows as its own. When the plan knows the grid serving the market it asked about
// (stampServingGrid, below), the state's queue rows are filtered to that grid; with none from it, the line says DC Hub
// has no queue data for that operator instead of borrowing another ISO's rows.
const RTOS = new Set(['ERCOT', 'PJM', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISO-NE']);

/**
 * The queue line for a state's rows read for a market on `grid`, or null when there is no grid, or an ISO grid with no
 * per-ISO breakdown (say the state line as before).
 *   { none: true, text }       no row from the serving grid (always so off an ISO/RTO: SERC, TVA, WECC ...);
 *   { n, mw, isos: [grid], others: [isos] }  the serving ISO's own rows (others: the ISOs left out).
 * byIso: queue_context.by_iso rows [{iso, active_projects, active_mw}].
 */
export function servingGridQueue(st, byIso, grid) {
  try {
    const g = normIso(grid);
    if (!g) return null;
    // Off an ISO/RTO no row can be the grid's own (DC Hub's queue table holds ISO queue files only), breakdown or not.
    if (!Array.isArray(byIso) && RTOS.has(g)) return null;
    const s = String(st || '').toUpperCase();
    const rows = (Array.isArray(byIso) ? byIso : []).filter(isObj);
    const mine = rows.filter((r) => normIso(r.iso) === g);
    const others = [...new Set(rows.map((r) => normIso(r.iso)).filter((i) => i && i !== g))];
    const n = mine.reduce((a, r) => a + (typeof r.active_projects === 'number' ? r.active_projects : 0), 0);
    if (RTOS.has(g) && n > 0) {
      const mw = mine.reduce((a, r) => a + (typeof r.active_mw === 'number' ? r.active_mw : 0), 0);
      return { n, mw: Math.round(mw * 10) / 10, isos: [g], others };
    }
    const c = nonIsoState(s);
    const who = !RTOS.has(g) && c && c.region === g ? `${g}: ${c.who}` : g;
    const held = others.length
      ? `; DC Hub's ${s || 'state'} queue rows are ${others.join(', ')} queue rows${c && c.partial ? `, from the part of ${s} that ${c.partial.join('/')} serves` : ''}, not this operator's queue`
      : '';
    return { none: true, text: `No interconnection-queue data for the operator serving this market (${who})${held}` };
  } catch (_e) { return null; }
}

const readObj = (v) => {
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return isObj(v) ? v : null;
};

/**
 * Stamp the serving grid of the ONE market a plan asked about onto its get_power_availability_timeline results
 * (queue_context.serving_grid), so every composer reading the step filters the state's rows to it. The grid is the
 * named market's DCPI card iso; without a card, the plan's constraint_iso when it is exactly one grid. A plan that names
 * no market (citySlug / named markets) is left alone. Returns the grid
 * stamped, or null (nothing changed). Never throws.
 */
export function stampServingGrid(executed, fullByEntry, { named = [], citySlug = null, constraintIso = [] } = {}) {
  try {
    if (!Array.isArray(executed)) return null;
    const names = (Array.isArray(named) ? named : []).filter(Boolean);
    if (names.length > 1) return null;
    const want = new Set([...names, citySlug].filter(Boolean).map((x) => String(x).toLowerCase()));
    // A state- or ISO-wide plan names no market: nothing to read the rows for.
    if (!want.size) return null;
    let grid = null;
    {
      for (const e of executed) {
        if (!e || e.tool !== 'get_market_dcpi_rank' || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
        const p = readObj((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
        if (!p || typeof p.iso !== 'string' || !p.iso.trim()) continue;
        const slugs = [p.market_slug, p._requested_slug, p._canonical_slug, e.args && e.args.market_slug]
          .filter(Boolean).map((x) => String(x).toLowerCase());
        if (!slugs.some((x) => want.has(x))) continue;
        grid = p.iso.trim();
        break;
      }
    }
    const ci = (Array.isArray(constraintIso) ? constraintIso : []).filter((x) => typeof x === 'string' && x.trim());
    if (!grid && ci.length === 1) grid = ci[0].trim();
    if (!grid) return null;
    let stamped = false;
    for (const e of executed) {
      if (!e || e.tool !== 'get_power_availability_timeline' || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
      for (const [get, set] of [[() => e.result, (v) => { e.result = v; }],
        [() => fullByEntry && fullByEntry.get && fullByEntry.get(e), (v) => { if (fullByEntry && fullByEntry.has(e)) fullByEntry.set(e, v); }]]) {
        const raw = get();
        const obj = readObj(raw);
        if (!obj || !isObj(obj.queue_context)) continue;
        const next = { ...obj, queue_context: { ...obj.queue_context, serving_grid: grid } };
        set(typeof raw === 'string' ? JSON.stringify(next) : next);
        stamped = true;
      }
    }
    return stamped ? grid : null;
  } catch (_e) { return null; }
}
