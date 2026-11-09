// handoff.mjs — execute_plan's complement: who covers what DC Hub's answer did not (owner 2026-11-09).
//
// DC Hub is an additive orchestration layer that works alongside the data, research, media and brokerage
// sources in the Works with registry; it does not replace or rank them. route_back (lib/route-back.mjs)
// fires when the QUESTION asks for something DC Hub does not hold. This file covers the other half: after a
// plan DC Hub ANSWERED, one field says what that answer does not cover and who does (design
// dchub-planner-handoff-design-2026-11-09.md, section 2B):
//
//   market_ranking / market_outlook / market_comparison, at least one step answered
//       -> lease_comps_research, news_editorial
//   capacity_search where source_capacity ran and found no fit (sourceCapacityNoFit)
//       -> colocation_procurement, brokerage_deal_execution
//   capacity_search with matches, and every other class -> nothing
//
// WHERE THE WORDS COME FROM. The need labels, the organisation names and their links are READ from the
// Works with registry (the same in-memory copy route_back reads, parsed by parseRegistry). Which
// organisation covers a need is the registry row's `needs` tag; no organisation name is typed here
// (test/planner-handoff.test.mjs scans this file for that). Owners are listed alphabetically.
//
// RULES. At most one `handoff` field and one answer_guide sentence per plan. A need route_back already
// named is never repeated. Nothing when the response carries a human_url, a for_your_human relay or a
// wall (one answer does not stack pointers): predicted in the handler from the steps, and enforced again
// on the final result by stripHandoffIfPointered. The same banned-wording check as route_back
// (violatesRouteBackRules) runs on every emitted string but the link URLs. No network on the call path.
//
// SURFACES. /mcp and /mcp/oauth only (the answer-block gate, like route_back). Off on the directory
// profiles and ChatGPT clients (owner D3). Off on /mcp/core unless DCHUB_CORE_HANDOFF=1: its tools/list
// and output are the catalog under the M365 Copilot review, the same reason the re-run is held there.
// Kill switch: DCHUB_PLAN_HANDOFF=0 removes the field, the sentence and the log markers everywhere.

import { violatesRouteBackRules, ownersFor } from './route-back.mjs';
import { sourceCapacityNoFit } from './coverage-gap.mjs';

export const HANDOFF_KIND = 'complement';
export const HANDOFF_MAX_PLACES = 3;

