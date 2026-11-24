// power-rotation-1123.mjs -- planner 5.63: four POWER asks that misrouted (daily MCP head-to-head, 2026-11-23, POWER
// rotation, planner 5.62, keyless).
//
// WHY. Four of five power questions were answered from the wrong tools:
//   p2  "status of large-load interconnection in ERCOT: how many GW of large loads ... approved or energized?" took
//       dc_power_place (a data-center noun) and led with "3 facilities in TX on record". get_interconnection_queue
//       {iso:"ERCOT"} is the read that carries ERCOT's large-load (demand) queue.
//   p3  "How much firm generating capacity does Georgia have in MW, and how much new generation is planned or under
//       construction?" took facility_search on "under construction" and read the DATA-CENTER pipeline ("Under
//       construction in GA: no project on record"). New generation is get_power_pipeline (EIA-860M planned and
//       under-construction generators, keyless).
//   p4  "wholesale power price right now at the ERCOT North hub" took dc_power_place, whose ISO price step then had
//       state=TX injected; the backend answered the retail rate. A wholesale / LMP / hub / node ask is a price_now
//       question even beside a data-center noun, and the named hub (HB_NORTH) is passed.
//   p5  "What transmission constraints limit new large loads in Northern Virginia (Loudoun County), and what
//       transmission upgrades are planned?" took market_ranking and led "DCPI 20/100" with no intent_answer.
//       Transmission / constraint / congestion / upgrade asks read the lines and substations at the place
//       (get_infrastructure), the grid read (get_grid_intelligence) and the state's permitting / large-load context.
//
// WHAT. powerRotationRoute(text, d) names the class a question goes to (or null), and the two new classes'
// sequences and answers live here: power_supply (generation supply for a state) and grid_constraints (transmission
// at a place). buildLargeLoadAnswer leads an interconnection_queue plan that asked about large loads with the
// large-load figures, never the generation queue. Pure; nothing here throws. Kill: DCHUB_POWER_ROTATION_1123=0.
import { publicFact, factsFromStep } from './plan-step-facts.mjs';
import { phoenixDay } from './cite-day.mjs';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : (Math.round(n * 10) / 10).toLocaleString('en-US'));
const gw = (mw) => (Math.round(mw / 100) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// An as_of to its America/Phoenix calendar day ("2026-11-23 08:33:16+00:00" -> "2026-11-23"); never a time.
export function dayOf(v) {
  if (typeof v !== 'string') return null;
  // "2026-11-23 08:33:16.204394+00:00" -> "2026-11-23T08:33:16.204+00:00" (function replacers: no "$" literals in copy files)
  const s = v.trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, (_m, a, b) => `${a}T${b}`).replace(/(\.\d{3})\d+/, (_m, a) => a)
    .replace(/([+-]\d{2}):?(\d{2})$/, (_m, a, b) => `${a}:${b}`);
  return phoenixDay(s) || (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
}

export function powerRotationOn() {
  return !/^(0|false|no|off)$/i.test(String(process.env.DCHUB_POWER_ROTATION_1123 || '').trim());
}

const T = (text) => String(text || '').slice(0, 2000);

// ---- p2: large loads ----
const LARGE_LOAD_RE = /\blarge[-\s]loads?\b|\bload\s+interconnection\b|\bLLIS\b|\blarge[-\s]load\s+(?:queue|interconnection)\b/i;
const LL_STATUS_RE = /\b(?:status|how\s+many|how\s+much|GW|MW|queue[ds]?|request(?:s|ed|ing)?|approv(?:ed|al)|energi[sz](?:ed|e)|seeking|pending|in\s+line|backlog|total)\b/i;
export function largeLoadAsk(text) { const t = T(text); return LARGE_LOAD_RE.test(t) && LL_STATUS_RE.test(t); }

// ---- p3: generation supply ----
const GEN_SUPPLY_RE = /\b(?:firm\s+)?generat(?:ing|ion)\s+capacity\b|\bpower\s+plants?\b|\bnew\s+generation\b|\bgeneration\s+(?:supply|pipeline|fleet|planned|under\s+construction|coming\s+online)\b|\b(?:planned|new|proposed)\s+(?:power\s+)?(?:generators?|generating\s+units?|plants?)\b/i;
const MIX_RE = /\b(?:mix|percent(?:age)?s?|share\s+of|fuel\s+mix)\b/i;
const RETIRE_RE = /\bretir(?:e|es|ed|ing|ements?)\b/i;
export function generationSupplyAsk(text) { const t = T(text); return GEN_SUPPLY_RE.test(t) && /\bgenerat(?:ing|ion|ors?)\b|\bpower\s+plants?\b/i.test(t) && !MIX_RE.test(t) && !RETIRE_RE.test(t); }

// ---- p5: transmission constraints ----
// Both a network word and a limit word: "transmission lines near 33.45, -112.07" is a point read, not a constraint ask.
const NETWORK_RE = /\b(?:transmission|grid|lines?|substations?|network|wires)\b/i;
const LIMIT_RE = /\b(?:constraints?|constrained|congest(?:ion|ed)|upgrades?|bottlenecks?|limit(?:s|ing|ed)?|overloads?|reinforcements?)\b/i;
export function transmissionAsk(text) { const t = T(text); return /\btransmission\b|\bcongestion\b/i.test(t) && NETWORK_RE.test(t) && LIMIT_RE.test(t); }

// ---- p4: wholesale ----
const WHOLESALE_RE = /\b(?:wholesale|lmps?|locational\s+marginal|hub\s+prices?|(?:north|south|west|houston|pan)\s+hub|hb_[a-z]+|node|nodal|real[-\s]?time\s+(?:power\s+)?prices?|day[-\s]?ahead|spot\s+(?:power|electricity)\s+prices?)\b/i;
export function wholesaleAsk(text) { return WHOLESALE_RE.test(T(text)); }
// A second power side ("wholesale prices, grid headroom and the PJM queue") keeps the two-sided class.
const OTHER_SIDE_RE = /\b(?:headroom|queues?|interconnection|firm\s+supply|time[-\s]to[-\s]power|timeline|substations?|feeders?|hosting\s+capacity|transmission|retail)\b/i;
export function otherPowerSide(text) { return OTHER_SIDE_RE.test(T(text)); }
const ERCOT_HUBS = [[/\bnorth\b|\bhb_north\b/i, 'HB_NORTH'], [/\bhouston\b|\bhb_houston\b/i, 'HB_HOUSTON'],
  [/\bsouth\b|\bhb_south\b/i, 'HB_SOUTH'], [/\bwest\b|\bhb_west\b/i, 'HB_WEST'], [/\bpan\b|\bhb_pan\b/i, 'HB_PAN'],
  [/\bhub\s*average\b|\bhb_hubavg\b/i, 'HB_HUBAVG']];
/** The ERCOT pricing hub the question names ("ERCOT North hub" -> HB_NORTH), or null. Only when "hub" or HB_ is said. */
export function namedHub(text, iso) {
  const t = T(text);
  if (String(iso || '').toUpperCase() !== 'ERCOT') return null;
  if (!/\bhub\b|\bhb_[a-z]+\b/i.test(t)) return null;
  const m = t.match(/\bhb_[a-z]+\b/i);
  if (m) return m[0].toUpperCase();
  for (const [re, hub] of ERCOT_HUBS) {
    // the hub word must sit next to "hub" ("North hub", "hub ... North" within a few words), not "North Texas"
    const near = new RegExp(`${re.source.replace(/\\b/g, '')}\\s+hub|hub\\s+(?:\\w+\\s+){0,2}${re.source.replace(/\\b/g, '')}`, 'i');
    if (near.test(t)) return hub;
  }
  return null;
}

/**
 * Which class a POWER question goes to, or null to leave the planner's choice. d: planner signals; topId: the class
 * the planner would pick. Precedence: transmission (a large-load constraint ask is about lines), then large-load
 * status, then wholesale price, then generation supply. Comparisons, points, colocation and multi-place asks keep
 * their class.
 */
export function powerRotationRoute(text, d, topId) {
  try {
    if (!powerRotationOn()) return null;
    const t = T(text);
    if (!isObj(d)) return null;
    if (d.comparePair || (Array.isArray(d.isos) && d.isos.length > 1) || (Array.isArray(d.states) && d.states.length > 1)) return null;
    if (d.__colo && (d.__colo.metro || d.__colo.pair || d.__colo.address)) return null;
    if (d.candidateId || d.__address) return null;
    const keep = new Set(['point_infrastructure', 'site_analysis', 'colocation', 'pricing_out_of_scope', 'gas_price', 'queue_withdrawals', 'hosting_capacity', 'fiber', 'fiber_power_pairing', 'subsea_cables', 'iso_comparison', 'market_comparison', 'air_permits', 'deals_ma', 'incentives_tax', 'water_climate', 'named_campus', 'generation_mix']);
    if (keep.has(topId)) return null;
    const st = d.state || d.stateFromPlace || null;
    const place = !!(d.coords || d.market || st || d.iso);
    // A ranking ("which markets have the least transmission congestion") stays a ranking.
    const ranking = /\b(?:rank|best|top\s+\d|which\s+(?:markets?|states?|metros?|regions?))\b/i.test(t);
    if (transmissionAsk(t) && place && !ranking && (d.coords || st)) {
      return { cls: 'grid_constraints', why: 'a transmission / constraint / upgrade ask about one place' };
    }
    if (largeLoadAsk(t) && (d.iso || st === 'TX')) {
      return { cls: 'interconnection_queue', why: 'a large-load interconnection ask (the large-load queue, not facilities)', largeLoad: true };
    }
    if (wholesaleAsk(t) && !otherPowerSide(t) && (d.iso || (Array.isArray(d.isos) && d.isos.length === 1)) && /\bprices?|costs?|lmps?|\$|mwh\b/i.test(t)) {
      return { cls: 'price_now', why: 'a wholesale / LMP / hub price ask' };
    }
    if (generationSupplyAsk(t) && st && !ranking && !/\b(?:prices?|costs?|headroom|queues?|interconnection)\b/i.test(t)
      && ['facility_search', 'dc_capacity', 'unknown', 'grid_headroom', 'capacity_search', 'dc_power_place', 'market_outlook'].includes(topId)) {
      return { cls: 'power_supply', why: 'a generation-supply ask for one state (power plants, not data centers)' };
    }
    return null;
  } catch (_e) { return null; }
}

// ---- sequences ----
export function powerSupplySequence(d, stateIsoMeta) {
  const st = String((isObj(d) && (d.state || d.stateFromPlace)) || '').toUpperCase();
  const RTO = /^(PJM|ERCOT|MISO|SPP|CAISO|NYISO|ISONE|ISO-NE)$/;
  // Only a US RTO has a queue file; a state on SERC / WECC alone (GA, AZ) has none, and no queue step runs for it.
  const isos = ((isObj(stateIsoMeta) && stateIsoMeta[st]) || []).filter((i) => RTO.test(String(i)));
  const seq = [];
  const add = (tool, args, why, extra = {}) => seq.push({ step: seq.length + 1, tool, depends_on: [], estimated_calls: 1, why, args_hint: args, ...extra });
  add('get_power_pipeline', { state: st },
    `New generation in ${st}: planned and under-construction generators from EIA-860M (every balancing authority, including non-ISO utilities), with nameplate MW, status and planned online date.`);
  add('get_power_availability_timeline', { state: st },
    `Firm generating supply for ${st} by year (EIA-860M) and the queue context; firm-supply MW is withheld below a DC Hub licence, and the answer says so.`);
  if (isos.length) {
    add('get_refined_queue', { state: st, ...(isos.length === 1 ? { iso: isos[0] === 'ISO-NE' ? 'ISONE' : isos[0] } : {}) },
      `Generation interconnection requests located in ${st} on ${isos.join('/')}, dated by the ISO file.`);
  }
  return seq;
}

export function gridConstraintsSequence(d, stateIsoMeta) {
  const st = String((isObj(d) && (d.state || d.stateFromPlace)) || '').toUpperCase();
  const iso = (isObj(d) && d.iso) ? String(d.iso).toUpperCase() : (((isObj(stateIsoMeta) && stateIsoMeta[st]) || [])[0] || null);
  const seq = [];
  const add = (tool, args, why, extra = {}) => seq.push({ step: seq.length + 1, tool, depends_on: [], estimated_calls: 1, why, args_hint: args, ...extra });
  if (isObj(d) && d.coords && Number.isFinite(d.coords.lat) && Number.isFinite(d.coords.lon)) {
    add('get_infrastructure', { lat: d.coords.lat, lon: d.coords.lon, radius_km: Math.min(Math.max(d.radiusKm || 25, 10), 40) },
      'Transmission at the place: lines in the radius (230 kV and above counted), the nearest line with its voltage and operator, and substations.');
  }
  if (iso && /^(PJM|ERCOT|MISO|SPP|CAISO|NYISO|ISONE|ISO-NE)$/.test(iso)) {
    add('get_grid_intelligence', { iso: iso === 'ISO-NE' ? 'ISONE' : iso },
      `${iso} headroom and the constraint band DC Hub scores for the grid that serves the place.`);
  }
  // Planned transmission upgrades from the ISO's own project list (ERCOT TPIT, PJM RTEP, MISO MTEP, SPP STEP, ISO-NE,
  // CAISO TPP): the upgrade side of the question. NYISO and non-ISO states (Southeast) have no list.
  if (st && iso && /^(PJM|ERCOT|MISO|SPP|CAISO|ISONE|ISO-NE)$/.test(iso)) {
    add('get_infra_projects', { type: 'transmission', state: st, limit: 5 },
      `Planned and under-construction transmission upgrades located in ${st} from ${iso}'s own project list, counted by status and dated by the ISO release.`);
  }
  if (st) {
    add('get_permitting_intel', { state: st },
      `Permitting and large-load context for ${st}: moratoriums, zoning and tariff records that bear on new large loads.`);
  }
  return seq;
}

// ---- answers ----
function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}
function readSteps(executed, fullByEntry) {
  const out = [];
  for (const e of Array.isArray(executed) ? executed : []) {
    if (!e || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (p) out.push({ step: e.step, tool: e.tool, args: e.args || {}, p });
  }
  return out;
}
function answer(kind, geography, headline, facts, notEstablished, asOf) {
  const dates = facts.map((f) => f.as_of).filter((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  return { kind, requested_mw: null, geography, headline, verdict: null, evidence: facts.map((f) => f.text),
    not_established: notEstablished, as_of: asOf || dates[dates.length - 1] || null, relay: null,
    source: `Source: DC Hub (dchub.cloud)${(asOf || dates[dates.length - 1]) ? `, as of ${asOf || dates[dates.length - 1]}` : ''}; each figure dated in its own fact.`,
    facts: facts.map(publicFact) };
}

// Large-load metrics in the order a status answer reads them.
const LL_ORDER = [
  ['large_load_queue_total', 'large loads seeking interconnection'],
  ['data_center_load_in_queue', 'of it labelled data center'],
  ['approved_to_energize', 'approved to energize'],
  ['observed_energized', 'observed energized (peak consumption of approved loads)'],
  ['awaiting_approval_to_energize', 'finished every other step, awaiting approval to energize'],
];
export const LARGE_LOAD_PAGE = 'https://dchub.cloud/grid/large-load-queue';
export function buildLargeLoadAnswer(ctx, executed, fullByEntry) {
  try {
    if (!powerRotationOn() || !ctx || ctx.intent_class !== 'interconnection_queue' || !ctx.large_load) return null;
    const steps = readSteps(executed, fullByEntry);
    const q = steps.find((s) => s.tool === 'get_interconnection_queue');
    const iso = one((q && (q.p.iso || q.args.iso)) || ctx.iso || 'ERCOT').toUpperCase();
    const facts = [];
    const ne = [];
    const block = q && isObj(q.p.large_load) && Array.isArray(q.p.large_load.rows) ? q.p.large_load : null;
    if (block) {
      // newest row per metric; when two rows share a metric the backend's first (newest) wins
      const seen = new Map();
      for (const r of block.rows) if (isObj(r) && r.metric && !seen.has(r.metric) && num(r.value_mw) != null) seen.set(r.metric, r);
      for (const [m, label] of LL_ORDER) {
        const r = seen.get(m);
        if (!r) continue;
        const d = dayOf(r.as_of_date) || dayOf(r.published_date);
        facts.push({ tool: q.tool, step: q.step, entity: `${iso} large-load queue`, as_of: d, _metric: m, _gw: gw(r.value_mw),
          text: `${iso} large-load queue: ${gw(r.value_mw)} GW ${label} (${one(r.source_title) || iso}${d ? `, as of ${d}` : ''}).` });
      }
    }
    const llGw = q ? num(q.p.queued_large_load_gw) : null;
    if (!facts.length && llGw != null) {
      const d = dayOf(q.p.as_of);
      facts.push({ tool: q.tool, step: q.step, entity: `${iso} large-load queue`, as_of: d, _metric: 'large_load_queue_total', _gw: fmt(llGw),
        text: `${iso} large-load queue: ${fmt(llGw)} GW of large loads seeking interconnection (DC Hub from ${iso} reporting${d ? `, as of ${d}` : ''}).` });
      const share = num(q.p.queued_load_dc_share_pct);
      if (share != null) facts.push({ tool: q.tool, step: q.step, entity: `${iso} large-load queue`, as_of: d, text: `About ${fmt(share)}% of it is data-center load (${iso}${d ? `, as of ${d}` : ''}).` });
    }
    const hl = q && isObj(q.p.taste) && isObj(q.p.taste.headline) ? q.p.taste.headline : null;
    const genGw = hl && hl.name === 'queued_generation_gw' ? num(hl.value) : num(q && q.p.queued_generation_gw);
    const genDay = hl ? dayOf(hl.as_of) : null;
    const genLine = genGw != null ? `For context, ${iso}'s generation (supply) interconnection queue is ${fmt(genGw)} GW${genDay ? ` as of ${genDay}` : ''}; it is a separate queue and is not added to the load figure.` : '';
    // DC Hub holds a large-load (demand) queue for ERCOT only; another ISO's is not "withheld", it is not held.
    if (!facts.length && iso !== 'ERCOT') {
      if (!q) return null;
      ne.push(`DC Hub holds no large-load (demand) queue for ${iso}; it tracks ERCOT's. ${iso}'s queue here is generation (supply) requests.`);
      const gf = genGw != null ? [{ tool: q.tool, step: q.step, entity: `${iso} generation queue`, as_of: genDay, text: `${iso} generation interconnection queue: ${fmt(genGw)} GW requested generation, not load (${iso}${genDay ? `, as of ${genDay}` : ''}).` }] : [];
      return answer('large_load_queue', iso, `${iso} large-load interconnection: DC Hub holds no ${iso} large-load queue figure (it tracks ERCOT's).${genLine ? ` ${genLine}` : ''}`, gf, ne);
    }
    if (!facts.length) {
      ne.push(`${iso}'s large-load (demand) queue figures, and their approved / energized split, are withheld at this access level. ${iso}'s published large-load figures, dated and sourced: ${LARGE_LOAD_PAGE}`);
      if (!q) return null;
      const lead = `${iso} large-load interconnection: the large-load queue figures are withheld at this access level (dated, sourced figures: ${LARGE_LOAD_PAGE}).${genLine ? ` ${genLine}` : ''}`;
      const gf = genGw != null ? [{ tool: q.tool, step: q.step, entity: `${iso} generation queue`, as_of: genDay, text: `${iso} generation interconnection queue: ${fmt(genGw)} GW requested generation, not load (${iso}${genDay ? `, as of ${genDay}` : ''}).` }] : [];
      return answer('large_load_queue', iso, lead, gf, ne);
    }
    const total = facts.find((f) => f._metric === 'large_load_queue_total');
    const dc = facts.find((f) => f._metric === 'data_center_load_in_queue');
    const appr = facts.find((f) => f._metric === 'approved_to_energize');
    const en = facts.find((f) => f._metric === 'observed_energized');
    const parts = [];
    if (total) parts.push(`${total._gw} GW of large loads seeking interconnection${dc ? ` (${dc._gw} GW of it data centers)` : ''}`);
    if (appr) parts.push(`${appr._gw} GW approved to energize`);
    if (en) parts.push(`${en._gw} GW observed energized`);
    if (!appr && !en) ne.push(`The approved / energized split is not in this answer for ${iso}.`);
    const newest = facts.map((f) => f.as_of).filter(Boolean).sort().pop() || null;
    const lead = `${iso} large-load interconnection: ${parts.join('; ') || facts[0].text}. Each figure is dated and sourced in facts[] (${iso} reports via DC Hub, ${LARGE_LOAD_PAGE}).${genLine ? ` ${genLine}` : ''}`;
    return answer('large_load_queue', iso, lead, facts, ne, newest);
  } catch (_e) { return null; }
}

// EIA-860M status U / V / TS. "Regulatory approvals pending. Not under construction" is not.
const STATUS_UC = /(?<!\bnot\s)under\s+construction|\((?:U|V|TS)\)|\btesting\b/i;
export function buildPowerSupplyAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'power_supply') return null;
    const steps = readSteps(executed, fullByEntry);
    const pp = steps.find((s) => s.tool === 'get_power_pipeline');
    const tl = steps.find((s) => s.tool === 'get_power_availability_timeline');
    const st = one((pp && pp.args.state) || (tl && tl.args.state) || ctx.state || '').toUpperCase();
    const facts = [];
    const ne = [];
    let lead = '';
    if (pp) {
      const p = pp.p;
      const d = dayOf(p.as_of) || dayOf(isObj(p.citation) ? p.citation.as_of : null);
      const total = num(p.total_planned_mw);
      const count = num(p.count);
      const rows = Array.isArray(p.largest_projects) ? p.largest_projects : [];
      let ucMw = 0; let ucN = 0;
      for (const r of rows) if (isObj(r) && STATUS_UC.test(String(r.status || '')) && num(r.capacity_mw) != null) { ucMw += r.capacity_mw; ucN += 1; }
      const bs = isObj(p.by_status) ? p.by_status : {};
      const ucCount = Object.entries(bs).filter(([k]) => STATUS_UC.test(k)).reduce((a, [, v]) => a + (num(v) || 0), 0);
      const tech = isObj(p.by_technology_mw) ? Object.entries(p.by_technology_mw).filter(([, v]) => num(v) != null).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
      if (total != null && count != null) {
        const techTxt = tech.length ? `; largest by technology: ${tech.map(([k, v]) => `${k.replace(/\s+/g, ' ').toLowerCase()} ${fmt(v)} MW`).join(', ')}` : '';
        facts.push({ tool: pp.tool, step: pp.step, entity: st, as_of: d,
          text: `${st}: ${count} planned or under-construction generators totalling ${fmt(total)} MW nameplate in this read (EIA-860M via DC Hub${d ? `, as of ${d}` : ''})${ucCount ? `, ${ucCount} of them under construction` : ''}${techTxt}.` });
        lead = `${st} new generation: ${count} planned or under-construction generators, ${fmt(total)} MW nameplate (EIA-860M${d ? `, as of ${d}` : ''})${ucCount ? `; ${ucCount} under construction` : ''}.`;
        if (ucN && ucMw) facts.push({ tool: pp.tool, step: pp.step, entity: st, as_of: d, text: `Under construction among the largest rows shown: ${ucN} units, ${fmt(Math.round(ucMw))} MW (EIA-860M${d ? `, as of ${d}` : ''}).` });
        const big = rows.filter((r) => isObj(r) && num(r.capacity_mw) != null).slice(0, 3)
          .map((r) => `${one(r.plant_name)} (${one(r.entity_name)}, ${fmt(r.capacity_mw)} MW ${String(r.technology || '').toLowerCase()}, ${String(r.status || '').replace(/^\([A-Z]+\)\s*/, '').toLowerCase()}${r.planned_year ? `, online ${r.planned_month ? `${String(r.planned_month).padStart(2, '0')}/` : ''}${r.planned_year}` : ''})`);
        if (big.length) facts.push({ tool: pp.tool, step: pp.step, entity: st, as_of: d, text: `Largest: ${big.join('; ')} (EIA-860M${d ? `, as of ${d}` : ''}).` });
      }
    }
    // Firm supply: the timeline's served MW, else the owner-policy withheld sentence (mcp#1700 / be#9305).
    const tlp = tl ? tl.p : null;
    const firm = tlp ? (num(tlp.firm_supply_mw) ?? num(isObj(tlp.firm_supply) ? tlp.firm_supply.mw : null)) : null;
    if (firm != null) {
      const d = dayOf(tlp.as_of);
      facts.unshift({ tool: tl.tool, step: tl.step, entity: st, as_of: d, text: `${st} firm generating supply: ${fmt(firm)} MW (EIA-860M via DC Hub${d ? `, as of ${d}` : ''}).` });
      lead = `${st} firm generating supply: ${fmt(firm)} MW${d ? ` (as of ${d})` : ''}. ${lead}`.trim();
    } else {
      ne.push(`${st || 'The state'}'s firm generating capacity (EIA-860M operating MW) is withheld at this access level.`);
      lead = `${lead}${lead ? ' ' : ''}${st || 'The state'}'s firm generating capacity in MW is withheld at this access level.`;
    }
    if (!facts.length) return null;
    return answer('power_supply', st || 'the state asked', lead, facts, ne);
  } catch (_e) { return null; }
}

