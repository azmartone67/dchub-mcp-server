// plan-facility-lead.mjs -- execute_plan: a facilities ask keeps its class, its lead and an honest count (2026-11-23).
//
// WHY. Grok spec 3 (2026-11-23, re-run on server 2.12.63, planner 5.62), Muse TEST_PATH P4:
//   execute_plan(intent "Which data center facilities are in the Ashburn market?", market "Ashburn") was PARTIAL.
//   a. Routing: facility_search scored 3 on "facilities"; market_ranking scored 1.5 on the bare word "market" plus
//      1.5 for the bound market arg, tied 3 vs 3, and won on declaration order. With no market arg the same text
//      routes to facility_search. A singular "<place> market" is the place's name, not a ranking ask.
//   b. The ranking plan led with "DCPI 20/100" and a where-to-build ranking nobody asked for.
//   c. The submarket filter cut Vantage "Ashburn I" (registry 7826, city field "Ashburn I") as outside Ashburn.
//   d. The count said "2 facilities in Ashburn on record" while the direct search said 5 were available (3 shown).
//   P7 (Columbus): the facilities fact did not say its rows sit in Dublin and New Albany, not Columbus proper.
//
// WHAT (all behind DCHUB_PLAN_FACILITY_LEAD_V1, default OFF; off = planner 5.63 byte-identical):
//   1. facilityLeadRoutingAdjust: market_ranking's bare "market(s)" credit (1.5) counts only on the plural or a
//      ranking word (rank, best, top, compare, shortlist, where to build / where should|can|do); a singular
//      "<place> market" scores it 0 when the text also matches facility_search. A bound market arg is geography only:
//      it adds no class score once the text matched any class (it still rescues text that matched nothing, the same
//      split the #209 rule draws for a typed iso).
//   2. facilityLeadSummary: for intent_class facility_search the fact header SUMMARY begins with the facilities fact.
//   3. honestFacilityCount: "<shown> of <total> matching rows shown (preview)" when the read was a slice of a larger
//      total; "on record" only when the rows are the whole total; places named when rows sit outside the named city.
//   4. submarketNumeralIn: a row whose city is the submarket name plus a building numeral ("Ashburn I", "Ashburn 2")
//      is inside the submarket. "Sterling" is still outside Ashburn.
//   The planner reports planner_version 5.64 only with the flag on (FACILITY_LEAD_PLANNER_VERSION); PLANNER_VERSION
//   stays 5.63 (main's, mcp#1716) so a flag-off plan is byte-identical (same convention as DCHUB_PLANNER_DCPI_CLASSIFY_FIX, mcp#1678).
//
// NOT DONE HERE. The registry row itself (city "Ashburn I") is normalised by a dry-run-first dchub-backend script;
// depth, preview limits, gating and tool lists are unchanged. Pure; nothing here throws.

export const FACILITY_LEAD_PLANNER_VERSION = '5.64';

export function facilityLeadOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_PLAN_FACILITY_LEAD_V1) || '').trim());
}

// The bare market credit market_ranking carries in server.mjs _PLAN_CLASSES: [/\bmarkets?\b/i, 1.5].
export const BARE_MARKET_CREDIT = 1.5;
const PLURAL_MARKETS_RE = /\bmarkets\b/i;
const RANKING_WORD_RE = /\b(?:rank(?:s|ing|ed)?|best|top|compare|comparing|comparison|shortlist|where\s+to\s+build|where\s+(?:should|can|do)\b)/i;

// Item 1. `scored` is _planQuery's [{cls, score, hits}] after the pattern loop and BEFORE the context boosts.
// Mutates the market_ranking entry in place; returns true when it changed a score.
export function facilityLeadRoutingAdjust(text, scored) {
  try {
    const t = String(text || '');
    if (!/\bmarket\b/i.test(t) || PLURAL_MARKETS_RE.test(t) || RANKING_WORD_RE.test(t)) return false;
    const fac = scored.find((s) => s && s.cls && s.cls.id === 'facility_search');
    const mr = scored.find((s) => s && s.cls && s.cls.id === 'market_ranking');
    if (!fac || !mr || !(fac.score > 0) || !(mr.score > 0)) return false;
    const i = mr.hits.findIndex((h) => h === 'markets?');
    if (i < 0) return false;
    mr.score = Math.max(0, mr.score - BARE_MARKET_CREDIT);
    mr.hits.splice(i, 1);
    return true;
  } catch (_e) { return false; }
}

// Item 1 (the arg half): may a bound market arg add market_ranking score? Only when no class matched the text.
export function marketArgBoostAllowed(anyTextMatch) { return !anyTextMatch; }

