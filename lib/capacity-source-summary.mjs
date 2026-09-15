// =============================================================================
// Capacity Source distribution layer: DORMANT UNTIL LISTINGS EXIST.
// -----------------------------------------------------------------------------
// Production launched Capacity Source with an empty inventory. Everything that
// ADVERTISES the inventory (the pointer on siting/market tool results, the live
// clause in the session instructions, the registry paste line) reads ONE
// public aggregate, GET /api/v1/listings/summary, and says nothing at all until
// that aggregate reports live listings:
//
//   {ok:true, program_status, live_count, total_mw, latest_updated_at,
//    generated_at, markets:[{market, state, country, count, mw,
//    delivery_types[]}], delivery_types:{...}}
//
// THREE STATES, and only one of them speaks:
//   live     a 200 whose body validates and whose live_count > 0
//   dormant  a 200 whose live_count is 0
//   unknown  anything else: 404 (the route is not deployed yet), any other
//            status, a transport error, the 2 s timeout, a body that does not
//            validate, or a cached read older than the stale bound.
// A failed refresh REPLACES a good value with unknown. Listings that were
// pulled, or a backend in trouble, must silence the pointers, not freeze them.
//
// NEVER ON THE REQUEST PATH. peek() is synchronous: it returns what is cached
// and, when the cache is empty or past its TTL, starts ONE background refresh
// (single-flight) that nothing awaits. A tool result therefore never waits on
// this module, however slow the summary is.
//
// Kill switch: DCHUB_CAPACITY_POINTERS=off (also 0/false/no/disabled) turns
// every consumer off and stops the fetches.
// =============================================================================

export const CAPACITY_SUMMARY_PATH = '/api/v1/listings/summary';
export const CAPACITY_SUMMARY_TTL_MS = 5 * 60 * 1000;
// Stale-while-revalidate serves a past-TTL value while the refresh runs, but
// not forever: an idle replica must not wake up and advertise an inventory it
// last saw an hour ago.
export const CAPACITY_SUMMARY_MAX_STALE_MS = 60 * 60 * 1000;
export const CAPACITY_SUMMARY_TIMEOUT_MS = 2000;

export const CAPACITY_POINTER_KEY = 'capacity_source';
export const CAPACITY_POINTER_META_KEY = 'cloud.dchub/capacity_source';
export const CAPACITY_POINTER_NOTE =
  'Each listing is reached through a DC Hub deal registration: the provider sees only your human\'s company name and requirement, and contact details are exchanged only if the provider accepts.';
// The end of the first sentence of the "CAPACITY SOURCE:" paragraph in
// server.mjs _INSTR_TAIL. The live clause is spliced in front of its period.
// A test pins that it occurs exactly once; with zero or two occurrences the
// instructions are returned unchanged rather than edited in the wrong place.
export const CAPACITY_INSTR_ANCHOR = 'each listing stamped with when it was last updated.';

const POINTER_MARKETS_CAP = 5;
const CLAUSE_TOP_MARKETS = 3;
const OFF = new Set(['off', '0', 'false', 'no', 'disable', 'disabled']);

export function capacityPointersEnabled(env = process.env) {
  try {
    const v = String((env && env.DCHUB_CAPACITY_POINTERS) ?? '').trim().toLowerCase();
    return !OFF.has(v);
  } catch {
    return false;   // an unreadable switch fails toward silence
  }
}

const _str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const _nonNeg = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const _round1 = (v) => Math.round(v * 10) / 10;

/** The summary body, validated, or null. Never throws. */
export function normalizeCapacitySummary(body) {
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    if (body.ok !== true) return null;
    if (!Number.isInteger(body.live_count) || body.live_count < 0) return null;
    const markets = [];
    for (const m of Array.isArray(body.markets) ? body.markets : []) {
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
      const market = _str(m.market);
      if (!market || !Number.isInteger(m.count) || m.count < 0) continue;
      markets.push(Object.freeze({
        market,
        state: _str(m.state),
        country: _str(m.country),
        count: m.count,
        mw: _nonNeg(m.mw),
        delivery_types: Object.freeze((Array.isArray(m.delivery_types) ? m.delivery_types : [])
          .filter((t) => typeof t === 'string' && t).slice(0, 8)),
      }));
    }
    let total = _nonNeg(body.total_mw);
    if (total === null) {
      const mws = markets.map((m) => m.mw).filter((v) => v !== null);
      total = mws.length ? _round1(mws.reduce((a, b) => a + b, 0)) : null;
    }
    const updated = _str(body.latest_updated_at);
    return Object.freeze({
      live_count: body.live_count,
      total_mw: total,
      latest_updated_at: updated && Number.isFinite(Date.parse(updated)) ? updated : null,
      generated_at: _str(body.generated_at),
      program_status: _str(body.program_status),
      markets: Object.freeze(markets),
    });
  } catch {
    return null;
  }
}

