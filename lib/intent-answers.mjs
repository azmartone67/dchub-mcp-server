// intent_answer for execute_plan: the first answer for the three most repeated non-ranking asks
// (Grok/owner, MCP leadership plan item 2, 2026-10-17): SITING ("find a site for 150 MW in
// Ohio"), POWER TIMING ("how soon can I get 100 MW in ERCOT") and MARKET CHECK ("is Columbus a
// good market"). Sibling of lib/ranked-answer.mjs (market ranking).
//
// Measured on prod 2026-10-18 (anonymous, read-only), why this exists:
//   - siting and power-timing plans skip their DCPI step ("skipped_unresolved: market_slug"), so
//     the envelope carries NO BUILD/CAUTION/AVOID anywhere, and the agent writes its own.
//   - "is Columbus a good market" routed to market_ranking and DCPI-checked Canton and Akron
//     (both AVOID), never Columbus. An agent that joins steps by itself reports Columbus as AVOID.
//
// PURE: no I/O, never throws (returns null). It reads only the step payloads the caller's own
// tier received, so it is exactly as tier-honest as the steps. RULES:
//   1. A verdict (BUILD/CAUTION/AVOID) is only ever copied from a DCPI read. A market verdict
//      requires a get_market_dcpi_rank step for the market the user ASKED about; an ISO band comes
//      from the grid taste and is labelled scope "iso". Otherwise verdict is null and
//      not_established says why. Nothing is inferred or averaged.
//   2. A withheld field stays withheld (null). A count shown is a count the step returned.
//   3. as_of is the OLDEST data date among the steps used; a stale input is named, not hidden.
//   4. `source` is the last key: one citable line. `relay` is filled later by attachIntentRelay
//      from the ONE link the response already carries (never minted here).

