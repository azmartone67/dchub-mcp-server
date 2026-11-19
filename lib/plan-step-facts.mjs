// plan-step-facts.mjs -- dated facts an execute_plan step already returned, as plain sentences for the answer lead.
//
// WHY. Grok's colocation head-to-head re-run (2026-11-17, server 2.12.59) found answers whose payload held the
// figure the question asked for while the lead said something thinner:
//   * "Fastest grid power in Texas" led with "DC Hub ran 2 lookups for ..." while its timeline step carried
//     ERCOT's own queue total (461.4 GW, as of 2026-10-31) and the 2026 firm-supply signal (16,796 MW);
//   * the Phoenix colocation-price answer named its drivers but showed none of the dated figures it had
//     (the AZ retail rate, the AZ incentive status);
//   * the Chicago 350 E Cermak answer never said the building is a key fiber endpoint or that the point is on-net.
//
// WHAT. One function per step tool, each reading only fields the step returned at the caller's depth (a withheld
// field stays out; nothing is looked up or estimated). Each fact is { text, as_of, tool }: text is one sentence
// that names its source and date. Pure; nothing here throws.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

// A street address in a question: "350 E Cermak", "60 Hudson St", "111 8th Ave". Case-sensitive on the street
// word so sizes ("500 kW", "100 MW") never match.
const ADDRESS_RE = /\b(\d{2,5}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-z]+|\d{1,3}(?:st|nd|rd|th))(?:\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Pkwy|Parkway|Way|Pl|Place|Ln|Lane)\b\.?)?)/;
export function addressFromText(text) {
  const m = ADDRESS_RE.exec(String(text || '').slice(0, 2000));
  return m ? m[1].replace(/\.$/, '').trim() : null;
}
// "350 E Cermak Rd", "350 East Cermak Road" and "Digital Realty 350 E Cermak" name the same building: the street
// number and the street word both appear.
const DIRS = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west']);
const SUFFIXES = new Set(['st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'boulevard', 'dr', 'drive', 'pkwy', 'parkway', 'way', 'pl', 'place', 'ln', 'lane']);
function addressParts(a) {
  const w = String(a || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  if (w.length < 2 || !/^\d{2,5}$/.test(w[0])) return null;
  const street = w.slice(1).find((x) => !DIRS.has(x) && !SUFFIXES.has(x));
  return street ? { number: w[0], street } : null;
}
export function addressMatches(haystack, address) {
  const a = addressParts(address);
  if (!a) return false;
  // Any punctuation separates words: "Digital Realty CHI (350 E Cermak)" names 350 E Cermak (Grok 2026-11-18 Q-f).
  const h = ' ' + String(haystack || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  return h.includes(' ' + a.number + ' ') && h.includes(' ' + a.street + ' ');
}

/** The newest data date a step result names about itself, or null. */
export function stepAsOf(p) {
  if (!isObj(p)) return null;
  return day(p.as_of) || day(p.data_as_of) || (isObj(p.provenance) && day(p.provenance.as_of))
    || (isObj(p.citation) && day(p.citation.as_of)) || null;
}

function timelineFacts(p, args) {
  const out = [];
  const st = one(p.state || (args && args.state));
  const qc = isObj(p.queue_context) ? p.queue_context : null;
  const reported = qc && Array.isArray(qc.iso_reported) ? qc.iso_reported : [];
  const ir = reported.find((r) => isObj(r) && r.primary) || reported.find(isObj);
  if (ir && num(ir.gw) != null) {
    const d = day(ir.as_of);
    out.push({ tool: 'get_power_availability_timeline', as_of: d,
      text: `${ir.iso ? `${ir.iso}'s` : 'The grid operator\'s'} own reported generation queue: ${fmt(num(ir.gw))} GW`
        + `${num(ir.requests) != null ? ` across ${fmt(num(ir.requests))} requests` : ''}`
        + ` (${ir.iso ? `${ir.iso} report` : 'operator report'}${d ? `, as of ${d}` : ''}).` });
  }
  const rows = Array.isArray(p.timeline) ? p.timeline : [];
  const firm = rows.find((r) => isObj(r) && num(r.cumulative_firm_signal_mw) != null);
  if (firm) {
    const vint = isObj(p.sources) && isObj(p.sources.planned_generators) ? day(p.sources.planned_generators.vintage) : null;
    out.push({ tool: 'get_power_availability_timeline', as_of: vint,
      text: `${st ? `${st} ` : ''}${firm.year ? `${firm.year} ` : ''}firm-supply signal: ${fmt(num(firm.cumulative_firm_signal_mw))} MW`
        + ` (EIA-860M${vint ? `, as of ${vint}` : ''}).` });
  }
  return out.length ? out : timelineContextFacts(p, args);
}

function energyFacts(p, args) {
  const st = one((isObj(p.filter) && p.filter.state) || (args && args.state) || (args && args.iso));
  const h = isObj(p.taste) && isObj(p.taste.headline) ? p.taste.headline : null;
  if (h && num(h.value) != null) {
    const d = day(h.as_of) || stepAsOf(p);
    return [{ tool: 'get_energy_prices', as_of: d,
      text: `${st ? `${st} ` : ''}${one(h.sector) || 'average'} retail electricity rate: ${h.value} ${one(h.unit) || 'cents/kWh'}`
        + `${h.window ? ` (${h.window} average` : ' ('}${h.window ? ', ' : ''}EIA${d ? `, as of ${d}` : ''}).` }];
  }
  for (const [k, label] of [['industrial_rate_kwh', 'industrial'], ['commercial_rate_kwh', 'commercial'], ['retail_rate_kwh', 'average retail']]) {
    const v = num(p[k]);
    if (v == null) continue;
    const d = stepAsOf(p);
    return [{ tool: 'get_energy_prices', as_of: d,
      text: `${st ? `${st} ` : ''}${label} electricity rate: ${v} ${v < 1 ? '$/kWh' : 'cents/kWh'} (EIA${d ? `, as of ${d}` : ''}).` }];
  }
  return [];
}

function taxFacts(p, args) {
  const rows = Array.isArray(p.data) ? p.data : [];
  const want = one(args && args.state).toUpperCase();
  const r = rows.find((x) => isObj(x) && (!want || String(x.abbr || x.state || '').toUpperCase() === want)) || null;
  if (!r) return [];
  const name = one(r.name) || want;
  const d = day(r.status_as_of) || day(r.last_verified);
  if (typeof r.status === 'string' && r.status) {
    return [{ tool: 'get_tax_incentives', as_of: d,
      text: `${name} data-center tax incentive: ${r.status.replace(/_/g, ' ')}${d ? ` (as of ${d})` : ''}.` }];
  }
  if (typeof r.has_incentive === 'boolean') {
    return [{ tool: 'get_tax_incentives', as_of: d,
      text: `${name} ${r.has_incentive ? 'has' : 'has no'} data-center sales-tax incentive on record${d ? ` (verified ${d})` : ''}.` }];
  }
  return [];
}

function fiberReadinessFacts(p, args, ctx) {
  const where = (ctx && ctx.address) || (num(p.lat) != null ? `${p.lat}, ${p.lon}` : (pointOf(args) || 'the point read'));
  const onNet = p.on_net === true || /^on[\s-]?net$/i.test(one(p.near_net_bucket));
  const bucket = onNet ? 'on-net' : one(p.near_net_bucket);
  const km = num(p.nearest_carrier_km);
  if (!bucket && km == null) return [];
  const d = stepAsOf(p);
  return [{ tool: 'get_fiber_readiness', as_of: d,
    text: `Fiber at ${where}: ${bucket || 'carrier read'}${km != null ? `, nearest carrier ${km} km` : ''}`
      + ` (PeeringDB carrier presence + FCC fiber coverage${d ? `, as of ${d}` : ''}).` }];
}

function metroFiberFacts(p, args, ctx) {
  const addr = ctx && ctx.address;
  if (!addr) return [];
  const d = stepAsOf(p);
  const carriers = Array.isArray(p.carriers) ? p.carriers : [];
  const names = carriers.filter((c) => isObj(c) && Array.isArray(c.key_endpoints)
    && c.key_endpoints.some((e) => typeof e === 'string' && addressMatches(e, addr))).map((c) => one(c.carrier)).filter(Boolean);
  const summary = isObj(p.summary) ? p.summary : {};
  const hotel = (Array.isArray(summary.key_carrier_hotels) ? summary.key_carrier_hotels : [])
    .some((h) => typeof h === 'string' && addressMatches(h, addr));
  if (!names.length && !hotel) return [];
  const who = names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '') : '';
  return [{ tool: 'get_metro_fiber', as_of: d,
    text: `${addr} is ${who ? `a key fiber endpoint for ${who}` : ''}${who && hotel ? ' and ' : ''}${hotel ? 'a key carrier hotel' : ''}`
      // The curated carrier profiles are a fixed baseline (no public source publishes them; backend
      // routes/fiber_provenance METRO_FIBER_BASELINE), so the date is said as one.
      + ` in ${one(p.market) || 'the metro'}'s curated carrier profiles (DC Hub baseline${d ? ` as of ${d}` : ''}, not a live feed).` }];
}

// ---- 5.34 (Grok MCP-dominance evals 2026-11-17, gap 2): every step that returned a dated headline gets a line ----
// The lead said "DC Hub ran N lookups" on price (TX vs VA), fiber, changes, pipeline and timeline answers whose
// steps each carried a headline. These readers add the step kinds those answers ran; tasteFacts reads any step's
// taste.headline ({name, value, unit, window, as_of}, lib/free-decision-taste.mjs) when no reader below applies.

const MW_NOT_HELD = 'MW not held';
export { MW_NOT_HELD };
const rowsOf = (p, keys) => { for (const k of keys) if (Array.isArray(p[k])) return p[k]; return null; };
const placeOf = (args, p) => one((args && (args.market || args.state || args.iso || args.query || args.location))
  || (isObj(p.scope) && (p.scope.market || p.scope.state)) || p.market || p.state || p.iso || '');
const humanName = (n) => one(String(n || '').replace(/_(pct|gw|mw|mwh|kwh|cents_kwh|usd|count)$/i, '').replace(/_/g, ' '));

// get_pipeline: the projects on record and their MW. A null capacity is said as "MW not held", never as 0 MW
// (gap 5: Ohio returned 2 rows with capacity null and the answer gave no figure and no reason).
// /api/v1/pipeline rows carry `capacity` and `project`, not capacity_mw and name: reading only capacity_mw said
// "MW not held" for the 600 MW Stargate Abilene row (Grok weekly brief 2026-11-18). A preview nulls capacity on
// every row; that is said as withheld, not as not held, and the count is the full list length, not the rows shown.
const PIPELINE_MW_WITHHELD = 'MW withheld at this access level';
export { PIPELINE_MW_WITHHELD };
const rowMw = (r) => (isObj(r) ? (num(r.capacity_mw) ?? num(r.capacity)) : null);
const pipelinePreview = (p) => p.preview_is_partial === true || p.trial_preview === true
  || (Array.isArray(p._locked_fields) && p._locked_fields.some((f) => /capacity/i.test(String(f))));
function pipelineFacts(p, args) {
  const rows = rowsOf(p, ['projects', 'data', 'results', 'pipeline']) || [];
  const total = num(p.total) ?? num(p.count) ?? num(p.total_count)
    ?? num(p._data_total_available) ?? num(p._pipeline_total_available) ?? num(p._projects_total_available);
  const n = total != null ? total : rows.length;
  if (!n) return [];
  const where = placeOf(args, p);
  // be#9030: rows marked confidence=reported are projects named in a linked article, MW as the article states
  // it. Two articles can describe one project, so their MW is never summed; they are counted apart.
  const cur = rows.filter((r) => !(isObj(r) && r.confidence === 'reported'));
  const cc = isObj(p.confidence_coverage) ? p.confidence_coverage : null;
  // The backend names these curated_count / reported_count so a preview nulls them; bare names are the first shape.
  const rep = (cc && (num(cc.reported_count) ?? num(cc.reported))) ?? (rows.length - cur.length);
  const curN = (cc && (num(cc.curated_count) ?? num(cc.curated))) ?? (rep ? cur.length : n);
  const mws = cur.map(rowMw).filter((x) => x != null);
  const sum = mws.reduce((a, b) => a + b, 0);
  const d = stepAsOf(p);
  const first = rows.length && isObj(rows[0]) ? one(rows[0].name || rows[0].project) : '';
  const named = one(args && args.query) && first
    ? ` First match: ${first}${one(rows[0].status) ? ` (${one(rows[0].status)})` : ''}.` : '';
  const unsized = pipelinePreview(p) ? PIPELINE_MW_WITHHELD : MW_NOT_HELD;
  const mwPart = !curN ? ''
    : mws.length
      ? `, ${fmt(Math.round(sum * 10) / 10)} MW across the ${mws.length === cur.length ? '' : `${mws.length} `}project${mws.length === 1 ? '' : 's'} that state a size`
        + (mws.length < cur.length ? `; ${unsized} for ${cur.length - mws.length}` : '')
      : `; ${unsized} for ${curN === 1 ? 'it' : 'them'}`;
  const repPart = rep > 0
    ? `${curN ? '; ' : ', '}${fmt(rep)} more reported in linked news articles (each with its source; MW as the article states it, not summed)`
    : '';
  const count = rep > 0 ? curN : n;
  return [{ tool: 'get_pipeline', as_of: d, entity: where,
    text: `${where ? `${where} ` : ''}data-center pipeline: ${fmt(count)} ${rep > 0 ? 'curated ' : ''}project${count === 1 ? '' : 's'} on record`
      + `${mwPart}${repPart} (DC Hub pipeline${d ? `, as of ${d}` : ''}).${named}` }];
}

// get_market_dcpi_rank: the market's verdict, as served.
function dcpiFacts(p, args) {
  const v = typeof p.verdict === 'string' ? p.verdict.trim().toUpperCase() : '';
  if (!/^(BUILD|CAUTION|AVOID)$/.test(v)) return [];
  const m = one(p.market_name || p.market || (args && args.market_slug) || p.market_slug).replace(/-/g, ' ');
  const d = day(p.computed_at) || stepAsOf(p);
  return [{ tool: 'get_market_dcpi_rank', as_of: d, entity: m,
    text: `${m ? m.replace(/\b[a-z]/g, (c) => c.toUpperCase()) + ' ' : ''}DCPI verdict: ${v}${num(p.composite_score) != null ? ` (${p.composite_score})` : ''}`
      + `${d ? ` (DCPI, as of ${d})` : ''}.` }];
}

// analyze_site: the site-level verdict band the step returned (site_teaser.verdict on a preview, verdict in full).
export function siteVerdictOf(p) {
  if (!isObj(p)) return null;
  for (const v of [p.verdict, isObj(p.site_teaser) && p.site_teaser.verdict, isObj(p.preview_bands) && p.preview_bands.verdict]) {
    const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
    if (/^(BUILD|CAUTION|AVOID)$/.test(t)) {
      const pw = isObj(p.site_teaser) && typeof p.site_teaser.power_infrastructure === 'string' ? p.site_teaser.power_infrastructure : null;
      return { verdict: t, power: pw };
    }
  }
  return null;
}
function siteFacts(p, args) {
  const sv = siteVerdictOf(p);
  if (!sv) return [];
  const where = num(args && args.lat) != null ? `${args.lat}, ${args.lon}` : one(args && (args.address || args.location)) || 'the site';
  return [{ tool: 'analyze_site', as_of: stepAsOf(p), entity: where,
    text: `Site read at ${where} (analyze_site): ${sv.verdict}${sv.power ? `; power infrastructure ${sv.power}` : ''} (site-level band).` }];
}

// get_grid_data: the live reading, or nothing (an EU zone with no stored load and no shares is a null step).
export function gridReadingOf(p) {
  if (!isObj(p)) return null;
  const m = isObj(p.metrics) ? p.metrics : {};
  const val = (k) => (isObj(m[k]) ? num(m[k].value) : null);
  const out = {
    demand_mw: num(p.demand_mw) ?? val('demand_mw'),
    renewable_pct: num(p.renewable_pct) ?? val('renewable_pct') ?? num(p.renewable_share_pct),
    gas_pct: num(p.gas_pct) ?? val('gas_pct') ?? num(p.gas_share_pct),
    generation_total_mw: val('generation_total_mw'),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}
function gridDataFacts(p, args) {
  const r = gridReadingOf(p);
  if (!r) return [];
  const g = one(p.iso || (args && args.iso));
  const d = day(p.newest_at) || stepAsOf(p);
  const parts = [];
  if (r.demand_mw != null) parts.push(`demand ${fmt(Math.round(r.demand_mw))} MW`);
  if (r.gas_pct != null) parts.push(`gas ${r.gas_pct}% of generation`);
  if (r.renewable_pct != null) parts.push(`renewables ${r.renewable_pct}%`);
  if (!parts.length && r.generation_total_mw != null) parts.push(`generation ${fmt(Math.round(r.generation_total_mw))} MW`);
  return [{ tool: 'get_grid_data', as_of: d, entity: g,
    text: `${g ? `${g} ` : ''}live grid reading: ${parts.join(', ')} (grid operator feed${d ? `, as of ${d}` : ''}).` }];
}

// get_changes: how much moved in the window (counts of the arrays the diff holds).
function changesFacts(p) {
  const diff = isObj(p.diff) ? p.diff : (isObj(p.changes) ? p.changes : null);
  if (!diff) return [];
  const parts = Object.entries(diff).filter(([, v]) => Array.isArray(v) && v.length)
    .slice(0, 4).map(([k, v]) => `${v.length} ${humanName(k)}`);
  if (!parts.length) return [];
  const d = day(p.generated_at) || stepAsOf(p);
  return [{ tool: 'get_changes', as_of: d, entity: 'changes',
    text: `Since ${one(p.since) || 'the last pull'}: ${parts.join(', ')} (DC Hub change feed${d ? `, as of ${d}` : ''}).` }];
}

// Any step: taste.headline when it holds a value.
function tasteFacts(tool, p, args) {
  const h = isObj(p.taste) && isObj(p.taste.headline) ? p.taste.headline : null;
  if (!h || h.value == null || (typeof h.value !== 'number' && typeof h.value !== 'string') || h.value === '') return [];
  const ent = pointOf(args) || placeOf(args, p);
  const d = day(h.as_of) || stepAsOf(p);
  const unit = one(h.unit);
  const val = typeof h.value === 'number' ? fmt(h.value) : one(h.value);
  const label = humanName(h.name) || tool.replace(/^get_/, '').replace(/_/g, ' ');
  return [{ tool, as_of: d, entity: ent,
    text: `${ent ? `${ent} ` : ''}${label}: ${val}${unit && !/verdict/i.test(unit) ? (unit === '%' ? '%' : ` ${unit}`) : ''}`
      + `${h.window ? ` (${one(h.window)}` : ' ('}${h.window ? ', ' : ''}DC Hub${d ? `, as of ${d}` : ''}).` }];
}

// ---- 5.37 (Grok dominance evals, gaps 4 and 6): a point read is about the POINT ----
// A step that ran at a lat/lon is labelled by that point, never by a state or market the response carried (a New York
// point read must not group, or print, as New Jersey because the nearest record sits across the river).
const pointOf = (args) => (args && num(args.lat) != null && num(args.lon) != null ? `${args.lat}, ${args.lon}` : '');

// get_infrastructure: counts inside the box around the point, by asset class. A null count is "not measured", never 0.
const INFRA_NAMES = { substations: 'substations', transmission_lines_eia: 'transmission line segments',
  gas_pipelines: 'gas pipeline segments', discovered_power_plants: 'power plants' };
function infrastructureFacts(p, args) {
  const c = isObj(p.counts) ? p.counts : null;
  if (!c) return [];
  const f = isObj(p.filter) ? p.filter : {};
  const where = pointOf(args) || (num(f.lat) != null ? `${f.lat}, ${f.lon}` : '');
  if (!where) return [];
  const r = num(f.radius_km) ?? num(args && args.radius_km);
  const have = [], unmeasured = [];
  for (const [k, label] of Object.entries(INFRA_NAMES)) {
    if (!(k in c)) continue;
    const n = num(c[k]);
    if (n == null) unmeasured.push(label); else have.push(`${fmt(n)} ${label}`);
  }
  if (!have.length) return [];
  const d = stepAsOf(p);
  return [{ tool: 'get_infrastructure', as_of: d,
    text: `Within ${r != null ? `${fmt(r)} km` : 'the radius'} of ${where}: ${have.join(', ')}`
      + `${unmeasured.length ? `; ${unmeasured.join(', ')} not measured` : ''} (HIFLD/EIA asset counts, box search${d ? `, as of ${d}` : ''}).` }];
}

// get_subsea_cables near a point: the nearest landing point and its distance, and how many are in range.
function subseaFacts(p, args) {
  const pts = Array.isArray(p.landing_points) ? p.landing_points.filter(isObj) : null;
  if (!pts) return [];
  const q = isObj(p.query) ? p.query : {};
  const where = pointOf(args) || (num(q.lat) != null ? `${q.lat}, ${num(q.lng) ?? q.lon}` : 'the point');
  const r = num(q.radius_km) ?? num(args && args.radius_km);
  const d = stepAsOf(p);
  const src = ` (DC Hub subsea landing points${d ? `, as of ${d}` : ''}).`;
  if (!pts.length) return [{ tool: 'get_subsea_cables', as_of: d, text: `No subsea landing point within ${r != null ? `${fmt(r)} km` : 'the radius'} of ${where}${src}` }];
  const n = pts[0];
  const km = num(n.distance_km);
  const total = num(p.total_nearby) ?? pts.length;
  return [{ tool: 'get_subsea_cables', as_of: d,
    text: `Nearest subsea landing to ${where}: ${one(n.name) || 'a landing point'}${km != null ? `, ${km} km` : ''}; `
      + `${fmt(total)} landing point${total === 1 ? '' : 's'} within ${r != null ? `${fmt(r)} km` : 'the radius'}${src}` }];
}

// get_peering_intel at a point: PeeringDB counts (never the derived score), withheld counts left out.
function peeringFacts(p, args) {
  const c = isObj(p.connectivity) ? p.connectivity : p;
  const parts = [];
  const fac = num(c.facilities_nearby); if (fac != null) parts.push(`${fmt(fac)} facilities nearby`);
  const ix = num(c.total_ix_presence); if (ix != null) parts.push(`${fmt(ix)} IX presences`);
  const nets = num(c.total_networks); if (nets != null) parts.push(`${fmt(nets)} networks`);
  if (!parts.length) return [];
  const where = pointOf(args) || 'the point';
  const d = stepAsOf(p);
  return [{ tool: 'get_peering_intel', as_of: d, text: `Peering around ${where}: ${parts.join(', ')} (PeeringDB${d ? `, as of ${d}` : ''}).` }];
}

// ---- 5.40 (Grok energy + cross-domain round 2, 2026-11-17): power-side steps that returned figures no fact carried ----

// get_refined_queue: the requests matching the filters (a state slice when state= was set), dated by the ISO file.
// A request count, never MW: keyless rows withhold MW and a request is not built capacity.
export function refinedQueueFacts(p) {
  const total = num(p.count_total_matching);
  if (total == null) return [];
  const fa = isObj(p.filters_applied) ? p.filters_applied : {};
  const st = typeof fa.state === 'string' && /^[A-Z]{2}$/.test(fa.state) ? fa.state : '';
  const iso = typeof fa.iso === 'string' ? fa.iso.toUpperCase() : '';
  const status = typeof fa.status === 'string' && fa.status ? fa.status.toLowerCase() : 'active';
  // The loaders drop withdrawn rows, so a withdrawn count of 0 is "not served", never a fact (Grok 2026-11-18 e7).
  if (status === 'withdrawn' && total === 0) return [];
  const fr = isObj(p.freshness_by_iso) ? Object.values(p.freshness_by_iso).filter(isObj) : [];
  const d = fr.map((f) => day(f.source_as_of)).filter(Boolean).sort()[0] || null;
  const fuel = isObj(p.summary) && isObj(p.summary.by_fuel_class) ? p.summary.by_fuel_class : null;
  const firm = fuel ? num(fuel['firm/baseload-capable']) : null;
  const where = `${iso || 'US'} interconnection queue${st ? `, ${st} slice` : ''}`;
  return [{ tool: 'get_refined_queue', as_of: d, entity: [iso, st].filter(Boolean).join(' ') || null, _slice: !!st, _status: status, _count: total,
    text: `${where}: ${fmt(total)} ${status === 'all' ? '' : `${status} `}generation request${total === 1 ? '' : 's'}`
      + `${firm != null && status !== 'withdrawn' ? ` (${fmt(firm)} firm or baseload-capable)` : ''}`
      + ` (${iso || 'ISO'} queue file${d ? `, as of ${d}` : ''}; a request count, not MW or headroom).` }];
}

// get_hosting_capacity: utility-published feeder hosting capacity near a point. The feeder table is distribution
// grain (single-digit MW per feeder), never a site's available load: said as not binding.
export function hostingFacts(p, args) {
  const tot = isObj(p.totals) ? p.totals : {};
  const n = num(tot.feeders);
  if (!n) return [];
  const head = typeof p.headline === 'string' ? p.headline : '';
  const best = num(tot.max_mw) ?? (() => { const m = head.match(/best\s+([\d.]+)\s*MW/i); return m ? Number(m[1]) : null; })();
  const utils = isObj(p.utilities) ? Object.keys(p.utilities).slice(0, 2).map((u) => u.replace(/\s*\((?:load|gen|bus headroom)\)\s*$/i, '')) : [];
  const ctype = isObj(p.capacity_by_type) && isObj(p.capacity_by_type.load) ? 'load-serving ' : '';
  const d = stepAsOf(p);
  const at = isObj(args) && args.place_label ? String(args.place_label) : '';
  return [{ tool: 'get_hosting_capacity', as_of: d,
    text: `Utility-published ${ctype}feeder hosting capacity${at ? ` near ${at}` : ''}: ${fmt(n)} feeders${best != null ? `, best ${fmt(best)} MW` : ''}`
      + `${utils.length ? ` (${utils.join(', ')})` : ''}; distribution grain, not binding: verify with the utility${d ? ` (as of ${d})` : ''}.`,
    _short: `utility feeder hosting capacity ${fmt(n)} feeders${best != null ? `, best ${fmt(best)} MW` : ''}${utils.length ? ` (${utils[0]}; not binding)` : ' (not binding)'}` }];
}

// get_retirement_headroom: filed generator retirements in the region (EIA-860M), each with its date. A filing, not a
// promise: the utility's current plan may keep the unit running.
export function retirementFacts(p) {
  const rows = Array.isArray(p.data) ? p.data.filter((r) => isObj(r) && isObj(r.generator)) : [];
  if (!rows.length) return [];
  const g = rows[0].generator;
  const meta = isObj(p.meta) ? p.meta : {};
  const base = typeof meta.baseline_age === 'string' ? meta.baseline_age : null;
  const fa = isObj(p.filters_applied) ? p.filters_applied : {};
  const region = Array.isArray(fa.region_iso) ? fa.region_iso.join('/') : (typeof fa.region_iso === 'string' ? fa.region_iso : '');
  const mw = num(g.capacity_mw);
  const n = num(p.count_returned) ?? rows.length;
  return [{ tool: 'get_retirement_headroom', as_of: null, ...(base ? { collected_at: base } : {}),
    text: `Filed retirements${region ? ` in ${region}` : ''}: ${fmt(n)} returned; first ${one(g.name)}${g.generator_id ? ` unit ${one(String(g.generator_id))}` : ''}`
      + ` (${one(g.fuel_category || 'generator')}${mw != null ? `, ${fmt(mw)} MW` : ''}${g.county ? `, ${one(g.county)} County` : ''}${g.state ? `, ${one(g.state)}` : ''})`
      + `${g.retirement_date ? ` filed to retire ${day(g.retirement_date) || one(g.retirement_date)}` : ''}`
      + ` (EIA-860M${base ? ` baseline ${base}` : ''}${isObj(meta.irp_divergence) ? '; the utility\'s current plan may keep it running longer' : ''}).` }];
}

// get_power_availability_timeline with the MW withheld: the dated queue context it still carries (active requests
// located in the state), said as derived, so a keyless timeline is not read as "no power figure".
function timelineContextFacts(p, args) {
  const qc = isObj(p.queue_context) ? p.queue_context : null;
  const n = qc ? num(qc.active_projects) : null;
  if (n == null) return [];
  const st = one(p.state || (args && args.state));
  const d = day(qc.as_of);
  const isos = Array.isArray(qc.by_iso) ? qc.by_iso.filter(isObj).map((r) => one(r.iso)).filter(Boolean) : [];
  const mw = num(qc.active_mw);
  return [{ tool: 'get_power_availability_timeline', as_of: d,
    text: `${st ? `${st}: ` : ''}${fmt(n)} active generation requests located in the state${mw != null ? ` (${fmt(mw)} MW)` : ''}`
      + `${isos.length ? ` (${isos.join(', ')} queue rows)` : ''} (DC Hub derived from ISO queues${d ? `, as of ${d}` : ''}; congestion context, not a time to power).` }];
}

// get_gas_index: the state's Data Center Gas Index (DCGI) verdict and, when this caller can read it, the gas price.
export function gasIndexFacts(p, args) {
  const s = isObj(p.score) ? p.score : null;
  if (!s) return [];
  const st = one(s.state || p.state || (args && args.state));
  const d = day(s.data_as_of) || stepAsOf(p);
  const out = [];
  const price = num(s.gas_price);
  const win = Array.isArray(s.gas_price_window) && s.gas_price_window.length === 2 ? `${s.gas_price_window[0]} to ${s.gas_price_window[1]}` : '';
  if (price != null) {
    out.push({ tool: 'get_gas_index', as_of: d, entity: st || null, _gas_price: true,
      text: `${st ? `${st} ` : ''}natural-gas price: $${fmt(price)}/MMBtu (EIA${s.gas_price_sector ? ` ${one(s.gas_price_sector)}` : ''}${win ? `, trailing 12 months ${win}` : ''}${d ? `, as of ${d}` : ''}).` });
  } else if (s._gas_price_withheld) {
    out.push({ tool: 'get_gas_index', as_of: d, entity: st || null, _gas_price: true, _withheld: true,
      text: `${st ? `${st} ` : ''}natural-gas price: withheld at this access level${win ? ` (EIA trailing-12-month mean, ${win})` : ''}.` });
  }
  const v = typeof s.verdict === 'string' ? s.verdict.trim().toUpperCase() : '';
  if (v) {
    const bands = [s.gas_access_score_band ? `gas access ${one(s.gas_access_score_band)}` : '', s.gas_cost_score_band ? `gas cost ${one(s.gas_cost_score_band)}` : ''].filter(Boolean);
    out.push({ tool: 'get_gas_index', as_of: d, entity: st || null,
      text: `${st ? `${st} ` : ''}Data Center Gas Index (DCGI) verdict: ${v}${bands.length ? ` (${bands.join(', ')})` : ''}${d ? ` (as of ${d})` : ''}.` });
  }
  return out;
}

const BY_TOOL = {
  get_refined_queue: refinedQueueFacts,
  get_hosting_capacity: hostingFacts,
  get_retirement_headroom: retirementFacts,
  get_gas_index: gasIndexFacts,
  get_infrastructure: infrastructureFacts,
  get_subsea_cables: subseaFacts,
  get_peering_intel: peeringFacts,
  get_power_availability_timeline: timelineFacts,
  get_energy_prices: energyFacts,
  get_tax_incentives: taxFacts,
  get_fiber_readiness: fiberReadinessFacts,
  get_metro_fiber: metroFiberFacts,
  get_pipeline: pipelineFacts,
  get_market_dcpi_rank: dcpiFacts,
  analyze_site: siteFacts,
  get_grid_data: gridDataFacts,
  get_changes: changesFacts,
};

/** Facts from one step result ({tool, args, p}); ctx: { address }. Each fact carries `entity` (the place it is about). */
export function factsFromStep(tool, p, args, ctx = {}) {
  try {
    if (!isObj(p)) return [];
    const f = BY_TOOL[tool];
    let out = f ? f(p, args || {}, ctx || {}) : [];
    if (!out.length) out = tasteFacts(tool, p, args || {});
    const ent = pointOf(args || {}) || placeOf(args || {}, p);
    return out.map((x) => ({ ...x, entity: x.entity != null ? x.entity : ent }));
  } catch (_e) { return []; }
}

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}

/** A fact without its internal `_` marks (composers read them; facts[] never carries them). */
export function publicFact(f) {
  const o = {};
  for (const k of Object.keys(f || {})) if (!k.startsWith('_')) o[k] = f[k];
  return o;
}

/** Facts from every step that ran, in step order. executed: execute_plan's executed[]; fullByEntry optional. */
export function factsFromExecuted(executed, fullByEntry, ctx = {}) {
  const out = [];
  try {
    for (const e of Array.isArray(executed) ? executed : []) {
      if (!e || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
      const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
      if (!p) continue;
      for (const f of factsFromStep(e.tool, p, e.args, ctx)) if (!out.some((x) => x.text === f.text)) out.push(publicFact(f));
    }
  } catch (_e) { /* a fact is optional */ }
  return out;
}

/** The plain caveat for state-grain supply facts. */
export function stateGrainCaveat(state) {
  return `${state ? `${state}-wide` : 'State-wide'} supply signals, not a time to power for a specific load.`;
}
