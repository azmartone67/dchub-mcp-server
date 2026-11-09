// grid-ranking.mjs — planner 5.18: the first answer to a US grid-headroom question is a DATED
// ranking of US grids that says why each grid is where it is.
//
// Measured live 2026-11-09 08:22Z, anonymous, execute_plan "where in the US is there grid
// headroom for a 100 MW data center" (planner 5.17):
//   - step 1 get_grid_scoreboard ran, but its answer is the GLOBAL greenest-first fuel-mix
//     ranking (Norway first), not a headroom ranking, with provenance.as_of null;
//   - answer_guide opened "UNDATED — get_grid_scoreboard (step 1) returned no as_of ... Do not
//     present those steps' figures or verdicts as current", so the planner told the agent not to
//     use its own first step;
//   - the deep read (steps 2-3) went to SPP because SPP was the first whitelisted ISO the harvest
//     met in the scoreboard (its freshness.stale_mix_rows list), not because of any headroom
//     figure. Nothing in the envelope said why.
//
// This module is that join, done once and deterministically from the scoreboard step the caller's
// own tier received. RULES:
//   1. Rows are the scoreboard's US rows (country "US"). The ranking metric is the DCPI per-ISO
//      BUILD rate (build_markets / total_markets): the share of an ISO's DCPI-tracked markets that
//      DC Hub's Data Center Power Index rates BUILD. It is the one headroom-relevant figure the
//      scoreboard serves to every tier. A row with no DCPI aggregate (BPA) is listed in not_ranked
//      with the reason, never placed.
//   2. Each row's date is its DCPI aggregate's own as_of (the OLDEST market score in that ISO
//      aggregate, carried by the scoreboard as dcpi_detail.as_of). The ranking's as_of is the
//      oldest of those. A row with no date is still ranked but the ranking is then undated
//      (as_of null) and says how many rows lacked one: no date is invented.
//   3. A withheld number stays withheld. Rows tied on BUILD rate are ordered by the DCPI average
//      queue wait only when every tied row shows it; when the caller's tier withholds it
//      (dcpi_detail._locked_fields) the tie is reported as a tie and the reason names the
//      tie-break without its number.
//   4. This ranks ISOs. It does not say any MW is available at any site; how_to_read says so.
//
// PURE: no I/O, never throws (returns null).

const RTO_QUEUE_ISOS = new Set(['PJM', 'ERCOT', 'CAISO', 'MISO', 'SPP', 'NYISO', 'ISONE']);
// The intent names somewhere other than the US: a US ranking would answer another question.
// (A named non-US COUNTRY never reaches here: lib/country-scope.mjs drops the scoreboard step.)
const NON_US_REGION_RE = /\b(europe|european|eu|emea|apac|asia|asian|latam|latin america|south america|africa|middle east|canada|canadian|oceania)\b|(?<!new )\bmexico\b/i;

const RANKED_BY = 'dcpi_build_rate_pct: the share of the ISO\'s DCPI-tracked markets that DC Hub\'s Data Center '
  + 'Power Index rates BUILD (power available, grid not the binding constraint), highest first.';
const TIE_BREAK = 'dcpi_avg_queue_wait_months';
const SOURCE_NAME = 'DC Hub Data Center Power Index (DCPI), per-ISO aggregate';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dated = (x) => (typeof x === 'string' && x.trim() && !Number.isNaN(Date.parse(x)) ? x.trim() : null);
const normIso = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function parsed(full) {
  if (full && typeof full === 'object') return full;
  if (typeof full === 'string') { try { return JSON.parse(full); } catch (_e) { return null; } }
  return null;
}

// One scoreboard US row -> a rankable entry, or { iso, why } when it cannot be placed.
function readRow(g) {
  const iso = typeof g.iso === 'string' ? g.iso : null;
  if (!iso) return null;
  const d = g.dcpi_detail && typeof g.dcpi_detail === 'object' ? g.dcpi_detail : null;
  if (!d) {
    return { not_ranked: { iso, why: `No DCPI per-ISO aggregate for ${iso} on the scoreboard (a balancing authority outside the tracked ISOs, or the DCPI read failed this cycle); not placed rather than guessed.` } };
  }
  const locked = new Set(Array.isArray(d._locked_fields) ? d._locked_fields : []);
  const b = num(d.build_markets), m = num(d.total_markets);
  let rate = num(d.build_rate_pct);
  if (rate == null && b != null && m != null && m > 0) rate = Math.round((b / m) * 1000) / 10;
  if (rate == null || m == null || m <= 0 || locked.has('build_rate_pct')) {
    return { not_ranked: { iso, why: `The DCPI BUILD rate for ${iso} is not in this response (withheld at this tier or not measured); not placed rather than guessed.` } };
  }
  const qw = locked.has('avg_queue_wait_months') ? undefined : num(d.avg_queue_wait_months);
  return {
    iso, region: typeof g.region === 'string' ? g.region : iso,
    rate, build: b, markets: m,
    as_of: dated(d.as_of),
    // undefined = withheld for this caller, null = not measured, number = shown
    queue_wait: qw,
  };
}

