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
// ★2026-09-16: THE METRO-ALIAS MISS. Equality-only matching meant a call
// about "dallas" carried NO capacity pointer while two live listings sat in
// "Dallas-Fort Worth" — measured against the live summary that day, and the
// short name is the one everything else uses: execute_plan's own verdict line
// says "dallas: CAUTION", and the DCPI market slug is `dallas`. The pointer was
// silent exactly where a buyer was standing.
//
// So a LEADING token-group also matches, in both directions: "dallas" matches
// "dallas-fort-worth", and "dallas-fort-worth-metro" matches "dallas-fort-worth".
// Leading only, so "worth" and "fort" (mid-name tokens) still do NOT match a
// Dallas-Fort Worth listing, and the boundary is a whole "-" token, so "dal"
// never matches "dallas" and "san" never matches "san-jose".
const _MIN_ALIAS_TOKEN = 4;
function _tokenPrefix(shortSlug, longSlug) {
  if (!shortSlug || !longSlug) return false;
  if (shortSlug.length < _MIN_ALIAS_TOKEN) return false;
  if (shortSlug.length >= longSlug.length) return false;
  if (!longSlug.startsWith(`${shortSlug}-`)) return false;
  // ★ A TWO-LETTER TAIL IS A STATE, NOT A METRO. "dallas-az" must not match a
  // Dallas TX listing, and it is the anti-case this matcher already carried.
  // The one legitimate state suffix — the listing's OWN state — is matched by
  // the exact `${base}-${st}` rule above, so refusing every 2-letter tail here
  // keeps that behaviour and rejects the disagreeing ones.
  return !/^[a-z]{2}$/.test(longSlug.slice(shortSlug.length + 1));
}

function _marketIdMatches(id, m) {
  const s = capacitySlug(id);
  const base = capacitySlug(m.market);
  if (!s || !base) return false;
  if (s === base) return true;
  const st = m.state ? capacitySlug(m.state) : '';
  if (st && s === `${base}-${st}`) return true;
  return _tokenPrefix(s, base) || _tokenPrefix(base, s);
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

// G-1016-03 (Grok, 2026-10-16): analyze_site at 33.44,-112.36 with capacity_mw=50
// pointed at a 2 MW Phoenix listing as one that "match[es] this request". A market
// is offered against a sized ask only when its listed MW is at least this share of
// the ask. The summary is per MARKET (count, total mw), so a market whose TOTAL is
// under the floor holds no listing that reaches it; one at or above the floor may
// still be made of smaller listings, which source_capacity min_mw matches per listing.
export const POINTER_MIN_SHARE_OF_ASK = 0.25;

/** The capacity_source block for a set of matched markets, or null. */
export function buildCapacityPointer(matches, { minMw = null } = {}) {
  if (!Array.isArray(matches) || !matches.length) return null;
  const ask = (typeof minMw === 'number' && Number.isFinite(minMw) && minMw > 0) ? minMw : null;
  let undersized = 0;
  if (ask !== null) {
    const floor = ask * POINTER_MIN_SHARE_OF_ASK;
    const kept = matches.filter((m) => !(typeof m.mw === 'number' && Number.isFinite(m.mw) && m.mw < floor));
    undersized = matches.length - kept.length;
    matches = kept;
    if (!matches.length) return null;
  }
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
    ...(ask !== null ? { size_check: {
      ask_mw: ask,
      min_share_of_ask: POINTER_MIN_SHARE_OF_ASK,
      markets_dropped_undersized: undersized,
      unsized_markets: matches.filter((m) => !(typeof m.mw === 'number' && Number.isFinite(m.mw))).map((m) => m.market),
      basis: 'A market is offered only when its listed MW is at least ' + (POINTER_MIN_SHARE_OF_ASK * 100) + '% of the ask. '
        + 'That test reads market totals, so a market that passes can still hold only smaller listings: '
        + 'source_capacity with min_mw matches each listing against what it can deliver.',
    } } : {}),
    note: CAPACITY_POINTER_NOTE,
  };
}

