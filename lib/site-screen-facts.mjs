// site-screen-facts.mjs -- planner 5.42: a site screen at a point says what each read found, not the verdict alone.
//
// WHY. Grok's LAND head-to-head (2026-11-18, L1 17/30 vs a FEMA flood MCP 23): "Screen 21571 Beaumeade Circle,
// Ashburn, VA for flood zone, zoning and parcel, nearby transmission and the grid context" (with lat/lon) led
// "Siting read for PJM (ISO): site verdict BUILD at 39.0186, -77.458" with an empty evidence[]. get_disaster_risk,
// get_water_risk and get_permitting_intel had run and none of their figures reached the answer; analyze_parcel and
// get_infrastructure never ran although the question named the parcel and transmission.
//
// WHAT.
//   * siteScreenSteps(text, coords, toolsAlready): analyze_parcel when the question asks about the parcel itself (its
//     boundary or size, zoning, acreage); get_infrastructure (10 km) when it names transmission, substations or power lines. Point reads only.
//   * siteScreenFacts(executed, fullByEntry, text): one line per read, each said with its source and grain:
//       flood       FEMA National Risk Index county ratings (riverine / coastal flooding), never called the parcel's
//                   flood zone
//       water       US Drought Monitor, dated by the week it reports
//       permitting  the state's permitting records, the newest in the site's own county first
//       infra       substations, transmission-line and gas-pipeline records within the radius (counts; the backend
//                   serves no nearest distance)
//       parcel      the hosted parcel's acreage, or that no hosted boundary covers the point
//     plus what the question asked that no read answers (the parcel's zoning designation, the FEMA flood zone when
//     only the full site report holds it).
// 5.50 (Grok daily 2026-11-19, item 13): every site screen at a point reads get_infrastructure, which now carries the
// nearest transmission line in km, and get_disaster_risk carries the FEMA NFHL flood zone AT the point
// (lib/site-point-depth.mjs). The flood line leads with the point's zone and keeps the county NRI rating as context;
// the transmission line leads with the nearest line's distance and keeps the radius counts.
// Pure; nothing here throws.
import { floodZoneText, nearestLineText } from './site-point-depth.mjs';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : null);
const fmt = (n) => n.toLocaleString('en-US');

// The parcel as a thing to read (its boundary, size, zoning), not "at this parcel" naming the place of a power question.
const PARCEL_RE = /\bacre(?:s|age)?\b|\bzoning\b|\bzoned\b|\bparcel\s+(?:boundar(?:y|ies)|size|data|info(?:rmation)?|id|lines?|details?|records?)\b|(?:\band|,)\s+parcels?\b|\blot\s+(?:size|lines?)\b/i;
const INFRA_RE = /\btransmission\b|\bsubstations?\b|\bpower\s+lines?\b|\bhigh[-\s]voltage\b|\bnearby\s+(?:power\s+)?infrastructure\b/i;
const ZONING_RE = /\bzoning\b|\bzoned\b/i;
const FLOOD_RE = /\bflood/i;

export const INFRA_RADIUS_KM = 10;

// Spec 2 (Grok, 2026-11-23). The backend's analyze_parcel carries new blocks, each behind its own backend flag
// (all default OFF): flood (FEMA NFHL zone, panel, BFE, LOMA/LOMR), contamination (EPA), zoning (Loudoun County
// only), owner (organization owners, Franklin County OH only) and coverage (where each field exists). The lines
// below say what those blocks hold; with the backend flags off the blocks are absent and nothing here changes.
// One planner switch on this server: DCHUB_SITE_FLOOD_V2 (default OFF) adds an analyze_parcel read to a site
// screen that asks for the flood zone or base flood elevation, so the parcel-point flood block reaches the answer.
const BFE_RE = /\bbase\s+flood\s+elevations?\b|\bBFE\b|\bflood\s*(?:zone|plain|way)s?\b|\bfloodplain\b|\bLOMA\b|\bLOMR\b/i;
const OWNER_RE = /\bowner(?:ship|s)?\b|\bowned\b|\bwho\s+owns\b/i;
const CONTAM_RE = /\bcontaminat|\bsuperfund\b|\bbrownfields?\b|\bRCRA\b|\bhazardous\s+waste\b|\benvironmental\b/i;
export function _siteFloodV2On(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_SITE_FLOOD_V2) || '').trim());
}