export function handoffEnabled(env = process.env) {
  const v = String((env && env.DCHUB_PLAN_HANDOFF) ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no');
}
/** /mcp/core: default OFF (the M365 Copilot catalog must not drift); 1/on/true/yes turns it on. */
export function coreHandoffOn(env = process.env) {
  return /^(1|on|true|yes)$/i.test(String((env && env.DCHUB_CORE_HANDOFF) || '').trim());
}

const MARKET_CLASSES = new Set(['market_ranking', 'market_outlook', 'market_comparison']);
// basis -> the needs it complements (order = order in the field) and what DC Hub's own answer was.
export const HANDOFF_BASES = Object.freeze({
  market_answer: Object.freeze({
    needs: Object.freeze(['lease_comps_research', 'news_editorial']),
    lead: 'DC Hub covers power, grid and DCPI here',
  }),
  capacity_no_fit: Object.freeze({
    needs: Object.freeze(['colocation_procurement', 'brokerage_deal_execution']),
    lead: 'DC Hub found no matching capacity listing here',
  }),
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fullOfFn = (fullOf) => (typeof fullOf === 'function' ? fullOf
  : (fullOf && typeof fullOf.get === 'function' ? (e) => fullOf.get(e) : () => undefined));

/** Which complement a finished plan earns: 'market_answer' | 'capacity_no_fit' | null. Pure. */
export function handoffBasis(intentClass, executed, fullOf) {
  try {
    if (!Array.isArray(executed)) return null;
    const full = fullOfFn(fullOf);
    if (MARKET_CLASSES.has(intentClass)) {
      // DC Hub answered: at least one data step ran in full.
      return executed.some((e) => isObj(e) && e.status === 'executed'
        && e.tool !== 'plan_query' && e.tool !== 'execute_plan') ? 'market_answer' : null;
    }
    if (intentClass === 'capacity_search') {
      const sc = executed.filter((e) => isObj(e) && e.tool === 'source_capacity' && e.status === 'executed');
      if (!sc.length) return null;
      // Any listing found anywhere in the plan means DC Hub answered it: no complement.
      return sc.every((e) => sourceCapacityNoFit(full(e) || e.result)) ? 'capacity_no_fit' : null;
    }
  } catch { /* never break a plan */ }
  return null;
}

// ── wall / pointer detection ───────────────────────────────────────────────
function carriesPointer(o) {
  if (!isObj(o)) return false;
  if (typeof o.human_url === 'string' && o.human_url) return true;
  return !!o.for_your_human;
}

/**
 * In-handler prediction: a step that came back gated, or whose result carries a human pointer or reads as
 * a wall (isWall is server.mjs _isRelayWall), means the final response will carry the wall line. Pure.
 */
export function planLooksWalled(executed, { isWall, fullOf } = {}) {
  try {
    if (!Array.isArray(executed)) return false;
    const full = fullOfFn(fullOf);
    return executed.some((e) => {
      if (!isObj(e)) return false;
      if (e.status === 'gated_preview') return true;
      for (const r of [e.result, full(e)]) {
        if (!isObj(r)) continue;
        if (carriesPointer(r)) return true;
        if (typeof isWall === 'function') { try { if (isWall(r)) return true; } catch { /* unreadable: not a wall */ } }
      }
      return false;
    });
  } catch { return false; }
}

// ── the place the plan bound ───────────────────────────────────────────────
const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
/** 'dallas-tx' -> 'Dallas', 'northern-virginia' -> 'Northern Virginia', 'Dallas' -> 'Dallas'; else null. */
export function placeName(v) {
  if (typeof v !== 'string') return null;
  let t = v.trim();
  if (!t || t.length > 60) return null;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(t)) {
    t = t.toLowerCase().replace(/-[a-z]{2}$/, '').replace(/-/g, ' ');
    t = titleCase(t);
  } else if (/^[a-z][a-z .'-]*$/.test(t)) {
    t = titleCase(t);
  }
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(t)) return null;   // letters only: no digits, coordinates or markup
  return t.replace(/\s+/g, ' ');
}

/**
 * The markets the plan named, as display names: the caller's own market hint first; else every city in
 * the planner's city table the intent names (cityHit is server.mjs _execCityHit). Pure.
 */
export function boundPlaces({ intent, market, cityTable, cityHit } = {}) {
  try {
    if (market) { const n = placeName(String(market)); return n ? [n] : []; }
    if (!isObj(cityTable) || typeof cityHit !== 'function') return [];
    const t = String(intent || '').toLowerCase().slice(0, 2000);
    const out = [], seen = new Set();
    for (const [key, meta] of Object.entries(cityTable)) {
      if (!meta || !meta.slug || seen.has(meta.slug) || !cityHit(key, meta, t)) continue;
      seen.add(meta.slug);
      const n = placeName(meta.slug);
      if (n && !out.includes(n)) out.push(n);
    }
    return out;
  } catch { return []; }
}
const joinNames = (xs) => (xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ── the field and its sentence ─────────────────────────────────────────────
/** The one answer_guide sentence, rendered from the field alone (so it can be found again). Pure. */
export function renderHandoffSentence(field) {
  try {
    if (!isObj(field) || !HANDOFF_BASES[field.basis] || !Array.isArray(field.needs) || !field.needs.length) return '';
    const where = typeof field.for === 'string' && field.for ? ` in ${field.for}` : '';
    const parts = field.needs.map((n, i) => `for ${n.need}${i === 0 ? where : ''}, ${joinNames(n.owned_by.map((o) => o.name))}`);
    return `${HANDOFF_BASES[field.basis].lead}; ${parts.join('; ')}.`;
  } catch { return ''; }
}

/**
 * The complement for a finished plan: { field, sentence, basis, need_ids } or null. Pure.
 *   registry       parseRegistry output (the in-memory Works with copy)
 *   routeBackIds   need ids route_back already named for this plan (never repeated)
 *   places         display names of the market(s) the plan bound (boundPlaces)
 *   walled         planLooksWalled(...) for this plan
 */
export function buildHandoff({ intentClass, executed, fullOf, registry, routeBackIds = [], places = [], walled = false } = {}) {
  try {
    if (walled || !registry || !(registry.labels instanceof Map) || !Array.isArray(registry.partners)) return null;
    const basis = handoffBasis(intentClass, executed, fullOf);
    if (!basis) return null;
    const skip = new Set(Array.isArray(routeBackIds) ? routeBackIds : []);
    const needs = [], ids = [];
    for (const id of HANDOFF_BASES[basis].needs) {
      if (skip.has(id)) continue;
      const label = registry.labels.get(id);
      const owners = ownersFor(registry, id);
      if (!label || !owners.length) continue;
      const item = { need: label, owned_by: owners.map((o) => (o.link ? { name: o.name, url: o.link } : { name: o.name })) };
      // Every word that came from the registry keeps the house rules; a link URL is not prose.
      if (violatesRouteBackRules(label) || owners.some((o) => violatesRouteBackRules(o.name))) continue;
      needs.push(item); ids.push(id);
    }
    if (!needs.length) return null;
    const ps = Array.isArray(places) ? places.filter((p) => typeof p === 'string' && p && !violatesRouteBackRules(p)) : [];
    const place = ps.length && ps.length <= HANDOFF_MAX_PLACES ? joinNames(ps) : null;
    const field = { kind: HANDOFF_KIND, basis, ...(place ? { for: place } : {}), needs };
    const sentence = renderHandoffSentence(field);
    if (!sentence || violatesRouteBackRules(sentence)) return null;
    return { field, sentence, basis, need_ids: ids };
  } catch { return null; }
}

// ── the final word: no complement beside a pointer ─────────────────────────
const jsonInner = (s) => JSON.stringify(s).slice(1, -1);
/**
 * Runs on the FINAL tool result (after every wall / relay step): when structuredContent carries a
 * handoff AND a human_url, a for_your_human relay or a wall (isWall), the field and its sentence leave
 * structuredContent and every text block. Returns the same result object otherwise. Never throws.
 */
export function stripHandoffIfPointered(result, { isWall } = {}) {
  try {
    const sc = result && result.structuredContent;
    if (!isObj(sc) || !isObj(sc.handoff)) return result;
    let walled = carriesPointer(sc);
    if (!walled && typeof isWall === 'function') { try { walled = !!isWall(sc); } catch { walled = false; } }
    if (!walled) return result;
    const h = sc.handoff;
    const sentence = renderHandoffSentence(h);
    const fieldJson = JSON.stringify(h);
    const nsc = { ...sc };
    delete nsc.handoff;
    if (sentence && typeof nsc.answer_guide === 'string') {
      nsc.answer_guide = nsc.answer_guide.split(' ' + sentence).join('').split(sentence).join('').replace(/\s+$/, '');
    }
    const content = Array.isArray(result.content) ? result.content.map((b) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string' || !b.text.includes('"handoff"')) return b;
      let t = b.text.split(',"handoff":' + fieldJson).join('').split('"handoff":' + fieldJson + ',').join('');
      if (sentence) t = t.split(' ' + jsonInner(sentence)).join('').split(jsonInner(sentence)).join('');
      if (/"handoff"\s*:\s*\{/.test(t)) {
        // Not the byte-exact serialisation: fall back to a parse of a pure-JSON block.
        try { const o = JSON.parse(t); if (isObj(o)) { delete o.handoff; if (typeof o.answer_guide === 'string') o.answer_guide = nsc.answer_guide; t = JSON.stringify(o); } } catch { /* leave as is */ }
      }
      return { ...b, text: t };
    }) : result.content;
    return { ...result, content, structuredContent: nsc };
  } catch { return result; }
}