import { gridLabel } from './dc-power-place.mjs';
import { requestedMw } from './ranked-answer.mjs';
import { sourceLine, dataAsOfDay } from './source-line.mjs';
import { factsFromStep, stateGrainCaveat, siteVerdictOf } from './plan-step-facts.mjs';
import { SPLIT_STATE_NOTE } from './plan-entities.mjs';
import { buildFiberAnswer } from './fiber-answer.mjs';
import { siteScreenFacts } from './site-screen-facts.mjs';
// 5.40: the US RTOs; any other grid label in constraint_iso is a reliability region or balancing authority.
const RTO_LABELS = new Set(['ERCOT', 'PJM', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISO-NE', 'ISONE']);

const VERDICTS = new Set(['BUILD', 'CAUTION', 'AVOID']);
const STALE_DAYS = 30;
// siting_search (planner 5.29, Grok note K): a siting question over several named states.
const SITING_CLASSES = new Set(['capacity_search', 'site_analysis', 'fiber_power_pairing', 'hosting_capacity', 'siting_search']);
const TIMING_CLASSES = new Set(['capacity_search', 'power_timeline', 'grid_headroom', 'interconnection_queue', 'siting_search']);
const MARKET_CLASSES = new Set(['market_ranking', 'market_comparison', 'market_outlook', 'site_analysis', 'capacity_search']);

// "fastest" / "quickest" / "soonest" (Grok colocation re-run 2026-11-17: "Fastest grid power in Texas" got no answer block).
const TIMING_RE = /\b(how\s+(soon|long|fast|quickly)|fastest|quickest|soonest|earliest|when\s+(can|could|will|would)|time[\s-]to[\s-]power|energi[sz]ation|lead\s+time|power\s+(timeline|timing|availability\s+timeline))\b/i;
const MARKET_CHECK_RES = [
  /\b(?:is|are)\s+(.{2,60}?)\s+(?:a|an|the)?\s*(?:good|great|viable|safe|solid|right|bad|smart|worthwhile|decent)\b/i,
  /\bshould\s+(?:i|we)\s+(?:build|site|locate|put|expand)(?:\s+a\s+data\s+cent(?:er|re))?\s+in\s+(.{2,60}?)\s*[?.!]?$/i,
  /\bmarket\s+check\s+(?:on|for)?\s*(.{2,60}?)\s*[?.!]?$/i,
  /\bhow\s+(?:is|does)\s+(.{2,60}?)\s+(?:look|rate|score|stack up)\b/i,
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// The two time-to-power series a power-timing run can read (item 1, 2026-11-16): named in the answer so an
// agent can say which one it quotes.
export const TTP_GRID_FIELD = 'get_grid_intelligence.avg_time_to_power_months';
export const TTP_QUEUE_FIELD = 'get_refined_queue.estimated_ttp_months';
export const TTP_MARKET_FIELD = 'get_market_dcpi_rank.time_to_power_months';
// 5.44 (Grok QA 2026-11-19): the deadline sentence beside a market's time to power. Its own scrub rule in server.mjs
// (_DCPI_PROSE_RULES) withholds the comparison below Pro along with the figure; keep the two in step.
// Grok 2026-11-20 P2: a miss says by how much ("Dallas 37.9 vs 36": by ~2 months), so a reader need not do the sum.
const monthsOver = (months, ttp) => Math.max(1, Math.round(ttp - months));
export const deadlineSentence = (months, ttp) => (ttp > months
  ? `That is past the ${months}-month deadline asked, by ~${monthsOver(months, ttp)} month${monthsOver(months, ttp) === 1 ? '' : 's'}.`
  : `That is within the ${months}-month deadline asked.`);
// The scrubbed form of deadlineSentence (server.mjs _DCPI_PROSE_RULES): the same words when the figure never arrived.
// 5.48: shorter, the same words the prose scrub writes (server.mjs _DCPI_PROSE_RULES).
export const deadlineWithheld = (months) => `The ${months}-month deadline check is withheld at this access level.`;
function parsed(full) {
  if (full && typeof full === 'object') return full;
  if (typeof full === 'string') { try { return JSON.parse(full); } catch (_e) { return null; } }
  return null;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const cap = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function classifyIntentAnswer(intent, intentClass) {
  const t = String(intent || '').slice(0, 1000);
  if (!t || !intentClass) return null;
  if (TIMING_CLASSES.has(intentClass) && TIMING_RE.test(t)) return 'power_timing';
  if (MARKET_CLASSES.has(intentClass) && MARKET_CHECK_RES.some((r) => r.test(t))) return 'market_check';
  if (SITING_CLASSES.has(intentClass) && (requestedMw(t) != null || /\b(site|sites|siting|land|parcel|campus)\b/i.test(t))) return 'siting';
  return null;
}

export function askedMarket(intent) {
  const t = String(intent || '').slice(0, 1000);
  for (const r of MARKET_CHECK_RES) {
    const m = r.exec(t);
    if (m && m[1]) {
      const name = norm(m[1]).replace(/^(the|a|an)\s+/, '').replace(/\s+(market|area|metro)$/, '');
      if (name && name.split(' ').length <= 5) return name;
    }
  }
  return null;
}

// "columbus-oh" matches "columbus"; "ashburn" matches "ashburn va"; a state suffix alone never matches.
function slugMatchesAsked(slug, asked) {
  if (!slug || !asked) return false;
  const s = norm(slug.replace(/-/g, ' '));
  if (s === asked) return true;
  const stripState = (x) => x.replace(/\s+[a-z]{2}$/, '');
  return stripState(s) === stripState(asked) && stripState(s).length >= 3;
}

function days(fromIso, now) {
  const t = Date.parse(fromIso);
  return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null;
}

// The steps that can carry a time-to-power figure (a preview of any of them withholds it).
const TIMING_TOOLS = new Set(['get_power_availability_timeline', 'get_refined_queue', 'get_grid_intelligence', 'get_interconnection_queue']);

function readSteps(executed, fullByEntry) {
  const out = [];
  for (const e of Array.isArray(executed) ? executed : []) {
    if (!e || e.status !== 'executed') continue;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (p) out.push({ tool: e.tool, args: e.args || {}, p });
  }
  return out;
}

function dcpiReads(steps) {
  const out = [];
  for (const s of steps) {
    if (s.tool !== 'get_market_dcpi_rank') continue;
    const v = typeof s.p.verdict === 'string' ? s.p.verdict.trim().toUpperCase() : '';
    if (!VERDICTS.has(v)) continue;
    // Grok 2026-11-20 P2: the slug the card answered under (canonical "dallas"), not the planner's mint ("dallas-tx");
    // `requested` keeps the mint so a named-market match still finds it.
    out.push({ slug: String(s.p.market_slug || s.args.market_slug || ''), requested: String(s.args.market_slug || ''), verdict: v,
      composite_score: num(s.p.composite_score), time_to_power_months: num(s.p.time_to_power_months), step: s });
  }
  return out;
}

// The DCPI verdict's OWN Source line: the page and date of the get_market_dcpi_rank read the verdict
// was copied from (finding #118323, Grok 2026-11-14). `source` below is deliberately dated by the
// OLDEST input (rule 3), so on "What is the data center power outlook for Kansas City?" it carried
// the market-intel read's 2026-09-26 (its newest facility discovery) while the DCPI score beside it
// was computed that day. A verdict is cited with the date of the read that produced it.
function verdictSource(s) {
  return s && s.p ? sourceLine(s.p, s.tool, s.args) : null;
}

// ISO-level DCPI band from the grid read (taste.band, or full-tier constraint/excess bands).
function isoBand(steps) {
  for (const s of steps) {
    if (s.tool !== 'get_grid_intelligence') continue;
    const b = s.p.taste && s.p.taste.band;
    const c = b && typeof b.constraint === 'string' ? b.constraint.trim().toUpperCase() : '';
    if (VERDICTS.has(c)) return { iso: s.p.iso || s.args.iso || null, band: c, step: s,
      ttp: num(s.p.avg_time_to_power_months) };
  }
  return null;
}

// Grok midday re-run 2026-11-17, Q-d: "where in Texas" led with "ERCOT/SPP/MISO/WECC (ISO)", the union of every
// grid touching the state. A state that is mostly one grid is said as that state on that grid.
export const STATE_PRIMARY_GRID = Object.freeze({ TX: 'ERCOT', VA: 'PJM' });

// The counties the returned queue rows sit in, most rows first: [{county, n}] (top 3), or []. Rows outside the state
// asked are left out. A preview returns a slice, so this says where the rows shown are, not a state-wide count.
export function queueCounties(rows, state) {
  const st = String(state || '').toUpperCase();
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.county !== 'string' || !r.county.trim()) continue;
    if (st && r.state && String(r.state).toUpperCase() !== st) continue;
    const c = r.county.trim().replace(/\s+county$/i, '');
    by.set(c, (by.get(c) || 0) + 1);
  }
  return [...by.entries()].map(([county, n]) => ({ county, n })).sort((a, b) => b.n - a.n || a.county.localeCompare(b.county)).slice(0, 3);
}

// analyze_site's verdict band, from an executed OR gated-preview step (a keyless site read is a preview that still
// carries site_teaser.verdict). { verdict, power, where, step } or null.
function siteRead(executed, fullByEntry) {
  for (const e of Array.isArray(executed) ? executed : []) {
    if (!e || e.tool !== 'analyze_site' || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    const sv = siteVerdictOf(p);
    if (!sv) continue;
    const a = e.args || {};
    const where = num(a.lat) != null && num(a.lon) != null ? `${a.lat}, ${a.lon}` : String(a.address || a.location || 'the site read');
    return { ...sv, where, step: { tool: e.tool, args: a, p } };
  }
  return null;
}

export function buildIntentAnswer(ctx, executed, fullByEntry, now = Date.now()) {
  try {
    // 2026-11-17 (Grok, planner 5.38): a fiber plan (carrier hotel / IX / metro fiber) had no answer block at all;
    // it gets its own, read from its peering and metro-fiber steps (lib/fiber-answer.mjs).
    if (ctx && ctx.intent_class === 'fiber') return buildFiberAnswer(ctx, executed, fullByEntry);
    const intent = ctx && ctx.intent;
    const kind = classifyIntentAnswer(intent, ctx && ctx.intent_class);
    if (!kind) return null;
    const steps = readSteps(executed, fullByEntry);
    if (!steps.length) return null;

    // The size the caller asked for: a typed capacity_mw / context min_mw (the planner's signal, the
    // figure the queue step ran with) beats the figure in the intent text (Grok QA 2026-11-06:
    // capacity_mw=150 on "100 MW sites in Ohio" ran min_mw=150 and the answer said "the 100 MW floor").
    const want = (typeof ctx.requested_mw === 'number' && Number.isFinite(ctx.requested_mw) && ctx.requested_mw > 0)
      ? ctx.requested_mw : requestedMw(intent);
    const isos = Array.isArray(ctx.constraint_iso) ? ctx.constraint_iso.filter((x) => typeof x === 'string') : [];
    const gap = ctx.resolution_gap && typeof ctx.resolution_gap === 'object' ? ctx.resolution_gap : null;
    const evidence = [];
    const notEstablished = [];
    const dates = [];
    let verdict = null;
    let basis = null;   // the step whose page the Source line cites
    let headline = '';
    let ttpUsed = null;  // power_timing: the ONE time-to-power figure the headline states, and its field
    let ledVerdict = null;  // power_timing: the named market's verdict, when the headline's lead already states it

    // 5.29 (Grok note K): several named states are the geography asked, said as states, not as the union
    // of their grids ("TX and AZ", not "ERCOT/SPP/MISO/WECC (ISO)").
    const states = Array.isArray(ctx.states) ? ctx.states.filter((x) => typeof x === 'string' && /^[A-Z]{2}$/.test(x)) : [];
    const oneState = states.length === 1 ? states[0] : (typeof ctx.state === 'string' && /^[A-Z]{2}$/.test(ctx.state) ? ctx.state : null);
    const splitState = oneState && isos.length > 1 ? oneState : null;
    const scope = states.length >= 2 ? `${states.slice(0, -1).join(', ')} and ${states[states.length - 1]} (states)`
      : splitState ? (STATE_PRIMARY_GRID[splitState] ? `${splitState} (mostly ${STATE_PRIMARY_GRID[splitState]})` : `${splitState} (${isos.join('/')})`)
      // 5.40 (Grok round 2, gap 6): WECC/SERC are reliability regions, not ISOs: "Phoenix (APS/SRP/TEP, WECC)".
      : isos.length ? (isos.every((x) => !RTO_LABELS.has(String(x).toUpperCase()))
        ? (gridLabel(ctx.place && typeof ctx.place === 'object' ? ctx.place : {}, isos[0]) || `${isos.join('/')} (reliability region, not an ISO)`)
        : `${isos.join('/')} (ISO)`)
      : (gap && gap.phrase ? `unscoped: "${gap.phrase}" is outside the tracked index` : 'no geography bound');

    if (splitState && SPLIT_STATE_NOTE[splitState]) evidence.push(SPLIT_STATE_NOTE[splitState]);

    // ---- evidence common to all three: queue, retirements, hosting capacity ----
    const queue = steps.find((s) => s.tool === 'get_refined_queue');
    let queueTtp = null;    // { lo, hi, rows }: the queue rows' estimated_ttp_months
    let queueAsOf = null;   // the queue's own data date (its dated report), for the Source-line choice below
    if (queue) {
      const total = num(queue.p.count_total_matching);
      const asOf = (queue.p.freshness_by_iso && Object.values(queue.p.freshness_by_iso)
        .map((f) => f && f.source_as_of).filter(Boolean).sort()[0]) || queue.p.source_as_of || null;
      if (asOf) { dates.push(asOf); queueAsOf = String(asOf).slice(0, 10); }
      const qs = queue.p.scope && queue.p.scope.state ? queue.p.scope : null;
      if (qs && qs.filtered_server_side) {
        // 5.27 (live QA 2026-11-14): get_refined_queue takes state= (5.15). When the backend applied it,
        // the rows and totals are the state's own; this used to say "the queue tool has no state filter".
        if (total != null) evidence.push(`${total} active interconnection-queue projects in ${qs.state} (the queue was filtered to ${qs.state} server-side)${asOf ? ` (queue data as of ${asOf})` : ''}.`);
        else if (qs.kept > 0) evidence.push(`${qs.kept} queue project${qs.kept === 1 ? '' : 's'} in ${qs.state} returned (the queue was filtered to ${qs.state} server-side; the ${qs.state} total is withheld at this tier).`);
        else notEstablished.push(`The queue filtered to ${qs.state} server-side returned no projects in this read.`);
      } else if (qs) {
        // The step was cut to one state after the call (lib/siting-scope.mjs): the unscoped total is withheld, so say what the slice held.
        // 5.27: the queue tool HAS a state filter (state=); this read was not filtered by it, so say that instead.
        const asked = String((queue.args && queue.args.state) || '').toUpperCase() === qs.state;
        const why = asked ? `state=${qs.state} was asked but not applied by the queue backend` : `this read was not filtered by state= server-side`;
        if (qs.kept > 0) evidence.push(`${qs.kept} queue project${qs.kept === 1 ? '' : 's'} in ${qs.state} in the slice returned (${why}; this is a slice, not a ${qs.state} total).`);
        else notEstablished.push(`No ${qs.state} queue projects in the ${(qs.dropped_out_of_state || 0) + (qs.dropped_state_unreadable || 0)}-row slice returned (${why}); that is not proof there are none.`);
      } else if (total != null) {
        // A preview drops min_mw before counting (backend _refined_preview_args), so the count only
        // matches the floor when filters_applied says the floor was applied. Grok QA 11-05: "311 match
        // the 300 MW floor" on a run whose filters_applied.min_mw was null.
        const fa = queue.p.filters_applied && typeof queue.p.filters_applied === 'object' ? queue.p.filters_applied : null;
        const floorOn = want != null && fa != null && num(fa.min_mw) != null && num(fa.min_mw) >= want;
        const sized = !want ? '' : floorOn ? ` match the ${want} MW floor` : ` of every size (the ${want} MW floor was not applied to this count)`;
        evidence.push(`${total} active interconnection-queue projects${sized}${asOf ? ` (queue data as of ${asOf})` : ''}.`);
      }
      const age = asOf ? days(asOf, now) : null;
      if (age != null && age > STALE_DAYS) notEstablished.push(`The queue data is ${age} days old (as of ${asOf}); treat queue-based timing as stale.`);
      const ttps = (Array.isArray(queue.p.results) ? queue.p.results : []).map((r) => num(r && r.estimated_ttp_months)).filter((x) => x != null);
      if (ttps.length) {
        const lo = Math.min(...ttps), hi = Math.max(...ttps);
        queueTtp = { lo, hi, rows: ttps.length };
        // 5.27 (live QA 2026-11-14): every ERCOT row carried the same ISO-wide figure and the answer read
        // "32.6-32.6 months". One value on every row is an ISO-wide estimate, not a range across projects.
        // Pushed after the grid read below, which decides whether this figure is the headline's or a second series.
      }
    }
    // Grok live proof 2026-11-16 item 1 (PJM 100 MW): the answer led with 50.5 months (the queue rows'
    // estimated_ttp_months, one ISO table value on every row) while the grid step beside it said
    // avg_time_to_power_months 44.9 (the ISO's DCPI rollup over its scored markets). The headline names ONE
    // figure and the field it came from: the grid's DCPI average when the run read it, else the queue rows'.
    const gridTtpStep = steps.find((s) => s.tool === 'get_grid_intelligence' && num(s.p.avg_time_to_power_months) != null);
    const gridTtp = gridTtpStep ? { months: num(gridTtpStep.p.avg_time_to_power_months),
      iso: gridTtpStep.p.iso || gridTtpStep.args.iso || null } : null;
    // Shown where it was before (an ISO band read) and on every power-timing answer, which leads with it.
    const gridShown = !!gridTtp && (kind === 'power_timing' || isoBand(steps) != null);
    // 5.44 (Grok QA 2026-11-19, "fastest 300 MW ... near Dallas ... within 36 months"): the headline led with ERCOT's
    // queue-row figure (32.6, the same ISO-wide value on all 200 rows) while the fact header beside it said Dallas
    // 37.9, past the deadline, and nothing said so. A power-timing answer about a market the question NAMED leads with
    // that market's own DCPI time to power; the ISO-wide series stay as evidence, labelled as such.
    const named = new Set((Array.isArray(ctx.named_markets) ? ctx.named_markets : []).map((x) => String(x || '').toLowerCase()));
    // 5.46 (conductor live check 2026-11-20): keyless reads withhold the market's figure, and requiring it here sent every
    // keyless answer back to the ISO-wide lead with no canvas markets and no deadline line. The named market leads
    // with or without its figure; a withheld figure is said to be withheld.
    const namedRead = dcpiReads(steps).find((r) => named.has(r.slug.toLowerCase()) || named.has(r.requested.toLowerCase())) || null;
    const marketLead = kind === 'power_timing' ? namedRead : null;
    const deadlineMonths = num(ctx.deadline_months);
    if (gridShown) evidence.push(`${gridTtp.iso || 'ISO'} average time-to-power: ${gridTtp.months} months (${TTP_GRID_FIELD}, the DCPI average over the ISO's scored markets${marketLead ? '; an ISO-wide series, not the headline figure' : ''}).`);
    if (queueTtp) {
      const { lo, hi, rows } = queueTtp;
      const fig = lo === hi
        ? (rows > 1 ? `${lo} months on every queue row shown (${rows} rows), an ISO-wide estimate rather than a per-project range`
          : `${lo} months on the queue row shown`)
        : `${lo}-${hi} months on the queue rows shown`;
      evidence.push((gridShown || marketLead)
        ? `Queue rows also carry ${TTP_QUEUE_FIELD}: ${fig}. That is a different series from the headline figure and is not used for it.`
        : `Estimated time-to-power (${TTP_QUEUE_FIELD}): ${fig}.`);
    }
    const ret = steps.find((s) => s.tool === 'get_retirement_headroom');
    if (ret) {
      const ns = ret.p.near_scope && typeof ret.p.near_scope === 'object' ? ret.p.near_scope : null;
      const rs = !ns && ret.p.scope && ret.p.scope.state ? ret.p.scope : null;
      const n = rs || ns ? null : (num(ret.p._total_available) ?? num(ret.p.count_returned));
      // Grok 2026-11-20 P2: rows cut to the named market (server.mjs _planNearMarketCut); a Dallas plan read Bexar County.
      if (ns) {
        const near = `within ${ns.radius_km} km of ${ns.market || 'the named market'}`;
        if (ns.kept > 0) evidence.push(`${ns.kept} filed generator retirement${ns.kept === 1 ? '' : 's'} ${near} in the slice returned (the tool takes no point; rows farther away were dropped).`);
        else notEstablished.push(`No filed generator retirement ${near} in the slice returned${ns.nearest_dropped ? `; the nearest dropped was ${ns.nearest_dropped.row}, ${ns.nearest_dropped.km} km away` : ''}. That is not proof there are none.`);
      }
      if (rs) {
        if (rs.kept > 0) evidence.push(`${rs.kept} filed generator retirement${rs.kept === 1 ? '' : 's'} in ${rs.state} in the slice returned (the tool has no state filter; this is a slice, not a ${rs.state} total).`);
        else notEstablished.push(`No ${rs.state} retirements in the ${rs.dropped_out_of_state + rs.dropped_state_unreadable}-row slice returned; that is not proof there are none.`);
      }
      if (n != null) evidence.push(`${n} filed generator retirements near substations (EIA-860M, baseline ${(ret.p.meta && ret.p.meta.baseline_age) || 'undated'}); MW per site is ${ret.p.total_retiring_mw == null ? 'withheld at this tier' : 'in the step result'}.`);
      // Grok weekly 2026-11-19 item 4: a preview drops target_mw (filters_applied.target_mw null) and the read is the
      // backend default, not the size asked; say so, as the queue count does for min_mw.
      const rfa = ret.p.filters_applied && typeof ret.p.filters_applied === 'object' ? ret.p.filters_applied : null;
      if (want != null && rfa && 'target_mw' in rfa && num(rfa.target_mw) !== want) {
        notEstablished.push(`The ${want} MW target was not applied to the retirement read at this access level (it ran ${num(rfa.target_mw) != null ? `at ${num(rfa.target_mw)} MW` : 'at the backend default'}).`);
      }
    }
    const hc = steps.find((s) => s.tool === 'get_hosting_capacity');
    const hcMax = hc && hc.p.capacity_by_type && hc.p.capacity_by_type.load ? num(hc.p.capacity_by_type.load.max_mw) : null;
    if (hcMax != null) {
      evidence.push(`Largest utility-published load feeder headroom: ${hcMax} MW.`);
      if (want != null && hcMax < want) notEstablished.push(`${want} MW is above any single published feeder (${hcMax} MW): this is a multi-feeder or transmission-level ask, not a feeder-level one.`);
    }

    // Supply-side timing facts the timeline step returned (ERCOT's own queue total, the year's firm-supply signal):
    // dated, state-grain, and named as such (Grok colocation re-run 2026-11-17, Q-d).
    const tl = steps.find((s) => s.tool === 'get_power_availability_timeline');
    const tlFacts = tl ? factsFromStep(tl.tool, tl.p, tl.args).slice(0, 2) : [];
    for (const f of tlFacts) evidence.push(f.text);
    if (tlFacts.length) notEstablished.push(stateGrainCaveat(tl.p.state || tl.args.state));

    const reads = dcpiReads(steps);
    const band = isoBand(steps);

    if (kind === 'market_check') {
      const asked = askedMarket(intent);
      const hit = asked ? reads.find((r) => slugMatchesAsked(r.slug, asked)) : (reads.length === 1 ? reads[0] : null);
      if (hit) {
        verdict = { value: hit.verdict, scope: 'market', subject: hit.slug, composite_score: hit.composite_score,
          source: verdictSource(hit.step) };
        basis = hit.step;
        headline = `${cap(asked || hit.slug.replace(/-/g, ' '))}: DCPI ${hit.verdict}${hit.composite_score != null ? ` (${hit.composite_score})` : ''}.`;
        if (hit.time_to_power_months != null) evidence.unshift(`DCPI time-to-power: ${hit.time_to_power_months} months.`);
      } else {
        const checked = reads.map((r) => r.slug).filter(Boolean);
        const name = asked ? cap(asked) : 'The market you asked about';
        headline = `${name} was not DCPI-checked in this run, so there is no verdict for it.`
          + (checked.length ? ` The run checked ${checked.join(', ')} instead; do not report those as ${name}.` : '');
        notEstablished.push(`No BUILD/CAUTION/AVOID for ${name}: call get_market_dcpi_rank with its market_slug.`);
        if (band) basis = band.step;
      }
    } else {
      if (band) {
        verdict = { value: band.band, scope: 'iso', subject: band.iso, composite_score: null };
        basis = basis || band.step;
        evidence.unshift(`${band.iso || 'ISO'} DCPI constraint band: ${band.band} (ISO-level; not a verdict for a specific site or market).`);
      }
      if (reads.length) {
        const r = reads[0];
        verdict = { value: r.verdict, scope: 'market', subject: r.slug, composite_score: r.composite_score,
          source: verdictSource(r.step) };
        basis = r.step;
      }
      if (!verdict) notEstablished.push('No BUILD/CAUTION/AVOID in this run: no DCPI read was produced for the requested geography.');
      if (kind === 'power_timing') {
        // Worded "time-to-power N months" so the below-Pro DCPI prose scrub (server.mjs _DCPI_PROSE_RULES) takes
        // the figure and keeps the sentence; time_to_power_basis carries no number for the same reason.
        let lead = `Time to ${want ? `${want} MW of ` : ''}power for ${scope}`;
        if (marketLead) {
          const m = marketLead.time_to_power_months;
          const nm = cap(marketLead.slug.replace(/-/g, ' '));
          ttpUsed = { field: TTP_MARKET_FIELD, scope: 'market', market: marketLead.slug, ...(m == null ? { withheld: true } : {}) };
          // 5.48 (live 5.46/5.47 read): the lead said "for ERCOT (ISO)" before turning to Dallas, and the market's verdict
          // trailed as "dallas DCPI CAUTION.", the sentence the 600-character lead text cut first. The named market
          // leads, its grid beside it, and its own verdict rides in the lead.
          ledVerdict = verdict && verdict.scope === 'market'
            && String(verdict.subject || '').toLowerCase() === marketLead.slug.toLowerCase() ? verdict.value : null;
          lead = `Time to ${want ? `${want} MW of ` : ''}power near ${nm}${isos.length ? ` (${isos.join('/')})` : ''}`
            + (ledVerdict ? `, DCPI verdict ${ledVerdict}` : '');
          // 5.48: a withheld figure names no field (time_to_power_basis does) and its deadline line goes last, after the
          // canvas markets, so the 600-character lead text cuts the least informative sentence first.
          headline = m != null
            ? `${lead}: ${nm} DCPI time-to-power ${m} months (${TTP_MARKET_FIELD}).`
              + (deadlineMonths ? ` ${deadlineSentence(deadlineMonths, m)}` : '')
            : `${lead}: ${nm} DCPI time-to-power is withheld at this access level.`;
          const alt = canvasMarkets(steps, marketLead.slug);
          if (alt) {
            headline += ` ${alt.cut ? `Markets DCPI-ranked for ${alt.region} within ${alt.cut} months` : `Markets DCPI-ranked for ${alt.region}`}`
              + ` (site_selection_canvas): ${alt.rows.map((r) => `${r.market} (${r.verdict})`).join(', ')}.`;
            if (deadlineMonths && !alt.cut) notEstablished.push(`The ${deadlineMonths}-month cut was not applied to the site_selection_canvas shortlist at this access level, so its markets are not filtered to the deadline.`);
          }
          if (m == null && deadlineMonths) headline += ` ${deadlineWithheld(deadlineMonths)}`;
        } else if (gridShown) {
          ttpUsed = { field: TTP_GRID_FIELD, scope: 'iso_average', iso: gridTtp.iso };
          headline = `${lead}: ${gridTtp.iso ? `${gridTtp.iso} ` : ''}average time-to-power ${gridTtp.months} months (${TTP_GRID_FIELD}).`;
        } else if (queueTtp) {
          const { lo, hi } = queueTtp;
          ttpUsed = { field: TTP_QUEUE_FIELD, scope: lo === hi ? 'iso_estimate_on_queue_rows' : 'queue_rows' };
          headline = `${lead}: estimated time-to-power ${lo === hi ? lo : `${lo}-${hi}`} months (${TTP_QUEUE_FIELD}).`;
        } else if (tlFacts.length) {
          // No time-to-power figure at this depth, but the timeline's dated supply facts are: lead with them.
          headline = `${lead}: no time-to-power figure in this read. ${tlFacts.map((f) => f.text).join(' ')} ${stateGrainCaveat(tl.p.state || tl.args.state)}`;
        } else {
          headline = `${lead} is not measurable from this run: time-to-power and queue wait are withheld at this tier.`;
        }
        // 5.48 (Grok daily 2026-11-19, item 7): "time to power for 100 MW in Phoenix" led with the timeline's supply
        // facts and not_established never said the figure asked for was missing. No figure: say so, and why.
        if (!ttpUsed) {
          const preview = (Array.isArray(executed) ? executed : []).some((e) => e && TIMING_TOOLS.has(e.tool)
            && (e.depth === 'preview' || e.status === 'gated_preview'));
          notEstablished.unshift(preview
            ? `No time-to-power figure for ${scope}: time-to-power and queue wait are withheld at this access level (the timing steps ran as previews).`
            : `No time-to-power figure for ${scope}: the timing steps that ran returned none for this geography.`);
        }
        // Q-d: the "where" inside the state, from the queue rows the run returned (each row's county).
        const counties = oneState && queue ? queueCounties(queue.p.results, oneState) : [];
        if (counties.length) {
          headline += ` Queue projects returned sit in ${counties.map((c) => `${c.county} County (${c.n})`).join(', ')}`
            + ` (the rows shown, not a ${oneState} count).`;
        }
        if (verdict && !ledVerdict) headline += ` ${verdict.scope === 'iso' ? `${verdict.subject} (ISO-level)` : verdict.subject} DCPI ${verdict.value}.`;
      } else {
        // 5.34 (Grok dominance evals, gap 2): the site read's own verdict. The lead said "no BUILD/CAUTION/AVOID
        // verdict was produced" while analyze_site's site_teaser.verdict was BUILD and answer_guide said "LEAD WITH
        // THE VERDICT". A DCPI market verdict still wins; the site band is labelled site-level, never a market's.
        const site = verdict ? null : siteRead(executed, fullByEntry);
        if (site) {
          verdict = { value: site.verdict, scope: 'site', subject: site.where, composite_score: null };
          basis = basis || site.step;
          const i = notEstablished.findIndex((x) => /^No BUILD\/CAUTION\/AVOID in this run/.test(x));
          if (i >= 0) notEstablished.splice(i, 1, 'No DCPI market verdict in this run; the verdict above is the site read\'s own band.');
        }
        headline = `Siting read for ${want ? `${want} MW, ` : ''}${scope}`
          + (verdict && verdict.scope === 'site'
            ? `: site verdict ${verdict.value} at ${verdict.subject} (analyze_site, site-level${site && site.power ? `; power infrastructure ${site.power}` : ''}).`
            : verdict ? `: DCPI ${verdict.value} (${verdict.scope === 'iso' ? 'ISO-level' : verdict.subject}).` : ': no BUILD/CAUTION/AVOID verdict was produced.');
        // 5.42 (Grok LAND L1, 2026-11-18): a site screen at a point says what each read found. The flood and
        // transmission lines join the lead; every screen line is evidence (lib/site-screen-facts.mjs).
        const screen = ctx.intent_class === 'site_analysis' ? siteScreenFacts(executed, fullByEntry, intent) : null;
        if (screen) {
          const lead = [screen.flood, screen.infra].filter(Boolean);
          if (lead.length) headline += ` ${lead.join(' ')}`;
          for (const l of screen.lines) evidence.push(l.text);
          notEstablished.push(...screen.not_established);
        }
        // Grok 2026-11-20 P2 ("can I get 300 MW near Dallas within 36 months", capacity_search): the market the question
        // named, its own time to power and the deadline, beside the verdict; the power-timing lead already says this.
        if (namedRead && !(verdict && verdict.scope === 'site')) {
          const m = namedRead.time_to_power_months;
          const nm = cap(namedRead.slug.replace(/-/g, ' '));
          if (m != null) headline += ` ${nm} DCPI time-to-power ${m} months (${TTP_MARKET_FIELD}).` + (deadlineMonths ? ` ${deadlineSentence(deadlineMonths, m)}` : '');
          else if (deadlineMonths) headline += ` ${deadlineWithheld(deadlineMonths)}`;
        }
      }
    }
    if (gap && gap.phrase && kind !== 'market_check') notEstablished.push(`"${gap.phrase}" is outside the tracked geography index, so results are not limited to it.`);

    // oldest data date among the steps used, then the one Source line
    const dated = [];   // [{ day, step }]: every step that carries a data date
    for (const s of steps) { const d = dataAsOfDay(s.p); if (d) { dates.push(d); dated.push({ day: d.slice(0, 10), step: s }); } }
    if (queue && queueAsOf && /^\d{4}-\d{2}-\d{2}$/.test(queueAsOf)) dated.push({ day: queueAsOf, step: queue });
    // 5.47: the timeline's operator report date (ERCOT GIS, 2026-10-31) is an input the evidence quotes; the step's own
    // citation carries the serve date, so without this the siting answer read "as of 2026-11-20" alone.
    const tlStep = steps.find((s) => s.tool === 'get_power_availability_timeline');
    const tlReport = tlStep ? isoReportedDay(tlStep.p) : null;
    if (tlReport) { dates.push(tlReport); dated.push({ day: tlReport, step: tlStep }); }
    const asOfDate = dates.length ? dates.slice().sort()[0] : null;
    let cite = basis || queue || ret || steps[0];
    // The Source line must not read fresher than the answer it sits under: as_of is the OLDEST input,
    // so when the line's own step is newer than that, cite the step that holds the oldest date
    // (measured 2026-10-18: power timing said "as of 2026-10-18T03:00Z" over a 2026-08-31 queue).
    if (asOfDate) {
      const own = dataAsOfDay(cite.p);
      if (own && own.slice(0, 10) > asOfDate.slice(0, 10)) {
        const oldest = dated.filter((x) => x.day === asOfDate.slice(0, 10))[0];
        if (oldest) cite = oldest.step;
      }
    }
    return {
      kind, requested_mw: want, geography: scope,
      headline, verdict, evidence, not_established: notEstablished,
      ...(ttpUsed ? { time_to_power_basis: ttpUsed } : {}),
      as_of: asOfDate,
      relay: null,
      source: datedSource(sourceLine(cite.p, cite.tool, cite.args), asOfDate, verdict, now),
    };
  } catch (_e) { return null; }
}

// 5.47: the operator's own published queue report date in a timeline read (queue_context.iso_reported, the row the
// evidence quotes: the primary one, else the first), or null. Only a published basis is a report date.
function isoReportedDay(p) {
  const qc = p && typeof p === 'object' && p.queue_context && typeof p.queue_context === 'object' ? p.queue_context : null;
  const rows = qc && Array.isArray(qc.iso_reported) ? qc.iso_reported.filter((r) => r && typeof r === 'object') : [];
  const r = rows.find((x) => x.primary) || rows[0];
  const d = r && r.basis_class === 'published' && typeof r.as_of === 'string' ? r.as_of.slice(0, 10) : null;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

// 5.44: the site_selection_canvas shortlist a siting plan ran, as names and verdicts only (the rows' figures are DCPI
// numerics a preview withholds), without the market the headline already leads with. `cut` is the max_months the
// canvas applied, null when it did not. null when the run read no canvas rows.
export function canvasMarkets(steps, exceptSlug = null) {
  const c = (Array.isArray(steps) ? steps : []).find((s) => s.tool === 'site_selection_canvas');
  if (!c || !Array.isArray(c.p.shortlist)) return null;
  const skip = String(exceptSlug || '').toLowerCase();
  const rows = c.p.shortlist.filter((r) => r && typeof r.market === 'string' && VERDICTS.has(String(r.verdict || '').toUpperCase())
    && String(r.slug || '').toLowerCase() !== skip && !String(r.slug || '').toLowerCase().startsWith(`${skip}-`))
    .slice(0, 3).map((r) => ({ market: r.market, verdict: String(r.verdict).toUpperCase() }));
  if (!rows.length) return null;
  const af = c.p.applied_filters && typeof c.p.applied_filters === 'object' ? c.p.applied_filters : {};
  const cut = c.p.max_months_applied === false ? null : num(af.max_months);
  return { rows, cut, region: String(af.region || c.args.region || 'the region asked').toUpperCase() };
}

// Grok weekly 2026-11-19 items 2+3: the Source line always carries "as of <date>" (live "when can I get power in
// Ohio" read "Source: DC Hub (dchub.cloud/grid/pjm)", undated: the grid step states no data date), and when the
// verdict beside it is dated differently both dates are labelled (live Dallas: the line said 2026-09-26, the oldest
// input, under a 2026-11-19 verdict).
const DAY_IN = /\bas of (\d{4}-\d{2}-\d{2})/;
const AS_OF_IN = /\bas of \d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/;
export function datedSource(line, asOfDate, verdict, now = Date.now()) {
  if (typeof line !== 'string' || !line) return line;
  let out = line;
  // 5.47: the cited step's own line may carry its serve date while the oldest input it holds is older (the TX
  // timeline: "as of 2026-11-20" over ERCOT's 2026-10-31 report). The line never reads fresher than as_of.
  const old = asOfDate ? String(asOfDate).slice(0, 10) : null;
  const first = DAY_IN.exec(out);
  if (first && old && /^\d{4}-\d{2}-\d{2}$/.test(old) && old < first[1]) out = out.replace(AS_OF_IN, `as of ${old}`);
  const own = DAY_IN.exec(out);
  const day = own ? own[1] : (asOfDate ? String(asOfDate).slice(0, 10) : new Date(now).toISOString().slice(0, 10));
  if (!own) out = out.replace(/\.?\s*$/, '') + `, as of ${day}`;
  const vm = verdict && typeof verdict.source === 'string' ? DAY_IN.exec(verdict.source) : null;
  if (vm && vm[1] !== day) out = out.replace(/\bas of \d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/, (m) => `${m} (oldest input); DCPI verdict as of ${vm[1]}`);
  return out;
}

// Called on the FINISHED result (after the wall wrapper), like attachRankedRelay: copies the link
// the response already carries into intent_answer.relay. No link, no relay.
export function attachIntentRelay(result) {
  try {
    const sc = result && result.structuredContent;
    if (!sc || typeof sc !== 'object' || !sc.intent_answer || typeof sc.intent_answer !== 'object') return result;
    const fy = sc.for_your_human && typeof sc.for_your_human === 'object' ? sc.for_your_human : null;
    const url = (typeof sc.human_url === 'string' && sc.human_url) || (fy && typeof fy.url === 'string' && fy.url) || '';
    if (!url) return result;
    const text = (typeof sc.human_message === 'string' && sc.human_message)
      || (fy && typeof fy.text === 'string' && fy.text) || '';
    const { source, ...rest } = sc.intent_answer;
    // source stays the last key
    return { ...result, structuredContent: { ...sc,
      intent_answer: { ...rest, relay: { url, text, instruction: 'Show this to your human with the answer: the withheld fields are behind this link.' }, source } } };
  } catch (_e) { return result; }
}
