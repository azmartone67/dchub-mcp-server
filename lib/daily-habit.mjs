// lib/daily-habit.mjs: the daily check-in habit and the one-call email identity (owner approved 2026-11-17 21:51 MST).
//
// Four pieces, one definition site each:
//
//   get_changes window/watchlist  changesParams builds the backend query (window "1d" | "7d", watchlist = market
//                                 slugs, comma-joined); changesFallbackParams says what to re-ask when a backend
//                                 that predates window rejects it (or ignores a 7d window): since=<now - window>.
//   dchub://daily                 renderDaily turns GET /api/v1/daily into the resource text; dailyResourceText
//                                 reads it and, on any failure, says how to get the same check-in from get_changes.
//   next_tools                    dailyNextTool / attachDailyNext: one {tool:'get_changes', args:{window:'1d',
//                                 watchlist:[slug]}} entry, appended (never duplicated) to a result's next_tools.
//   one-call identity             dailyEmailAsk (the human's sentence, verbatim per owner), dailyClaimAsk (the ONE
//                                 call: CLAIM_TOOL with {email, market}), dailyClaimAgentText (the agent's line), and
//                                 claimFollowing (the backend's `following` block, surfaced on the claim result).
//
// The key tool is named through CLAIM_TOOL (lib/claim-handoff.mjs) only, so a rename of that tool flows through.
// No plan names, no prices, no allowance wording ("N answers a day", "free tier", "free key") anywhere here:
// test/daily-habit.test.mjs scans every string this module can emit.
// Pure: no ctx, no env; the network read takes its fetcher as an argument.
import { CLAIM_TOOL } from './claim-handoff.mjs';
// Not imported from lib/keyless-wall.mjs on purpose: lib/lean-response.mjs imports this module, and keyless-wall's
// import chain (wall-upgrade-offer -> neutral-cta) would close a cycle that leaves NEUTRAL_GATED undefined at load.
// Same slug rule and display name as keyless-wall's.
export const MARKET_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export function marketDisplayName(slug) {
  return String(slug || '').split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export const CHANGES_WINDOWS = Object.freeze(['1d', '7d']);
export const DAILY_WINDOW = '1d';
export const DAILY_RESOURCE_URI = 'dchub://daily';
export const DAILY_PATH = '/api/v1/daily';
export const WATCHLIST_MAX = 25;
const _WINDOW_MS = Object.freeze({ '1d': 24 * 3600 * 1000, '7d': 7 * 24 * 3600 * 1000 });

// 'Northern Virginia' / ' northern-virginia ' -> 'northern-virginia'; anything that is not a slug -> ''.
export function normMarketSlug(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().toLowerCase().replace(/\s+/g, '-');
  return MARKET_SLUG_RE.test(s) ? s : '';
}
// An array (or a comma-separated string) of market slugs -> unique valid slugs, first WATCHLIST_MAX.
export function normWatchlist(v) {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
  const out = [];
  for (const x of raw) {
    const s = normMarketSlug(x);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= WATCHLIST_MAX) break;
  }
  return out;
}

// The query get_changes sends. `since` keeps working exactly as before; window and watchlist ride beside it.
export function changesParams(a = {}) {
  const p = {};
  if (a.since !== undefined && a.since !== null && a.since !== '') p.since = a.since;
  if (a.limit !== undefined && a.limit !== null) p.limit = a.limit;
  if (CHANGES_WINDOWS.includes(a.window)) p.window = a.window;
  const wl = normWatchlist(a.watchlist);
  if (wl.length) p.watchlist = wl.join(',');
  return p;
}

export function windowSinceIso(window, now = new Date()) {
  const ms = _WINDOW_MS[window] || _WINDOW_MS[DAILY_WINDOW];
  return new Date(now.getTime() - ms).toISOString();
}

const _rejected = (r) => !r || typeof r !== 'object' || Array.isArray(r) || (typeof r.error === 'string' && r.error) || r.ok === false;

// null = the first answer stands. Otherwise the params of the one retry: since=<now - window> (the caller's own
// since wins), limit kept, no window, no watchlist. A backend that rejects window gets the retry; one that answers
// but does not echo `window` ignored it, which only matters for 7d (its default is the last 24h, i.e. 1d).
export function changesFallbackParams(a = {}, first, now = new Date()) {
  const p = changesParams(a);
  if (!p.window) return null;
  const ignored7d = !_rejected(first) && first.window === undefined && p.window === '7d' && p.since === undefined;
  if (!_rejected(first) && !ignored7d) return null;
  const out = { since: p.since !== undefined ? p.since : windowSinceIso(p.window, now) };
  if (p.limit !== undefined) out.limit = p.limit;
  return out;
}

