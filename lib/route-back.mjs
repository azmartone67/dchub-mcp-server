// route-back.mjs — execute_plan names who owns what DC Hub does not hold (owner 2026-10-28).
//
// DC Hub is a neutral orchestration layer: it works alongside data, research, media and brokerage
// providers and does not replace them. execute_plan runs DC Hub's own tools, so for an intent that
// asks for something DC Hub does not hold (verified lease comps, paid research, editorial reporting,
// brokerage, a colocation RFP) the response gains ONE small field, route_back, and one plain sentence
// on answer_guide.
//
// WHERE THE WORDS COME FROM. Organisation names, each organisation's route line and what DC Hub
// supplies are READ from the Works with registry (dchub-backend data/partners_works_with.json, served
// at /api/v1/partners/works-with.json). This file holds the question side only: which words in an
// intent signal which need. Which organisation owns which need is a `needs` tag on the registry row, so
// editing the registry changes the output and no organisation name is typed here
// (test/route-back.test.mjs scans this file for that).
//
// NO NETWORK ON THE CALL PATH. The registry is fetched in the background by a serving process (armed in
// the listen callback, like the Capacity Source summary) and read synchronously from memory. A cold or
// unreadable registry means no route_back, never a wait and never a guess.
//
// Rules the emitted strings keep (enforced here at emit time and again in the tests): no partnership,
// agreement, pilot or endorsement wording; no superlatives; no directive words; no digits, prices or
// currency; no emoji. An entry that fails any of them is dropped, so a registry edit cannot put a banned
// word in front of an agent. Kill switch: DCHUB_PLAN_ROUTE_BACK=0 removes the field and the sentence.

export const ROUTE_BACK_WHERE = 'https://dchub.cloud/partners#works-with';
export const ROUTE_BACK_MAX_ENTRIES = 3;
export const ROUTE_BACK_MAX_OWNERS = 3;
export const ROUTE_BACK_PATH = '/api/v1/partners/works-with.json';

