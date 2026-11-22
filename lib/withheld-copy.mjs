// lib/withheld-copy.mjs — the ONE place a walled answer's "withheld" wording and its field list come from
// (owner 2026-11-21, wall items 1, 2 and 4).
//
// Three surfaces name what a preview held back, and they must name the same thing:
//   * the value-first lead in content[0]       "Withheld here: <fields>."            (lib/wall-value-first.mjs)
//   * the relay page a human opens             "Withheld from this answer: <fields>" (dchub-backend human_relay, from
//                                              the list this module builds, stored against the relay token)
//   * the licence block's licence_unlocks      [<fields>]                           (lib/licence-block.mjs)
// They all read withheldFields(sc) below, so the lists cannot drift apart. Another team's PR (preview nulls read
// "withheld") is meant to reuse WITHHELD_VALUE and withheldFieldLabel.
//
// The list starts from what the answer already says it withheld (structuredContent.preview_scope.withheld_fields,
// lib/preview-scope.mjs, else the same computation on the answer) and fixes two contradictions measured live on
// keyless /mcp 2026-11-21:
//   (c) get_energy_prices TX served taste.headline retail_rate_cents_kwh 7.68 while withheld_fields listed
//       "retail rate kwh": a field the headline itself states is not withheld, so it leaves the list.
//   (d) get_interconnection_queue PJM served withheld_fields [] on a preview ("0 of 25 projects shown"): a section
//       withheld whole names its row fields (the tool's own output schema, SECTION_FIELDS), else the section.
// Never an empty list on a preview. Pure: no ctx, no network, no plan name, no price.
import { previewScope, isPreviewAnswer, FIELD_NOUNS, LINE_BANNED } from './preview-scope.mjs';

export const WITHHELD_HERE_LABEL = 'Withheld here:';
export const WITHHELD_PAGE_LABEL = 'Withheld from this answer:';
// The value a preview puts where a figure was held back (for the "preview nulls read withheld" PR).
export const WITHHELD_VALUE = 'withheld';

// A section withheld whole -> the row fields it carries, as plain nouns. Read off the tool's own output schema
// (server.mjs get_interconnection_queue projects[]: queue_id, project_name, county, fuel_type, capacity_mw,
// queue_status, queue_date), never guessed.
export const SECTION_FIELDS = Object.freeze({
  projects: Object.freeze(['project name', 'queue id', 'county', 'fuel type', 'capacity', 'queue status', 'queue date']),
});

// Column names a person cannot read ("top risks json", "avg kwh cents") -> the noun they mean. Measured live on
// keyless get_market_dcpi_rank 2026-11-22 (the market card's _locked_fields). Checked before FIELD_NOUNS; every
// label passes LINE_BANNED (no "price": the retail rate is a rate).
export const WITHHELD_LABELS = Object.freeze({
  avg_kwh_cents: 'average retail electricity rate',
  curtailment_pct: 'curtailment share',
  emergency_count_30d: 'grid emergencies in the last 30 days',
  gen_additions_12mo_mw: 'generation added in the last 12 months',
  quality_score: 'data quality score',
  queue_capacity_mw: 'queued capacity',
  queue_wait_months: 'queue wait',
  reserve_margin_pct: 'reserve margin',
  top_opportunities_json: 'top opportunities',
  top_risks_json: 'top risks',
});

// A facility answer (structuredContent._entity 'facility': search_facilities, get_facility) keeps power capacity for
// full access (server.mjs _FACILITY_FREE_FIELDS: "power capacity stays a full-access field"; the tool description:
// "MW and specs need a full-access key").
// The last-resort noun when nothing names a field. Not a field itself: a list read back from preview_scope drops it, so
// a later, better rule (the facility rule) still runs on an answer an earlier pass reconciled.
export const DETAIL_ROWS_FALLBACK = 'the detail rows of this answer';

export const FACILITY_FULL_ACCESS_FIELDS = Object.freeze(['power capacity (MW)']);

const FIELD_RE = /^[a-z][a-z0-9_ ()\/-]{0,60}$/i;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// One field name (snake_case or already a noun) -> the plain noun a person reads.
export function withheldFieldLabel(f) {
  const s = String(f == null ? '' : f).trim();
  if (!s) return '';
  const k = s.replace(/\[\]/g, '').split('.').pop();
  // preview_scope already turned underscores into spaces ("top risks json"), so look the label up both ways.
  const lk = k.trim().replace(/\s+/g, '_');
  if (WITHHELD_LABELS[lk]) return WITHHELD_LABELS[lk];
  if (FIELD_NOUNS[k]) return FIELD_NOUNS[k];
  const n = FIELD_RE.test(k) ? k.replace(/_in_pro$/, '').replace(/_json$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return n && !LINE_BANNED.test(n) ? n : '';
}

// "a, b and c" (every field named; the list is what the person is told, so nothing is folded into a count).
export function withheldList(fields) {
  const xs = (Array.isArray(fields) ? fields : []).map(withheldFieldLabel).filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i);
  if (xs.length <= 1) return xs.join('');
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

// The same list cut to at most `max` characters at an item boundary, the rest counted ("a, b and 3 more fields"): for
// the relay page's stored copy (dchub-backend relay_teaser _WITHHELD_OK caps it at 200), which a plain slice cut
// mid-word. The answer itself always names every field (withheldList).
export function withheldListFit(fields, max = 200) {
  const full = withheldList(fields);
  if (full.length <= max) return full;
  const xs = (Array.isArray(fields) ? fields : []).map(withheldFieldLabel).filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i);
  for (let k = xs.length - 1; k >= 1; k -= 1) {
    const rest = xs.length - k;
    const s = xs.slice(0, k).join(', ') + ' and ' + rest + ' more field' + (rest === 1 ? '' : 's');
    if (s.length <= max) return s;
  }
  return '';
}