/**
 * Rank the US rows of one get_grid_scoreboard payload. Exported for tests and for the planner's
 * deep-read mint (topQueueIso below).
 * -> { rows, not_ranked, ranked_count, us_rows_seen } (rows may be empty)
 */
export function rankUsGrids(scoreboard) {
  const sb = parsed(scoreboard) || {};
  const grids = Array.isArray(sb.grids) ? sb.grids : [];
  const entries = []; const notRanked = [];
  let seen = 0;
  for (const g of grids) {
    if (!g || typeof g !== 'object' || g.country !== 'US') continue;
    seen += 1;
    const r = readRow(g);
    if (!r) continue;
    if (r.not_ranked) { notRanked.push(r.not_ranked); continue; }
    entries.push(r);
  }
  entries.sort((a, b) => (b.rate - a.rate) || a.iso.localeCompare(b.iso));
  // Group by equal BUILD rate; inside a group the tie-break applies only when every member shows it.
  const rows = [];
  let i = 0; let rank = 1;
  while (i < entries.length) {
    let j = i;
    while (j < entries.length && entries[j].rate === entries[i].rate) j += 1;
    const group = entries.slice(i, j);
    const canBreak = group.length > 1 && group.every((x) => typeof x.queue_wait === 'number');
    const withheld = group.length > 1 && group.some((x) => x.queue_wait === undefined);
    if (canBreak) group.sort((a, b) => (a.queue_wait - b.queue_wait) || a.iso.localeCompare(b.iso));
    group.forEach((x, k) => {
      const myRank = canBreak ? rank + k : rank;
      const tied = (!canBreak && group.length > 1) ? group.filter((y) => y !== x).map((y) => y.iso) : [];
      rows.push(shapeRow(x, myRank, tied, canBreak, withheld));
    });
    rank += group.length;
    i = j;
  }
  return { rows, not_ranked: notRanked, ranked_count: rows.length, us_rows_seen: seen };
}

function shapeRow(x, rank, tied, broken, tieWithheld) {
  const text = `${x.build} of ${x.markets} DCPI-tracked markets in ${x.iso} rate BUILD (${x.rate}%)`;
  const reason = {
    metric: 'dcpi_build_rate_pct', value: x.rate, unit: '%',
    build_markets: x.build, tracked_markets: x.markets,
    text, iso: x.iso, source: SOURCE_NAME, as_of: x.as_of,
  };
  const row = { rank, iso: x.iso, region: x.region, reason };
  if (tied.length) {
    row.tied_with = tied;
    row.tie_break = tieWithheld
      ? { metric: TIE_BREAK, withheld: true, note: 'Rows tied on BUILD rate; the tie-break (DCPI average queue wait) is withheld at this tier, so they share a rank.' }
      : { metric: TIE_BREAK, value: null, note: 'Rows tied on BUILD rate; the DCPI average queue wait is not measured for every tied row, so they share a rank.' };
  } else if (broken) {
    row.tie_break = { metric: TIE_BREAK, value: x.queue_wait, unit: 'months', note: 'Tied on BUILD rate; ordered by DCPI average queue wait, shortest first.' };
  }
  return row;
}

/** The ISO the planner's deep read (get_grid_intelligence + get_interconnection_queue) should take:
 *  the best-ranked row the queue tools cover, inside the run's ISO constraint when it has one. */
export function topQueueIso(scoreboard, allowed = []) {
  try {
    const allow = (Array.isArray(allowed) ? allowed : []).map(normIso);
    const { rows } = rankUsGrids(scoreboard);
    for (const r of rows) {
      const k = normIso(r.iso);
      if (!RTO_QUEUE_ISOS.has(k)) continue;
      if (allow.length && !allow.includes(k)) continue;
      return k;
    }
  } catch (_e) { /* the harvest order stands */ }
  return null;
}

export function intentNamesNonUsRegion(intent) {
  return NON_US_REGION_RE.test(String(intent || '').slice(0, 1000));
}