// Item 4. A row city that is the submarket plus a building numeral: "Ashburn I", "Ashburn III", "Ashburn 2".
const NUMERAL_RE = /^(?:[ivx]{1,5}|\d{1,3})$/i;
const _norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
export function submarketNumeralIn(rowCity, submarket) {
  const c = _norm(rowCity), w = _norm(submarket);
  if (!c || !w || !c.startsWith(w + ' ')) return false;
  return NUMERAL_RE.test(c.slice(w.length + 1));
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (n) => Number(n).toLocaleString('en-US');

// The total the backend said matched, before any submarket cut: the cut nulls the step's own total fields and keeps
// them in submarket_scope.unscoped_totals. null when no total was served.
export function totalAvailable(p) {
  if (!p || typeof p !== 'object') return null;
  const sc = p.submarket_scope && typeof p.submarket_scope === 'object' ? p.submarket_scope : null;
  const un = sc && sc.unscoped_totals && typeof sc.unscoped_totals === 'object' ? sc.unscoped_totals : {};
  for (const k of ['_data_total_available', 'total_matching', 'total', 'count_total', 'total_count']) {
    const v = num(p[k]) ?? num(un[k]);
    if (v != null) return v;
  }
  // A keyed search states its total as pagination.total, not as a top-level field (live 2026-11-25: an enterprise
  // Ashburn read carried pagination.total 229 and the lead said "the total matching was not served").
  const pg = p.pagination && typeof p.pagination === 'object' ? p.pagination : null;
  return pg ? num(pg.total) : null;
}

// Item 3. The distinct row cities (as written), in row order, up to `max`, when at least one is not the asked place;
// [] when every row sits in the place (or no row names a city). The asked place is listed too when rows sit there, so
// "Columbus and Dublin" is never said as "Dublin".
export function otherRowPlaces(rows, place, max = 3) {
  const want = _norm(place);
  const out = [];
  let other = false;
  for (const r of Array.isArray(rows) ? rows : []) {
    const c = r && typeof r === 'object' ? (r.city || (r.location && r.location.city)) : null;
    if (typeof c !== 'string' || !c.trim()) continue;
    const inPlace = _norm(c) === want || submarketNumeralIn(c, place);
    if (!inPlace) other = true;
    const label = inPlace ? String(place).trim() : c.trim();
    if (out.length < max && !out.some((x) => _norm(x) === _norm(label))) out.push(label);
  }
  return other ? out : [];
}
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// Item 3. The count clause of the facilities fact. `n` is the count kept in the place (or matched), `returned` the
// rows the step handed back before any cut, `total` the backend's total (or null), `scopeTxt` " in Ashburn" /
// ' matching "Columbus"'. Never "on record" for a slice.
export function honestCountText({ n, returned, total, scopeTxt, rows, place, scoped, query = '' }) {
  const label = n === 1 ? 'facility' : 'facilities';
  let head;
  if (scoped && returned > n && total != null && total > returned) {
    // A wider read (the metro query, or rows cut as outside the place): the total is the wider read's, never the place's.
    head = `${fmt(n)} of the ${fmt(returned)} rows shown sit${scopeTxt} (preview of ${fmt(total)} matching ${total === 1 ? 'row' : 'rows'}${query ? ` "${query}"` : ''})`;
  } else if (total != null && total > returned) {
    head = `${fmt(n)} of ${fmt(total)} matching ${total === 1 ? 'row' : 'rows'} shown (preview)${scopeTxt ? `,${scopeTxt.replace(/^ /, ' ')}` : ''}`;
  } else if (total != null && total === returned && !scoped) {
    head = `${fmt(n)} ${label}${scopeTxt} on record`;
  } else if (total != null && total === returned && scoped) {
    head = `${fmt(n)} of ${fmt(total)} matching ${total === 1 ? 'row' : 'rows'} sit${scopeTxt}`;
  } else {
    head = `${fmt(n)} ${label}${scopeTxt} in this read (the total matching was not served)`;
  }
  // P7: rows held to a free-text place that sit in other towns are said as those towns, of that place's metro.
  const others = !scoped && place ? otherRowPlaces(rows, place) : [];
  const where = others.length ? `; the rows sit in ${andList(others)}, ${place} metro` : '';
  return head + where;
}

// Item 2. The fact header SUMMARY segment for a facility_search plan: the facilities fact, cut at a word so the
// header stays under its cap. null when the plan's answer does not lead with a search_facilities fact.
export function facilityLeadSummary(plan, max = 170) {
  try {
    if (!plan || plan.intent_class !== 'facility_search') return null;
    const ia = plan.intent_answer && typeof plan.intent_answer === 'object' ? plan.intent_answer : null;
    if (!ia || ia.kind !== 'facility_search' || !Array.isArray(ia.facts) || !ia.facts.length) return null;
    const f = ia.facts[0];
    if (!f || f.tool !== 'search_facilities' || typeof f.text !== 'string' || !f.text.trim()) return null;
    const t = f.text.replace(/[\r\n|:]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[,;]$/, '')}...`;
  } catch (_e) { return null; }
}
