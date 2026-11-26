// plan-cite-line.mjs — the line an execute_plan answer is cited by (Grok head-to-head 2026-11-25, planner 5.64).
//
// Every plan's cite_as read like "DC Hub (dchub.cloud) — PARTIAL preview, 3 of 5 shown, as of 2026-11-25": the
// access level rode inside the line an agent quotes under a figure, and the date was not the answer's own date
// (fiber, fb-a: intent_answer.as_of 2026-03-17 beside cite_as "as of 2026-11-24").
//
// Owner-approved line (2026-11-10):  Source: DC Hub (dchub.cloud), as of <YYYY-MM-DD>
//   * <date> is the answer's own as_of when intent_answer states one (said as its America/Phoenix day, the same day
//     the answer's lead says), else the day the cite the plan already carried said (opts.priorCite: the line
//     stampOutreach built before, lib/agent-outreach.mjs citeAsFor), else the citation's date, else the provenance
//     date, else today in Phoenix.
//   * An upstream named by the cite the plan already carried ("...; upstream EPA Green Book") is appended the way
//     backend cites append it: "; upstream <name>".
//   * A plan no step dated (as_of_kind generated_at) keeps saying so: "(plan run; no source date stated)".
//   * The preview wording ("partial preview, 3 of 188 shown") moves to completeness.note and
//     citation.completeness_note. citation.completeness keeps its machine value ('partial_preview'): several readers
//     (isTierPreview, the relay and Cite-as steps) branch on exactly that string.
//   * Follow-up (live QA 2026-11-25 after #1768): the per-step citations[] and provenance.cite_as beside it still said
//     "DC Hub, dchub.cloud — PARTIAL preview, 3 of 11 shown (as of ...)" or an undated "DC Hub, dchub.cloud".
//     provenance.cite_as is the plan line; each DC Hub step cite is "Source: DC Hub (dchub.cloud), as of <the Phoenix
//     day of that step's as_of>" (no date clause only when the step states none), its PARTIAL wording in that entry's
//     completeness_note, its completeness value kept. A step cite that is not DC Hub's is left as it is.
// Pure; never throws (returns the payload unchanged on any failure).
import { phoenixDay, phoenixToday, spokenDay } from './cite-day.mjs';
import { partialPhrase } from './attribution.mjs';

export const PLAN_CITE_PREFIX = 'Source: DC Hub (dchub.cloud), as of ';
export const PLAN_CITE_RE = /^Source: DC Hub \(dchub\.cloud\), as of \d{4}-\d{2}-\d{2}/;
const GENERATED_NOTE = ' (plan run; no source date stated)';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const dayOf = (v) => {
  const s = str(v);
  if (!s) return null;
  return spokenDay(s) || phoenixDay(s);
};

// "; upstream EPA Green Book ..." on a cite the payload already carried, or null.
const UPSTREAM_RE = /;\s*upstream\s+(.+?)\s*\.?$/i;
function upstreamOf(sc) {
  const ia = isObj(sc.intent_answer) ? sc.intent_answer : {};
  const cit = isObj(sc.citation) ? sc.citation : {};
  for (const c of [sc.cite_as, cit.cite_as, ia.cite_as]) {
    const m = str(c) && UPSTREAM_RE.exec(str(c));
    if (m && !/PARTIAL|preview/i.test(m[1])) return m[1];
  }
  return null;
}

/** The PARTIAL wording the plan's citation carries, lower-cased ("partial preview, 3 of 188 shown"), or null. */
export function planCompletenessNote(sc) {
  if (!isObj(sc)) return null;
  const cit = isObj(sc.citation) ? sc.citation : {};
  const fromCite = str(cit.cite_as) && /\s—\s(PARTIAL.*?)(?:\s*\((?:as of|plan run)[^)]*\))?\s*$/.exec(str(cit.cite_as));
  const phrase = (fromCite && fromCite[1]) || partialPhrase(isObj(sc.provenance) ? sc.provenance : null);
  return phrase ? phrase.replace(/^PARTIAL/, 'partial') : null;
}

