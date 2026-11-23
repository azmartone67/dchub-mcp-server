// Brain 2026-11-23 item 6 (Grok answer-quality note): per-call answer-quality marks, read off the answer the
// agent actually received, so /api/v1/mcp/answer-quality (dchub-backend routes/answer_quality.py) can report
// external-only rates without a schema change. The marks ride the call's held track row as params._aq (the same
// jsonb the _front_desk and _next_ask_to marks use):
//
//   wall_ms        the whole call as the agent waited for it (outer wrapper start to final result), every call
//   intent_class   execute_plan only: the planner's class
//   error          the result is an error
//   empty          the answer carries a row list and every row list is empty (a "none on file" answer)
//   partial        a preview (partial_preview / preview flags / a partial cite_as)
//   unresolved     execute_plan class `unknown`, or an upstream not-found
//   dated_cite     structuredContent.cite_as reads "DC Hub (dchub.cloud), as of YYYY-MM-DD"
//   lead_match     execute_plan only, where the class has a subject test: the first 300 characters of the
//                  lead name that subject (a facilities ask leads with facilities). null = not measured.
//
// Pure, never throws (returns null on anything odd). Kill switch DCHUB_ANSWER_QUALITY_MARKS=0.
export const answerQualityMarksOn = (env = process.env) =>
  !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_ANSWER_QUALITY_MARKS) || '').trim());

const DATED_CITE_RE = /^DC Hub \(dchub\.cloud\), as of \d{4}-\d{2}-\d{2}/;
const ROW_KEYS = ['rows', 'results', 'data', 'items', 'facilities', 'markets', 'records', 'projects', 'deals',
  'transactions', 'listings', 'events', 'articles', 'sites', 'candidates'];
// What the lead of each class should be about. Classes not listed are not measured (lead_match null).
export const LEAD_SUBJECT = Object.freeze({
  facility_search: /\bfacilit(y|ies)\b|\bdata cent(er|re)s?\b/i,
  colocation: /\bcolocation\b|\bcolo\b|\bfacilit(y|ies)\b/i,
  grid_headroom: /\bheadroom\b|\bgrid\b|\bMW\b|\bload\b/i,
  interconnection_queue: /\bqueue\b|\binterconnection\b/i,
  power_timeline: /\btime to power\b|\bmonths?\b|\benergi[sz]/i,
  market_ranking: /\bDCPI\b|\bBUILD\b|\bCAUTION\b|\bAVOID\b|\brank/i,
  market_outlook: /\bDCPI\b|\bBUILD\b|\bCAUTION\b|\bAVOID\b|\boutlook\b/i,
  incentives_tax: /\bincentive|\btax\b|\bexemption/i,
  water_climate: /\bwater\b|\bflood|\bclimate|\bheat\b/i,
  fiber: /\bfiber\b|\bfibre\b|\bcarrier/i,
  permitting: /\bmoratori|\bpermit|\bzoning\b|\bordinance/i,
  deals_ma: /\bdeal|\bacqui|\btransaction/i,
});

const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

function _payload(result) {
  const sc = _obj(result && result.structuredContent);
  if (sc) return sc;
  try {
    const first = (result.content || []).find((it) => typeof it?.text === 'string' && it.text.trim().startsWith('{'));
    return first ? _obj(JSON.parse(first.text)) : null;
  } catch (_) { return null; }
}

function _empty(sc) {
  if (!sc) return false;
  if (sc.count === 0 || sc.total === 0) return true;
  let lists = 0;
  for (const holder of [sc, _obj(sc.data)]) {
    if (!holder) continue;
    for (const k of ROW_KEYS) {
      const v = holder[k];
      if (!Array.isArray(v)) continue;
      if (v.length) return false;
      lists += 1;
    }
  }
  return lists > 0;
}

function _partial(sc) {
  if (!sc) return false;
  const prov = _obj(sc.provenance) || {};
  const cit = _obj(sc.citation) || {};
  const comp = _obj(sc.completeness);
  return prov.completeness === 'partial_preview' || cit.completeness === 'partial_preview'
    || sc.completeness === 'partial_preview' || (comp && comp.status === 'partial')
    || ['_gated', '_preview_only', 'trial_preview', 'tease', 'preview_is_partial', 'taste_bounded'].some((k) => sc[k] === true)
    || (typeof sc.cite_as === 'string' && /partial/i.test(sc.cite_as));
}

function _leadText(result) {
  const it = (result.content || []).find((x) => x && x.type === 'text' && typeof x.text === 'string');
  return it ? it.text.slice(0, 300) : '';
}

export function answerQualityMarks(tool, result, { startedAt = null, now = Date.now() } = {}) {
  try {
    if (!result || typeof result !== 'object') return null;
    const sc = _payload(result);
    const err = result.isError === true || !!(sc && (sc._error_mitigation || sc.ok === false));
    const notFound = !!(sc && sc._error_mitigation && sc._error_mitigation.error_code === 'upstream_not_found');
    const out = {
      wall_ms: Number.isFinite(startedAt) ? Math.max(0, Math.round(now - startedAt)) : null,
      error: err,
      empty: !err && _empty(sc),
      partial: !err && _partial(sc),
      unresolved: notFound,
      dated_cite: !!(sc && typeof sc.cite_as === 'string' && DATED_CITE_RE.test(sc.cite_as)),
    };
    if (tool === 'execute_plan') {
      const cls = (sc && (sc.intent_class || (_obj(sc.replay) && sc.replay.intent_class)
        || (_obj(sc.plan_query) && sc.plan_query.intent_class))) || null;
      out.intent_class = typeof cls === 'string' ? cls.slice(0, 40) : null;
      if (out.intent_class === 'unknown') out.unresolved = true;
      const subj = out.intent_class && LEAD_SUBJECT[out.intent_class];
      out.lead_match = subj && !err ? subj.test(_leadText(result)) : null;
    }
    return out;
  } catch (_) { return null; }
}

// Stamp the marks on every held track row for `tool` (lib/agent-outreach.mjs holdTrackRow), before the flush.
export function markHeldRows(c, tool, marks) {
  try {
    if (!marks || !c || !Array.isArray(c._heldTrackRows)) return 0;
    let n = 0;
    for (const e of c._heldTrackRows) {
      if (!e || e.sent || !e.row || e.row.tool !== tool) continue;
      const p = _obj(e.row.params) || {};
      e.row = { ...e.row, params: { ...p, _aq: marks } };
      n += 1;
    }
    return n;
  } catch (_) { return 0; }
}