// ── the site-selection bridge (capacity handoff item 1, owner-approved 2026-11-10) ──
// Siting answers used to say nothing about inventory until a listing matched, so an agent that
// had just picked a market never learned it could ask for capacity there or register the
// requirement. The bridge rides every siting answer that names a place, whenever the summary is
// KNOWN (live or dormant): a live count for that place (zero is valid: providers are onboarding,
// which is not "no capacity in this market"), the browse call, the register call (no slug), and
// the listings page. An UNKNOWN summary still says nothing, so no count is ever invented.
export const CAPACITY_LISTINGS_URL = 'https://dchub.cloud/listings';
export const CAPACITY_REGISTER_WHY =
  'Registers this requirement (no slug) so providers with matching capacity can respond. '
  + 'Send it only after your human approves; DC Hub never contacts a provider without that approval.';
export const CAPACITY_ZERO_NOTE =
  'No live listing matches yet. Capacity Source is onboarding providers, so zero here does not mean the market has no capacity.';

function _browseArgs(q) {
  const args = {};
  if (q.markets.length === 1) args.market = q.markets[0];
  if (q.states.length === 1) args.state = q.states[0];
  // A grid answer names an ISO, which spans several states (item 3, 2026-11-11): source_capacity's
  // `location` filter takes them comma-separated.
  else if (q.states.length > 1 && !q.markets.length) args.location = q.states.join(', ');
  if (q.minMw !== null) args.min_mw = q.minMw;
  return args;
}

/**
 * The capacity_source bridge block for a siting answer, or null.
 *   summary  the cached /api/v1/listings/summary (null = unknown: say nothing)
 *   q        {states, markets, marketRows, minMw} from _capacityPointerQuery
 * Additive: when listings match, the pointer's own fields (live_listings, mw, markets,
 * next_step, size_check, note) ride along unchanged.
 */
export function buildCapacitySourceBlock(summary, q) {
  if (!summary || !q) return null;
  const states = Array.isArray(q.states) ? q.states : [];
  const markets = Array.isArray(q.markets) ? q.markets : [];
  const rows = Array.isArray(q.marketRows) ? q.marketRows : [];
  if (!states.length && !markets.length && !rows.length) return null;   // no place, nothing to count
  const minMw = (typeof q.minMw === 'number' && Number.isFinite(q.minMw) && q.minMw > 0) ? q.minMw : null;
  const query = { states, markets, marketRows: rows, minMw };
  const pointer = isCapacityLive(summary)
    ? buildCapacityPointer(matchCapacityMarkets(summary, query), { minMw }) : null;
  const browse = pointer ? { ...pointer.next_step.args } : _browseArgs(query);
  const block = {
    live_listings_matching: pointer ? pointer.live_listings : 0,
    program_status: summary.program_status || (isCapacityLive(summary) ? 'live' : 'onboarding'),
    browse_call: { tool: 'source_capacity', arguments: browse },
    register_call: { tool: 'request_capacity_intro', arguments: {}, why: CAPACITY_REGISTER_WHY },
    url: CAPACITY_LISTINGS_URL,
    ...(pointer ? {} : { note: CAPACITY_ZERO_NOTE }),
    ...(pointer || {}),
  };
  // The question names a size AND a place: the next call is the inventory, not another ranking.
  if (minMw !== null && (states.length || markets.length)) {
    block.next_call = { tool: 'source_capacity', arguments: browse };
  }
  return block;
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

/** The text line for a sized ask with no matching listing (no line for an unsized one). */
export function capacityRegisterLine(block) {
  const args = Object.entries(block.browse_call.arguments)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? v : JSON.stringify(v)}`).join(' ');
  return 'Capacity Source: no live listing matches this request yet (providers are onboarding; '
    + 'this does not mean the market has no capacity). Next: `request_capacity_intro` registers the '
    + `requirement once your human approves; \`source_capacity${args ? ` ${args}` : ''}\` browses listings.`;
}