/** The point reads a site screen adds for what the question named (steps without numbers). */
export function siteScreenSteps(text, coords, toolsAlready) {
  const t = String(text || '').slice(0, 2000);
  const have = new Set(Array.isArray(toolsAlready) ? toolsAlready : []);
  // 5.46: a point still to be geocoded (a street address) is written as the '<site lat>' / '<site lon>' placeholders.
  const ok = (v) => num(v) != null || (typeof v === 'string' && /^<site (?:lat|lon)>$/.test(v));
  if (!isObj(coords) || !ok(coords.lat) || !ok(coords.lon)) return [];
  const pt = { lat: coords.lat, lon: coords.lon };
  const out = [];
  if (PARCEL_RE.test(t) && !have.has('analyze_parcel')) {
    out.push({ tool: 'analyze_parcel', depends_on: [], estimated_calls: 1, site_screen: 'parcel',
      why: 'The question names the parcel: the hosted county parcel boundary containing the point (acreage, parcel id), or a plain parcel_not_covered outside the hosted counties. Independent of the other reads: same wave.',
      args_hint: { ...pt } });
  }
  if (_siteFloodV2On() && BFE_RE.test(t) && !have.has('analyze_parcel') && !out.some((x) => x.tool === 'analyze_parcel')) {
    out.push({ tool: 'analyze_parcel', depends_on: [], estimated_calls: 1, site_screen: 'flood',
      why: 'The question asks for the flood zone or base flood elevation: analyze_parcel carries the FEMA National Flood Hazard Layer read at the parcel\'s point (zone, FIRM panel and date, static BFE, nearest BFE line, LOMA/LOMR) inside hosted parcel coverage. Independent of the other reads: same wave.',
      args_hint: { ...pt } });
  }
  // 5.50: every screen at a point, named or not (the nearest line in km is part of a site screen).
  if (!have.has('get_infrastructure')) {
    out.push({ tool: 'get_infrastructure', depends_on: [], estimated_calls: 1, site_screen: 'infrastructure',
      why: `${INFRA_RE.test(t) ? 'The question names transmission' : 'A site screen at a point'}: the nearest transmission line in km (EIA lines located at their HIFLD substation), plus substation, transmission-line and gas-pipeline records within ${INFRA_RADIUS_KM} km of the point. Independent of the other reads: same wave.`,
      args_hint: { ...pt, radius_km: INFRA_RADIUS_KM } });
  }
  return out;
}

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}

