// lib/since-last-check.mjs — "since you last asked" (owner 2026-11-18, "lets do 1-6": bring agents back and grow
// use per agent). Two pieces, both pure:
//
//   since-last-check facts   A returning key's resume line (lib/resume-state.mjs) names the market it asked about
//                            most and says get_changes shows what moved. It never said WHAT moved. This module turns
//                            one /api/v1/changes/since read (since = the key's previous visit, watchlist = that one
//                            market) into dated facts: new deals, new pipeline projects, new capacity listings,
//                            newly discovered facilities and bill status changes in the market's state, the DCPI
//                            7-day move when the backend served it, and how many of the key's saved sites moved.
//                            server.mjs _resumeStateStep folds the line into the resume line (one block, never a
//                            second line, never a `Tell the user:` line) and puts the same facts in
//                            structuredContent.since_last_check.
//   get_changes last_session since:"last_session" resolves server-side to the key's previous visit (key_standing
//                            last_seen_at: the end of the previous session, a 30-minute gap rolls it), 7d when the
//                            key has none on record, 7d for a keyless caller. The answer says which was used.
//
// WHAT THE BACKEND SERVES (dchub-backend routes/changes_feed.py on origin/main, read 2026-11-18, not guessed):
//   since       ISO-8601 parses as since_mode "iso"; older than 30 days is clamped ("clamped-30d"); anything it
//               cannot parse falls back to 24h ("parse-error-fallback-24h"). Facts are stated only for "iso".
//   watchlist   apply_watchlist filters the lanes in _WATCH_FIELDS and echoes watchlist.markets / filtered_lanes:
//               transactions_new, pipeline_new by row market; pocket_listings_new by market, else state;
//               facilities_new and legislation_status_changes by the watched market's STATE. A lane not in
//               filtered_lanes (or no echo at all: an older backend) is global, so it is never stated here.
//   counts      counts[lane] is the filtered row count; null = the lane could not be read (never stated).
//               counts_at_limit names lanes whose GLOBAL read hit `limit` before the filter, so the filtered
//               count is a floor: it is written "N+".
//   dcpi_movers selected on a 7-day excess-power move whatever `since` is, and empty below the paid DCPI gate.
//               It is stated as a 7-day move, never as a since-your-last-check move.
//   portfolio   key-level (saved sites), not filtered by the watchlist: "N of your M saved sites moved".
//
// Facts only, only lanes that are present and non-zero; nothing real, no line. No plan, no price, no allowance,
// nothing promotional: test/since-last-check.test.mjs scans every string this module can emit.
//
// Kill switches: DCHUB_SINCE_LAST_CHECK=0 (the facts; it rides the resume line, so DCHUB_RESUME_STATE=0 also
// stops it) and DCHUB_CHANGES_LAST_SESSION=0 (since:"last_session" is passed through to the backend unchanged).

const _off = (v) => /^(0|off|false|no)$/i.test(String(v || '').trim());
export function sinceLastCheckOn(env = process.env) { return !_off(env && env.DCHUB_SINCE_LAST_CHECK); }
export function changesLastSessionOn(env = process.env) { return !_off(env && env.DCHUB_CHANGES_LAST_SESSION); }

export const SINCE_FETCH_TIMEOUT_MS = 2500;
export const SINCE_LIMIT = 200;
const _SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const _NAME_RE = /^[A-Za-z0-9 .,'()&/-]{1,60}$/;
const _STATE_RE = /^[A-Za-z][A-Za-z .-]{1,23}$/;
const _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _ms(v) {
  const t = v ? Date.parse(String(v)) : NaN;
  return Number.isFinite(t) ? t : NaN;
}
// The backend's fromisoformat takes "+00:00"; whole seconds keep it short.
export function backendIso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/Z$/, '+00:00');
}
function _market(standing) {
  const m = standing && typeof standing.top_market === 'object' ? standing.top_market : null;
  const slug = m && typeof m.slug === 'string' ? m.slug.trim().toLowerCase() : '';
  const name = m && typeof m.name === 'string' ? m.name.trim() : '';
  return _SLUG_RE.test(slug) && _NAME_RE.test(name) ? { slug, name } : null;
}

// The one backend query, or null when the key has no previous visit or no market on record.
export function sinceLastCheckQuery(standing, now = Date.now()) {
  const s = standing || {};
  if (s.found !== true) return null;
  const last = _ms(s.last_seen_at);
  if (!Number.isFinite(last) || last >= now) return null;
  const m = _market(s);
  if (!m) return null;
  return { market: m, params: { since: backendIso(last), watchlist: m.slug, limit: SINCE_LIMIT } };
}

const _plural = (n, one, many) => (n === 1 ? one : many);
const _int = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

// lane -> [singular, plural, scope]. scope 'state' lanes are filtered on the market's state, so they say so.
export const SINCE_LANES = Object.freeze([
  ['transactions_new', 'new deal', 'new deals', 'market'],
  ['pipeline_new', 'new pipeline project', 'new pipeline projects', 'market'],
  ['pocket_listings_new', 'new capacity listing', 'new capacity listings', 'market'],
  ['facilities_new', 'newly discovered facility', 'newly discovered facilities', 'state'],
  ['legislation_status_changes', 'bill status change', 'bill status changes', 'state'],
]);

function _stateOf(rows) {
  const seen = new Set();
  for (const r of rows || []) {
    const s = r && typeof r.state === 'string' ? r.state.trim() : '';
    if (s && _STATE_RE.test(s)) seen.add(s);
  }
  return seen.size === 1 ? [...seen][0] : '';
}

