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

export const FREE_DECISION_FLAG = 'DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY';
export const FREE_PREVIEW_ONLY_TOOLS = Object.freeze([
  'get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel',
]);
export const FREE_DECISION_UNLOCKS_AT = 'developer';
// The clause every emission of the published free-tier rule carries (initialize
// instructions, dchub://instructions, claim_free_key / bind_email free_tier_rule
// siblings, the repo docs). One string, so the copy cannot drift per surface.
// Shortest honest form (owner 2026-10-08): the lean initialize handshake quotes the FREE TIER
// block verbatim and holds a 2,048-char budget (test/handshake-is-lean.test.mjs).
export const FREE_DECISION_CLAUSE = 'Grid/queue/market-intel tools: previews on free; full needs Developer.';

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
      + 'every other section with its count. Nothing is nulled in place. Full `' + tool
      + '` opens with DC Hub Developer (Pro includes it); a free key, a trial key or a bound email does not deepen it.',
    ..._markers(fields),
    preview_is_partial: true,
    completeness: { status: 'partial', withheld: sections },
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
// Scalars the band is read from — never emitted.
function _gridTaste(parsed, bandFor) {
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
  const share = _num(parsed.renewable_share_pct)
    ? { name: 'renewable_share_pct', value: parsed.renewable_share_pct, unit: '%', window: parsed.generation_mix_period || null,
        basis: 'wind + solar + hydro + geothermal share of primary generation, storage excluded' }
    : _num(parsed.gas_share_pct)
      ? { name: 'gas_share_pct', value: parsed.gas_share_pct, unit: '%', window: parsed.generation_mix_period || null,
          basis: 'natural-gas share of primary generation, storage excluded' }
      : null;
  const prov = _isObj(parsed.provenance) ? parsed.provenance : null;
  const taste = {
    headline: { name: 'demand_mw', value: demand, unit: 'MW', window, as_of: asOf, basis: demand === null
      ? 'UNMEASURED - no demand figure in this response' : basis },
    band: {
      constraint: constraintBand,
      excess_power: excessBand,
      basis: (constraintBand || excessBand)
        ? 'Data Center Power Index (DCPI) bands for this ISO; the 0-100 scores are withheld (dcpi_scores)'
        : 'UNMEASURED - no DCPI row for this region',
    },
    ...(share ? { share } : {}),
    source: (prov && typeof prov.source === 'string' && prov.source) || 'EIA-930 hourly RTO/BA feed + DC Hub Data Center Power Index (DCPI)',
    cite_as: _citeAs(parsed, asOf),
  };
  const { withheld, figures, fields } = _withheldList(parsed, GRID_SECTIONS);
  const kept = {
    iso: parsed.iso,
    ...(parsed.iso_name !== undefined ? { iso_name: parsed.iso_name } : {}),
    as_of: asOf,
    ...(parsed.demand_period ? { demand_period: parsed.demand_period } : {}),
    ...(parsed.resolved_from ? { resolved_from: parsed.resolved_from } : {}),
    ...(parsed.coverage_note ? { coverage_note: parsed.coverage_note } : {}),
    ...(parsed._warning ? { _warning: parsed._warning } : {}),
    ...(parsed._warning_grid ? { _warning_grid: parsed._warning_grid } : {}),
    ...(parsed._warning_dcpi ? { _warning_dcpi: parsed._warning_dcpi } : {}),
    ...(prov ? { provenance: prov } : {}),
  };
  return { envelope: _envelope('get_grid_intelligence', kept, taste, withheld, fields), figures };
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
function _queueTaste(parsed) {
  if (!_isObj(parsed) || typeof parsed.iso !== 'string') return null;
  const perIso = Array.isArray(parsed.projects) || _num(parsed.project_count) || _num(parsed.queued_generation_gw);
  if (!perIso) return null;
  const asOf = parsed.as_of || null;
  const basis = parsed.queued_load_total_gw_basis || null;
  let headline;
  if (_num(parsed.queued_generation_gw)) {
    headline = { name: 'queued_generation_gw', value: parsed.queued_generation_gw, unit: 'GW',
      window: 'generation interconnection queue (requested generation; not load)',
      as_of: parsed.queued_generation_gw_as_of || asOf };
  } else if (_num(parsed.queued_load_total_gw)) {
    headline = { name: 'queued_load_total_gw', value: parsed.queued_load_total_gw, unit: 'GW',
      window: basis === 'mixed_connection_queue'
        ? 'connections queue (generation AND demand projects in one figure)'
        : basis === 'large_load' ? 'large-load (demand) queue' : (basis || 'queue total'),
      as_of: asOf };
  } else {
    headline = { name: 'queued_generation_gw', value: null, unit: 'GW', window: basis, as_of: asOf,
      basis: 'UNMEASURED - this row carries no queue total' };
  }
  const sections = QUEUE_SECTIONS.map(([s, paths]) => (s === 'load_queue' && basis === 'large_load')
    ? [s, [...paths, 'queued_load_total_gw']]    // ERCOT: the 474 GW large-load total is a separate, withheld queue
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
      as_of: parsed.source_as_of || parsed.queued_generation_gw_as_of || asOf,
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
  return { envelope: _envelope('get_interconnection_queue', kept, taste, withheld, fields), figures };
}

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
function _marketTaste(parsed) {
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
  const taste = {
    headline: {
      name: 'dcpi_verdict', value: verdict, unit: 'DCPI verdict (BUILD / CAUTION / AVOID)', window: null,
      as_of: (dcpi && dcpi.as_of) || asOf,
      method_url: (dcpi && dcpi.method_url) || 'https://dchub.cloud/dcpi/methodology',
      ...(verdict ? {} : { basis: (siting && siting.reason) ? 'UNMEASURED - ' + siting.reason : 'UNMEASURED - no DCPI verdict for this market' }),
    },
    band: (dcpi && dcpi.band) || null,
    ...(dcpi && dcpi.definition ? { band_definition: dcpi.definition } : {}),
    ...(dcpi && dcpi.data_basis ? { data_basis: dcpi.data_basis } : {}),
    iso: isoB ? { code: isoB.code || null, operator: isoB.operator || null, class: isoB.class || null } : null,
    utility: util ? { names: Array.isArray(util.names) ? util.names : null, ...(util.source_url ? { source_url: util.source_url } : {}),
      ...(util.basis ? { basis: util.basis } : {}) } : null,
    source: (prov && typeof prov.source === 'string' && prov.source) || 'DC Hub facility index + Data Center Power Index (DCPI)',
    cite_as: _citeAs(parsed, asOf),
  };
  const { withheld, figures, fields } = _withheldList(parsed, MARKET_SECTIONS);
  const kept = {
    market: market ? { ...(market.id !== undefined ? { id: market.id } : {}), ...(market.name !== undefined ? { name: market.name } : {}) } : null,
    as_of: asOf,
    ...(parsed.as_of_basis ? { as_of_basis: parsed.as_of_basis } : {}),
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
  return { envelope: _envelope('get_market_intel', kept, taste, withheld, fields), figures };
}

// ── entry ────────────────────────────────────────────────────────────────────
// { envelope, figures } or null when the payload is not the shape this tool's
// taste is defined for (an error envelope, the all-ISO queue snapshot, an
// unrecognised body): the caller then falls back to the generic trim.
export function buildFreeDecisionTaste(tool, parsed, opts = {}) {
  if (!_isObj(parsed)) return null;
  if (typeof parsed.error === 'string' && parsed.error.trim()) return null;   // errors are not previews
  try {
    if (tool === 'get_grid_intelligence') return _gridTaste(parsed, opts.bandFor);
    if (tool === 'get_interconnection_queue') return _queueTaste(parsed);
    if (tool === 'get_market_intel') return _marketTaste(parsed);
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