function stepsOf(executed, fullByEntry) {
  const by = {};
  for (const e of Array.isArray(executed) ? executed : []) {
    if (!e || !e.tool || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (p && !by[e.tool]) by[e.tool] = { e, p, args: isObj(e.args) ? e.args : {} };
  }
  return by;
}

function floodLine(s) {
  const p = s.p;
  const zone = floodZoneText(p.flood_zone_at_point);
  const county = countyFlood(p);
  if (zone) return `Flood: ${zone}${county ? ` County context: ${county}.` : ''}`;
  return county ? `Flood: ${county}; a county rating, not the parcel's FEMA flood zone.` : null;
}

function countyFlood(p) {
  if (p.coverage === 'unavailable' || !isObj(p.hazards)) return null;
  const riv = one(p.hazards['Riverine Flooding']);
  const coast = one(p.hazards['Coastal Flooding']);
  if (!riv && !coast) return null;
  const loc = isObj(p.location) ? p.location : {};
  const county = one(loc.county);
  const st = one(loc.state);
  const where = county ? `${county} County${st ? `, ${st}` : ''}` : (st || 'the county');
  const overall = isObj(p.disaster_risk) ? one(p.disaster_risk.rating) : '';
  const parts = [riv && `riverine flooding ${riv}`, coast && `coastal flooding ${coast}`].filter(Boolean).join(', ');
  return `${where} rates ${parts} in the FEMA National Risk Index${overall ? ` (all hazards: ${overall})` : ''}`;
}

function waterLine(s) {
  const p = s.p;
  const sev = one(p.dominant_severity) || one(p.drought_category);
  const score = num(p.water_stress_score);
  if (!sev && score == null) return null;
  const wk = isObj(p.latest_week) ? day(p.latest_week.date) : null;
  const st = one(p.state) || one(s.args.state);
  const src = one(p.source) || 'US Drought Monitor';
  return { text: `Water: ${[sev && `drought ${sev}`, score != null && `water stress ${score}/100`].filter(Boolean).join(', ')}`
    + `${st ? ` in ${st}` : ''} (${src}${wk ? `, week of ${wk}` : ''}).`, as_of: wk };
}

function permittingLine(s, county) {
  const p = s.p;
  const rows = (Array.isArray(p.records) ? p.records : []).filter(isObj);
  const count = num(p.count) ?? num(p._records_total_available) ?? (rows.length || null);
  const st = one(s.args.state) || one(rows[0] && rows[0].state);
  if (count == null && !rows.length) return null;
  const c = one(county).toLowerCase().replace(/\s+county$/, '');
  const near = c ? rows.filter((r) => one(r.jurisdiction).toLowerCase().replace(/\s+county$/, '') === c) : [];
  const newest = (near.length ? near : rows).slice().sort((a, b) => (day(b.updated_at) || '').localeCompare(day(a.updated_at) || ''))[0];
  let text = `Permitting: ${count != null ? `${fmt(count)} data-center permitting record${count === 1 ? '' : 's'}` : 'permitting records'} on file${st ? ` for ${st}` : ''} (DC Hub permitting intel).`;
  if (newest) {
    const what = one(newest.title) || one(newest.detail);
    const tag = [one(newest.jurisdiction), one(newest.class), one(newest.stage) || one(newest.stance),
      day(newest.effective_date) ? `effective ${day(newest.effective_date)}` : day(newest.updated_at) ? `record updated ${day(newest.updated_at)}` : '']
      .filter(Boolean).join(', ');
    if (what) text += ` ${near.length ? 'In this county' : 'Newest'}: "${what}"${tag ? ` (${tag})` : ''}.`;
  }
  return text;
}

function infraLine(s) {
  const c = isObj(s.p.counts) ? s.p.counts : null;
  if (!c) return null;
  const r = num(isObj(s.p.filter) ? s.p.filter.radius_km : null) ?? num(s.args.radius_km);
  const sub = num(c.substations);
  const tx = num(c.transmission_lines_eia);
  const gas = num(c.gas_pipelines);
  const parts = [sub != null && `${fmt(sub)} substation${sub === 1 ? '' : 's'}`,
    tx != null && `${fmt(tx)} transmission-line record${tx === 1 ? '' : 's'} (EIA snapshot)`,
    gas != null && `${fmt(gas)} gas-pipeline record${gas === 1 ? '' : 's'}`].filter(Boolean);
  const near = nearestLineText(s.p.nearest_transmission);
  if (!parts.length) return near ? `Transmission: ${near}` : null;
  const counts = `${parts.join(', ')} within ${r != null ? `${r} km` : 'the radius'} of the point (HIFLD/EIA, get_infrastructure)`;
  return near ? `Transmission: ${near} Within the radius: ${counts}.`
    : `Transmission: ${counts}; a count within the radius, not a distance to the nearest line.`;
}

function parcelLine(s) {
  const p = s.p;
  if (p.error === 'parcel_not_covered' || p.error_code === 'parcel_not_covered' || p.status === 'parcel_not_covered') {
    return 'Parcel: no hosted parcel boundary covers this point (analyze_parcel: parcel_not_covered).';
  }
  const hp = isObj(p.hosted_parcel) ? p.hosted_parcel : null;
  const acres = num(p.total_acres);
  if (!hp && acres == null) return null;
  const where = hp ? [one(hp.county) && `${one(hp.county)} County`, one(hp.state)].filter(Boolean).join(', ') : '';
  return `Parcel: ${acres != null ? `${acres.toLocaleString('en-US', { maximumFractionDigits: 1 })} acres` : 'boundary found'}`
    + `${hp && hp.parcel_id != null ? `, parcel ${hp.parcel_id}` : ''}${where ? ` (${where} GIS layer hosted by DC Hub)` : ''}.`;
}

const ft = (v) => `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ft`;

/** Spec 2 A: analyze_parcel's NFHL flood block as one line, or null. Never a zone letter as a BFE. */
export function parcelFloodLine(f) {
  if (!isObj(f)) return null;
  const confirm = one(f.confirm) || 'Confirm any flood determination on the official FEMA map.';
  if (f.status === 'timed_out' || f.status === 'unavailable') {
    return `Flood (FEMA NFHL at the parcel point): no answer (${f.status === 'timed_out' ? 'the flood map did not answer in time' : 'the flood map read failed'}); no flood determination is made. ${confirm}`;
  }
  if (f.status === 'not_mapped') {
    return `Flood (FEMA NFHL at the parcel point): FEMA maps no flood zone here (no digital flood map), not a finding of low risk. ${confirm}`;
  }
  if (f.status !== 'measured' || !one(f.zone)) return null;
  const parts = [`Zone ${one(f.zone)}${one(f.zone_subtype) ? ` (${one(f.zone_subtype).toLowerCase()})` : ''}`];
  if (f.sfha === true) parts.push('inside the Special Flood Hazard Area');
  else if (f.sfha === false) parts.push('outside the Special Flood Hazard Area');
  const bfe = num(f.static_bfe_ft);
  parts.push(bfe != null ? `static base flood elevation ${ft(bfe)}${one(f.static_bfe_datum) ? ` ${one(f.static_bfe_datum)}` : ''}` : 'no static base flood elevation');
  const line = num(f.nearest_bfe_line_ft);
  const dm = num(f.nearest_bfe_line_distance_m);
  if (line != null && dm != null) parts.push(`nearest BFE line ${ft(line)}, ${fmt(dm)} m away`);
  if (f.loma_lomr_present === true) parts.push('a LOMA or LOMR intersects the point');
  const panel = one(f.firm_panel);
  const eff = day(f.panel_effective_date);
  const src = panel ? `FIRM panel ${panel}${eff ? ` effective ${eff}` : ''}` : (eff ? `effective ${eff}` : '');
  return `Flood (FEMA NFHL at the parcel point${src ? `, ${src}` : ''}): ${parts.join('; ')}. ${confirm}`;
}

/** Spec 2 B: analyze_parcel's EPA contamination counts as one line, or null. */
export function parcelContaminationLine(c) {
  if (!isObj(c) || !(c.status === 'measured' || c.status === 'partial') || !isObj(c.counts)) return null;
  const r = num(c.radius_km);
  const n = (k) => (num(c.counts[k]) != null ? fmt(c.counts[k]) : 'not answered');
  return `Contaminated sites within ${r != null ? `${r} km` : 'the radius'} (U.S. EPA EMEF${day(c.as_of) ? `, as of ${day(c.as_of)}` : ''}): `
    + `Superfund ${n('superfund')}, RCRA ${n('rcra')} (regulated hazardous-waste handlers, not confirmed contamination), Brownfields ${n('brownfields')}.`;
}

/** Spec 2 C: the Loudoun zoning district, or null. */
export function parcelZoningLine(z) {
  if (!isObj(z) || !one(z.zone_code)) return null;
  const extra = [one(z.ordinance) && `ordinance ${one(z.ordinance)}`, one(z.case_number) && `case ${one(z.case_number)}`].filter(Boolean).join(', ');
  return `Zoning: ${one(z.zone_code)}${one(z.zone_name) ? ` (${one(z.zone_name)})` : ''}${extra ? `, ${extra}` : ''} (Loudoun County, VA zoning GIS${day(z.as_of) ? `, as of ${day(z.as_of)}` : ''}).`;
}

/** Spec 2 D: the organization owner, or that an individual owner is withheld; null otherwise. */
export function parcelOwnerLine(o) {
  if (!isObj(o)) return null;
  if (one(o.name)) return `Owner: ${one(o.name)} (organization owner, ${one(o.source) || 'county auditor'}).`;
  if (one(o.reason) === 'individual owner withheld') return 'Owner: individual owner withheld.';
  return null;
}

// analyze_site lists which site_context blocks it answered; their values come with the full site report.
function contextBlockAnswered(by, key) {
  const s = by.analyze_site;
  const blocks = s && isObj(s.p.site_context) && Array.isArray(s.p.site_context.blocks) ? s.p.site_context.blocks : [];
  return blocks.some((b) => isObj(b) && b.key === key && b.status === 'answered' && b.value === undefined);
}

/** { lines:[{tool, step, text, as_of}], flood, infra, not_established:[] } or null when no screen read ran. */
export function siteScreenFacts(executed, fullByEntry, text) {
  try {
    const by = stepsOf(executed, fullByEntry);
    const t = String(text || '');
    const lines = [];
    const ne = [];
    let flood = null;
    let infra = null;
    const dr = by.get_disaster_risk;
    // Grok Brain 2026-11-24 item 3: one flood line per answer. analyze_parcel and get_disaster_risk each read the
    // FEMA NFHL at the point; when one served a zone, the other's "not available" line contradicted it. The parcel
    // zone (it carries the BFE) leads when measured; otherwise the disaster-risk line; a failed read is dropped
    // whenever another read answered.
    // A "none mapped" answer also beats a failed read.
    const ap0 = by.analyze_parcel;
    const pflood = ap0 && isObj(ap0.p) && isObj(ap0.p.flood) ? ap0.p.flood : null;
    const dfz = dr && isObj(dr.p.flood_zone_at_point) ? dr.p.flood_zone_at_point : null;
    const rankOf = (f, zoneKey) => (!f ? 0 : f.status === 'measured' && one(f[zoneKey]) ? 3 : f.status === 'not_mapped' ? 2 : 1);
    const pRank = rankOf(pflood, 'zone');
    const dRank = rankOf(dfz, 'zone');
    const parcelZone = pRank === 3 || (pRank === 2 && dRank < 2);   // the parcel's flood line leads
    const drZone = dRank === 3;
    if (dr && !parcelZone) { flood = floodLine(dr); if (flood) lines.push({ tool: 'get_disaster_risk', step: dr.e.step, text: flood, as_of: null }); }
    const zoneRead = drZone || pRank === 3;
    if (!zoneRead && FLOOD_RE.test(t) && contextBlockAnswered(by, 'flood')) {
      ne.push('The FEMA flood zone at the point (National Flood Hazard Layer) is answered in analyze_site\'s full site report, not in this read.');
    }
    const wr = by.get_water_risk;
    const w = wr ? waterLine(wr) : null;
    if (w) lines.push({ tool: 'get_water_risk', step: wr.e.step, text: w.text, as_of: w.as_of });
    const pi = by.get_permitting_intel;
    const county = dr && isObj(dr.p.location) ? dr.p.location.county : '';
    const pl = pi ? permittingLine(pi, county) : null;
    if (pl) lines.push({ tool: 'get_permitting_intel', step: pi.e.step, text: pl, as_of: null });
    const gi = by.get_infrastructure;
    if (gi) { infra = infraLine(gi); if (infra) lines.push({ tool: 'get_infrastructure', step: gi.e.step, text: infra, as_of: null }); }
    const ap = by.analyze_parcel;
    const pa = ap ? parcelLine(ap) : null;
    if (pa) lines.push({ tool: 'analyze_parcel', step: ap.e.step, text: pa, as_of: null });
    // Spec 2: the parcel's new blocks, each present only when the backend's own flag is on.
    const app = ap && isObj(ap.p) ? ap.p : {};
    let pf = parcelFloodLine(app.flood);
    if (pf && parcelZone) {
      const county = dr ? countyFlood(dr.p) : null;
      if (county) pf += ` County context: ${county}.`;
      flood = pf;
    } else if (pf && flood) {
      pf = null;   // the parcel read gave no zone and the disaster-risk line already says the flood read
    }
    if (pf) lines.push({ tool: 'analyze_parcel', step: ap.e.step, text: pf, as_of: day(app.flood.as_of) });
    const pc = CONTAM_RE.test(t) ? parcelContaminationLine(app.contamination) : null;
    if (pc) lines.push({ tool: 'analyze_parcel', step: ap.e.step, text: pc, as_of: day(app.contamination.as_of) });
    const po = OWNER_RE.test(t) ? parcelOwnerLine(app.owner) : null;
    if (po) lines.push({ tool: 'analyze_parcel', step: ap.e.step, text: po, as_of: null });
    const pz = parcelZoningLine(app.zoning);
    if (pz) lines.push({ tool: 'analyze_parcel', step: ap.e.step, text: pz, as_of: day(app.zoning.as_of) });
    if (ZONING_RE.test(t) && !pz) {
      ne.push(Object.prototype.hasOwnProperty.call(app, 'zoning') && one(app.zoning_reason)
        ? `The parcel's zoning designation: ${one(app.zoning_reason)} (DC Hub reads lot zoning in Loudoun County, VA only).`
        : 'The parcel\'s zoning designation is not held by DC Hub; the permitting line is state and county records.');
    }
    if (isObj(app.coverage) && one(app.coverage.summary)) ne.push(`Coverage: ${one(app.coverage.summary)}`);
    if (!lines.length && !ne.length) return null;
    return { lines, flood, infra, not_established: ne };
  } catch (_e) { return null; }
}