// get_infra_projects (transmission): the summary's status counts and the highest-kV rows shown, dated by the release.
function upgradeFacts(s) {
  const p = s.p;
  const sm = isObj(p.summary) ? p.summary : null;
  const tx = sm && isObj(sm.by_type) && isObj(sm.by_type.transmission) ? sm.by_type.transmission : null;
  if (!tx || num(tx.matching) == null) return [];
  const st = one(s.args.state || '').toUpperCase();
  const bs = isObj(tx.by_status) ? Object.entries(tx.by_status).filter(([, v]) => num(v) != null).sort((a, b) => b[1] - a[1]) : [];
  const rows = Array.isArray(p.transmission_projects) ? p.transmission_projects.filter(isObj) : [];
  const isos = [...new Set(rows.map((r) => one(r.iso)).filter(Boolean))];
  // summary.as_of.transmission is the OLDEST release across every ISO list; one ISO's rows carry that ISO's own date.
  const src = isObj(p.sources) && isObj(p.sources.transmission) && Array.isArray(p.sources.transmission.per_iso) ? p.sources.transmission.per_iso : [];
  const own = isos.length === 1 ? src.find((x) => isObj(x) && one(x.iso).replace('-', '') === isos[0].replace('-', '')) : null;
  // A keyless preview may list only some ISOs in per_iso (live 2026-11-23: BPA/CAISO/ERCOT, no PJM); the rows of one ISO
  // then carry that ISO's own release (source_release), which beats the oldest-across-ISOs summary date.
  const rel = isos.length === 1 ? rows.map((r) => dayOf(r.source_release)).filter(Boolean).sort().pop() : null;
  const d = dayOf(own && own.as_of) || rel || dayOf(isObj(sm.as_of) ? sm.as_of.transmission : null);
  const out = [{ tool: s.tool, step: s.step, entity: st, as_of: d,
    text: `${st} planned transmission upgrades: ${fmt(tx.matching)} on file (${bs.map(([k, v]) => `${fmt(v)} ${k.toLowerCase()}`).join(', ')}; ${isos.length ? `${isos.join('/')} project list` : 'ISO project lists'}${d ? `, as of ${d}` : ''}).` }];
  const big = rows.filter((r) => num(r.kv) != null).sort((a, b) => b.kv - a.kv).slice(0, 2)
    .map((r) => `${fmt(r.kv)} kV ${one(r.description).slice(0, 90)}${one(r.owner) ? ` (${one(r.owner)}` : ' ('}${one(r.status) ? `, ${one(r.status).toLowerCase()}` : ''}${one(r.projected_isd) ? `, in service ${one(r.projected_isd).slice(0, 10)}` : ''})`);
  if (big.length) out.push({ tool: s.tool, step: s.step, entity: st, as_of: d, text: `Highest-voltage upgrades shown: ${big.join('; ')}.` });
  return out;
}

export function buildGridConstraintsAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'grid_constraints') return null;
    const steps = readSteps(executed, fullByEntry);
    const inf = steps.find((s) => s.tool === 'get_infrastructure');
    const gi = steps.find((s) => s.tool === 'get_grid_intelligence');
    const pi = steps.find((s) => s.tool === 'get_permitting_intel');
    const label = one(ctx.place_label || '') || one(ctx.state || '') || 'the place asked';
    const facts = [];
    const ne = [];
    const leadParts = [];
    if (inf) {
      const p = inf.p;
      const nt = isObj(p.nearest_transmission) ? p.nearest_transmission : null;
      const c = isObj(p.counts) ? p.counts : {};
      const r = num(isObj(p.filter) ? p.filter.radius_km : null) || num(inf.args.radius_km);
      const lines = nt ? num(nt.lines_in_radius) : null;
      const ehv = nt ? num(nt.ehv_230kv_plus) : null;
      const subs = num(c.substations);
      if (lines != null || subs != null) {
        const t = `Within ${r ? `${fmt(r)} km` : 'the radius'} of ${label}: ${lines != null ? `${fmt(lines)} transmission lines${ehv != null ? ` (${fmt(ehv)} at 230 kV or above)` : ''}` : ''}${lines != null && subs != null ? ' and ' : ''}${subs != null ? `${fmt(subs)} substations` : ''} (HIFLD / EIA via DC Hub; layer snapshot, no collection date).`;
        facts.push({ tool: inf.tool, step: inf.step, entity: label, as_of: null, text: t });
        leadParts.push(`${lines != null ? `${fmt(lines)} transmission lines${ehv != null ? ` (${fmt(ehv)} at 230 kV+)` : ''}` : ''}${lines != null && subs != null ? ' and ' : ''}${subs != null ? `${fmt(subs)} substations` : ''} within ${r ? `${fmt(r)} km` : 'the radius'}`);
      }
      if (nt && nt.status === 'measured' && num(nt.distance_km) != null) {
        const t = `Nearest transmission line: ${num(nt.voltage_kv) != null ? `${fmt(nt.voltage_kv)} kV` : 'voltage not held'}, ${fmt(nt.distance_km)} km away${one(nt.operator) ? `, ${one(nt.operator)}` : ''}${one(nt.substation) ? ` (from ${one(nt.substation)} substation)` : ''} (${one(nt.source) || 'EIA / HIFLD via DC Hub'}).`;
        facts.push({ tool: inf.tool, step: inf.step, entity: label, as_of: null, text: t });
        leadParts.push(`nearest line ${num(nt.voltage_kv) != null ? `${fmt(nt.voltage_kv)} kV ` : ''}${fmt(nt.distance_km)} km away`);
      }
    } else {
      ne.push(`No point was bound for ${label}, so the lines and substations there were not counted.`);
    }
    // The grid and permitting reads speak through the shared per-tool fact readers (the same lines every plan prints).
    for (const st of [gi, pi]) {
      if (!st) continue;
      const fs = factsFromStep(st.tool, st.p, st.args) || [];
      for (const f of fs.slice(0, 2)) if (isObj(f) && one(f.text)) facts.push({ ...f, step: st.step, as_of: dayOf(f.as_of) || f.as_of || null });
      if (st === gi && !fs.length) ne.push(`${one(gi.args.iso || '').toUpperCase() || 'The grid'} headroom figures are withheld at this access level.`);
      if (fs.length && one(fs[0].text)) leadParts.push(one(fs[0].text).replace(/\.$/, ''));
    }
    const ip = steps.find((s) => s.tool === 'get_infra_projects');
    const ipf = ip ? upgradeFacts(ip) : [];
    for (const f of ipf.slice(0, 2)) if (isObj(f) && one(f.text)) facts.push({ ...f, step: ip.step, as_of: dayOf(f.as_of) || f.as_of || null });
    if (ipf.length) leadParts.push(one(ipf[0].text).replace(/\.$/, ''));
    else ne.push(`Planned transmission upgrades for ${label} are not in this answer: ${ip ? 'the ISO project list returned no count for this caller' : 'no ISO project list DC Hub reads covers it (NYISO and non-ISO utilities publish none it holds)'}.`);
    // Every class emits an intent_answer: with no figure back, the lead says so rather than leaving a bare DCPI line.
    if (!facts.length) {
      return answer('grid_constraints', label, `Transmission at ${label}: no line, substation or grid figure came back for this caller; planned upgrades are not in this answer.`, [], ne);
    }
    const lead = `Transmission at ${label}: ${leadParts.join('; ')}. Each figure is sourced in facts[]${ipf.length ? '' : '; planned upgrades are not in this answer'}.`;
    return answer('grid_constraints', label, lead, facts, ne);
  } catch (_e) { return null; }
}
