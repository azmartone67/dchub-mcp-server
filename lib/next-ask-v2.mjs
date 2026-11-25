// lib/next-ask-v2.mjs — Grok spec item 5 (Nov 24, "MCP growth, stability first"): make next steps followable.
// DRAFT: flag DCHUB_NEXT_ASK_V2, default OFF. Off, nothing here runs and every answer is byte-identical to before.
//
// WHY: /api/v1/mcp/funnel next_ask_follow_7d (read 2026-11-25T04:42Z) has follow_rate 0.0 for every suggesting tool:
// get_news shown 134 times (rank_markets 88 of them), get_market_dcpi_rank 107 (rank_markets 89), search_facilities 95,
// get_changes 62. The suggestions were mostly a generic market ranking, often with nothing filled in.
//
// WHAT CHANGES (treatment arm only): at most ONE follow-up per answer, chosen from the user's question and this
// answer, with its arguments filled from the same market / ISO / state / coordinates / MW, so the agent can make the
// call as it stands:
//   next_call { tool, arguments, why }   why: at most 15 words, in the user's own terms (their place, their size)
//   next_ask  { tool, question, args }   the same tool and arguments; `question` is the one plain line
// Mapping (the spec's):
//   get_interconnection_queue  -> get_power_availability_timeline for the same state (time to power)
//   get_market_dcpi_rank       -> get_interconnection_queue for that market's ISO, else analyze_site for the market
//   search_facilities          -> get_grid_intelligence (grid headroom) for the same market
//   get_news / get_changes     -> set_market_alert for the market the item mentions
//   analyze_site               -> compare_sites with the next-best location the answer names
// A mapped tool the caller cannot use, or one missing a value it needs, falls back to execute_plan with the user's
// question (or one built from the same place and size). Any other tool keeps today's suggestion, with its filled
// args, unless that suggestion is a tool the caller cannot use or a market ranking nobody asked for: then the same
// execute_plan fallback. Never rank_markets unless the question asked for a ranking; never get_api_key or another key
// / account tool (#1594's once-per-session get_api_key nudge is a different step and is untouched). No price or plan
// text anywhere.
//
// HOLDOUT: today's answer, unchanged. The exposure is logged in both arms where the decision is made
// (lib/monetization-experiments.mjs, test exp_next_ask_v2, 50/50, sticky per identity).
//
// Pure: no ctx, no network. server.mjs decides who is eligible and what `usable(tool)` means for this caller (the
// tool is in the caller's own tools/list AND their key opens it: lib entitlements from be#9213's canon, as the
// server's _tierRequiredFor reads them).
import { NEXT_ASK_V2, armFor, expOn, TREATMENT } from './monetization-experiments.mjs';

export const FLAG = 'DCHUB_NEXT_ASK_V2';
export const TEST = NEXT_ASK_V2;
export function nextAskV2On(env = process.env) { return expOn(TEST, env); }

// Never a follow-up here: the key / account tools (their own steps ask for them), and the tool that just ran.
export const NEVER_SUGGEST = Object.freeze(new Set([
  'get_api_key', 'claim_free_key', 'bind_email', 'recover_my_key', 'unlock_more_data', 'accept_capacity_terms',
]));
export const WHY_MAX_WORDS = 15;
// Answers whose rows each name a market (a queue's rows are projects, a site answer's are not markets).
const ROW_MARKET_TOOLS = new Set(['get_market_dcpi_rank', 'search_facilities', 'get_news', 'get_changes']);
export const MAPPED_TOOLS = Object.freeze(['get_interconnection_queue', 'get_market_dcpi_rank', 'search_facilities',
  'get_news', 'get_changes', 'analyze_site']);

