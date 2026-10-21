// lib/free-decision-taste.mjs — the free-tier "labelled taste" of the three
// Pro-demand decision tools (owner decision 2026-10-08: "do tighten step 1,
// pro-demand tools preview-only on free").
//
// get_grid_intelligence, get_interconnection_queue and get_market_intel are the
// three heaviest free tools AND the top paid-demand tools (conversion report §8c:
// 6,413 / 10,630 grid+market calls in 30d, 0 paid). On every non-paid seat —
// anonymous, free key, trial key, email-bound — they now return this shape and
// never enter the free full-answer (trial_taste / inline_full) path:
//
//   taste:    { headline: {name, value, unit, window, as_of}, band, source, cite_as, ... }
//   withheld: [ {section, count, unlocks_at: 'developer'}, ... ]   (NO silent nulls)
//
// A withheld field is LISTED with its count, never nulled in place: a null reads
// as "unknown" when the truth is "withheld", which is the contradiction class the
// Grok completeness detector flags (PJM-DOM returned withholding_proven:true with
// an empty withheld_fields). Beside the list, the documented `_<section>_in_pro`
// marker + `_<section>_unlocks_at: 'developer'` sibling feed lib/attribution.mjs
// detectGating (provenance.preview.withheld_fields, withholding_proven) and
// lib/paywall-contract.mjs computeCompleteness (completeness.status 'partial').
//
// Pure module: no ctx, no network, no URLs. server.mjs attaches the ladder
// (_upgrade: Developer then Pro, never the $10 pack), the depth-wall relay
// (for_your_human / human_url) and the usual citation stamps.
//
// Kill switch: DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY=0 restores the previous
// behaviour on every path (the gate's taste branches, the anon inline-full
// cascade, the depth tease, the over-cap trims and this shape).
import { CHATGPT_NOTICE } from './chatgpt-directory.mjs';

export const FREE_DECISION_FLAG = 'DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY';
export const FREE_PREVIEW_ONLY_TOOLS = Object.freeze([
  'get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel',
]);
export const FREE_DECISION_UNLOCKS_AT = 'developer';
// Tools that render the taste shape on their preview paths WITHOUT being preview-only:
// a free key keeps its daily full answers, so nothing about who gets the full answer moves.
export const TASTE_SHAPED_ONLY_TOOLS = Object.freeze(['get_energy_prices']);
// The clause every emission of the published free-tier rule carries (initialize
// instructions, dchub://instructions, claim_free_key / bind_email free_tier_rule
// siblings, the repo docs). One string, so the copy cannot drift per surface.
// Shortest honest form (owner 2026-10-08): the lean initialize handshake quotes the FREE TIER
// block verbatim and holds a 2,048-char budget (test/handshake-is-lean.test.mjs).
//
// ITEM 3 (owner draft 2026-10-16, modifies 10-08 for EMAIL-BOUND keys only): a free key that
// carries a bound email gets FULL answers on the grid and queue reads, up to a small daily cap
// per tool; past the cap it gets this taste back with one link. Anonymous callers and free
// keys without an email stay preview-only. Growth freeze (owner 2026-10-19): get_market_intel
// joins the email allowance (it was preview-only on every non-paid seat) everywhere but the frozen
// /mcp/chatgpt profile; broker rates stay Pro-only via maskBrokerRatesBelowPro below (callAPI reads
// as internal, so the backend's own be#7232 mask does not fire on this path). get_energy_prices
// (the price read) is not preview-only at all: a free key already gets its full answers.
// Kill switch DCHUB_EMAIL_FULL_DECISION_TOOLS=0 restores the 10-08 rule byte for byte.
export const EMAIL_FULL_DECISION_FLAG = 'DCHUB_EMAIL_FULL_DECISION_TOOLS';
export const EMAIL_FULL_DECISION_TOOLS = Object.freeze(['get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel']);
// Full answers per tool per UTC day for an email-bound key on EMAIL_FULL_DECISION_TOOLS, below
// the email tier's general 10 (server.mjs IDENTIFIED_DAILY_FULL_CAP clamps it there).
export const EMAIL_DECISION_DAILY_FULL_DEFAULT = 10;  // owner 2026-10-19 (was 3; prod env set 10 at 22:41Z)
export function emailFullDecisionOn(env = process.env) {
  const v = env && env[EMAIL_FULL_DECISION_FLAG];
  return !/^(0|false|no|off)$/i.test(String(v === undefined || v === null ? '1' : v).trim());
}
// The 10-08 clause, still served while the item-3 switch is off.
export const FREE_DECISION_CLAUSE_PREVIEW_ONLY = 'Grid/queue/market-intel tools: previews on free; full needs a paid DC Hub plan.';
// The clause with the email allowance. `cap` is the served cap, so the published number is the
// enforced one (an env override moves both).
export function freeDecisionClause(cap = EMAIL_DECISION_DAILY_FULL_DEFAULT) {
  return 'Grid/queue/market-intel tools: previews on free; an email adds ' + cap + ' full answers/day each.';
}
export const FREE_DECISION_CLAUSE = freeDecisionClause(EMAIL_DECISION_DAILY_FULL_DEFAULT);