export function routeBackEnabled(env = process.env) {
  const v = String((env && env.DCHUB_PLAN_ROUTE_BACK) ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no');
}

// ── the question side: deterministic, no LLM ───────────────────────────────
// Order is the order entries come out in (and the cap keeps the first three). Each rule is a list of
// patterns; any one match sets the need. Patterns are anchored on a verb or noun that asks for the
// thing, so "lease" or "market" alone does not trip a need.
export const NEED_RULES = Object.freeze([
  { id: 'brokerage_deal_execution', rx: [
    /\bbroker(?:s|age|ing)?\b/i,
    /\btenant[- ]rep(?:resentation|resentative|s)?\b/i,
    /\blandlord[- ]rep(?:resentation|resentative|s)?\b/i,
    /\b(?:represent(?:ation|ative|ing)?)\s+(?:me|us|the (?:tenant|landlord|buyer|seller))\b/i,
    /\bLOIs?\b/,
    /\bletters? of intent\b/i,
    /\bnegotiat(?:e|es|ed|ing|ion|ions)\b/i,
    /\bdeal execution\b/i,
    /\b(?:sign|close|execute)\s+(?:the |a |this )?(?:lease|deal)\b/i,
  ] },
  { id: 'colocation_procurement', rx: [
    /\b(?:RFPs?|RFQs?|RFIs?)\b/,
    /\brequests? for (?:proposals?|quotes?|information)\b/i,
    /\bprocure(?:ment|s|d)?\b[^.?!]{0,60}\b(?:colo(?:cation)?|data ?cent(?:er|re) space|capacity)\b/i,
    /\b(?:colo(?:cation)?|data ?cent(?:er|re) space)\b[^.?!]{0,60}\bprocure(?:ment|s|d)?\b/i,
    /\bbid(?:ding)? (?:out|process)\b/i,
  ] },
  { id: 'lease_comps_research', rx: [
    /\b(?:lease|leasing)\s+(?:comps?|comparables?|rates?|rents?|pricing|prices?)\b/i,
    /\b(?:comps?|comparables)\b/i,
    /\b(?:asking|effective|wholesale|retail)\s+(?:rents?|rates?|pricing)\b/i,
    /\b(?:colo(?:cation)?|rental)\s+(?:rents?|rates?|pricing|prices?)\b/i,
    /\bvacancy\b/i,
    /\babsorption\b/i,
    /\b(?:price|rent|\$)\s*(?:per|\/)\s*kw\b/i,
  ] },
  { id: 'research_reports', rx: [
    /\banalyst(?:s|['’]s)?\b/i,
    /\bresearch\s+(?:reports?|subscriptions?|notes?|firms?|houses?|providers?)\b/i,
    /\b(?:market|industry)\s+reports?\b/i,
    /\bsubscri(?:be|ption|ptions)\b[^.?!]{0,40}\b(?:research|reports?|analytics)\b/i,
    /\b(?:research|reports?|analytics)\b[^.?!]{0,40}\bsubscri(?:be|ption|ptions)\b/i,
  ] },
  { id: 'news_editorial', rx: [
    /\bnews\b/i,
    /\beditorial\b/i,
    /\bjournalis(?:m|ts?)\b/i,
    /\bpress coverage\b/i,
    /\btrade (?:press|media)\b/i,
    /\bheadlines?\b/i,
  ] },
]);

/** Need ids an intent asks for, in NEED_RULES order. [] for most intents. Pure. */
export function classifyNeeds(intent) {
  const text = String(intent == null ? '' : intent).slice(0, 2000);
  if (!text.trim()) return [];
  const out = [];
  for (const rule of NEED_RULES) {
    if (rule.rx.some((rx) => rx.test(text))) out.push(rule.id);
  }
  return out;
}

// ── the strings an agent sees must keep the house rules ────────────────────
const BANNED = [
  /\b(?:must|shall|always|never|required to)\b/i,                                       // directives
  /\b(?:only|first|largest|best|deepest|unique|leading|top|premier|#1)\b/i,             // superlatives
  /\b(?:partner|partners|partnered|partnership|partnerships|pilot|pilots|agreement|agreements|endorse[sd]?|endorsement|official|officially|exclusive|preferred|sponsor\w*|certified|authorized|affiliat\w*|alliance|integration)\b/i,
  /[$€£%]|\d/,                                                                          // prices and figures
  /[←-⯿☀-➿️\u{1F000}-\u{1FAFF}]/u,                             // emoji and symbols
];
export function violatesRouteBackRules(s) {
  const t = String(s == null ? '' : s);
  return BANNED.some((rx) => rx.test(t));
}

const plain = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const stripEnd = (s) => plain(s).replace(/[.;:\s]+$/, '');
const isStr = (s) => typeof s === 'string' && s.trim().length >= 3 && s.length <= 400;

/** Registry document (the keyless twin) -> {labels:Map(id->label), partners:[...]} or null. Pure. */
export function parseRegistry(doc) {
  try {
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.partners) || !Array.isArray(doc.needs)) return null;
    const labels = new Map();
    for (const n of doc.needs) {
      if (n && isStr(n.id) && isStr(n.label)) labels.set(n.id, plain(n.label));
    }
    if (!labels.size) return null;
    const partners = [];
    for (const p of doc.partners) {
      if (!p || !isStr(p.name) || !isStr(p.route_back) || !Array.isArray(p.needs)) continue;
      partners.push({
        name: plain(p.name),
        route: plain(p.route_back),
        supplies: isStr(p.dchub_supplies) ? plain(p.dchub_supplies) : null,
        needs: p.needs.filter((x) => typeof x === 'string'),
      });
    }
    return partners.length ? { labels, partners } : null;
  } catch { return null; }
}

/**
 * The route_back block for an intent: { entries, sentence, need_ids } or null.
 * entries[] = { need, owned_by[], where, note }. Pure; the registry is passed in.
 * One sentence per entry (at most three), each in the form
 *   For <need>, DC Hub does not hold that; <registry route line>[; <next route line>].
 */
export function buildRouteBack(intent, registry) {
  try {
    if (!registry || !registry.labels || !Array.isArray(registry.partners)) return null;
    const ids = classifyNeeds(intent);
    if (!ids.length) return null;
    const entries = [];
    const sentences = [];
    const used = [];
    for (const id of ids) {
      const label = registry.labels.get(id);
      if (!label) continue;
      const owners = registry.partners.filter((p) => p.needs.includes(id)).slice(0, ROUTE_BACK_MAX_OWNERS);
      if (!owners.length) continue;
      const routes = [...new Set(owners.map((o) => stripEnd(o.route)))];
      const supplies = owners.map((o) => o.supplies).find(Boolean) || null;
      const entry = {
        need: label,
        owned_by: owners.map((o) => o.name),
        where: ROUTE_BACK_WHERE,
        ...(supplies ? { note: stripEnd(supplies) + '.' } : {}),
      };
      const sentence = `For ${label}, DC Hub does not hold that; ${routes.join('; ')}.`;
      // `where` is the fixed constant above (its path names the page); everything else came from the registry.
      const { where: _w, ...fromRegistry } = entry;
      if (violatesRouteBackRules(JSON.stringify(fromRegistry)) || violatesRouteBackRules(sentence)) continue;
      entries.push(entry);
      sentences.push(sentence);
      used.push(id);
      if (entries.length >= ROUTE_BACK_MAX_ENTRIES) break;
    }
    if (!entries.length) return null;
    return { entries, sentence: sentences.join(' '), need_ids: used };
  } catch { return null; }
}

// ── the registry cache: filled in the background, read from memory ─────────
export const ROUTE_BACK_TTL_MS = 15 * 60 * 1000;
export const ROUTE_BACK_RETRY_MS = 60 * 1000;
export const ROUTE_BACK_MAX_STALE_MS = 24 * 60 * 60 * 1000;
export const ROUTE_BACK_TIMEOUT_MS = 8000;

/**
 * fetchTwin() resolves to the twin's parsed JSON body (or {http_status, body}); it is called only by
 * refresh(), never by get(). A serving process calls arm(); an unarmed cache never fetches, so every
 * test that imports the server stays off the network.
 */
export function createRouteBackRegistry({
  fetchTwin, now = () => Date.now(), ttlMs = ROUTE_BACK_TTL_MS, retryMs = ROUTE_BACK_RETRY_MS,
  maxStaleMs = ROUTE_BACK_MAX_STALE_MS, timeoutMs = ROUTE_BACK_TIMEOUT_MS,
  enabled = () => routeBackEnabled(),
} = {}) {
  let value = null;
  let okAt = 0;
  let triedAt = 0;
  let inflight = null;
  let armed = false;
  let fetches = 0;

  function refresh() {
    try { if (!enabled() || typeof fetchTwin !== 'function') return Promise.resolve(null); } catch { return Promise.resolve(null); }
    if (inflight) return inflight;
    fetches += 1;
    triedAt = now();
    let timer = null;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    let call;
    try { call = Promise.resolve(fetchTwin()); } catch (e) { call = Promise.reject(e); }
    const p = Promise.race([call.then((response) => ({ response }), (error) => ({ error })), timedOut])
      .then((o) => {
        clearTimeout(timer);
        if (inflight !== p) return value;
        const r = o && o.response;
        const doc = r && typeof r === 'object' && 'http_status' in r ? (r.http_status === 200 ? r.body : null) : r;
        const reg = parseRegistry(doc);
        if (reg) { value = reg; okAt = now(); }       // a failed refresh keeps the last good copy until maxStaleMs
        return value;
      })
      .catch(() => { clearTimeout(timer); return value; })
      .finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  }

  /** Synchronous, never waits. The cached registry or null; kicks a background refresh when due. */
  function get() {
    try { if (!enabled()) return null; } catch { return null; }
    const t = now();
    if (armed && !inflight && (!value ? t - triedAt >= retryMs || triedAt === 0 : t - okAt >= ttlMs && t - triedAt >= retryMs)) {
      refresh();
    }
    if (value && t - okAt > maxStaleMs) return null;
    return value;
  }

  return {
    get, refresh,
    arm() { armed = true; },
    /** Test and warm-up hook: install a registry document directly. */
    load(doc) { const reg = parseRegistry(doc); if (reg) { value = reg; okAt = now(); } return !!reg; },
    reset() { value = null; okAt = 0; triedAt = 0; inflight = null; armed = false; fetches = 0; },
    stats() { return { armed, fetches, has_value: !!value, age_ms: value ? now() - okAt : null }; },
  };
}
