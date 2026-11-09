// lib/us-headroom-headline.mjs — the free, dated headline of a US grid_headroom plan (planner 5.18).
//
// A headroom question that names no ISO leads with get_grid_scoreboard. That scoreboard is the
// live fuel-mix ranking, greenest first and worldwide, so the one row a keyless run kept was a
// Norwegian or Brazilian zone, and the ISO the executor harvested for the deep reads was simply
// the greenest US one (SPP). Neither is an answer to "where is there power for a data center".
//
// The owner's 10-08 gate stays: every headroom number (excess power, constraint, time to power)
// is paid. What the scoreboard already gives everyone is each grid's DCPI BUILD rate: how many of
// the markets DC Hub tracks in that grid read BUILD, the index's power-availability verdict, dated
// by the DCPI run. This module ranks the US RTOs the queue tools accept by that rate, dates each
// row, says why each sits where it does, and scopes the step-1 result to them. It is a ranking by
// verdicts, never a megawatt figure, and every row says so.
//
// Pure functions, no I/O, never throw.

// The grids get_interconnection_queue / get_refined_queue accept, as the scoreboard names them.
export const US_QUEUE_RTOS = Object.freeze(['ERCOT', 'PJM', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISO-NE']);

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const RTO_KEYS = new Set(US_QUEUE_RTOS.map(norm));
const dated = (x) => (typeof x === 'string' && x.trim() && !Number.isNaN(Date.parse(x))) ? x : null;
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export const HEADLINE_BASIS = 'Ranked by DCPI BUILD rate: the share of the markets DC Hub tracks in each grid whose '
  + 'daily power-availability verdict is BUILD. A verdict count, not megawatts of headroom; per-ISO headroom, queue '
  + 'depth and time to power are the deep reads in the next steps.';

// scoreboard: a get_grid_scoreboard result (pre-slim). isoSet: the plan's ISO constraint, if any.
// Returns null when the scoreboard has no US RTO row to rank.
export function usHeadroomHeadline(scoreboard, isoSet = []) {
  try {
    const grids = scoreboard && Array.isArray(scoreboard.grids) ? scoreboard.grids : [];
    const only = new Set((Array.isArray(isoSet) ? isoSet : []).map(norm).filter(Boolean));
    const rows = [];
    const undated = [];
    for (const g of grids) {
      if (!g || !RTO_KEYS.has(norm(g.iso)) || (only.size && !only.has(norm(g.iso)))) continue;
      const d = (g.dcpi_detail && typeof g.dcpi_detail === 'object') ? g.dcpi_detail : {};
      const build = num(d.build_markets), total = num(d.total_markets), rate = num(d.build_rate_pct);
      const asOf = dated(d.as_of);
      if (rate == null || !total || !asOf) { undated.push(g.iso); continue; }
      rows.push({ iso: g.iso, build_rate_pct: rate, build_markets: build, total_markets: total, as_of: asOf });
    }
    if (!rows.length && !undated.length) return null;
    rows.sort((a, b) => (b.build_rate_pct - a.build_rate_pct)
      || ((b.build_markets || 0) - (a.build_markets || 0)) || (a.total_markets - b.total_markets));
    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.pick_reason = `${r.build_markets} of ${r.total_markets} tracked DCPI markets in ${r.iso} read BUILD `
        + `(${r.build_rate_pct}%), DCPI as of ${r.as_of}`
        + (i === 0 ? '; highest BUILD rate of the US grids ranked, so the deep reads use it' : '');
    });
    const asOfs = rows.map((r) => r.as_of).sort();
    return { rows, as_of: asOfs[0] || null, as_of_basis: 'oldest DCPI run among the ranked rows',
             ranked_by: HEADLINE_BASIS, ...(undated.length ? { not_ranked: undated,
               not_ranked_reason: 'no dated DCPI BUILD rate for these grids in this response' } : {}) };
  } catch (_e) {
    return null;
  }
}

// The step-1 result an agent sees: grids restricted to the ranked US RTOs in headline order,
// trimmed to as many rows as the slimmed result kept (at least one), plus the headline and its date.
export function scopeScoreboardToUs(result, full, headline) {
  if (!result || typeof result !== 'object' || !headline || !headline.rows.length) return result;
  const src = full && Array.isArray(full.grids) ? full.grids : (Array.isArray(result.grids) ? result.grids : []);
  const byIso = new Map(src.filter(Boolean).map((g) => [norm(g.iso), g]));
  const keep = Math.max(1, Array.isArray(result.grids) ? result.grids.length : 1);
  // Compact rows: the full scoreboard row repeats long definition text the slimmed step cut.
  const compact = (g) => {
    const d = g.dcpi_detail || {};
    return { iso: g.iso, region: g.region, country: g.country, demand_mw: g.demand_mw ?? null,
             demand_period: g.demand_period ?? null, renewable_share_pct: g.renewable_share_pct ?? null,
             mix_period: g.mix_period ?? null,
             dcpi_detail: { build_markets: d.build_markets ?? null, total_markets: d.total_markets ?? null,
                            build_rate_pct: d.build_rate_pct ?? null, as_of: d.as_of ?? null } };
  };
  const grids = headline.rows.map((r) => byIso.get(norm(r.iso))).filter(Boolean).slice(0, keep).map(compact);
  return { ...result, grids, as_of: headline.as_of, us_headroom_headline: headline,
           scope_note: 'Scoped by the planner to the US grids the queue tools read, for a US headroom question; '
             + 'the worldwide fuel-mix ranking is get_grid_scoreboard called directly.' };
}