export function freeDecisionPreviewOnlyOn(env = process.env) {
  const v = env && env[FREE_DECISION_FLAG];
  return !/^(0|false|no|off)$/i.test(String(v === undefined || v === null ? '1' : v).trim());
}

// ── counting what is withheld ────────────────────────────────────────────────
const _isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const _num = (v) => typeof v === 'number' && Number.isFinite(v);
function _present(v) {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (_isObj(v)) return Object.keys(v).length > 0;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}
// Rows for a list; present leaves for an object; 1 for a scalar.
function _count(v) {
  if (!_present(v)) return 0;
  if (Array.isArray(v)) return v.length;
  if (_isObj(v)) {
    let n = 0;
    for (const x of Object.values(v)) n += _isObj(x) || Array.isArray(x) ? (_count(x) > 0 ? 1 : 0) : (_present(x) ? 1 : 0);
    return n;
  }
  return 1;
}
function _get(o, path) {
  let cur = o;
  for (const k of String(path).split('.')) {
    if (!_isObj(cur) && !Array.isArray(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}
// [{section, count, unlocks_at}] over `sections` = [[section, [paths...]], ...],
// plus the figures a relay line may name (numeric leaves, first per section).
function _withheldList(parsed, sections) {
  const withheld = [];
  const figures = [];
  const fields = [];
  for (const [section, paths] of sections) {
    let count = 0;
    for (const p of paths) {
      const v = _get(parsed, p);
      const c = _count(v);
      if (c > 0) {
        fields.push(p.split('.').pop());
        if (_num(v)) figures.push({ key: p.split('.').pop(), value: v });
      }
      count += c;
    }
    if (count > 0) withheld.push({ section, count, unlocks_at: FREE_DECISION_UNLOCKS_AT });
  }
  return { withheld, figures, fields };
}
// The documented per-field marker, `_<field>_in_pro: true`, for every withheld
// field that was present — WITHOUT the nulled field beside it. This is what the
// continuation block (fields_unlocked), the grid sell line, the missed-upgrade
// prompt (collectMissed) and provenance.preview.withheld_fields (detectGating)
// read, so the taste feeds every existing honesty surface. The rung is named
// once: `_withheld_unlocks_at` and each `withheld[].unlocks_at`.
function _markers(fields) {
  const out = {};
  for (const f of fields) out['_' + f + '_in_pro'] = true;
  if (fields.length) out._withheld_unlocks_at = FREE_DECISION_UNLOCKS_AT;
  return out;
}
function _asOfDate(asOf) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(asOf || ''));
  return m ? m[1] : null;
}
function _citeAs(parsed, asOf) {
  const p = parsed && parsed.provenance;
  if (_isObj(p) && typeof p.cite_as === 'string' && p.cite_as.trim()) return p.cite_as;
  const d = _asOfDate(asOf);
  return 'DC Hub (dchub.cloud)' + (d ? ', as of ' + d : '');
}
// The note's last sentence: who else can get the full answer. On the item-3 tools with the email
// allowance on (opts.emailFullCap > 0), a bound email does open full answers, so it says so.
function _deepensSentence(tool, opts = {}) {
  const cap = Number(opts.emailFullCap) || 0;
  if (cap > 0 && EMAIL_FULL_DECISION_TOOLS.includes(tool)) {
    return '; a free key with a bound email gets ' + cap + ' full answers a day, a free key without one does not.';
  }
  return '; a free key, a trial key or a bound email does not deepen it.';
}
// The same sentence on its own, after the neutral partial line.
function _deepensStandalone(tool, opts = {}) {
  const s = _deepensSentence(tool, opts).replace(/^;\s*/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function _envelope(tool, kept, taste, withheld, fields = [], opts = {}) {
  const sections = withheld.map((w) => w.section);
  return {
    ok: true,
    tool,
    ...kept,
    taste,
    withheld,
    withheld_total: withheld.reduce((n, w) => n + w.count, 0),
    free_preview_only: true,
    full_unlocks_at: FREE_DECISION_UNLOCKS_AT,
    _taste_note: 'Free-tier taste: `taste` is the one headline this tier publishes; `withheld` lists '
      + 'every other section with its count. Nothing is nulled in place. '
      // Item 1 leftover (2026-10-17): opts.legacyWallCopy is set on /mcp/chatgpt (frozen) and /mcp/claude.
      + (opts.legacyWallCopy
        ? 'Full `' + tool + '` opens with a paid DC Hub plan' + _deepensSentence(tool, opts)
        : CHATGPT_NOTICE + ' ' + _deepensStandalone(tool, opts)),
    ..._markers(fields),
    preview_is_partial: true,
    completeness: { status: 'partial', kind: 'taste', withheld: sections },
    ...(opts.extra || {}),
  };
}

// ── get_grid_intelligence ────────────────────────────────────────────────────
// KEEP: current demand MW + its hour, the constraint and excess-power BAND WORDS
// (not the scores), as_of, source (EIA-930 + DCPI), cite_as, ONE renewable-or-gas
// share. Known bug fixed in passing: the generic trim nulled demand_mw (`_mw$`)
// while demand_24h[0] carried the same hour; here demand is the headline, and
// when the shaper itself had no demand_mw the latest demand_24h hour is used and
// says so.
const GRID_SECTIONS = Object.freeze([
  ['dcpi_scores', ['constraint_score', 'excess_power_score', 'build_rate_pct', 'market_count', 'build_count']],
  ['queue_and_time_to_power', ['queue_depth_gw', 'connections_queue_gw', 'avg_time_to_power_months',
    'avg_queue_wait_months', 'data_center_share_pct', 'data_center_load']],
  ['demand_history', ['demand_24h', 'peak_mw', 'min_mw', 'load_factor']],
  ['generation_mix_detail', ['generation_mix_mw', 'generation_mix_pct']],
  ['grid_stress', ['reserve_margin_pct', 'curtailment_pct', 'stranded_capacity_mw', 'grid_emergencies_30d',
    'operating_reserve_mw', 'grid_carbon_intensity_lb_mwh']],
  ['capacity', ['capacity_auction_price_usd_mw_day', 'forward_load_mw', 'committed_capacity_mw', 'headroom', 'headroom_preview']],
  ['price', ['retail_price_cents_kwh']],
  ['related_intel', ['related_intel']],
]);
// An hour-precise stamp for a grid cite: "2026-10-16T04:00Z". EIA periods are
// "YYYY-MM-DDTHH" (UTC); the shaper's as_of is the same hour as a full ISO string.
// G-1016-01: a day-only "as of 2026-10-16" over a figure read at 04:00Z that day is
// indistinguishable from "as of today" when the caller reads it at 15:00Z.
function _gridHour(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/.exec(s);
  if (m) return m[1] + 'T' + m[2] + ':00Z';
  m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]00:?00)?$/.exec(s);
  if (m) return m[1] + 'T' + m[2] + ':' + m[3] + 'Z';
  return null;
}
// Scalars the band is read from — never emitted.
function _gridTaste(parsed, bandFor, emailFullCap = 0, legacyWallCopy = false) {
  if (!_isObj(parsed) || typeof parsed.iso !== 'string') return null;
  const asOf = parsed.as_of || parsed.last_updated || null;
  // Headline: live demand, with its hour.
  let demand = _num(parsed.demand_mw) ? parsed.demand_mw : null;
  let window = parsed.demand_period || null;
  let basis = 'EIA-930 hourly demand for the period in `window` (UTC hour)';
  if (demand === null && Array.isArray(parsed.demand_24h)) {
    for (let i = parsed.demand_24h.length - 1; i >= 0; i--) {
      const r = parsed.demand_24h[i];
      const mw = _isObj(r) ? (_num(r.mw) ? r.mw : (_num(r.demand_mw) ? r.demand_mw : null)) : null;
      if (mw !== null) {
        demand = mw;
        window = (r.period || r.hour || r.ts || window) || null;
        basis = 'latest hour of the demand_24h series (demand_mw itself was absent from the feed)';
        break;
      }
    }
  }
  const band = (k) => (typeof bandFor === 'function' && _num(parsed[k]) ? bandFor(k, parsed[k]) : null);
  const constraintBand = band('constraint_score');
  const excessBand = band('excess_power_score');
  const mixPeriod = parsed.generation_mix_period || null;
  // 2026-10-21: the share carries its own as_of (the fuel-mix hour), as the headline does. EIA
  // publishes the mix about once a day, so this is the answer's OLDEST figure, and the preview
  // withholds the mix layer itself: without a stamp here nothing collectable dated the share, and the
  // response as_of (oldest input wins) read as the demand hour once the eia930 source entry stopped
  // carrying the backend's collection date (lib/grid-provenance.mjs ownSourceAsOf).
  const mixAsOf = _gridHour(mixPeriod);
  const share = _num(parsed.renewable_share_pct)
    ? { name: 'renewable_share_pct', value: parsed.renewable_share_pct, unit: '%', window: mixPeriod,
        ...(mixAsOf ? { as_of: mixAsOf } : {}),
        basis: 'wind + solar + hydro + geothermal share of primary generation, storage excluded' }
    : _num(parsed.gas_share_pct)
      ? { name: 'gas_share_pct', value: parsed.gas_share_pct, unit: '%', window: mixPeriod,
          ...(mixAsOf ? { as_of: mixAsOf } : {}),
          basis: 'natural-gas share of primary generation, storage excluded' }
      : null;
  const prov = _isObj(parsed.provenance) ? parsed.provenance : null;
  // G-1016-01: the headline carries the as_of of the figure it holds, never a
  // neighbour's. Demand present: the demand hour. Demand absent (the backend's live
  // EIA-930 demand read did not answer; it serves no demand fields then): fall back
  // to the measured fuel-mix share, stamped with the fuel-mix hour, and say so.
  // Nothing measured: value AND as_of null, and the basis says why.
  let headline;
  let shareRidesBeside = !!share;
  if (demand !== null) {
    headline = { name: 'demand_mw', value: demand, unit: 'MW', window,
      as_of: (_gridHour(window) && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(window)) ? window + ':00:00Z' : asOf,
      basis };
  } else if (share && _gridHour(mixPeriod)) {
    shareRidesBeside = false;
    headline = { name: share.name, value: share.value, unit: share.unit, window: mixPeriod,
      as_of: _gridHour(mixPeriod), fallback_from: 'demand_mw',
      basis: 'demand_mw: the live EIA-930 demand read did not return a value for this request, so the headline '
        + 'falls back to the measured fuel-mix share (' + share.basis + '), stamped with its own EIA hour in `window`. '
        + 'EIA publishes the fuel mix hours behind demand; do not narrate it as the current hour.' };
  } else {
    headline = { name: 'demand_mw', value: null, unit: 'MW', window: null, as_of: null,
      basis: 'UNMEASURED - no demand or fuel-mix reading in this response (the live EIA-930 read did not return '
        + 'a value), so there is no data date to cite for a headline' };
  }
  const hourStamp = _gridHour(headline.as_of);
  const taste = {
    headline,
    band: {
      constraint: constraintBand,
      excess_power: excessBand,
      basis: (constraintBand || excessBand)
        ? 'Data Center Power Index (DCPI) bands for this ISO; the 0-100 scores are withheld (dcpi_scores)'
        : 'UNMEASURED - no DCPI row for this region',
    },
    ...(shareRidesBeside ? { share } : {}),
    source: (prov && typeof prov.source === 'string' && prov.source) || 'EIA-930 hourly RTO/BA feed + DC Hub Data Center Power Index (DCPI)',
    // The cite names the headline's own hour (G-1016-01), never a bare day and never the serve date.
    cite_as: hourStamp ? 'DC Hub (dchub.cloud), as of ' + hourStamp
      : 'DC Hub (dchub.cloud) - headline unmeasured in this response, no data date',
  };
  const { withheld, figures, fields } = _withheldList(parsed, GRID_SECTIONS);
  const kept = {
    iso: parsed.iso,
    ...(parsed.iso_name !== undefined ? { iso_name: parsed.iso_name } : {}),
    // Grok 10-16 nit 1: with the headline UNMEASURED the payload's as_of is the serve
    // time, not a data date. Null it and carry the serve time as retrieved_at.
    ...(hourStamp ? { as_of: asOf } : {
      as_of: null, retrieved_at: asOf,
      as_of_basis: 'UNMEASURED - no demand or fuel-mix reading in this response; retrieved_at is when DC Hub served it, not a data date',
    }),
    ...(parsed.demand_period ? { demand_period: parsed.demand_period } : {}),
    ...(parsed.resolved_from ? { resolved_from: parsed.resolved_from } : {}),
    ...(parsed.coverage_note ? { coverage_note: parsed.coverage_note } : {}),
    ...(parsed._warning ? { _warning: parsed._warning } : {}),
    ...(parsed._warning_grid ? { _warning_grid: parsed._warning_grid } : {}),
    ...(parsed._warning_dcpi ? { _warning_dcpi: parsed._warning_dcpi } : {}),
    ...(prov ? { provenance: prov } : {}),
    // G-1016-01: the result-level cites (citation.cite_as, and cite_as, which the outreach
    // stamp keeps when present) are otherwise derived later at DAY precision from the
    // collection as_of, so "as of 2026-10-16" sat over a 04:00Z figure read at 15:00Z
    // the same day. Stated here at the headline's hour, PARTIAL caveat included (the
    // attribution merge keeps a producer cite_as only when it says PARTIAL).
    cite_as: 'DC Hub (dchub.cloud) — PARTIAL preview (tier-gated; not the full dataset)'
      + (hourStamp ? ', as of ' + hourStamp : ', headline unmeasured, no data date'),
    citation: {
      cite_as: 'DC Hub, dchub.cloud — PARTIAL preview (tier-gated; not the full dataset)'
        + (hourStamp ? ' (as of ' + hourStamp + ')' : ' (headline unmeasured, no data date)'),
      as_of: hourStamp ? headline.as_of : null,
    },
  };
  return { envelope: _envelope('get_grid_intelligence', kept, taste, withheld, fields, { emailFullCap, legacyWallCopy }), figures };
}

// ── get_interconnection_queue (per-ISO shape) ────────────────────────────────
// KEEP: total queued GW, project count, source date, source name + URL, cite_as.
// WITHHOLD: the project rows, the load-queue figures, new applications,
// completion history, sub-regions. Known bug fixed in passing: the generic trim
// nulled the headline GW (`_gw$`) and project_count (`_count$`) while 25 rows
// leaked through `_projects_total_in_pro` and cite_as; here the headline is
// present and the rows are withheld. The all-ISO snapshot (no iso=) is a
// different shape and keeps today's trim.
const QUEUE_SECTIONS = Object.freeze([
  ['projects', ['projects']],
  ['load_queue', ['queued_load_data_center_gw', 'queued_load_dc_share_pct', 'large_load', 'queued_generation_pending_revision_gw']],
  ['new_applications', ['new_applications_q_gw', 'new_applications_period']],
  ['completion_history', ['historical_completion_pct']],
  ['top_subregions', ['top_subregions']],
]);
// "as of Aug 2026 (ERCOT monthly)": a queue figure from a monthly report is dated by its report month, so
// an agent does not present it as current. Derived from the figure's own as_of, never a literal month.
const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function _monthlyAsOfLabel(iso, asOf, cadence) {
  if (cadence !== 'monthly' || typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(asOf || ''));
  const mon = m && _MONTHS[Number(m[2]) - 1];
  return mon ? 'as of ' + mon + ' ' + m[1] + ' (' + iso + ' monthly)' : null;
}
function _queueTaste(parsed, emailFullCap = 0, legacyWallCopy = false) {
  if (!_isObj(parsed) || typeof parsed.iso !== 'string') return null;
  const perIso = Array.isArray(parsed.projects) || _num(parsed.project_count) || _num(parsed.queued_generation_gw);
  if (!perIso) return null;
  const asOf = parsed.as_of || null;
  // item 2c (2026-10-20): the load-named total arrives renamed (lib/queue-kind-fields.mjs); both shapes read.
  const basis = parsed.queue_kind || parsed.queued_load_total_gw_basis || null;
  const _total = _num(parsed.queued_load_total_gw) ? parsed.queued_load_total_gw
    : _num(parsed.queued_large_load_gw) ? parsed.queued_large_load_gw
    : _num(parsed.queued_connections_gw) ? parsed.queued_connections_gw : null;
  const _totalName = basis === 'large_load' ? 'queued_large_load_gw'
    : basis === 'mixed_connection_queue' ? 'queued_connections_gw' : 'queued_total_gw';
  let headline;
  if (_num(parsed.queued_generation_gw)) {
    headline = { name: 'queued_generation_gw', value: parsed.queued_generation_gw, unit: 'GW',
      window: 'generation interconnection queue (requested generation; not load)',
      as_of: parsed.queued_generation_gw_as_of || asOf };
    const lbl = _monthlyAsOfLabel(parsed.iso, headline.as_of, parsed.refresh_cadence);
    if (lbl) headline.as_of_label = lbl;
  } else if (_total !== null) {
    headline = { name: _totalName, value: _total, unit: 'GW',
      window: basis === 'mixed_connection_queue'
        ? 'connections queue (generation AND demand projects in one figure)'
        : basis === 'large_load' ? 'large-load (demand) queue' : (basis || 'queue total'),
      as_of: asOf };
  } else {
    headline = { name: 'queued_generation_gw', value: null, unit: 'GW', window: basis, as_of: asOf,
      basis: 'UNMEASURED - this row carries no queue total' };
  }
  const sections = QUEUE_SECTIONS.map(([s, paths]) => (s === 'load_queue' && basis === 'large_load')
    ? [s, [...paths, 'queued_load_total_gw', 'queued_large_load_gw']]    // ERCOT: the 474 GW large-load total is a separate, withheld queue
    : [s, paths]);
  const { withheld, figures, fields } = _withheldList(parsed, sections);
  const prov = _isObj(parsed.provenance) ? parsed.provenance : null;
  const taste = {
    headline,
    project_count: { value: _num(parsed.project_count) ? parsed.project_count : null,
      basis: _num(parsed.project_count) ? 'active projects DC Hub tracks in this ISO queue'
        : 'UNMEASURED - no project count on this row' },
    band: null,
    band_basis: 'UNMEASURED - this tool publishes no ISO band; the DCPI constraint band is on get_grid_intelligence.',
    source: { name: parsed.source_name || null, url: parsed.source_url || null,
      // A live feed's source_as_of is its fetch date (source_as_of_basis says so): not a report date.
      as_of: parsed.source_as_of_basis === 'live_feed_fetch_date'
        ? null : (parsed.source_as_of || parsed.queued_generation_gw_as_of || asOf),
      ...(parsed.source_report ? { report: parsed.source_report } : {}) },
    cite_as: _citeAs(parsed, asOf),
  };
  const kept = {
    iso: parsed.iso,
    as_of: asOf,
    ...(basis ? { queue_basis: basis } : {}),
    ...(parsed.queued_generation_gw_basis_note ? { queued_generation_gw_basis_note: parsed.queued_generation_gw_basis_note } : {}),
    ...(parsed.last_refreshed ? { last_refreshed: parsed.last_refreshed } : {}),
    ...(parsed.refresh_cadence ? { refresh_cadence: parsed.refresh_cadence } : {}),
    ...(parsed.v ? { v: parsed.v } : {}),
    ...(prov ? { provenance: prov } : {}),
  };
  return { envelope: _envelope('get_interconnection_queue', kept, taste, withheld, fields, { emailFullCap, legacyWallCopy }), figures };
}

// The DCPI fallback verdict (dchub-backend util/dcpi_method.py VERDICT_FALLBACK).
const DCPI_FALLBACK_VERDICT = 'AVOID';

// ── get_market_intel ─────────────────────────────────────────────────────────
// KEEP: ONE headline — the DCPI verdict with its method link (never a facility
// count: the count is withheld canon), as_of, source, cite_as, ISO and the
// serving utility names. WITHHOLD: providers, recent facilities, cities, MW,
// time to power, pricing (CBRE content: source line only), related intel, the
// counts. Known bug fixed in passing: `_gated:false` never rides a partial.
const MARKET_SECTIONS = Object.freeze([
  ['providers', ['top_providers']],
  ['recent_facilities', ['recent_facilities']],
  ['cities', ['market.cities']],
  ['capacity_mw', ['stats.total_power_mw', 'stats.avg_power_mw', 'siting.mw']],
  ['facility_counts', ['stats.facility_count', 'stats.provider_count', 'stats.mw_reporting_count', 'by_status']],
  ['time_to_power', ['siting.time_to_power']],
  ['pricing', ['market_pricing.asking_rate', 'market_pricing.asking_rate_range', 'market_pricing.vacancy_percent',
    'market_pricing.deal_size']],
  ['related_intel', ['related_intel']],
]);
// The upstream pricing source line can embed the figure it cites ("... $160-185/kW/mo").
// A source line names and links the source; any dollar figure is the withheld rate.
const _MONEY_FIGURE = /\$\s?\d[\d.,]*(?:\s?[-\u2013\u2014]\s?\$?\d[\d.,]*)?(?:\s?\/\s?kW(?:\s?\/\s?(?:mo|month))?)?/gi;
function _scrubFigures(v) {
  if (typeof v !== 'string') return v;
  return v.replace(_MONEY_FIGURE, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,;:.)])/g, '$1').trim();
}
// Growth freeze (owner 2026-10-19): an email-bound key gets the FULL get_market_intel answer,
// but broker asking rates stay Pro-only (leak-audit H1, dchub-backend#7232). callAPI reaches the
// backend as internal (= Pro), so the backend's own mask never fires on this path: mask here.
// Values are nulled and keys kept (the shape an agent parses does not change); the source line
// keeps its name but loses any dollar figure.
const _RATE_KEYS = ['asking_rate', 'asking_rate_range', 'vacancy_percent', 'deal_size', 'unit'];  // unit: no rate, no unit
// ★2026-10-20 OWNER DECISION (verbatim): "Keep CBRE/JLL broker lease rates Pro-only everywhere:
// remove them from public pages to match MCP." The one line every sub-Pro surface carries: the
// source is named, no figure, no plan name, no price.
export const BROKER_RATES_LINE = 'Broker lease rates (CBRE/JLL): available on paid plans';
// One `market_pricing` block, masked. Used by maskBrokerRatesBelowPro AND by the free-tier trims'
// r-market-pricing exemption (server.mjs _PUBLIC_SUBTREE_KEYS), which used to pass the block through
// byte-identical: callAPI reads the backend as internal (= Pro), so the backend never masked it.
export function maskPricingBlock(block) {
  if (!_isObj(block)) return block;
  const mp = { ...block };
  for (const k of _RATE_KEYS) if (k in mp) mp[k] = null;
  if (typeof mp.source === 'string') mp.source = _scrubFigures(mp.source);
  mp.rates_withheld = true;
  mp.rates_note = BROKER_RATES_LINE;
  return mp;
}
export function maskBrokerRatesBelowPro(parsed) {
  if (!_isObj(parsed) || !_isObj(parsed.market_pricing)) return parsed;
  return { ...parsed, market_pricing: maskPricingBlock(parsed.market_pricing) };
}
function _marketTaste(parsed, legacyWallCopy = false) {
  if (!_isObj(parsed)) return null;
  const market = _isObj(parsed.market) ? parsed.market : null;
  if (!market && !_isObj(parsed.stats)) return null;
  const asOf = parsed.as_of || null;
  const siting = _isObj(parsed.siting) ? parsed.siting : null;
  const dcpi = siting && _isObj(siting.dcpi) ? siting.dcpi : null;
  const isoB = siting && _isObj(siting.iso) ? siting.iso : null;
  const util = siting && _isObj(siting.utilities) ? siting.utilities : null;
  const pricing = _isObj(parsed.market_pricing) ? parsed.market_pricing : null;
  const prov = _isObj(parsed.provenance) ? parsed.provenance : null;
  const verdict = dcpi && typeof dcpi.verdict === 'string' ? dcpi.verdict : null;
  // G-1019-01 / C12: the one figure this preview publishes is the verdict, so the date it is
  // cited at is the VERDICT's own as_of (siting.dcpi.as_of, the score's computed_at). The
  // response's top-level as_of is MAX(discovered_at) over the facilities the withheld sections
  // count: it dated Dallas "2026-09-26" beside a verdict computed that morning. Fall back to it
  // only when the verdict carries no date of its own.
  const verdictAsOf = (dcpi && dcpi.as_of) || null;
  const tasteAsOf = verdictAsOf || asOf;
  // G-1016-02: no hard verdict on a fallback band. The DCPI's last verdict is a
  // FALLBACK (util/dcpi_method.py VERDICT_FALLBACK): it means "did not clear the BUILD
  // or CAUTION band". Canon (Grok 10-16 nit 2): AVOID = did not clear a scoring band;
  // provisional_basis says only that, not why a market missed the band.
  // The value stays in the owner's vocabulary (BUILD / CAUTION / AVOID); the
  // provisional label rides beside it as its own fields.
  const fallback = !!verdict && (verdict.toUpperCase() === DCPI_FALLBACK_VERDICT
    || (typeof (dcpi && dcpi.band) === 'string' && /\bfallback\b/i.test(dcpi.band)));
  const taste = {
    headline: {
      name: 'dcpi_verdict', value: verdict, unit: 'DCPI verdict (BUILD / CAUTION / AVOID)', window: null,
      as_of: (dcpi && dcpi.as_of) || asOf,
      method_url: (dcpi && dcpi.method_url) || 'https://dchub.cloud/dcpi/methodology',
      ...(verdict ? {} : { basis: (siting && siting.reason) ? 'UNMEASURED - ' + siting.reason : 'UNMEASURED - no DCPI verdict for this market' }),
      ...(fallback ? {
        provisional: true,
        verdict_band_kind: 'fallback',
        provisional_basis: verdict + ' is the DCPI fallback band: this market did not clear the BUILD or CAUTION '
          + 'scoring band. It is a provisional market-level '
          + 'screen, not a measured judgement that the market is bad; a site-level read (analyze_site) can differ. '
          + 'Quote it as provisional, never as a hard verdict.',
      } : { provisional: false }),
    },
    band: (dcpi && dcpi.band) || null,
    ...(dcpi && dcpi.definition ? { band_definition: dcpi.definition } : {}),
    ...(dcpi && dcpi.data_basis ? { data_basis: dcpi.data_basis } : {}),
    iso: isoB ? { code: isoB.code || null, operator: isoB.operator || null, class: isoB.class || null } : null,
    utility: util ? { names: Array.isArray(util.names) ? util.names : null, ...(util.source_url ? { source_url: util.source_url } : {}),
      ...(util.basis ? { basis: util.basis } : {}) } : null,
    source: (prov && typeof prov.source === 'string' && prov.source) || 'DC Hub facility index + Data Center Power Index (DCPI)',
    cite_as: _citeAs(parsed, tasteAsOf),
  };
  const { withheld, figures, fields } = _withheldList(parsed, MARKET_SECTIONS);
  const kept = {
    market: market ? { ...(market.id !== undefined ? { id: market.id } : {}), ...(market.name !== undefined ? { name: market.name } : {}) } : null,
    as_of: tasteAsOf,
    ...(verdictAsOf
      ? { as_of_basis: "the DCPI verdict's own computed_at (siting.dcpi.as_of); the facility-discovery date counts withheld sections and is not what this preview publishes." }
      : (parsed.as_of_basis ? { as_of_basis: parsed.as_of_basis } : {})),
    // CBRE / broker content: the source line only, never the figure.
    ...(pricing ? { pricing_source: {
      ...(pricing.basis ? { basis: _scrubFigures(pricing.basis) } : {}),
      ...(pricing.period ? { period: _scrubFigures(pricing.period) } : {}),
      ...(pricing.source ? { source: _scrubFigures(pricing.source) } : {}),
      ...(pricing.source_url ? { source_url: pricing.source_url } : {}),
      note: 'Asking rate, range, vacancy and deal size are withheld on this tier (see `withheld`, section pricing).',
    } } : {}),
    ...(prov ? { provenance: prov } : {}),
    _gated: true,
  };
  return { envelope: _envelope('get_market_intel', kept, taste, withheld, fields, { legacyWallCopy }), figures };
}

