// preview-scope.mjs -- a preview or walled answer says, in one neutral line, how much of the list it shows and which
// fields it leaves out (Grok free-to-paid note, M2.1; owner 2026-11-18 "lets do 1 and 2").
//
// WHY. A keyless preview already carries what was held back, in machine fields an agent has to know to read:
// provenance.preview {shown, total, withheld_fields}, `_<list>_total_available`, `_locked_fields` (the fields the
// backend nulled), a taste answer's `withheld` sections. The agent relays the rows; its person never learns that
// 3 of 15 deals were shown or that the deal values were left out.
//
// WHAT. previewScopeStep(result): on a preview / walled answer, structuredContent.preview_scope
// {shown, total, withheld_fields[]} and ONE text line, e.g. "3 of 5,469 projects shown; capacity and location
// withheld.", as its own block right after the data block (the first JSON block), so the citation, the ask and the closing preview
// footer keep their places. When block 0 also carries the ask (only closing lines follow it), no line is added: the
// scope rides in block 0's JSON, and the ask stays the last text the agent reads. preview_scope goes before the relay tail keys (lib/answer-shape.mjs RELAY_TAIL_KEYS), so the
// data still comes before every relay / upsell key. Field names become plain nouns (FIELD_NOUNS).
//   * Counts come only from the answer's own fields. No total -> no count is said (never a guess); an answer with
//     withheld fields and no list (one market's DCPI row) says only what it withheld: "DCPI sub-scores withheld."
//   * Nothing to say (no count, no withheld field) -> no line. A full answer -> no line and no preview_scope.
//   * The line names no plan, price, tier or offer: LINE_BANNED is checked on every line before it is added.
// Skipped (server.mjs): the directory profile (/mcp/chatgpt is frozen), execute_plan (its steps speak for themselves)
// and its loopback steps, clean platforms. Kill switch DCHUB_PREVIEW_SCOPE=0 (read per call): unchanged, byte for byte.

import { PREVIEW_FOOTER } from './dchub-identity.mjs';
import { RELAY_TAIL_KEYS } from './answer-shape.mjs';

const RELAY_TAIL = new Set(RELAY_TAIL_KEYS);

export const PREVIEW_SCOPE_FLAG = 'DCHUB_PREVIEW_SCOPE';
export function previewScopeOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[PREVIEW_SCOPE_FLAG]) || '').trim());
}

