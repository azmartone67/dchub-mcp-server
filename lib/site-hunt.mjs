// site-hunt.mjs -- planner 5.61: "find a Miami site for a 50 MW data center ... check zoning, moratorium" is a site search.
//
// WHY. Owner head-to-head against a parcel agent (2026-11-22): the brief "find a Miami site for a 50 MW data center: no
// flood-prone land, within 2 miles of a 115 kV line, fiber nearby; check power, zoning, moratorium, flood, environmental"
// routed to the permitting class. permittingAsk() reads "moratorium" as a strong ask and the permitting tie-break wins
// over every class but a short held list, so the plan ran three get_permitting_intel reads for FL and a disaster-risk
// step that never resolved a point: no search areas, no power, no market verdict. Without the word "moratorium" the same
// brief went to capacity_search with find_sites waiting on a "<site lat>" no step mints. Both are the wrong answer to
// "find me a site".
//
// WHAT. siteHuntAsk(text, d): true when the question asks to FIND a site (a finding verb before site / location /
// parcel / land, or "where should I build"), states a size, names exactly one place (one named market, or a market or
// state pinned in context), and gives no point or street address (those are site screens). The planner then:
//   * does not let a moratorium / zoning word take the plan (permitting keeps its own questions: "which counties have
//     moratoriums", "is there a moratorium in Miami-Dade" name no site to find);
//   * routes the plan to siting_search, anchored on the named metro (find_sites market=<slug>);
//   * appends the permitting read the question asked for (get_permitting_intel class=moratorium, held to the state).
// Pure; nothing here throws.

const FIND = String.raw`(?:find|finding|locate|locating|identify|scout|scouting|search\s+for|look(?:ing)?\s+for|hunt(?:ing)?\s+for|`
  + String.raw`pick|choose|select|shortlist|recommend|suggest|source|sourcing)`;
const TARGET = String.raw`(?:sites?|locations?|parcels?|land|acreage|places?\s+to\s+build)`;
// The finding verb and its target in one clause (no sentence or list break between them), at most 40 characters apart:
// "find a Miami site", "identify candidate sites", "looking for land".
const HUNT_RE = new RegExp(String.raw`\b${FIND}\b[^.?!;:]{0,40}?\b${TARGET}\b`, 'i');
const WHERE_RE = /\bwhere\s+(?:should|could|can|would|do)\s+(?:i|we|you|they)\s+(?:build|put|site|locate|place)\b/i;
const SITE_SEL_RE = /\bsite\s+(?:selection|search|hunt|scouting)\s+for\b/i;

export function siteHuntWording(text) {
  try {
    const t = String(text || '').slice(0, 2000);
    return HUNT_RE.test(t) || WHERE_RE.test(t) || SITE_SEL_RE.test(t);
  } catch (_e) { return false; }
}

/** The one place a site hunt is held to: { slug } for a named market, { state } for a state, else null. */
export function siteHuntPlace(d) {
  try {
    if (!d || typeof d !== 'object') return null;
    const named = [...new Set((Array.isArray(d.__namedMarkets) ? d.__namedMarkets : []).filter((x) => typeof x === 'string' && x))];
    const states = Array.isArray(d.states) ? d.states : [];
    if (typeof d.market === 'string' && d.market && named.length <= 1) return { slug: d.market };
    if (named.length === 1 && states.length <= 1) return { slug: named[0] };
    if (named.length === 0 && states.length === 1) return { state: states[0] };
    // 5.62: a corridor-table place ("Loudoun County") is one place with a point; the land step searches around it.
    if (named.length === 0 && states.length === 0 && d.placeScope && d.placeScope.basis === 'corridor_table' && d.coords) {
      return { corridor: Array.isArray(d.placeScope.places) ? d.placeScope.places[0] || null : null };
    }
    return null;
  } catch (_e) { return null; }
}

export function siteHuntAsk(text, d) {
  try {
    if (!d || typeof d !== 'object') return false;
    if (!(typeof d.mw === 'number' && d.mw > 0)) return false;
    // 5.62: a corridor-table centroid is the named place, not a user point (it binds arguments only).
    const userPt = !!d.coords && !(d.placeScope && d.placeScope.basis === 'corridor_table');
    if (userPt || d.__address || d.candidateId || d.comparePair) return false;
    if (Array.isArray(d.isos) && d.isos.length >= 2) return false;
    if (!siteHuntPlace(d)) return false;
    return siteHuntWording(text);
  } catch (_e) { return false; }
}