// ── next_tools ──────────────────────────────────────────────────────────────────────────────────────────────
export function dailyNextTool(slugs) {
  const wl = normWatchlist(Array.isArray(slugs) ? slugs.filter(Boolean) : (slugs ? [slugs] : []));
  return { tool: 'get_changes', args: { window: DAILY_WINDOW, ...(wl.length ? { watchlist: wl } : {}) } };
}
const _isDailyEntry = (e) => !!e && typeof e === 'object' && e.tool === 'get_changes'
  && !!e.args && e.args.window === DAILY_WINDOW;
// Appends the entry to obj.next_tools in place (creating it when absent). A result that already carries a daily
// get_changes entry, or a next_tools that is not an array, is left alone. Returns obj.
export function attachDailyNext(obj, slugs) {
  try {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const entry = dailyNextTool(slugs);
    if (obj.next_tools === undefined) obj.next_tools = [entry];
    else if (Array.isArray(obj.next_tools) && !obj.next_tools.some(_isDailyEntry)) obj.next_tools = [...obj.next_tools, entry];
  } catch (_) { /* a hint never breaks an answer */ }
  return obj;
}

// ── dchub://daily ───────────────────────────────────────────────────────────────────────────────────────────
const _str = (v) => (typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : ''));
export function renderDaily(j) {
  const items = (j && Array.isArray(j.items)) ? j.items : [];
  const asOf = _str(j && (j.as_of || j.generated_at));
  const lines = ['# DC Hub Daily' + (asOf ? ' (as of ' + asOf + ')' : ''), ''];
  if (!items.length) lines.push('Nothing moved in the last day.');
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const head = [_str(it.market) ? marketDisplayName(normMarketSlug(it.market) || it.market) : '', _str(it.title)].filter(Boolean).join(': ');
    const tail = [_str(it.kind), _str(it.as_of) ? 'as of ' + _str(it.as_of) : '', _str(it.source)].filter(Boolean).join(', ');
    lines.push('- ' + (head || '(untitled)') + (_str(it.detail) ? ' ' + _str(it.detail) : '') + (tail ? ' (' + tail + ')' : ''));
  }
  lines.push('', 'Same check-in as a tool call: get_changes with window 1d (add watchlist for your markets).',
    'Cite "DC Hub (dchub.cloud)" with the as-of date.');
  return lines.join('\n');
}
export const DAILY_UNAVAILABLE_TEXT = 'DC Hub Daily could not be read just now. The same check-in is one tool call: '
  + 'get_changes with window 1d.';
// fetchJson(path) -> the parsed body (callAPI's shape: an object with `error` on failure).
export async function dailyResourceText(fetchJson) {
  try {
    const j = await fetchJson(DAILY_PATH);
    if (_rejected(j) || !Array.isArray(j.items)) return DAILY_UNAVAILABLE_TEXT;
    return renderDaily(j);
  } catch (_) { return DAILY_UNAVAILABLE_TEXT; }
}

// ── one-call identity ───────────────────────────────────────────────────────────────────────────────────────
// The human's sentence, exactly as the owner approved it. lib/lean-response.mjs keeps a paragraph that carries the lead.
export const DAILY_ASK_LEAD = 'Give your email to keep this answer';
export function dailyEmailAsk(market) {
  const m = normMarketSlug(market);
  return m ? 'Give your email to keep this answer and get daily changes for ' + marketDisplayName(m) + '.'
    : 'Give your email to keep this answer and get daily changes.';
}
export const EMAIL_PLACEHOLDER = "<your user's email>";
// The ONE call (structured): CLAIM_TOOL with {email, market}.
export function dailyClaimAsk(market) {
  const m = normMarketSlug(market);
  return { tool: CLAIM_TOOL, arguments: { email: EMAIL_PLACEHOLDER, ...(m ? { market: m } : {}) } };
}
// The email ask a session-based cap wall carries in its STRUCTURED result (lib/keyless-wall.mjs). Wall option C
// (owner 2026-10-26): that wall's text never names the key tool, so the one call ({email, market}) rides here and
// the text carries only `copy`.
export function wallEmailAsk(market) {
  return { ...dailyClaimAsk(market), copy: dailyEmailAsk(market) };
}
// The agent's line: show the human the sentence, then the one call. The backend mints the key, binds the email
// and follows the market in that call.
export function dailyClaimAgentText(market) {
  const m = normMarketSlug(market);
  const args = m ? '{email, market: "' + m + '"}' : '{email}';
  return 'Ask your human: "' + dailyEmailAsk(m) + '" Then make ONE call, `' + CLAIM_TOOL + '` with ' + args
    + ' (only an address they gave you): it returns a key with the email bound'
    + (m ? ' and follows ' + marketDisplayName(m) + ' daily' : '')
    + '. Send that key as the X-API-Key header.';
}