// ── get_energy_prices ────────────────────────────────────────────────────────
// KEEP: ONE rate (cents/kWh) with its sector and the EIA period it is averaged over.
// That period is `averaging_period`/`window`, NOT as_of (the payload carries no
// source timestamp, so as_of is an explicit null and the envelope stamps UNMEASURED). WITHHOLD: the min/max spread, the
// per-sector rates beyond the headline, the states-in-footprint count.
// ISO scope: the retail, industrial and average fields all carry the SAME
// all-sector average across the ISO's states, so the headline says so rather than
// presenting one of them as an industrial rate.
const ENERGY_SECTIONS = Object.freeze([
  ['rate_range', ['retail_rates.min_cents_kwh', 'retail_rates.max_cents_kwh']],
  ['other_sectors', ['industrial_rate_kwh', 'retail_rate_kwh']],
  ['iso_footprint', ['retail_rates.states_covered']],
  ['wholesale_and_gas', ['wholesale_price_usd_mwh', 'natural_gas_usd_mmbtu', 'grid_status']],
]);
function _energyTaste(parsed, legacyWallCopy = false) {
  const rr = _isObj(parsed.retail_rates) ? parsed.retail_rates : null;
  if (!rr || !_num(rr.avg_cents_kwh)) return null;
  const period = typeof rr.latest_period === 'string' && rr.latest_period.trim() ? rr.latest_period.trim() : null;
  const f = _isObj(parsed.filter) ? parsed.filter : {};
  const isoScope = parsed.scope === 'iso_footprint_avg' || (f.iso && !f.state);
  // Agent QA 2026-10-20 (item 6): the backend now ships an EIA provenance block whose
  // as_of is the last EIA month inside the averaged period (month-end, never Jan 1).
  // Carry it, like the queue tools do; without one the answer stays UNMEASURED.
  const prov = _isObj(parsed.provenance) ? parsed.provenance : null;
  const provAsOf = prov && typeof prov.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(prov.as_of) ? prov.as_of : null;
  const provBasis = provAsOf && typeof prov.as_of_basis === 'string' ? prov.as_of_basis : null;
  const sector = f.sector && f.sector !== 'all' ? String(f.sector) : 'all-sector average';
  const taste = {
    headline: {
      name: 'retail_rate_cents_kwh', value: rr.avg_cents_kwh, unit: 'cents/kWh', sector, window: period,
      // The EIA period is the span the rate is AVERAGED over ("2026" is a whole-year
      // average), not a source timestamp: stamped as as_of it parsed to 2026-01-01
      // and cite_as read "as of 2026-01-01" (Grok 10-12). Labelled, never a date.
      averaging_period: period, as_of: provAsOf,
      ...(provAsOf ? { as_of_basis: provBasis } : {}),
      basis: isoScope
        ? 'Average of EIA state retail rates across the ISO footprint; an all-sector average, not an industrial or data-center tariff'
        : 'EIA retail rate for the period in `window`',
    },
    band: null,
    source: 'EIA retail electricity rates (eia.gov)',
    ...(prov && typeof prov.source_url === 'string' ? { source_url: prov.source_url } : {}),
    cite_as: _citeAs(parsed, provAsOf),
  };
  const { withheld, fields } = _withheldList(parsed, ENERGY_SECTIONS);
  const kept = {
    filter: _isObj(parsed.filter) ? parsed.filter : null,
    ...(parsed.scope ? { scope: parsed.scope } : {}),
    ...(typeof parsed.caller_tier === 'string' ? { caller_tier: parsed.caller_tier } : {}),
    ...(period ? { averaging_period: period } : {}),
    as_of: provAsOf,
    as_of_basis: provAsOf ? provBasis
      : 'UNMEASURED - EIA publishes a rate averaged over a period, not a data date; see averaging_period.',
    ...(prov ? { provenance: prov } : {}),
    _gated: true,
  };
  // A free key still gets full answers on this tool (daily allowance), so the
  // envelope must not claim the preview-only rule the three decision tools carry.
  const envelope = _envelope('get_energy_prices', kept, taste, withheld, fields, { extra: {
    free_preview_only: false,
    full_unlocks_at: undefined,
    _taste_note: 'Free-tier taste: `taste` is the one rate this answer publishes; `withheld` lists the rest with counts. '
      + 'Nothing is nulled in place. '
      + (legacyWallCopy ? 'The fields above are in a paid DC Hub plan.' : CHATGPT_NOTICE),
  } });
  delete envelope.full_unlocks_at;
  return { envelope, figures: [] };
}