/** The ONE predicate every consumer speaks on. */
export function isCapacityLive(summary) {
  return !!summary && Number.isInteger(summary.live_count) && summary.live_count > 0;
}

/** A {status, text} HTTP read (ecosystem-sync's fetchText shape) -> summary or null. */
export function capacitySummaryFromHttp(res) {
  try {
    if (!res || res.status !== 200) return null;
    return normalizeCapacitySummary(JSON.parse(String(res.text || '')));
  } catch {
    return null;
  }
}

/**
 * In-memory summary cache: 5 min TTL, stale-while-revalidate, 2 s timeout,
 * single-flight. `fetchSummary` resolves an HTTP envelope
 * {http_status, body} (server.mjs callAPI with {withStatus:true}).
 *
 * `armed` gates the background fetches: the running server arms it when it
 * starts serving, so importing server.mjs (every test file does) never
 * reaches the network on its own.
 */
export function createCapacitySummaryCache({
  fetchSummary,
  now = () => Date.now(),
  ttlMs = CAPACITY_SUMMARY_TTL_MS,
  maxStaleMs = CAPACITY_SUMMARY_MAX_STALE_MS,
  timeoutMs = CAPACITY_SUMMARY_TIMEOUT_MS,
  enabled = () => capacityPointersEnabled(),
} = {}) {
  let value = null;
  let status = 'empty';
  let at = 0;
  let inflight = null;
  let armed = false;
  let fetches = 0;

  const settle = (outcome) => {
    at = now();
    const r = outcome && outcome.response;
    const norm = r && r.http_status === 200 ? normalizeCapacitySummary(r.body) : null;
    value = norm;
    status = norm ? 'ok' : 'unknown';
  };

  function refresh() {
    try {
      if (!enabled() || typeof fetchSummary !== 'function') return Promise.resolve(null);
    } catch {
      return Promise.resolve(null);
    }
    if (inflight) return inflight;
    fetches += 1;
    let timer = null;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    let call;
    try { call = Promise.resolve(fetchSummary()); } catch (e) { call = Promise.reject(e); }
    const p = Promise.race([call.then((response) => ({ response }), (error) => ({ error })), timedOut])
      // `inflight === p` doubles as the generation check: after reset() (or a
      // newer read) a late answer from this one cannot overwrite the cache.
      .then((outcome) => { clearTimeout(timer); if (inflight === p) settle(outcome); return value; })
      .catch(() => { clearTimeout(timer); if (inflight === p) settle(null); return null; })
      .finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  }

  /** Synchronous. Returns the cached summary (or null) and never waits. */
  function peek() {
    try {
      if (!enabled()) return null;
    } catch {
      return null;
    }
    if (status === 'empty') {
      if (armed) refresh();
      return null;
    }
    const age = now() - at;
    if (age >= ttlMs && armed) refresh();
    if (age > maxStaleMs) return null;
    return value;
  }

  return {
    peek,
    refresh,
    arm() { armed = true; },
    disarm() { armed = false; },
    seed(body, atMs) {
      const norm = normalizeCapacitySummary(body);
      value = norm;
      status = norm ? 'ok' : 'unknown';
      at = Number.isFinite(atMs) ? atMs : now();
    },
    reset() { value = null; status = 'empty'; at = 0; inflight = null; armed = false; fetches = 0; },
    state() {
      return { status, at, armed, inflight: !!inflight, fetches,
        live_count: value ? value.live_count : null };
    },
  };
}

// ── matching ────────────────────────────────────────────────────────────────