// ★2026-09-29 — the instructions clause is COUNT-FREE. It used to splice the
// day's count, MW, markets and date into the session instructions, and hosts
// copy instructions into system prompts, transcripts and directory snapshots
// that outlive the day (the owner found the Phoenix line there). It now says
// the program is live and where the live numbers are.
export const CAPACITY_INSTR_LIVE_CLAUSE =
  'live now: current listings at https://dchub.cloud/listings, live summary at '
  + 'https://dchub.cloud/api/v1/listings/summary';

/** Instructions with the live clause spliced into the CAPACITY SOURCE sentence. */
export function withCapacityLiveClause(instructions, summary) {
  if (typeof instructions !== 'string') return instructions;
  if (!isCapacityLive(summary)) return instructions;
  const i = instructions.indexOf(CAPACITY_INSTR_ANCHOR);
  if (i < 0 || instructions.indexOf(CAPACITY_INSTR_ANCHOR, i + 1) >= 0) return instructions;
  return instructions.slice(0, i)
    + `${CAPACITY_INSTR_ANCHOR.slice(0, -1)} (${CAPACITY_INSTR_LIVE_CLAUSE}).`
    + instructions.slice(i + CAPACITY_INSTR_ANCHOR.length);
}

// ★2026-09-16 — the OWNER-GIVEN registry wording, and the one place it lives.
// Every surface that describes DC Hub to a directory reads this constant, so
// the sentence has one origin rather than a copy per file (the failure mode in
// the 2026-07-28 white-glove note: the loop emitted copy its own detector
// then flagged, because one quantity had two homes).
//
// It is COUNT-FREE on purpose. A registry re-crawls on its own schedule, so a
// number pasted into a listing goes stale where no detector of ours can reach
// it; the capability, the tool and the page all outlive any one inventory.
//
// ★ Byte-identical to CAPACITY_SOURCE_BLURB in the dchub-backend's
//   routes/mcp_presence_crawler.py, which builds the same copy for the
//   white-glove lane. Two repos, so two literals; each is pinned by a test
//   naming the other.
export const CAPACITY_BLURB =
  'Capacity Source: powered land/shell/turnkey capacity to buy or lease '
  + 'via source_capacity; browse dchub.cloud/listings.';

// ★2026-09-29 — where the paste line used to append "Live now: <N> live
// listings, <X> MW across <markets>, updated <date>", it now points at the live
// source and states no number. The paste line is COPIED into directory
// listings, curated-list PRs and a public GitHub issue, and each copy froze the
// inventory of the day it was pasted; an AI-training probe quoted one back as
// current two weeks later. Live surfaces (GET /api/v1/listings/summary, the
// /listings page, source_capacity, the per-session instructions) keep their
// live numbers. test/capacity-inventory-not-in-static-copy.test.mjs fences
// every static surface in this repo against the same shape the backend's
// listing_copy_violations refuses.
export const CAPACITY_LIVE_POINTER =
  'Current listings: https://dchub.cloud/listings · '
  + 'live summary: https://dchub.cloud/api/v1/listings/summary · '
  + 'agents: source_capacity.';

/**
 * The Capacity Source sentence for the registry paste line, or null while
 * dormant. Count-free in both halves: the blurb states the capability, the
 * pointer sends the reader to the live numbers.
 *
 * The gate is unchanged and deliberate: a listing that says "browse
 * dchub.cloud/listings" while nothing is live sends a reader to an empty page,
 * so silence stays the dormant answer.
 */
export function capacityPasteClause(summary) {
  return isCapacityLive(summary) ? `${CAPACITY_BLURB} ${CAPACITY_LIVE_POINTER}` : null;
}