// "Withheld here: a, b and c." ('' when there is nothing to name).
export function withheldLine(fields, label = WITHHELD_HERE_LABEL) {
  const l = withheldList(fields);
  return l ? label + ' ' + l + '.' : '';
}

// Two field names say the same figure (retail_rate_cents_kwh and retail_rate_kwh / "retail rate kwh").
const _sameFigure = (a, b) => {
  const n = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/cents/g, '');
  return !!n(a) && n(a) === n(b);
};

// The figures this answer states in its headline (taste.headline, intent_answer.headline when it names a field).
function headlineFields(sc) {
  const out = [];
  for (const h of [isObj(sc.taste) ? sc.taste.headline : null, isObj(sc.intent_answer) ? sc.intent_answer.headline : null]) {
    if (isObj(h) && typeof h.name === 'string' && h.value !== null && h.value !== undefined) out.push(h.name);
  }
  return out;
}

// Sections the answer withheld whole: taste `withheld` [{section, count}], completeness.withheld.
function withheldSections(sc) {
  const s = [];
  if (Array.isArray(sc.withheld)) for (const w of sc.withheld) if (isObj(w) && typeof w.section === 'string' && w.count > 0) s.push(w.section);
  if (isObj(sc.completeness) && Array.isArray(sc.completeness.withheld)) for (const w of sc.completeness.withheld) if (typeof w === 'string') s.push(w);
  return s.filter((x, i, a) => a.indexOf(x) === i);
}

// The withheld field nouns for a preview answer: [] for a full answer, never [] for a preview.
export function withheldFields(sc) {
  if (!isObj(sc)) return [];
  const preview = isPreviewAnswer(sc) || sc._gated === true || sc._preview_only === true;
  if (!preview) return [];
  let base = isObj(sc.preview_scope) && Array.isArray(sc.preview_scope.withheld_fields)
    ? sc.preview_scope.withheld_fields.slice()
    : ((previewScope(sc) || {}).withheld_fields || []).slice();
  // (c) a field the headline states is not withheld.
  const shown = headlineFields(sc);
  base = base.filter((f) => f !== DETAIL_ROWS_FALLBACK && !shown.some((h) => _sameFigure(h, f)));
  let nouns = base.map(withheldFieldLabel).filter(Boolean);
  // (d) a section withheld whole names its row fields.
  if (!nouns.length) {
    for (const sec of withheldSections(sc)) {
      const f = SECTION_FIELDS[sec];
      nouns.push(...(f ? f : [withheldFieldLabel(sec)]));
    }
  }
  // A facility list: the full-access field, and the rows the preview cut ("the other 2 of the 5 facilities in this
  // answer", the answer's own preview_scope counts, never a registry total).
  if (!nouns.length && sc._entity === 'facility') {
    nouns.push(...FACILITY_FULL_ACCESS_FIELDS);
    const ps = isObj(sc.preview_scope) ? sc.preview_scope : (previewScope(sc) || {});
    if (Number.isInteger(ps.shown) && Number.isInteger(ps.total) && ps.total > ps.shown) {
      // Plain digits: the noun is read back through withheldFieldLabel, whose pattern has no comma.
      nouns.push('the other ' + (ps.total - ps.shown) + ' of the ' + ps.total + ' facilities in this answer');
    }
    return nouns;
  }
  // Still nothing: what the answer itself says is missing (analyze_site's wall: `missing`, plain nouns), else the
  // locked fields as the answer lists them.
  if (!nouns.length && Array.isArray(sc.missing)) nouns = sc.missing.filter((x) => typeof x === 'string').map(withheldFieldLabel);
  if (!nouns.length && Array.isArray(sc._locked_fields)) nouns = sc._locked_fields.map(withheldFieldLabel);
  nouns = nouns.filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  return nouns.length ? nouns : [DETAIL_ROWS_FALLBACK];
}

// structuredContent with preview_scope.withheld_fields set to withheldFields (the (c) / (d) fixes), when the answer
// carries a preview_scope. Returns sc itself when nothing changes.
export function reconcilePreviewScope(sc) {
  if (!isObj(sc) || !isObj(sc.preview_scope)) return sc;
  const next = withheldFields(sc);
  const cur = Array.isArray(sc.preview_scope.withheld_fields) ? sc.preview_scope.withheld_fields : [];
  if (next.length === cur.length && next.every((x, i) => x === cur[i])) return sc;
  return { ...sc, preview_scope: { ...sc.preview_scope, withheld_fields: next } };
}