function _day(ms) { return new Date(ms).toISOString().slice(0, 10); }
function _short(ms) { const d = new Date(ms); return _MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
function _signed(x) { return (x > 0 ? '+' : '') + x.toFixed(1); }

// { market, since, as_of, facts: [{lane, count?, floor?, scope?, state?, delta_7d?, label}], line } or
// { reason } when there is nothing real to say. body is the /api/v1/changes/since JSON.
export function sinceLastCheckFacts(body, market, now = Date.now()) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b || b.ok === false || (typeof b.error === 'string' && b.error)) return { reason: 'unreadable' };
  if (!market || !_SLUG_RE.test(market.slug || '') || !_NAME_RE.test(market.name || '')) return { reason: 'no_market' };
  if (b.since_mode !== 'iso') return { reason: 'since_not_applied' };
  const sinceMs = _ms(b.since);
  if (!Number.isFinite(sinceMs)) return { reason: 'since_not_applied' };
  const wl = b.watchlist && typeof b.watchlist === 'object' ? b.watchlist : null;
  const watched = !!(wl && Array.isArray(wl.markets) && wl.markets.includes(market.slug));
  const filtered = new Set(watched && Array.isArray(wl.filtered_lanes) ? wl.filtered_lanes : []);
  const counts = b.counts && typeof b.counts === 'object' ? b.counts : {};
  const diff = b.diff && typeof b.diff === 'object' ? b.diff : {};
  const atLimit = new Set(Array.isArray(b.counts_at_limit) ? b.counts_at_limit : []);
  const facts = [];
  for (const [lane, one, many, scope] of SINCE_LANES) {
    if (!filtered.has(lane) || !Array.isArray(diff[lane])) continue;
    const n = _int(counts[lane]);
    if (!n) continue;
    const floor = atLimit.has(lane);
    const f = { lane, count: n, scope, label: n + (floor ? '+' : '') + ' ' + _plural(n, one, many) };
    if (floor) f.floor = true;
    if (scope === 'state') {
      const st = _stateOf(diff[lane]);
      f.state = st || null;
      f.label += st ? ' in ' + st : " in the market's state";
    }
    facts.push(f);
  }
  if (watched && filtered.has('dcpi_movers') && Array.isArray(diff.dcpi_movers)) {
    const row = diff.dcpi_movers.find((r) => r && r.market_slug === market.slug);
    const d = row ? Number(row.delta_7d) : NaN;
    if (Number.isFinite(d) && Math.abs(d) >= 0.05) {
      facts.push({ lane: 'dcpi_movers', delta_7d: Math.round(d * 10) / 10,
        label: 'DCPI excess-power score ' + _signed(d) + ' over 7 days' });
    }
  }
  const pf = b.portfolio && typeof b.portfolio === 'object' ? b.portfolio : null;
  const moved = pf ? _int(pf.moved_count) : 0;
  const saved = pf ? _int(pf.saved_sites) : 0;
  if (moved && saved >= moved) {
    facts.push({ lane: 'portfolio', count: moved, label: moved + ' of your ' + saved + ' saved ' + _plural(saved, 'site', 'sites') + ' moved' });
  }
  if (!facts.length) return { reason: 'nothing_moved' };
  const asOfMs = _ms(b.generated_at);
  const asOf = _day(Number.isFinite(asOfMs) ? asOfMs : now);
  const line = 'Since your last check on ' + market.name + ' (' + _short(sinceMs) + '): '
    + facts.map((f) => f.label).join(', ') + '. Source: DC Hub (dchub.cloud), as of ' + asOf + '.';
  return { market: { slug: market.slug, name: market.name }, since: new Date(sinceMs).toISOString(), as_of: asOf,
           facts, line };
}

// Fold the facts into the resume line: the same block, one more sentence. Pure.
export function foldIntoResumeLine(resumeLine, sinceLine) {
  if (!resumeLine) return resumeLine;
  return sinceLine ? resumeLine + ' ' + sinceLine : resumeLine;
}

// ── get_changes since:"last_session" ────────────────────────────────────────────────────────────────────────
export const LAST_SESSION = 'last_session';
export function isLastSession(v) { return typeof v === 'string' && v.trim().toLowerCase() === LAST_SESSION; }

// { since, basis, note } for a since:"last_session" call, else null (the caller's since stands).
//   basis 'last_session'  the key's previous visit (standing.last_seen_at)
//   basis 'fallback_7d'   a key with no previous visit on record (or standing unreadable)
//   basis 'keyless_7d'    no key: there is no previous visit to read
export function resolveChangesSince({ since, keyed = false, standing = null, now = Date.now() } = {}) {
  if (!isLastSession(since)) return null;
  if (!keyed) {
    return { since: '7d', basis: 'keyless_7d',
      note: 'since="last_session" reads the previous visit of a key; this call has none, so it covers the last 7 days.' };
  }
  const s = standing && typeof standing === 'object' ? standing : {};
  const last = s.found === true ? _ms(s.last_seen_at) : NaN;
  if (Number.isFinite(last) && last < now) {
    return { since: backendIso(last), basis: 'last_session',
      note: 'since="last_session" resolved to this key\'s previous visit, ' + new Date(last).toISOString() + '.' };
  }
  return { since: '7d', basis: 'fallback_7d',
    note: 'No previous visit is on record for this key, so since="last_session" covers the last 7 days.' };
}