/**
 * buildGridRanking(ctx, executed, fullByEntry) -> { block, evidence } | null
 * ctx: { intent, intent_class, geography_scope, deep_read_iso }
 * block: the envelope's grid_ranking. evidence: { entry, as_of, as_of_basis } for the scoreboard
 * step's power_evidence row, only when the ranking is dated; null otherwise.
 */
export function buildGridRanking(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'grid_headroom') return null;
    if (ctx.geography_scope) return null;
    if (intentNamesNonUsRegion(ctx.intent)) return null;
    const steps = Array.isArray(executed) ? executed : [];
    const entry = steps.find((e) => e && e.tool === 'get_grid_scoreboard'
      && (e.status === 'executed' || e.status === 'gated_preview'));
    if (!entry) return null;
    const sb = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(entry)) || entry.result);
    if (!sb) return null;
    const { rows, not_ranked: notRanked, us_rows_seen: seen } = rankUsGrids(sb);
    const undatedRows = rows.filter((r) => !r.reason.as_of).map((r) => r.iso);
    const dates = rows.map((r) => r.reason.as_of).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b));
    const asOf = rows.length && !undatedRows.length ? dates[0] : null;
    const asOfBasis = !rows.length
      ? 'UNMEASURED: no US grid could be ranked from this response.'
      : undatedRows.length
        ? `UNMEASURED: ${undatedRows.length} of ${rows.length} ranked grids carry no DCPI date (${undatedRows.join(', ')}), so the ranking has no date; do not present it as current.`
        : `Oldest per-row date among the ${rows.length} ranked US grids. Each row's date is the oldest market score inside that ISO's DCPI aggregate, so no figure here is older than this.`;
    const total = num(sb._grids_total_available) ?? num(sb._grids_total_in_pro);
    const shown = Array.isArray(sb.grids) ? sb.grids.length : 0;
    const trimmed = total != null && total > shown;
    const block = {
      scope: 'United States: the US grid operators on the DC Hub grid scoreboard (country US)',
      ranked_by: RANKED_BY,
      as_of: asOf,
      as_of_basis: asOfBasis,
      rows,
      ...(notRanked.length ? { not_ranked: notRanked } : {}),
      ...(trimmed ? { preview: { scoreboard_rows_shown: shown, scoreboard_rows_total: total, us_rows_shown: seen,
          note: 'The scoreboard step was a preview at this tier; only the rows it returned are ranked. A free key returns every row.' } } : {}),
      ...(ctx.deep_read_iso ? { deep_read: { iso: ctx.deep_read_iso,
          why: `Steps 2-3 read ${ctx.deep_read_iso}, the best-ranked grid the queue tools cover.` } } : {}),
      from_step: { step: entry.step, tool: entry.tool },
      how_to_read: [
        'This ranks grid operators (ISOs), not sites: it does not establish that any MW is available at a specific location. For a site, call analyze_site with its coordinates.',
        'reason.value is the DCPI BUILD rate for that ISO, reason.as_of its date. Quote both with the ISO.',
        'A row in not_ranked had no headroom figure in this response; do not place it yourself.',
        'tie_break.withheld means the number that would order tied rows is not in this tier\'s response; say the rows are tied.',
      ],
      source: asOf ? `DC Hub (dchub.cloud/dcpi), ${SOURCE_NAME}, as of ${asOf.slice(0, 10)}` : `DC Hub (dchub.cloud/dcpi), ${SOURCE_NAME}`,
    };
    return { block, evidence: asOf ? { entry, as_of: asOf, as_of_basis: `${asOfBasis} (grid_ranking; the scoreboard's other rows are not used by this answer)` } : null };
  } catch (_e) { return null; }
}

/** The answer_guide sentence for a DATED ranking; '' otherwise (the UNDATED sentence then stands). */
export function gridRankingGuideLine(block) {
  try {
    if (!block || !block.as_of || !Array.isArray(block.rows) || !block.rows.length) return '';
    const day = String(block.as_of).slice(0, 10);
    const parts = block.rows.map((r) => `${r.rank}. ${r.iso} ${r.reason.value}% (${r.reason.build_markets}/${r.reason.tracked_markets} markets BUILD)`);
    return `LEAD WITH THE US GRID RANKING — DCPI BUILD rate by ISO, as of ${day}: ${parts.join('; ')}. `
      + 'Name the metric and the date with each grid; this ranks ISOs, not sites, and is not a MW availability figure.';
  } catch (_e) { return ''; }
}