/**
 * Each Capacity Source INVENTORY figure in `text` — a listing count, or MW
 * beside "listings" — or [] when clean. The same shape as
 * the backend's routes/white_glove_propagation.capacity_inventory_violations.
 * A result limit ("up to N listings"), an example size quoted for a single
 * listing and a requirement in an example prompt are documentation, not
 * inventory.
 */
const _CAPACITY_INVENTORY_RE = new RegExp(
  String.raw`(?<!up to )(?<!top )(?<!most )(?<!first )(?<!max )`
  + String.raw`\b\d[\d,]*\s+(?:live\s+|public\s+|active\s+|current\s+)?listings?\b`
  + String.raw`|\blistings\b[^.\n]{0,60}?\b\d[\d,]*(?:\.\d+)?\s*(?:MW|megawatts?|kW)\b`,
  'gi');
export function capacityInventoryViolations(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ')
    .replace(/\/listings\/[\w-]+/g, ' ');   // a listing's own URL slug
  return [...flat.matchAll(_CAPACITY_INVENTORY_RE)].map((m) => m[0]);
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

// ── "where can I get X MW" / "need X MW by <date>" (2026-11-12, owner via Grok) ──
// A sibling of capacityProcurementIntent for the asks that name a size and an
// acquisition verb but no lease/buy word: "where can I get 50 MW in Texas by
// Q2 2027", "need 20 MW in Phoenix by 2027", "who has 30 MW available in
// Dallas". The size is required, and the ask must come before it, so a size
// alone ("rank markets for a 200 MW AI campus") never matches. The same
// _PROCURE_NOT exclusions apply, plus the energy and grid readings of a size:
// "50 MW of power", "a 100 MW load", headroom, queues, ISOs, rack density and
// land/site searches stay with the tools that answer them.
const _SIZE = String.raw`\d+(?:\.\d+)?\s*(?:mw|megawatts?|kw|kilowatts?|gw|gigawatts?)\b`;
const _ACQUIRE_ASK = new RegExp(String.raw`\b(?:where\s+(?:can|could|do|would|should)\s+(?:i|we|you|they|my\s+\w+|our\s+\w+)\s+(?:get|find|source|secure|buy|lease|rent)`
  + String.raw`|(?:i|we|they)\s+(?:need|want|require)|needs?|looking\s+for|in\s+the\s+market\s+for|seeking|searching\s+for`
  + String.raw`|who\s+(?:has|have|offers?|can\s+(?:offer|deliver|provide))|find\s+me|get\s+me)\b[^.?!]{0,40}?\b${_SIZE}`, 'i');
const _ACQUIRE_NOT = new RegExp(String.raw`\b(?:${_SIZE.slice(0, -2)})\s+(?:of\s+)?(?:\w+\s+){0,2}?(?:power|electricity|energy|load|generation|generators?|solar|wind|gas|batter(?:y|ies)|storage|cooling|chillers?|ups)\b`
  + String.raw`|\b(?:loads?|grid|headroom|interconnect\w*|queues?|substations?|transmission|utilit(?:y|ies)|isos?|rtos?|ercot|pjm|miso|caiso|spp|nyiso|iso[\s-]*ne`
  + String.raw`|time[\s-]+to[\s-]+power|power\s+availability|buildable|greenfield|parcels?|sites?|per\s+(?:rack|cabinet)|rack\s+density)\b`, 'i');

export function capacityAcquireIntent(text) {
  const t = String(text || '');
  if (!t || _PROCURE_NOT.test(t) || _ACQUIRE_NOT.test(t)) return false;
  return _ACQUIRE_ASK.test(t);
}

/** Either reading: a buy/lease intent, or a "where can I get / need X MW" ask. */
export function capacityStepIntent(text) {
  return capacityProcurementIntent(text) || capacityAcquireIntent(text);
}

// The deadline a capacity intent states, as YYYY-MM for source_capacity's
// available_by, or null. A quarter is its last month (Q2 2027 -> 2027-06), a
// half its last month, a bare year December ("by 2027" -> 2027-12), a month
// itself, early/mid/late -> 03/06/12, and "within N months" counts from `now`.
// A deadline before the current month is not one (null), so a typo or a past
// year never filters every listing out.
const _MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const _MONTH_RE = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const _DATE_ANCHOR = String.raw`\b(?:by|before|until|no\s+later\s+than|(?:ready|online|live|delivered|energi[sz]ed|available)\s+(?:by|in)|in)\s+(?:the\s+)?(?:end\s+of\s+)?`;
const _BY_QUARTER = /\b(?:q([1-4])\s*(?:of\s+)?'?(20\d{2})|(20\d{2})\s*q([1-4]))\b/i;
const _BY_HALF = /\b(?:h([12])|(first|second)\s+half\s+(?:of\s+)?)\s*'?(20\d{2})\b/i;
const _BY_MONTH = new RegExp(_DATE_ANCHOR + String.raw`(?:early\s+|mid[\s-]+|late\s+)?` + _MONTH_RE + String.raw`\.?,?\s+(?:of\s+)?(20\d{2})\b`, 'i');
const _BY_SEASON = new RegExp(_DATE_ANCHOR + String.raw`(early|mid|late)[\s-]+(20\d{2})\b`, 'i');
const _BY_YEAR = new RegExp(_DATE_ANCHOR + String.raw`(20\d{2})\b`, 'i');
const _WITHIN = /\b(?:within|in|over\s+the\s+next|next)\s+(\d{1,2})\s+months?\b/i;
const _ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

export function capacityAvailableBy(text, now = new Date()) {
  try {
    const t = String(text || '');
    if (!t) return null;
    const cur = _ym(now.getUTCFullYear(), now.getUTCMonth() + 1);
    let out = null;
    let m;
    if ((m = t.match(_BY_QUARTER))) out = _ym(m[2] || m[3], Number(m[1] || m[4]) * 3);
    else if ((m = t.match(_BY_HALF))) out = _ym(m[3], (m[1] === '1' || /^first$/i.test(m[2] || '')) ? 6 : 12);
    else if ((m = t.match(_BY_MONTH))) out = _ym(m[2], _MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1);
    else if ((m = t.match(_BY_SEASON))) out = _ym(m[2], { early: 3, mid: 6, late: 12 }[m[1].toLowerCase()]);
    else if ((m = t.match(_BY_YEAR))) out = _ym(m[1], 12);
    else if ((m = t.match(_WITHIN)) && Number(m[1]) > 0) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + Number(m[1]), 1));
      out = _ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
    }
    return out && out >= cur ? out : null;
  } catch { return null; }
}

// A size the intent states in kW, when it states none in MW/GW (the planner's
// own signal reads MW and GW only). "500 kW per rack" is density, not a size.
const _KW_RE = /(\d+(?:\.\d+)?)\s*(?:kw|kilowatts?)\b(?!\s*(?:\/|per)\s*(?:rack|cabinet))/i;
export function capacityKwFromText(text) {
  const m = String(text || '').match(_KW_RE);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Regions source_capacity's `region` filter takes, by the words a buyer uses.
const _REGION_WORDS = [
  [/\b(?:europe|european|emea|eu)\b/i, 'europe'],
  [/\b(?:asia[\s-]*pacific|apac|asia)\b/i, 'asia_pacific'],
  [/\b(?:latin\s+america|latam|south\s+america)\b/i, 'latin_america'],
  [/\b(?:middle\s+east|africa|mea)\b/i, 'middle_east_africa'],
  [/\b(?:north\s+america)\b/i, 'north_america'],
];
export function capacityRegionFromText(text) {
  const t = String(text || '');
  for (const [re, key] of _REGION_WORDS) if (re.test(t)) return key;
  return null;
}
