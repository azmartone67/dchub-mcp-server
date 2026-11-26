// plan-cite-line.mjs — the line an execute_plan answer is cited by (Grok head-to-head 2026-11-25, planner 5.64).
//
// Every plan's cite_as read like "DC Hub (dchub.cloud) — PARTIAL preview, 3 of 5 shown, as of 2026-11-25": the
// access level rode inside the line an agent quotes under a figure, and the date was not the answer's own date
// (fiber, fb-a: intent_answer.as_of 2026-03-17 beside cite_as "as of 2026-11-24").
//
// Owner-approved line (2026-11-10):  Source: DC Hub (dchub.cloud), as of <YYYY-MM-DD>
//   * <date> is the answer's own as_of when intent_answer states one (said as its America/Phoenix day, the same day
//     the answer's lead says), else the citation's date, else the provenance date, else today in Phoenix.
//   * An upstream named by the cite the plan already carried ("...; upstream EPA Green Book") is appended the way
//     backend cites append it: "; upstream <name>".
//   * A plan no step dated (as_of_kind generated_at) keeps saying so: "(plan run; no source date stated)".
//   * The preview wording ("partial preview, 3 of 188 shown") moves to completeness.note and
//     citation.completeness_note. citation.completeness keeps its machine value ('partial_preview'): several readers
//     (isTierPreview, the relay and Cite-as steps) branch on exactly that string.
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
export function planCiteDay(sc, now = Date.now()) {
  const ia = isObj(sc && sc.intent_answer) ? sc.intent_answer : {};
  const cit = isObj(sc && sc.citation) ? sc.citation : {};
  const prov = isObj(sc && sc.provenance) ? sc.provenance : {};
  return dayOf(ia.as_of) || dayOf(cit.as_of) || dayOf(prov.as_of) || phoenixToday(now);
}

/** "Source: DC Hub (dchub.cloud), as of <day>[ (plan run; no source date stated)][; upstream <name>]". */
export function planCiteLine(sc, now = Date.now()) {
  const ia = isObj(sc && sc.intent_answer) ? sc.intent_answer : {};
  const prov = isObj(sc && sc.provenance) ? sc.provenance : {};
  const generated = !dayOf(ia.as_of) && prov.as_of_kind === 'generated_at';
  const up = upstreamOf(sc || {});
  return PLAN_CITE_PREFIX + planCiteDay(sc, now) + (generated ? GENERATED_NOTE : '') + (up ? '; upstream ' + up : '');
}

/** The plan payload with cite_as, citation.cite_as and the completeness note set. */
export function stampPlanCite(sc, now = Date.now()) {
  try {
    if (!isObj(sc)) return sc;
    const line = planCiteLine(sc, now);
    const note = planCompletenessNote(sc);
    const out = { ...sc, cite_as: line };
    if (isObj(sc.citation)) {
      out.citation = { ...sc.citation, cite_as: line, ...(note ? { completeness_note: note } : {}) };
    }
    if (note) {
      if (isObj(sc.completeness)) out.completeness = { ...sc.completeness, note: sc.completeness.note || note };
      else if (sc.completeness == null) out.completeness = { status: 'partial', note };
    }
    return out;
  } catch (_e) { return sc; }
}
