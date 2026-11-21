// lib/headline-preview.mjs — the headline numbers before the wall (owner-approved relay 2026-11-20, builder B).
//
// GOAL. On the three most-walled tools (get_grid_intelligence, get_interconnection_queue, execute_plan), a keyless or
// trial-key caller who hits the wall still gets the HEADLINE numbers, each with its date and source. Only the detail
// rows stay withheld. Measured on main before this change (live keyless /mcp and the loopback harness):
//   * get_grid_intelligence: the taste already carries demand MW at its EIA hour, the fuel-mix share at its own hour,
//     the source and a dated cite_as. Left alone.
//   * get_interconnection_queue with iso=: the taste carries queued GW, the project count and the source; a
//     report-dated ISO (ERCOT) carries as_of. A live-feed ISO (PJM, MISO, ...) carries as_of null and nothing else
//     on the headline: the collection time sat only in the top-level last_refreshed. -> stampQueueCollected.
//   * get_interconnection_queue without iso (the all-ISO snapshot): the generic trim nulled the US total
//     (totals.queued_generation_gw), so the wall carried no headline at all. -> queueSnapshotTaste.
//   * execute_plan: fact_header (SOURCE / AS_OF / SUMMARY) and the dated facts already carry each step's headline;
//     the one undated fact is the live-feed queue figure, which reads the stamp above (lib/plan-step-facts.mjs).
// Never a number the backend did not send: every value is read from the response being trimmed. A live feed has no
// report date, so its figure keeps as_of null and says when DC Hub collected it (collected_at), the same wording
// execute_plan's answer_guide already uses ("collected <time>", never "as of").
//
// Behind DCHUB_WALL_IDENTITY_V2 (default OFF; on for 1 / true / yes / on). Flag off: nothing here runs, so the
// output is byte-identical to main. Never on /mcp/chatgpt, /mcp/core, a ChatGPT-identified client or an
// execute_plan step started on /mcp/chatgpt (server.mjs _headlinePreviewSeat decides; this module is pure: no ctx,
// no network). No price, plan name or allowance number in any string here. The identity line (builder A) goes after
// the headline; this module adds none.

// The same switch builder A's lib/wall-identity-v2.mjs reads (wallIdentityV2On), with the identical test.
export const HEADLINE_PREVIEW_FLAG = 'DCHUB_WALL_IDENTITY_V2';
export function headlinePreviewOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[HEADLINE_PREVIEW_FLAG]) || '').trim());
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => typeof v === 'string' && v.trim() !== '';
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export const COLLECTED_BASIS = 'live feed: the ISO publishes no report date for this figure, so as_of stays null; '
  + 'collected_at is when DC Hub last collected it. Quote it as "collected <date>", not "as of".';

// get_interconnection_queue with iso=: a taste headline with no as_of, on a row DC Hub collected from a live feed,
// gets that collection time. In place; returns true when it stamped. The taste's source and cite_as follow it.
export function stampQueueCollected(env, parsed) {
  try {
    if (!isObj(env) || !isObj(env.taste) || !isObj(env.taste.headline) || !isObj(parsed)) return false;
    const h = env.taste.headline;
    if (h.as_of != null || !num(h.value)) return false;
    const at = str(parsed.last_refreshed) ? parsed.last_refreshed
      : (parsed.source_as_of_basis === 'live_feed_fetch_date' && str(parsed.source_as_of) ? parsed.source_as_of : null);
    if (!at || !day(at)) return false;
    h.collected_at = at;
    h.as_of_basis = COLLECTED_BASIS;
    if (isObj(env.taste.source) && env.taste.source.as_of == null) env.taste.source.collected_at = at;
    env.taste.cite_as = 'DC Hub (dchub.cloud), collected ' + day(at);
    return true;
  } catch (_) { return false; }
}

// get_interconnection_queue without iso: the snapshot's own US total, its project total and its date, as a taste
// (the shape every wall reader already knows: taste.headline, taste.project_count, taste.source, taste.cite_as).
// null when the snapshot carries no US total. The per-ISO rows stay as the trim left them (detail rows).
export const SNAPSHOT_WINDOW = 'US ISO generation queues (7 ISOs, active requests; not load)';
export function queueSnapshotTaste(parsed) {
  if (!isObj(parsed) || !isObj(parsed.totals) || !num(parsed.totals.queued_generation_gw)) return null;
  if (!Array.isArray(parsed.by_iso)) return null;
  const t = parsed.totals;
  const fr = isObj(parsed.freshness) ? parsed.freshness : null;
  const asOf = day(parsed.as_of) ? parsed.as_of : (fr && day(fr.latest_as_of) ? fr.latest_as_of : null);
  const prov = isObj(parsed.provenance) ? parsed.provenance : null;
  const projects = isObj(parsed.projects) && num(parsed.projects.total) ? parsed.projects.total : null;
  const freshNote = fr && num(fr.fresh_iso_count) && num(fr.stale_iso_count)
    ? ' ' + fr.fresh_iso_count + ' of ' + (fr.fresh_iso_count + fr.stale_iso_count) + ' ISOs were refreshed on that date.'
    : '';
  return {
    headline: {
      name: 'queued_generation_gw', value: t.queued_generation_gw, unit: 'GW', window: SNAPSHOT_WINDOW,
      as_of: asOf,
      as_of_basis: asOf
        ? 'the newest per-ISO date in this snapshot; each ISO is refreshed on its own date (by_iso).' + freshNote
        : 'UNMEASURED - this snapshot carries no date',
      ...(str(t.queued_generation_gw_scope) ? { scope: t.queued_generation_gw_scope } : {}),
    },
    project_count: {
      value: projects,
      basis: projects !== null ? 'active per-project queue rows DC Hub tracks across the 7 US ISOs'
        : 'UNMEASURED - no project total on this snapshot',
    },
    source: { name: (prov && str(prov.source)) ? prov.source : 'US ISO public interconnection queues',
      ...(str(parsed.source) ? { url: parsed.source } : {}) },
    cite_as: 'DC Hub (dchub.cloud)' + (day(asOf) ? ', as of ' + day(asOf) : ''),
  };
}

// The one entry server.mjs calls on a wall preview of these tools. `out` is the object the wall is about to serve
// (the taste envelope, or the generic trim of the snapshot); `parsed` the backend body it was cut from. In place;
// returns `out`.
export function attachHeadlinePreview(name, parsed, out) {
  try {
    if (name !== 'get_interconnection_queue' || !isObj(out) || !isObj(parsed)) return out;
    if (isObj(out.taste)) { stampQueueCollected(out, parsed); return out; }
    const taste = queueSnapshotTaste(parsed);
    if (!taste) return out;
    out.taste = taste;
    // The headline the trim nulled in place, back beside its scope (the per-ISO rows stay trimmed).
    if (isObj(out.totals) && out.totals.queued_generation_gw === null) {
      out.totals = { ...out.totals, queued_generation_gw: taste.headline.value };
      delete out.totals._queued_generation_gw_withheld;
      delete out.totals._queued_generation_gw_in_pro;
    }
  } catch (_) { /* a headline never breaks a wall */ }
  return out;
}
