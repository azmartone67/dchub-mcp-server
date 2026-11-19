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

// ---- planner 5.42: the named_campus answer (Grok 2026-11-18 evening, item 5) ----
// "status and power plan of the Stargate Abilene data center campus" led with the market's DCPI verdict alone and
// never named the project. The answer now leads with the name lookup's best match (or its no-match sentence), then
// the market verdict. A lookup step whose response carries no name_lookup block (a backend that ignored name=)
// returned rows that were not looked up by name: none of them is passed on, and the lead says no record matched.
const parsedObj = (v) => {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
};
export const namedNoMatch = (name) => `No DC Hub record matched "${name}" in this read.`;

export function buildNamedCampusAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'named_campus') return null;
    const name = one(ctx.campus);
    const steps = [];
    for (const e of Array.isArray(executed) ? executed : []) {
      if (!e || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
      const p = parsedObj((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
      if (p) steps.push({ e, p });
    }
    const lookups = steps.filter((s) => (s.e.tool === 'get_pipeline' || s.e.tool === 'search_facilities') && s.e.args && one(s.e.args.name));
    if (!lookups.length) return null;
    const q = name || one(lookups[0].e.args.name);
    const facts = [];
    // get_pipeline first (the full record at the caller's depth), then the registry search.
    const order = (t) => (t === 'get_pipeline' ? 0 : 1);
    const real = lookups.filter((s) => isNameLookup(s.p)).sort((a, b) => order(a.e.tool) - order(b.e.tool));
    const hit = real.find((s) => s.p.name_lookup.matched !== false && namedLookupFacts(s.e.tool, s.p).length);
    let lead;
    if (hit) {
      const f = namedLookupFacts(hit.e.tool, hit.p)[0];
      facts.push({ ...f, step: hit.e.step });
      lead = f.text;
    } else if (real.length) {
      const f = namedLookupFacts(real[0].e.tool, real[0].p)[0];
      lead = f ? f.text : namedNoMatch(q);
      if (f) facts.push({ ...f, step: real[0].e.step });
    } else {
      lead = namedNoMatch(q);
      facts.push({ tool: lookups[0].e.tool, step: lookups[0].e.step, as_of: null, entity: q, text: lead });
    }
    const ne = [];
    if (!real.length) ne.push(`The lookup steps did not read by name in this run, so the rows they returned are not "${q}" and are not reported.`);
    const dc = steps.find((s) => s.e.tool === 'get_market_dcpi_rank');
    let vLine = '';
    if (dc) {
      const v = one(dc.p.verdict).toUpperCase();
      const sc = num(dc.p.composite_score);
      const mk = one(dc.p.market_name) || one(dc.e.args && dc.e.args.market_slug);
      const d = /^\d{4}-\d{2}-\d{2}/.test(one(dc.p.computed_at)) ? one(dc.p.computed_at).slice(0, 10) : null;
      if (/^(BUILD|CAUTION|AVOID)$/.test(v)) {
        vLine = `${mk ? `${mk} ` : ''}Data Center Power Index (DCPI) verdict for the market: ${v}${sc != null ? `, ${sc}/100` : ''}${d ? ` (as of ${d})` : ''}.`;
        facts.push({ tool: 'get_market_dcpi_rank', step: dc.e.step, entity: mk || null, as_of: d, text: vLine });
      }
    }
    const dates = facts.map((f) => f.as_of).filter((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
    return { kind: 'named_campus', requested_mw: null, geography: q, headline: [lead, vLine].filter(Boolean).join(' '),
      verdict: null, evidence: facts.map((f) => f.text), not_established: ne, as_of: dates[0] || null, relay: null,
      source: 'Source: DC Hub (dchub.cloud), each figure dated in its own fact.',
      facts: facts.map(({ tool, step, as_of, entity, text }) => ({ tool, step, as_of, entity, text })) };
  } catch (_e) { return null; }
}
