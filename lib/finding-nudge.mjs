// finding-nudge.mjs — 2026-11-16 (owner "Let's do both", Grok findings tightening, item 4).
//
// execute_plan, site_selection_canvas and get_refined_queue add ONE next_tools entry pointing at
// report_finding, and only when the answer shows a gap DC Hub could close:
//   - a plan step that was skipped because nothing resolved its input (skipped_unresolved), unless a
//     step of the same plan answered a gated preview (then the skip is about access, not data);
//   - a parameter the answer says it did not apply (_ignored_params, filters_applied._<p>_not_applied,
//     constraint_coverage {applied:false}), when the stated reason is about the data, not access;
//   - a region the tool does not cover (region_not_covered);
//   - an execute_plan question about something DC Hub does not carry (lib/coverage-gap.mjs topics).
// A clean answer carries nothing. A filter held back by access (a locked or keyed filter) is not a
// gap and never triggers it: the filing is about data and coverage, not about access.
//
// Pure: no I/O, no clock. server.mjs decides which surfaces may carry the field.

export const FINDING_NUDGE_TOOLS = Object.freeze(new Set(['execute_plan', 'site_selection_canvas', 'get_refined_queue']));
export const FINDING_NUDGE_SUMMARY_MAX = 280;
const _REASON_MAX = 90;
// A reason that is about access, not data: never a gap.
const _ACCESS_REASON = /\b(paid|tier|plan|pro|preview|locked|withheld|full[- ]access|api key|key|upgrade|trial|quota|allowance|sign[- ]?in|subscription|developer (?:plan|tier|key|access))\b/i;
// Plain words for the execute_plan coverage topics (lib/coverage-gap.mjs COVERAGE_GAP_TOPICS).
const _TOPIC_WORDS = Object.freeze({
  lease_comps: 'lease comparables are not covered',
  colo_pricing: 'colocation rates are not covered',
  vacancy_absorption: 'vacancy and absorption are not covered',
  colo_availability_nofit: 'no listed colocation capacity fit the ask',
});

function _clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
export function isAccessReason(s) {
  return typeof s === 'string' && _ACCESS_REASON.test(s);
}
function _reasonText(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return typeof v.reason === 'string' ? v.reason : (typeof v.note === 'string' ? v.note : '');
  return '';
}
function _regionNotCovered(r) {
  if (!r || typeof r !== 'object') return null;
  const m = r._error_mitigation;
  if ((m && m.error_code === 'region_not_covered') || r.error_code === 'region_not_covered'
      || r.error === 'region_not_covered' || r.error === 'region not covered') {
    return r.requested != null ? String(r.requested) : (r.region != null ? String(r.region) : '');
  }
  return null;
}

// The gaps one tool result shows, as short phrases. [] for a clean answer or anything unreadable.
// `skip`: params whose not-applied disposition is a known limit of that tool, not a coverage gap.
export function resultGaps(r, asked, skip = null) {
  const out = [];
  const skipSet = new Set(Array.isArray(skip) ? skip : []);
  try {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return out;
    const rnc = _regionNotCovered(r);
    if (rnc !== null) out.push(rnc ? `region not covered: ${_clip(rnc, 60)}` : 'region not covered');
    const seen = new Set();
    const add = (param, why) => {
      const reason = _reasonText(why);
      if (!reason.trim() || isAccessReason(reason) || seen.has(param) || skipSet.has(param)) return;
      seen.add(param);
      out.push(`${param} not applied (${_clip(reason, _REASON_MAX)})`);
    };
    const ign = r._ignored_params;
    if (ign && typeof ign === 'object' && !Array.isArray(ign)) for (const [p, why] of Object.entries(ign)) add(p, why);
    const fa = r.filters_applied;
    if (fa && typeof fa === 'object' && !Array.isArray(fa)) {
      for (const [k, why] of Object.entries(fa)) {
        const m = /^_([a-z0-9_]+)_not_applied$/.exec(k);
        if (m) add(m[1], why);
      }
    }
    const cc = r.constraint_coverage;
    if (cc && typeof cc === 'object' && !Array.isArray(cc)) {
      for (const [p, v] of Object.entries(cc)) {
        if (!v || typeof v !== 'object' || v.applied !== false || v.status === 'locked') continue;
        if (asked && typeof asked === 'object' && asked[p] == null) continue;   // only what was asked
        add(p, v);
      }
    }
  } catch (_) { /* a nudge never breaks an answer */ }
  return out;
}

// The gaps an execute_plan run shows. `dropped` is _execDroppedFilters' list; `topic` is
// classifyCoverageGap's answer (or null).
export function planGaps(executed, fullByEntry, dropped, topic) {
  const out = [];
  try {
    const steps = Array.isArray(executed) ? executed : [];
    // A step skipped because an earlier step answered a preview (nothing minted from a gated answer) is
    // an access outcome, not a data gap: with any gated step in the plan, skipped steps do not count.
    // A step stopped by the caller's limit (limit_hit, 2026-11-25) is an access outcome too.
    const gated = steps.some((e) => e && (e.status === 'gated_preview' || e.limit_hit));
    for (const e of steps) {
      if (!e || !e.tool) continue;
      if (e.status === 'skipped_unresolved') {
        if (gated) continue;
        out.push(`step ${e.step} ${e.tool} skipped${e.missing ? ` (no ${_clip(e.missing, 30)} resolved)` : ''}`);
        continue;
      }
      if (e.status !== 'executed' && e.status !== 'gated_preview') continue;
      if (e.limit_hit) continue;
      const r = (fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result;
      const rnc = _regionNotCovered(r);
      if (rnc !== null) out.push(`step ${e.step} ${e.tool}: region not covered${rnc ? ` (${_clip(rnc, 40)})` : ''}`);
    }
    for (const d of (Array.isArray(dropped) ? dropped : [])) {
      if (!d || d.kind === 'locked' || d.kind === 'not_used' || !d.reason || isAccessReason(d.reason)) continue;
      // 2026-11-25 (owner): the canvas never sizes its shortlist to MW (rows carry scores, not megawatts), so its
      // capacity_mw not_applied is a known limit, not a coverage gap. It stays in dropped_filters and not_established.
      if (d.kind === 'not_applied' && d.param === 'capacity_mw' && d.tool === 'site_selection_canvas') continue;
      out.push(`step ${d.step} ${d.tool}: ${d.param} not applied (${_clip(d.reason, _REASON_MAX)})`);
    }
    if (topic && _TOPIC_WORDS[topic]) out.push(_TOPIC_WORDS[topic]);
  } catch (_) { /* a nudge never breaks an answer */ }
  return out;
}

// The next_tools entry for those gaps, or null when there are none.
export function findingNextTool(tool, gaps) {
  if (!Array.isArray(gaps) || !gaps.length || !tool) return null;
  let summary = _clip(`${tool}: ${gaps.join('; ')}`, FINDING_NUDGE_SUMMARY_MAX);
  if (summary.length < 10) summary = `${tool}: gap in this answer`;
  return { tool: 'report_finding', args: { class: 'coverage_gap', tool, summary } };
}

// Adds the entry to a plain result object (in place) and returns it. A result that already
// carries next_tools as an array gets it appended; any other next_tools is left alone.
export function attachFindingNext(obj, entry) {
  if (!entry || !obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (obj.next_tools === undefined) obj.next_tools = [entry];
  else if (Array.isArray(obj.next_tools)) obj.next_tools = [...obj.next_tools, entry];
  return obj;
}