// Field name -> the plain noun a person reads. Several names share a noun (lat + lng = location); each noun is said once.
export const FIELD_NOUNS = Object.freeze({
  capacity_mw: 'capacity', capacity: 'capacity', size_mw: 'capacity', queued_mw: 'capacity',
  lat: 'location', lng: 'location', lon: 'location', latitude: 'location', longitude: 'location',
  representative_point: 'location', coordinates: 'location', geometry: 'location', address: 'location',
  estimated_ttp_months: 'time to power', ttp_months: 'time to power', time_to_power_months: 'time to power',
  excess_power_score: 'DCPI sub-scores', constraint_score: 'DCPI sub-scores',
  value_usd: 'deal value', deal_value: 'deal value', deal_value_usd: 'deal value',
});
// What the line may never say (plans, prices, offers).
export const LINE_BANNED = /free|\bpro\b|upgrade|unlock|\$|\bplans?\b|pric(?:e|ing)|\btier\b|\bpaid\b|trial|credit/i;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (n) => Number.isInteger(n) && n >= 0;
const FIELD_RE = /^[a-z][a-z0-9_]{0,40}$/;
const NOUNS = new Set(Object.values(FIELD_NOUNS));
const noun = (f) => FIELD_NOUNS[f] || (FIELD_RE.test(f) ? f.replace(/_/g, ' ') : null);
const fmt = (n) => n.toLocaleString('en-US');
function joinWords(xs) {
  if (xs.length <= 1) return xs.join('');
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

// A provenance.preview block that records only a SIZE trim (lib/attribution.mjs SIZE_ONLY_REASONS: a step result cut
// to fit the response) with no withheld field and no proven withholding. It is not a preview: a licensed execute_plan
// carried one and was told "Withheld here: the detail rows of this answer" (live 2026-11-25).
const SIZE_ONLY_PREVIEW_REASONS = new Set(['step result truncated']);
export function sizeTrimOnlyPreview(pv) {
  if (!isObj(pv) || pv.withholding_proven === true) return false;
  if (Array.isArray(pv.withheld_fields) && pv.withheld_fields.length) return false;
  const rs = Array.isArray(pv.reasons) ? pv.reasons : [];
  return rs.length > 0 && rs.every((r) => SIZE_ONLY_PREVIEW_REASONS.has(String(r)));
}

// Whether the answer is a preview or walled (one of the markers the server already sets).
export function isPreviewAnswer(sc) {
  if (!isObj(sc)) return false;
  const pv = isObj(sc.provenance) ? sc.provenance : {};
  return sc.preview_is_partial === true || sc.trial_preview === true || sc.free_preview_only === true
    || sc._wall === true || sc.status === 'gated_preview' || (isObj(pv.preview) && !sizeTrimOnlyPreview(pv.preview)) || pv.completeness === 'partial_preview'
    || (Array.isArray(sc._locked_fields) && sc._locked_fields.length > 0);
}

// The list the answer trims: { list, shown, total } or null, from the answer's own fields only.
function listCounts(sc) {
  const pv = isObj(sc.provenance) && isObj(sc.provenance.preview) ? sc.provenance.preview : null;
  const totals = Object.entries(sc).filter(([k, v]) => /^_[a-z][a-z0-9_]*_total_available$/.test(k) && isCount(v))
    .map(([k, v]) => ({ list: k.slice(1, -'_total_available'.length), total: v }));
  if (pv && isCount(pv.shown) && isCount(pv.total)) {
    const t = totals.find((x) => x.total === pv.total && Array.isArray(sc[x.list]))
      || totals.find((x) => Array.isArray(sc[x.list]) && sc[x.list].length === pv.shown);
    const fromReason = Array.isArray(pv.reasons) ? pv.reasons.map((r) => /^([a-z][a-z0-9_]*): \d+ of \d+ shown$/.exec(String(r))).find(Boolean) : null;
    return { list: t ? t.list : fromReason ? fromReason[1] : null, shown: pv.shown, total: pv.total };
  }
  for (const t of totals) if (Array.isArray(sc[t.list])) return { list: t.list, shown: sc[t.list].length, total: t.total };
  // A taste answer: a section withheld whole, with its count.
  if (Array.isArray(sc.withheld)) {
    const w = sc.withheld.find((x) => isObj(x) && typeof x.section === 'string' && isCount(x.count) && x.count > 0);
    if (w) return { list: w.section, shown: 0, total: w.count };
  }
  return null;
}

// The withheld field names: _locked_fields (the answer's and the first row's), _<x>_locked_fields, and
// provenance.preview.withheld_fields, minus the list and section names (those are counted, not withheld fields).
function withheldFields(sc, listName) {
  const out = [];
  const add = (xs, prefix = '') => { if (Array.isArray(xs)) for (const f of xs) if (typeof f === 'string') out.push(prefix ? prefix + '_' + f : f); };
  add(sc._locked_fields);
  for (const [k, v] of Object.entries(sc)) { const m = /^_([a-z][a-z0-9]*)_locked_fields$/.exec(k); if (m) add(v, m[1]); }
  if (listName && Array.isArray(sc[listName]) && isObj(sc[listName][0])) add(sc[listName][0]._locked_fields);
  const pv = isObj(sc.provenance) && isObj(sc.provenance.preview) ? sc.provenance.preview : null;
  if (pv) add(pv.withheld_fields);
  const sections = new Set([listName].concat(Array.isArray(sc.withheld) ? sc.withheld.map((x) => x && x.section) : []));
  const nouns = [];
  for (const f of out) {
    const name = String(f).replace(/\[\]/g, '').split('.').pop();
    if (sections.has(f) || sections.has(name) || (Array.isArray(sc[name]) && !FIELD_NOUNS[name])) continue;
    const n = noun(name);
    if (n && !LINE_BANNED.test(n) && !nouns.includes(n)) nouns.push(n);
  }
  return nouns;
}

// { shown, total, withheld_fields } for a preview answer, or null (a full answer, or nothing to say).
export function previewScope(sc) {
  if (!isPreviewAnswer(sc)) return null;
  const c = listCounts(sc);
  const counted = !!(c && c.total > 0 && c.shown < c.total);
  const fields = withheldFields(sc, c && c.list);
  if (!counted && !fields.length) return null;
  return { shown: counted ? c.shown : null, total: counted ? c.total : null, withheld_fields: fields,
    ...(counted && c.list ? { list: c.list } : {}) };
}

export function scopeLine(scope) {
  if (!scope) return null;
  const listNoun = scope.list && FIELD_RE.test(scope.list) ? scope.list.replace(/_/g, ' ') : 'rows';
  const parts = [];
  if (isCount(scope.shown) && isCount(scope.total)) parts.push(fmt(scope.shown) + ' of ' + fmt(scope.total) + ' ' + listNoun + ' shown');
  // The line names the plain nouns (FIELD_NOUNS) and counts the rest; preview_scope.withheld_fields lists them all.
  const known = scope.withheld_fields.filter((n) => NOUNS.has(n));
  const others = scope.withheld_fields.length - known.length;
  const named = known.concat(others > 0 ? [(known.length ? others + ' other field' : others + ' field') + (others === 1 ? '' : 's')] : []);
  if (named.length) parts.push(joinWords(named) + ' withheld');
  if (!parts.length) return null;
  const line = parts.join('; ') + '.';
  const out = line[0].toUpperCase() + line.slice(1);
  return LINE_BANNED.test(out) ? null : out;
}

// A closing line: the citation, the identity footer, the one-step key line (lib/dchub-identity.mjs, the grid preview).
const CLOSING_RE = /^(Source: DC Hub \(dchub\.cloud|Cite as: |Free, one call: call `|Ask your user for their email, then call `|Give your user this answer first: )/;
function isClosingBlock(b) {
  if (!b || b.type !== 'text' || typeof b.text !== 'string') return true;
  const t = b.text.trim();
  return t === PREVIEW_FOOTER.trim() || CLOSING_RE.test(t);
}
// `obj` with preview_scope before its first relay tail key (lib/answer-shape.mjs), so the data still leads.
function withScopeKey(obj, scope) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!('preview_scope' in out) && k !== 'human_url' && RELAY_TAIL.has(k)) out.preview_scope = scope;
    out[k] = v;
  }
  if (!('preview_scope' in out)) out.preview_scope = scope;
  return out;
}