export function capacitySlug(v) {
  return String(v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Deliberately exact. The backend's own market filter is
// LOWER(market) = LOWER(%s), and a pointer that names the wrong metro is worse
// than no pointer. Accepted spellings of a listing market "Dallas" in "TX":
// "Dallas", "dallas", "dallas-tx", "Dallas, TX". Not "dallas-fort-worth".
function _marketIdMatches(id, m) {
  const s = capacitySlug(id);
  const base = capacitySlug(m.market);
  if (!s || !base) return false;
  if (s === base) return true;
  const st = m.state ? capacitySlug(m.state) : '';
  return !!st && s === `${base}-${st}`;
}

/**
 * The summary markets a call is about.
 *   states      2-letter codes from the call's arguments
 *   markets     market names or slugs from the call's arguments
 *   marketRows  [{ids:[...], state}] from a result's own market rows
 *               (rank_markets), where a row state that disagrees rejects it
 * Markets whose count is 0 never match.
 */
export function matchCapacityMarkets(summary, { states = [], markets = [], marketRows = [] } = {}) {
  if (!summary || !Array.isArray(summary.markets)) return [];
  const st = new Set((states || []).filter(Boolean).map((x) => String(x).toUpperCase()));
  const out = [];
  for (const m of summary.markets) {
    if (!(m.count > 0)) continue;
    const mState = m.state ? String(m.state).toUpperCase() : null;
    const hit = (!!mState && st.has(mState))
      || (markets || []).some((id) => _marketIdMatches(id, m))
      || (marketRows || []).some((row) => {
        const rs = row && row.state ? String(row.state).toUpperCase() : null;
        if (rs && mState && rs !== mState) return false;
        return Array.isArray(row && row.ids) && row.ids.some((id) => _marketIdMatches(id, m));
      });
    if (hit) out.push(m);
  }
  return out;
}

const _byWeight = (a, b) => ((b.mw ?? -1) - (a.mw ?? -1)) || (b.count - a.count)
  || a.market.localeCompare(b.market);

/** The capacity_source block for a set of matched markets, or null. */
export function buildCapacityPointer(matches, { minMw = null } = {}) {
  if (!Array.isArray(matches) || !matches.length) return null;
  const live = matches.reduce((n, m) => n + (Number.isInteger(m.count) ? m.count : 0), 0);
  if (!(live > 0)) return null;
  const mws = matches.map((m) => m.mw).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const args = {};
  if (matches.length === 1) {
    args.market = matches[0].market;
    if (matches[0].state) args.state = matches[0].state;
  } else {
    const states = new Set(matches.map((m) => (m.state ? String(m.state).toUpperCase() : null)));
    if (states.size === 1 && !states.has(null)) args.state = [...states][0];
  }
  if (typeof minMw === 'number' && Number.isFinite(minMw) && minMw > 0) args.min_mw = minMw;
  return {
    live_listings: live,
    mw: mws.length ? _round1(mws.reduce((a, b) => a + b, 0)) : null,
    markets: [...matches].sort(_byWeight).slice(0, POINTER_MARKETS_CAP).map((m) => ({
      market: m.market, state: m.state, country: m.country, count: m.count, mw: m.mw,
      delivery_types: [...m.delivery_types],
    })),
    next_step: { tool: 'source_capacity', args },
    note: CAPACITY_POINTER_NOTE,
  };
}

// ── prose ───────────────────────────────────────────────────────────────────

export function formatMw(v) {
  const r = _round1(v);
  const [i, f] = String(r).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
}
const _plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function _joinNames(names, extra) {
  if (extra > 0) return `${names.join(', ')} and ${_plural(extra, 'more market')}`;
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The one text line that rides beside a capacity_source block. */
export function capacityPointerLine(block) {
  const labels = block.markets.map((m) => (m.state ? `${m.market} (${m.state})` : m.market));
  const args = Object.entries(block.next_step.args)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? v : JSON.stringify(v)}`).join(' ');
  return `Capacity Source: ${_plural(block.live_listings, 'live listing')}`
    + (block.mw ? `, ${formatMw(block.mw)} MW,` : '')
    + ` in ${_joinNames(labels, 0)} match this request. `
    + `Next: \`source_capacity${args ? ` ${args}` : ''}\`. ${block.note}`;
}

/** "N live listings, X MW across A, B and C, updated YYYY-MM-DD", or null. */
export function capacityLiveClause(summary) {
  if (!isCapacityLive(summary)) return null;
  let s = _plural(summary.live_count, 'live listing');
  if (typeof summary.total_mw === 'number' && summary.total_mw > 0) s += `, ${formatMw(summary.total_mw)} MW`;
  const names = [];
  for (const m of [...summary.markets].filter((x) => x.count > 0).sort(_byWeight)) {
    if (!names.includes(m.market)) names.push(m.market);
  }
  if (names.length) {
    s += ` across ${_joinNames(names.slice(0, CLAUSE_TOP_MARKETS), names.length - CLAUSE_TOP_MARKETS)}`;
  }
  const t = Date.parse(summary.latest_updated_at || '');
  if (Number.isFinite(t)) s += `, updated ${new Date(t).toISOString().slice(0, 10)}`;
  return s;
}

/** Instructions with the live clause spliced into the CAPACITY SOURCE sentence. */
export function withCapacityLiveClause(instructions, summary) {
  if (typeof instructions !== 'string') return instructions;
  const clause = capacityLiveClause(summary);
  if (!clause) return instructions;
  const i = instructions.indexOf(CAPACITY_INSTR_ANCHOR);
  if (i < 0 || instructions.indexOf(CAPACITY_INSTR_ANCHOR, i + 1) >= 0) return instructions;
  return instructions.slice(0, i)
    + `${CAPACITY_INSTR_ANCHOR.slice(0, -1)} (live now: ${clause}).`
    + instructions.slice(i + CAPACITY_INSTR_ANCHOR.length);
}

/** "Capacity Source: <clause>." for the registry paste line, or null. */
export function capacityPasteClause(summary) {
  const c = capacityLiveClause(summary);
  return c ? `Capacity Source: ${c}.` : null;
}

// ── planner ─────────────────────────────────────────────────────────────────
// A BUY / LEASE intent for data-center capacity. Deterministic, and narrow on
// purpose: grid "available capacity", energy procurement ("buy 100 MW of
// power", PPAs), M&A ("who is buying data centers") and market statistics
// ("lease rates", "leasing activity") are other questions with other tools.
const _OBJ = String.raw`(?:capacity|space|shells?|colo(?:cation)?|data[\s-]*cent(?:er|re)s?|facilit(?:y|ies)|campus(?:es)?|halls?|suites?|cages?)`;
const _PROCURE_STRONG = new RegExp(String.raw`\b(?:powered\s+(?:shells?|land|buildings?)`
  + String.raw`|turnkey\s+(?:capacity|space|data[\s-]*cent(?:er|re)s?|colo(?:cation)?|facilit(?:y|ies)|halls?|suites?)`
  + String.raw`|colo(?:cation)?\s+(?:space|capacity|suites?|cages?)`
  + String.raw`|data[\s-]*halls?|white[\s-]*space|pocket\s+listings?|capacity\s+source|capacity\s+procurement`
  + String.raw`|(?:available|off[\s-]*market)\s+(?:data[\s-]*cent(?:er|re)|colo(?:cation)?)\s+(?:capacity|space))\b`, 'i');
const _PROCURE_VERB_OBJ = new RegExp(String.raw`\b(?:lease|sublease|rent|buy|purchase|procure)\b[^.?!]{0,60}\b${_OBJ}\b`, 'i');
const _PROCURE_OBJ_VERB = new RegExp(String.raw`\b${_OBJ}\b[^.?!]{0,40}\b(?:to\s+(?:lease|sublease|rent|buy|purchase|procure)|for\s+(?:lease|rent|sale))\b`, 'i');
const _PROCURE_LEASE_MW = /\b(?:lease|sublease|rent)\b[^.?!]{0,30}\b\d+(?:\.\d+)?\s*(?:mw|megawatts?)\b/i;
const _PROCURE_NOT = new RegExp(String.raw`\b(?:m&a|acquisitions?|acquirers?|deal\s*flow|transactions?`
  + String.raw`|who\s+(?:is|are|'s)\s+(?:buying|leasing|renting|acquiring)`
  + String.raw`|lease\s+(?:rates?|pricing|prices?|comps?|expirations?|renewals?)|leasing\s+(?:activity|trends?|volume|velocity)`
  + String.raw`|ppas?|power\s+purchase)\b`, 'i');

export function capacityProcurementIntent(text) {
  const t = String(text || '');
  if (!t || _PROCURE_NOT.test(t)) return false;
  return _PROCURE_STRONG.test(t) || _PROCURE_VERB_OBJ.test(t)
    || _PROCURE_OBJ_VERB.test(t) || _PROCURE_LEASE_MW.test(t);
}
