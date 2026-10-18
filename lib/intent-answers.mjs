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

import { requestedMw } from './ranked-answer.mjs';
import { sourceLine, dataAsOfDay } from './source-line.mjs';

const VERDICTS = new Set(['BUILD', 'CAUTION', 'AVOID']);
const STALE_DAYS = 30;
const SITING_CLASSES = new Set(['capacity_search', 'site_analysis', 'fiber_power_pairing', 'hosting_capacity']);
const TIMING_CLASSES = new Set(['capacity_search', 'power_timeline', 'grid_headroom', 'interconnection_queue']);
const MARKET_CLASSES = new Set(['market_ranking', 'market_comparison', 'site_analysis', 'capacity_search']);

const TIMING_RE = /\b(how\s+(soon|long|fast|quickly)|when\s+(can|could|will|would)|time[\s-]to[\s-]power|energi[sz]ation|lead\s+time|power\s+(timeline|timing|availability\s+timeline))\b/i;
const MARKET_CHECK_RES = [
  /\b(?:is|are)\s+(.{2,60}?)\s+(?:a|an|the)?\s*(?:good|great|viable|safe|solid|right|bad|smart|worthwhile|decent)\b/i,
  /\bshould\s+(?:i|we)\s+(?:build|site|locate|put|expand)(?:\s+a\s+data\s+cent(?:er|re))?\s+in\s+(.{2,60}?)\s*[?.!]?$/i,
  /\bmarket\s+check\s+(?:on|for)?\s*(.{2,60}?)\s*[?.!]?$/i,
  /\bhow\s+(?:is|does)\s+(.{2,60}?)\s+(?:look|rate|score|stack up)\b/i,
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
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
    out.push({ slug: String(s.args.market_slug || s.p.market_slug || ''), verdict: v,
      composite_score: num(s.p.composite_score), time_to_power_months: num(s.p.time_to_power_months), step: s });
  }
  return out;
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