// The step. `skip`: a skipped surface or tool (server.mjs decides).
export function previewScopeStep(result, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !previewScopeOn(env)) return result;
    if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !isObj(result.structuredContent)) return result;
    const sc = result.structuredContent;
    if (sc.preview_scope !== undefined) return result;   // once per answer
    const scope = previewScope(sc);
    const line = scopeLine(scope);
    if (!line) return result;
    const { list: _l, ...pubScope } = scope;
    const content = result.content.slice();
    // The data block: the first block that is a JSON object (a notice may come before it); none = block 0.
    let at = content.findIndex((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.trimStart().startsWith('{'));
    if (at < 0) at = 0;
    // The ask stays the last text the agent reads (owner 2026-11-02): when every block after the data block is a
    // closing line (citation, footer, the claim line), the ask is in the data block, so the scope rides in its JSON.
    if (content.slice(at + 1).some((b) => !isClosingBlock(b))) content.splice(at + 1, 0, { type: 'text', text: line });
    else {
      const bd = content[at];
      let j = null;
      try { j = bd && bd.type === 'text' ? JSON.parse(bd.text) : null; } catch (_) { j = null; }
      if (!isObj(j)) return result;
      content[at] = { ...bd, text: JSON.stringify(withScopeKey(j, pubScope)) };
    }
    return { ...result, content, structuredContent: withScopeKey(sc, pubScope) };
  } catch (_) { return result; }   // a scope line is never worth failing a response over
}
