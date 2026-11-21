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

const FIELD_RE = /^[a-z][a-z0-9_ ()\/-]{0,60}$/i;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// One field name (snake_case or already a noun) -> the plain noun a person reads.
export function withheldFieldLabel(f) {
  const s = String(f == null ? '' : f).trim();
  if (!s) return '';
  const k = s.replace(/\[\]/g, '').split('.').pop();
  if (FIELD_NOUNS[k]) return FIELD_NOUNS[k];
  const n = FIELD_RE.test(k) ? k.replace(/_in_pro$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return n && !LINE_BANNED.test(n) ? n : '';
}

// "a, b and c" (every field named; the list is what the person is told, so nothing is folded into a count).
export function withheldList(fields) {
  const xs = (Array.isArray(fields) ? fields : []).map(withheldFieldLabel).filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i);
  if (xs.length <= 1) return xs.join('');
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
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
  base = base.filter((f) => !shown.some((h) => _sameFigure(h, f)));
  let nouns = base.map(withheldFieldLabel).filter(Boolean);
  // (d) a section withheld whole names its row fields.
  if (!nouns.length) {
    for (const sec of withheldSections(sc)) {
      const f = SECTION_FIELDS[sec];
      nouns.push(...(f ? f : [withheldFieldLabel(sec)]));
    }
  }
  // Still nothing: what the answer itself says is missing (analyze_site's wall: `missing`, plain nouns), else the
  // locked fields as the answer lists them.
  if (!nouns.length && Array.isArray(sc.missing)) nouns = sc.missing.filter((x) => typeof x === 'string').map(withheldFieldLabel);
  if (!nouns.length && Array.isArray(sc._locked_fields)) nouns = sc._locked_fields.map(withheldFieldLabel);
  nouns = nouns.filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  return nouns.length ? nouns : ['the detail rows of this answer'];
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
