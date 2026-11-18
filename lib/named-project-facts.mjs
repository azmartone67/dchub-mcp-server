// named-project-facts.mjs -- the answer line for a name lookup (owner note 2026-11-18, feature 4).
//
// get_pipeline name= and search_facilities name= (dchub-backend util/project_lookup) return `name_lookup`
// {query, matched, best_match_index, message} and the matched records in `data`, best first. This turns that
// into one dated sentence for execute_plan's facts[]. It reads only fields the step returned at the caller's
// depth: a field the preview withheld (nulled by the trim, or marked <field>_withheld by the backend) is said
// as withheld, never filled in; a field the record does not state is said as not stated.

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));

export const NAMED_WITHHELD = 'withheld at this access level';

export function isNameLookup(p) {
  return isObj(p) && isObj(p.name_lookup);
}

function withheld(rec, key) {
  return rec[`${key}_withheld`] === true || rec[`_${key}_in_pro`] === true
    || (rec[key] === null && Object.prototype.hasOwnProperty.call(rec, key) && !one(rec[`${key === 'stated_mw' ? 'mw' : key}_basis`]).startsWith('no '));
}

export function namedLookupFacts(tool, p) {
  try {
    const nl = p.name_lookup;
    const q = one(nl.query);
    if (nl.matched === false) {
      const msg = one(nl.message) || `No record matches "${q}" in DC Hub's facility registry or construction pipeline.`;
      return [{ tool, as_of: null, entity: q || null, text: `${msg.replace(/\.$/, '')} (DC Hub name lookup).` }];
    }
    const rows = Array.isArray(p.data) ? p.data : [];
    const rec = rows[Number.isInteger(nl.best_match_index) ? nl.best_match_index : 0];
    if (!isObj(rec) || !one(rec.name)) return [];
    const parts = [];
    const dev = one(rec.developer);
    if (dev) parts.push(`developer ${dev}`);
    const place = [one(rec.city), one(rec.county), one(rec.state)].filter(Boolean).join(', ');
    if (place) parts.push(place);
    const status = one(rec.status);
    if (status) parts.push(`status ${status}`);
    else if (withheld(rec, 'status')) parts.push(`status ${NAMED_WITHHELD}`);
    const mw = num(rec.stated_mw);
    if (mw != null) parts.push(`${fmt(mw)} MW stated`);
    else if (withheld(rec, 'stated_mw')) parts.push(`MW ${NAMED_WITHHELD}`);
    else parts.push('no MW stated');
    const cod = one(rec.expected_cod);
    if (cod) parts.push(`expected completion ${cod}`);
    else if (withheld(rec, 'expected_cod')) parts.push(`expected completion ${NAMED_WITHHELD}`);
    else parts.push('no completion date stated');
    const src = one(rec.source_url);
    if (src) parts.push(`source ${src}`);
    const asOf = /^\d{4}-\d{2}-\d{2}/.test(one(rec.as_of)) ? one(rec.as_of).slice(0, 10) : null;
    const others = rows.length > 1 ? ` ${rows.length - 1} other matching record${rows.length - 1 === 1 ? ' is' : 's are'} listed beside it.` : '';
    return [{ tool, as_of: asOf, entity: q || one(rec.name),
      text: `"${q || one(rec.name)}": best match ${one(rec.name)} (${parts.join('; ')})`
        + ` (DC Hub name lookup${asOf ? `, record as of ${asOf}` : ''}).${others}` }];
  } catch (_e) { return []; }
}