/** The day the plan is cited as of (YYYY-MM-DD, America/Phoenix). */
const PRIOR_DAY_RE = /\bas of (\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z?)?)/;
const priorDay = (c) => { const m = str(c) && PRIOR_DAY_RE.exec(str(c)); return m ? dayOf(m[1]) : null; };
export function planCiteDay(sc, now = Date.now(), opts = {}) {
  const ia = isObj(sc && sc.intent_answer) ? sc.intent_answer : {};
  const cit = isObj(sc && sc.citation) ? sc.citation : {};
  const prov = isObj(sc && sc.provenance) ? sc.provenance : {};
  return dayOf(ia.as_of) || priorDay(opts && opts.priorCite) || dayOf(cit.as_of) || dayOf(prov.as_of) || phoenixToday(now);
}

/** "Source: DC Hub (dchub.cloud), as of <day>[ (plan run; no source date stated)][; upstream <name>]". */
export function planCiteLine(sc, now = Date.now(), opts = {}) {
  const ia = isObj(sc && sc.intent_answer) ? sc.intent_answer : {};
  const prov = isObj(sc && sc.provenance) ? sc.provenance : {};
  const generated = !dayOf(ia.as_of) && prov.as_of_kind === 'generated_at';
  const up = upstreamOf(sc || {});
  return PLAN_CITE_PREFIX + planCiteDay(sc, now, opts) + (generated ? GENERATED_NOTE : '') + (up ? '; upstream ' + up : '');
}

const DCHUB_CITE_RE = /^(?:Source:\s*)?DC Hub(?:,\s*dchub\.cloud|\s*\(dchub\.cloud\))/;
const STEP_PARTIAL_RE = /\s—\s(PARTIAL.*?)(?=\s*(?:\((?:as of|plan run)[^)]*\)|;\s*upstream\b|,\s*as of\b|$))/;
const STEP_DAY_RE = /\bas of (\d{4}-\d{2}(?:-\d{2})?(?:T[0-9:.]+Z?)?)/;

/** One citations[] entry with the owner line ({...c, cite_as, completeness_note}); a cite that is not DC Hub's as is. */
export function stepCiteEntry(c) {
  try {
    if (!isObj(c) || !str(c.cite_as) || !DCHUB_CITE_RE.test(str(c.cite_as))) return c;
    const cite = str(c.cite_as);
    const m = STEP_DAY_RE.exec(cite);
    const day = dayOf(c.as_of) || (m ? dayOf(m[1].length === 7 ? `${m[1]}-01` : m[1]) : null);
    const pm = STEP_PARTIAL_RE.exec(cite);
    const up = UPSTREAM_RE.exec(cite.replace(/\s*\((?:as of|plan run)[^)]*\)\s*$/, ''));
    const upName = up && !/PARTIAL|preview/i.test(up[1]) ? up[1] : null;
    const line = (day ? PLAN_CITE_PREFIX + day : 'Source: DC Hub (dchub.cloud)') + (upName ? '; upstream ' + upName : '');
    const note = pm ? pm[1].replace(/^PARTIAL/, 'partial') : null;
    return { ...c, cite_as: line, ...(note && !str(c.completeness_note) ? { completeness_note: note } : {}) };
  } catch (_e) { return c; }
}

/** The plan payload with cite_as, citation.cite_as and the completeness note set. */
export function stampPlanCite(sc, now = Date.now(), opts = {}) {
  try {
    if (!isObj(sc)) return sc;
    const line = planCiteLine(sc, now, opts);
    const note = planCompletenessNote(sc);
    const out = { ...sc, cite_as: line };
    if (isObj(sc.citation)) {
      out.citation = { ...sc.citation, cite_as: line, ...(note ? { completeness_note: note } : {}) };
    }
    if (note) {
      if (isObj(sc.completeness)) out.completeness = { ...sc.completeness, note: sc.completeness.note || note };
      else if (sc.completeness == null) out.completeness = { status: 'partial', note };
    }
    if (isObj(sc.provenance) && typeof sc.provenance.cite_as === 'string') out.provenance = { ...sc.provenance, cite_as: line };
    if (Array.isArray(sc.citations)) out.citations = sc.citations.map(stepCiteEntry);
    return out;
  } catch (_e) { return sc; }
}