export function buildIntentAnswer(ctx, executed, fullByEntry, now = Date.now()) {
  try {
    const intent = ctx && ctx.intent;
    const kind = classifyIntentAnswer(intent, ctx && ctx.intent_class);
    if (!kind) return null;
    const steps = readSteps(executed, fullByEntry);
    if (!steps.length) return null;

    const want = requestedMw(intent);
    const isos = Array.isArray(ctx.constraint_iso) ? ctx.constraint_iso.filter((x) => typeof x === 'string') : [];
    const gap = ctx.resolution_gap && typeof ctx.resolution_gap === 'object' ? ctx.resolution_gap : null;
    const evidence = [];
    const notEstablished = [];
    const dates = [];
    let verdict = null;
    let basis = null;   // the step whose page the Source line cites
    let headline = '';

    const scope = isos.length ? `${isos.join('/')} (ISO)`
      : (gap && gap.phrase ? `unscoped: "${gap.phrase}" is outside the tracked index` : 'no geography bound');

    // ---- evidence common to all three: queue, retirements, hosting capacity ----
    const queue = steps.find((s) => s.tool === 'get_refined_queue');
    let queueAsOf = null;   // the queue's own data date (its dated report), for the Source-line choice below
    if (queue) {
      const total = num(queue.p.count_total_matching);
      const asOf = (queue.p.freshness_by_iso && Object.values(queue.p.freshness_by_iso)
        .map((f) => f && f.source_as_of).filter(Boolean).sort()[0]) || queue.p.source_as_of || null;
      if (asOf) { dates.push(asOf); queueAsOf = String(asOf).slice(0, 10); }
      const qs = queue.p.scope && queue.p.scope.state ? queue.p.scope : null;
      if (qs) {
        // The step was cut to one state after the call (lib/siting-scope.mjs): the unscoped total is withheld, so say what the slice held.
        if (qs.kept > 0) evidence.push(`${qs.kept} queue project${qs.kept === 1 ? '' : 's'} in ${qs.state} in the slice returned (the queue tool has no state filter; this is a slice, not a ${qs.state} total).`);
        else notEstablished.push(`No ${qs.state} queue projects in the ${qs.dropped_out_of_state + qs.dropped_state_unreadable}-row slice returned; that is not proof there are none.`);
      } else if (total != null) evidence.push(`${total} active interconnection-queue projects match${want ? ` the ${want} MW floor` : ''}${asOf ? ` (queue data as of ${asOf})` : ''}.`);
      const age = asOf ? days(asOf, now) : null;
      if (age != null && age > STALE_DAYS) notEstablished.push(`The queue data is ${age} days old (as of ${asOf}); treat queue-based timing as stale.`);
      const ttps = (Array.isArray(queue.p.results) ? queue.p.results : []).map((r) => num(r && r.estimated_ttp_months)).filter((x) => x != null);
      if (ttps.length) evidence.push(`Estimated time-to-power on the queue rows shown: ${Math.min(...ttps)}-${Math.max(...ttps)} months.`);
    }
    const ret = steps.find((s) => s.tool === 'get_retirement_headroom');
    if (ret) {
      const rs = ret.p.scope && ret.p.scope.state ? ret.p.scope : null;
      const n = rs ? null : (num(ret.p._total_available) ?? num(ret.p.count_returned));
      if (rs) {
        if (rs.kept > 0) evidence.push(`${rs.kept} filed generator retirement${rs.kept === 1 ? '' : 's'} in ${rs.state} in the slice returned (the tool has no state filter; this is a slice, not a ${rs.state} total).`);
        else notEstablished.push(`No ${rs.state} retirements in the ${rs.dropped_out_of_state + rs.dropped_state_unreadable}-row slice returned; that is not proof there are none.`);
      }
      if (n != null) evidence.push(`${n} filed generator retirements near substations (EIA-860M, baseline ${(ret.p.meta && ret.p.meta.baseline_age) || 'undated'}); MW per site is ${ret.p.total_retiring_mw == null ? 'withheld at this tier' : 'in the step result'}.`);
    }
    const hc = steps.find((s) => s.tool === 'get_hosting_capacity');
    const hcMax = hc && hc.p.capacity_by_type && hc.p.capacity_by_type.load ? num(hc.p.capacity_by_type.load.max_mw) : null;
    if (hcMax != null) {
      evidence.push(`Largest utility-published load feeder headroom: ${hcMax} MW.`);
      if (want != null && hcMax < want) notEstablished.push(`${want} MW is above any single published feeder (${hcMax} MW): this is a multi-feeder or transmission-level ask, not a feeder-level one.`);
    }

    const reads = dcpiReads(steps);
    const band = isoBand(steps);

    if (kind === 'market_check') {
      const asked = askedMarket(intent);
      const hit = asked ? reads.find((r) => slugMatchesAsked(r.slug, asked)) : (reads.length === 1 ? reads[0] : null);
      if (hit) {
        verdict = { value: hit.verdict, scope: 'market', subject: hit.slug, composite_score: hit.composite_score };
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
        if (band.ttp != null) evidence.push(`${band.iso} average time-to-power: ${band.ttp} months.`);
      }
      if (reads.length) {
        const r = reads[0];
        verdict = { value: r.verdict, scope: 'market', subject: r.slug, composite_score: r.composite_score };
        basis = r.step;
      }
      if (!verdict) notEstablished.push('No BUILD/CAUTION/AVOID in this run: no DCPI read was produced for the requested geography.');
      if (kind === 'power_timing') {
        const ttpKnown = evidence.some((e) => /time-to-power/.test(e));
        headline = ttpKnown
          ? `Time to ${want ? `${want} MW of ` : ''}power for ${scope}: see the time-to-power figures below.`
          : `Time to ${want ? `${want} MW of ` : ''}power for ${scope} is not measurable from this run: time-to-power and queue wait are withheld at this tier.`;
        if (verdict) headline += ` ${verdict.scope === 'iso' ? `${verdict.subject} (ISO-level)` : verdict.subject} DCPI ${verdict.value}.`;
      } else {
        headline = `Siting read for ${want ? `${want} MW, ` : ''}${scope}`
          + (verdict ? `: DCPI ${verdict.value} (${verdict.scope === 'iso' ? 'ISO-level' : verdict.subject}).` : ': no BUILD/CAUTION/AVOID verdict was produced.');
      }
    }
    if (gap && gap.phrase && kind !== 'market_check') notEstablished.push(`"${gap.phrase}" is outside the tracked geography index, so results are not limited to it.`);

    // oldest data date among the steps used, then the one Source line
    const dated = [];   // [{ day, step }]: every step that carries a data date
    for (const s of steps) { const d = dataAsOfDay(s.p); if (d) { dates.push(d); dated.push({ day: d.slice(0, 10), step: s }); } }
    if (queue && queueAsOf && /^\d{4}-\d{2}-\d{2}$/.test(queueAsOf)) dated.push({ day: queueAsOf, step: queue });
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
      as_of: asOfDate,
      relay: null,
      source: sourceLine(cite.p, cite.tool, cite.args),
    };
  } catch (_e) { return null; }
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