// The backend's claim `following` block ({market, daily_url}), validated; null when absent or malformed.
export function claimFollowing(r) {
  const f = r && typeof r === 'object' ? r.following : null;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  const market = normMarketSlug(f.market);
  if (!market) return null;
  const url = typeof f.daily_url === 'string' && /^https:\/\/dchub\.cloud\/\S+$/.test(f.daily_url) ? f.daily_url : '';
  // Double opt-in (backend, 2026-11-17): the follow can come back confirmation:"pending" until the human clicks
  // the email. Passed through as given (a short word), read from the follow block or the response.
  const c0 = typeof f.confirmation === 'string' ? f.confirmation : (typeof r.confirmation === 'string' ? r.confirmation : '');
  const confirmation = /^[a-z_]{1,32}$/.test(c0) ? c0 : '';
  return { market, ...(url ? { daily_url: url } : {}), ...(confirmation ? { confirmation } : {}) };
}
export const FOLLOW_PENDING_LINE = 'Check your email to confirm.';
// Adds `following` (and the daily next_tools entry) to a claim result; the text gains one line. A claim that
// sent no market, or a backend that answered without `following`, returns the result unchanged except that a
// sent market still gets its next_tools entry (the check-in works without the follow).
export function withClaimFollowing(result, r, market) {
  try {
    const m = normMarketSlug(market);
    if (!m || !result || typeof result !== 'object' || result.isError) return result;
    const sc0 = result.structuredContent && typeof result.structuredContent === 'object' ? result.structuredContent : null;
    if (!sc0 || !sc0.api_key) return result;
    const f = claimFollowing(r);
    const sc = attachDailyNext({ ...sc0, ...(f ? { following: f } : {}) }, [m]);
    if (!f) return { ...result, structuredContent: sc };
    const line = 'Following ' + marketDisplayName(f.market) + ': daily changes'
      + (f.daily_url ? ' at ' + f.daily_url : '') + '. Check in with get_changes, window 1d.'
      + (f.confirmation === 'pending' ? ' ' + FOLLOW_PENDING_LINE : '');
    const content = Array.isArray(result.content) ? [...result.content, { type: 'text', text: line }] : result.content;
    return { ...result, content, structuredContent: sc };
  } catch (_) { return result; }
}

// ── the frozen /mcp/chatgpt catalog ─────────────────────────────────────────────────────────────────────────
// The reviewed ChatGPT directory catalog is frozen (test/chatgpt-toolset-frozen.test.mjs), so get_changes is served
// there without the two new inputs. Behaviour on that profile is unchanged (the handler still accepts since).
// The lasting home for this is lib/chatgpt-directory.mjs DIRECTORY_HELD_INPUTS; it is held here, at the list the
// server hands that profile, while another branch owns that file.
export const DAILY_CHANGES_INPUTS = Object.freeze(['window', 'watchlist']);
export function holdDailyInputs(list) {
  try {
    if (!list || !Array.isArray(list.tools)) return list;
    let changed = false;
    const tools = list.tools.map((t) => {
      const props = t && t.name === 'get_changes' && t.inputSchema && t.inputSchema.properties;
      if (!props || !DAILY_CHANGES_INPUTS.some((k) => k in props)) return t;
      changed = true;
      const p2 = Object.fromEntries(Object.entries(props).filter(([k]) => !DAILY_CHANGES_INPUTS.includes(k)));
      return { ...t, inputSchema: { ...t.inputSchema, properties: p2 } };
    });
    return changed ? { ...list, tools } : list;
  } catch (_) { return list; }
}