// ── entry ────────────────────────────────────────────────────────────────────
// { envelope, figures } or null when the payload is not the shape this tool's
// taste is defined for (an error envelope, the all-ISO queue snapshot, an
// unrecognised body): the caller then falls back to the generic trim.
export function buildFreeDecisionTaste(tool, parsed, opts = {}) {
  if (!_isObj(parsed)) return null;
  if (typeof parsed.error === 'string' && parsed.error.trim()) return null;   // errors are not previews
  try {
    if (tool === 'get_grid_intelligence') return _gridTaste(parsed, opts.bandFor, opts.emailFullCap, !!opts.legacyWallCopy);
    if (tool === 'get_interconnection_queue') return _queueTaste(parsed, opts.emailFullCap, !!opts.legacyWallCopy);
    if (tool === 'get_market_intel') return _marketTaste(parsed, !!opts.legacyWallCopy);
    if (tool === 'get_energy_prices') return _energyTaste(parsed, !!opts.legacyWallCopy);
  } catch (_) { return null; }
  return null;
}

// The decision scalars a free seat must never see on these tools. Tests assert
// every one of these is ABSENT (not null) from the served payload.
export const FREE_DECISION_STRIPPED_FIELDS = Object.freeze({
  get_grid_intelligence: Object.freeze(['constraint_score', 'excess_power_score', 'queue_depth_gw',
    'avg_time_to_power_months', 'avg_queue_wait_months', 'reserve_margin_pct', 'retail_price_cents_kwh',
    'capacity_auction_price_usd_mw_day', 'forward_load_mw', 'committed_capacity_mw', 'operating_reserve_mw',
    'stranded_capacity_mw', 'grid_emergencies_30d', 'curtailment_pct', 'generation_mix_mw', 'generation_mix_pct',
    'demand_24h', 'peak_mw', 'min_mw', 'load_factor', 'related_intel', 'headroom', 'headroom_preview',
    'data_center_load', 'data_center_share_pct', 'build_rate_pct', 'market_count', 'build_count']),
  get_interconnection_queue: Object.freeze(['projects', 'queued_load_data_center_gw', 'queued_load_dc_share_pct',
    'new_applications_q_gw', 'new_applications_period', 'historical_completion_pct', 'top_subregions', 'large_load']),
  get_market_intel: Object.freeze(['top_providers', 'recent_facilities', 'by_status', 'stats', 'market_pricing',
    'related_intel', 'siting']),
});