const _US_ISOS = Object.freeze(['PJM', 'ERCOT', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISONE']);
const _str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
function _num(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

// ── the user's question ──────────────────────────────────────────────────────────────────────────────────────────
export function questionOf(args) {
  const a = _obj(args) || {};
  for (const k of ['intent', 'question', 'query', 'q', 'prompt']) {
    const v = _str(a[k]);
    if (v) return v.slice(0, 300);
  }
  return null;
}
const RANK_RE = /\b(rank(?:ed|ing|ings|s)?|top\s*\d*|best|leading|shortlist|which markets|compare markets|list (?:of )?markets)\b/i;
export function askedForRanking(q) { return !!(q && RANK_RE.test(q)); }
const QUEUE_RE = /\b(queue|interconnect(?:ion)?|time[- ]to[- ]power|when (?:can|could|will)[^?]{0,40}power)\b/i;
const SITE_RE = /\b(site|parcel|acre|coordinates?|lat(?:itude)?|lon(?:gitude)?)\b/i;

// ── values from the call and the answer ──────────────────────────────────────────────────────────────────────────
function _iso(v) {
  const s = _str(v);
  if (!s || s.includes(',')) return null;
  const u = s.toUpperCase().replace(/[^A-Z]/g, '');
  return _US_ISOS.includes(u) ? u : null;
}
function _state(v) {
  const s = _str(v);
  return s && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
}
export function slugOf(v) {
  const s = _str(v);
  if (!s) return null;
  const t = s.toLowerCase().replace(/[,.]/g, ' ').trim().replace(/\s+/g, '-');
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(t) ? t : null;
}
function _pretty(slug) {
  if (!slug) return null;
  return slug.split('-').map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}
function _mw(a) {
  const n = _num(a && (a.capacity_mw ?? a.target_mw ?? a.mw ?? a.min_mw));
  return n !== null && n > 0 ? n : null;
}
function _coords(o) {
  if (!o) return null;
  const lat = _num(o.lat ?? o.latitude);
  const lon = _num(o.lon ?? o.lng ?? o.long ?? o.longitude);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
const _ROW_KEYS = ['items', 'results', 'data', 'articles', 'news', 'facilities', 'movers', 'market_movers', 'changes',
  'new_facilities', 'deals', 'markets', 'rows'];
function _rows(sc) {
  const out = [];
  const s = _obj(sc) || {};
  for (const k of _ROW_KEYS) if (Array.isArray(s[k])) out.push(...s[k].filter(_obj));
  return out;
}
// The market a row names: its slug, its market name, the first market among its entities.
function _rowMarket(r) {
  const direct = slugOf(r.market_slug) || slugOf(r.market) || slugOf(r.metro) || slugOf(r.market_name);
  if (direct) return direct;
  for (const k of ['markets', 'market_slugs']) {
    const v = r[k];
    if (Array.isArray(v) && v.length) return slugOf(typeof v[0] === 'string' ? v[0] : (v[0] && (v[0].slug || v[0].market_slug || v[0].name)));
  }
  const e = _obj(r.entities);
  if (e) for (const k of ['markets', 'market', 'metros']) {
    const v = e[k];
    if (Array.isArray(v) && v.length) return slugOf(typeof v[0] === 'string' ? v[0] : (v[0] && (v[0].slug || v[0].name)));
    if (typeof v === 'string') return slugOf(v);
  }
  return null;
}
// The place this call and its answer are about. Call args first (the user's own words), then the answer's own fields.
export function contextOf(name, args, sc) {
  const a = _obj(args) || {};
  const s = _obj(sc) || {};
  const rf = _obj(s.resolved_from) || {};
  const market = slugOf(a.market_slug) || slugOf(a.market) || slugOf(a.location) || slugOf(a.city)
    || slugOf(s.market_slug) || slugOf(rf.market_slug) || slugOf(rf.market) || slugOf(s.market) || null;
  const iso = _iso(a.iso) || _iso(a.region_id) || _iso(a.region) || _iso(s.iso) || _iso(rf.iso)
    || _iso(s.grid_region) || _iso(s.iso_region) || null;
  const state = _state(a.state) || _state(s.state) || _state(rf.state) || null;
  const coords = _coords(a) || _coords(s) || _coords(_obj(s.site)) || null;
  return { market, iso, state, coords, mw: _mw(a) };
}

// ── the follow-ups ───────────────────────────────────────────────────────────────────────────────────────────────
function _place(ctx) { return _pretty(ctx.market) || ctx.state || ctx.iso || null; }
function _size(ctx) { return ctx.mw ? `${ctx.mw} MW` : 'a new load'; }
function _args(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return out;
}
function _fit(why) {
  const w = String(why || '').trim().split(/\s+/).filter(Boolean);
  return w.slice(0, WHY_MAX_WORDS).join(' ');
}
const C = (tool, args, why, line, extra = {}) => ({ tool, arguments: _args(args), why: _fit(why), line, ...extra });

// execute_plan with the user's question, or a question built from the same place and size. Null with no place.
function _planFallback(ctx, q) {
  const place = _place(ctx);
  const intent = q || (place ? `Time to power and grid headroom for ${_size(ctx)} in ${place}` : null);
  if (!intent) return null;
  const args = { intent, market: ctx.market, iso: ctx.iso, state: ctx.state, capacity_mw: ctx.mw,
    lat: ctx.coords ? ctx.coords.lat : null, lon: ctx.coords ? ctx.coords.lon : null };
  return C('execute_plan', args, place ? `Answers your question for ${place} in one dated, cited pass` : 'Answers your question in one dated, cited pass',
    place ? `Want the full picture for ${place} — power, queue and fiber in one pass?` : 'Want the full picture for this question in one pass?');
}
function _timeline(ctx, whyLead) {
  if (!ctx.state) return null;
  return C('get_power_availability_timeline', { state: ctx.state, mw: ctx.mw },
    `${whyLead}: when new power lands in ${ctx.state}`,
    `When could ${_size(ctx)} get power in ${ctx.state}, year by year?`);
}
function _queue(ctx, label) {
  if (!ctx.iso) return null;
  return C('get_interconnection_queue', { iso: ctx.iso }, `How crowded the ${ctx.iso} queue serving ${label} is`,
    `How congested is the ${ctx.iso} interconnection queue that serves ${label}?`);
}
function _headroom(ctx) {
  const place = _pretty(ctx.market);
  if (place) {
    return C('get_grid_intelligence', { market: ctx.market }, `Grid headroom and time to power where these ${place} facilities sit`,
      `How much grid headroom is left around ${place}, and how fast can new load get power?`);
  }
  if (ctx.iso) {
    return C('get_grid_intelligence', { region_id: ctx.iso }, `Grid headroom on ${ctx.iso}, where these facilities sit`,
      `How much grid headroom is left on ${ctx.iso}, and how fast can new load get power?`);
  }
  return null;
}
function _site(ctx, label) {
  if (!ctx.market && !ctx.coords) return null;
  const args = ctx.coords ? { lat: ctx.coords.lat, lon: ctx.coords.lon, capacity_mw: ctx.mw, state: ctx.state }
    : { location: ctx.market, capacity_mw: ctx.mw };
  return C('analyze_site', args, `Scores a ${_size(ctx)} site in ${label} on power, fiber and risk`,
    `Want a site-level read for ${_size(ctx)} in ${label}?`);
}
function _alert(market) {
  if (!market) return null;
  const p = _pretty(market);
  return C('set_market_alert', { market, channel: 'email' }, `Emails you when ${p}'s power verdict or scores move`,
    `Want an email when ${p}'s power verdict or scores change?`,
    { needs: 'email: an address your human types here (never guess one)' });
}
// The next-best location an analyze_site answer names (its alternatives / nearby markets with coordinates).
function _nextBest(sc, here) {
  const s = _obj(sc) || {};
  for (const k of ['alternatives', 'next_best', 'nearby_markets', 'better_alternatives', 'comparables', 'nearby_sites']) {
    const v = s[k];
    const list = Array.isArray(v) ? v : (_obj(v) ? [v] : []);
    for (const r of list.filter(_obj)) {
      const c = _coords(r) || _coords(_obj(r.location)) || _coords(_obj(r.centroid));
      if (c && (!here || c.lat !== here.lat || c.lon !== here.lon)) return { ...c, name: _str(r.name) || _str(r.market) || null };
    }
  }
  return null;
}
function _compare(ctx, sc) {
  if (!ctx.coords) return null;
  const alt = _nextBest(sc, ctx.coords);
  if (!alt) return null;
  const label = alt.name ? alt.name : 'the next-best location';
  return C('compare_sites', { locations: `${ctx.coords.lat},${ctx.coords.lon};${alt.lat},${alt.lon}`, capacity_mw: ctx.mw },
    `Puts your site beside ${label}, side by side`,
    `Want this site compared side by side with ${label}?`);
}

// Candidates for a mapped tool, best first. Each may be null (a value it needs is missing).
function _candidates(name, ctx, sc, q, args) {
  const place = _place(ctx) || 'this market';
  switch (name) {
    case 'get_interconnection_queue':
      return [_timeline(ctx, `You asked about the ${ctx.iso || 'grid'} queue`)];
    case 'get_market_dcpi_rank': {
      const top = { ...ctx, market: ctx.market || _topMarket(sc) };
      const label = _pretty(top.market) || place;
      // A question about a site asks for the site read first; otherwise the queue behind the verdict.
      return SITE_RE.test(q || '') ? [_site(top, label), _queue(top, label)] : [_queue(top, label), _site(top, label)];
    }
    case 'search_facilities': {
      const m = ctx.market || _rowsMarket(sc);
      return [_headroom({ ...ctx, market: m })];
    }
    case 'get_news':
    case 'get_changes':
      return [_alert(_rowsMarket(sc) || ctx.market || slugOf(Array.isArray(args && args.watchlist) ? args.watchlist[0] : null))];
    case 'analyze_site':
      return [_compare(ctx, sc), _timeline(ctx, 'Your site')];
    default:
      return [];
  }
}
function _topMarket(sc) {
  const s = _obj(sc) || {};
  return slugOf(s.market_slug) || (_rows(s).map(_rowMarket).find(Boolean) || null);
}
function _rowsMarket(sc) { return _rows(sc).map(_rowMarket).find(Boolean) || null; }

// One follow-up for this answer, or null (nothing worth suggesting; the caller keeps today's next_ask).
//   name      the tool that just ran
//   args      its arguments (the user's question rides intent / query when there is one)
//   sc        its structuredContent
//   current   today's next_ask (lib/agent-outreach nextAskFor), or null
//   usable    (tool) => boolean: listed for this caller AND their key opens it (server.mjs)
// Returns { tool, arguments, why, line, needs? } or { drop: true } (execute_plan's own answer when nothing fits:
// the answer then carries no follow-up rather than an unasked ranking).
export function chooseNextCall(name, args, sc, { current = null, usable = () => true } = {}) {
  const q = questionOf(args);
  const ranking = askedForRanking(q);
  const ctx = contextOf(name, args, sc);
  // A mapped answer about rows (news, changes, facilities, a ranking) is about the market its first row names.
  if (ROW_MARKET_TOOLS.has(name) && !ctx.market) ctx.market = _rowsMarket(sc);
  if (QUEUE_RE.test(q || '') && name === 'execute_plan') {
    const t = _timeline(ctx, 'You asked about time to power');
    if (_ok(t, name, usable, ranking)) return t;
  }
  const ok = (c) => _ok(c, name, usable, ranking);
  const mapped = MAPPED_TOOLS.includes(name);
  if (mapped) {
    for (const c of _candidates(name, ctx, sc, q, args)) if (ok(c)) return c;
  }
  const f = name === 'execute_plan' ? null : _planFallback(ctx, q);
  if (mapped && ok(f)) return f;
  // Unmapped (or a mapped tool with nothing to fill): keep today's suggestion when it is usable and not an unasked
  // ranking.
  const cur = _obj(current);
  const curTool = cur && _str(cur.tool);
  if (curTool && ok({ tool: curTool })) return null;   // today's follow-up already passes: nothing to change
  if (!mapped && ok(f)) return f;
  // Nothing usable fits, and today's suggestion is unusable or an unasked ranking: drop it.
  return curTool ? { drop: true } : null;
}
function _ok(c, name, usable, ranking) {
  if (!c || !c.tool || c.tool === name || NEVER_SUGGEST.has(c.tool)) return false;
  if (c.tool === 'rank_markets' && !ranking) return false;
  try { return usable(c.tool) === true; } catch (_) { return false; }
}

// The next_ask the treatment arm serves (same tool and arguments as next_call; `question` is the one plain line).
export function nextAskOf(choice) {
  if (!choice || choice.drop) return null;
  return { tool: choice.tool, question: choice.line, ...(Object.keys(choice.arguments).length ? { args: { ...choice.arguments } } : {}),
    ...(choice.needs ? { needs: choice.needs } : {}) };
}
export function nextCallOf(choice) {
  if (!choice || choice.drop) return null;
  return { tool: choice.tool, arguments: { ...choice.arguments }, why: choice.why, ...(choice.needs ? { needs: choice.needs } : {}) };
}

// The arm for an identity ('treatment' | 'holdout'); '' with no identity.
export function armOf(identity) { return identity ? armFor(identity, TEST) : ''; }
export function isTreatment(identity) { return armOf(identity) === TREATMENT; }

// Exposure memo: one exposure row per (identity, session) per replica, both arms.
const _seen = new Set();
const _MAX_SEEN = 20000;
export function exposureDue(identity, sessionId) {
  const k = `${identity}|${sessionId || ''}`;
  if (!identity || _seen.has(k)) return false;
  if (_seen.size >= _MAX_SEEN) _seen.clear();
  _seen.add(k);
  return true;
}
export function _resetForTests() { _seen.clear(); }
