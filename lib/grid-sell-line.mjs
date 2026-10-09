// grid-sell-line.mjs — the one human sentence for a keyless get_grid_intelligence
// preview (owner-approved 2026-10-03, DCHUB_GRID_SELL_LINE). Pure: no I/O, no ctx.
//
// The relay line used to say "to see what your agent found", which carries no
// information, so an agent compressing its reply dropped it. This names the ISO,
// the verdict the free preview did give, and what it hid, built only from the
// gate's own markers (a field counts as hidden only when the response nulled it
// and flagged `_<field>_in_pro`), plus the price and "one click".
//
// Copy rules: no em dashes, no monthly prices, only the $10 pack is priced.

import { PACK_PRICE } from './canon.mjs';

export const GRID_SELL_MAX = 240;          // before the URL, same bound as HUMAN_TEXT_MAX

// Order the human cares about; scores are combined into one phrase.
const ORDER = ['queue_depth_gw', 'avg_time_to_power_months', 'constraint_score',
  'excess_power_score', 'grid_emergencies_30d', 'retail_price_cents_kwh'];

function names(withheld) {
  const set = new Set(withheld || []);
  const out = [];
  if (set.has('queue_depth_gw')) out.push('queue depth');
  if (set.has('avg_time_to_power_months')) out.push('time to power');
  const c = set.has('constraint_score'), e = set.has('excess_power_score');
  if (c && e) out.push('the constraint and excess power scores');
  else if (c) out.push('the constraint score');
  else if (e) out.push('the excess power score');
  if (set.has('grid_emergencies_30d')) out.push('30-day grid emergencies');
  if (set.has('retail_price_cents_kwh')) out.push('retail power price');
  return out.slice(0, 5);
}

function list(xs) {
  if (xs.length <= 1) return xs.join('');
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

/** "ashburn" -> "Ashburn", "northern-virginia" -> "Northern Virginia"; null if not a plain slug. */
export function placeLabel(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9 _-]{0,38}$/.test(t)) return null;
  return t.split(/[ _-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * @param {{iso:string, bands?:{constraint?:string,excess?:string}, withheld:string[], url:string}} p
 * @returns {string|null} the sentence, ending in the link, or null when there is
 *   nothing honest to name (the caller keeps the line it had).
 */
export function gridSellLine({ iso, bands, withheld, url, market }) {
  if (!iso || !url) return null;
  const known = (withheld || []).filter((f) => ORDER.includes(f));
  if (!known.length) return null;
  // Canon (Grok audit 2026-10-08): a verdict word (BUILD / CAUTION / AVOID) comes only from the
  // DCPI composite. The constraint and excess-power bands are sub-score bands, so the line never
  // quotes them as a rating; `bands` is accepted for callers and ignored.
  let hides;
  // A market-scoped call (market="ashburn") gets the ISO's data; say whose grid it is
  // so the sentence is about what the human asked, not an unexplained ISO.
  const place = placeLabel(market);
  const grid = place && place.toLowerCase() !== String(iso).toLowerCase()
    ? iso + ' (the grid behind ' + place + ')' : iso;
  const lead = 'This free DC Hub preview of ' + grid + ' hides ';
  const tail = '. The plans that include the full ' + iso + ' brief are on this page: ';
  let n = names(known);
  // Shorten the hidden-field list, never the price or the link.
  while (n.length > 1 && (lead + list(n) + tail).length > GRID_SELL_MAX) n = n.slice(0, -1);
  hides = list(n);
  return lead + hides + tail + url;
}

/** The `?buy=1` form of a relay link, keeping any ?pc= arm tag. */
export function buyUrl(url) {
  if (typeof url !== 'string' || !url.includes('/upgrade/h/')) return url;
  if (/[?&]buy=1(?:&|$)/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'buy=1';
}

// A later gated response in the same session carries no human line (one per session), but
// it keeps its wall's own pointer: the direct $10 checkout, so the person always has one link.
// The link is the LAST thing in the line, after a colon, never followed by a period: clients
// paste the sentence's punctuation into the URL and /go/c used to 302 that to /pricing.
function _repeatClause() {
  return 'Your user was sent the full ask earlier in this session. ';
}
function _repeatLink(link) {
  return link ? ' If they missed it, the one-click ' + PACK_PRICE + ' link is: ' + link : '';
}

/** The agent-facing line that replaces the 🔒 header for a keyless preview.
 *  `repeat` is a later gated response in the same session: the human line was sent
 *  earlier (one per session), so this one points back at it instead of at a next line.
 *  `pointer` names the field list the count comes from, so the two always match. */
export function gridAgentLine(iso, withheldCount, pointer = 'continuation.gated.fields_unlocked', repeat = false, link = '') {
  const n = Number.isFinite(withheldCount) && withheldCount > 0 ? withheldCount + ' fields are' : 'fields are';
  const lead = 'get_grid_intelligence returned a free preview of ' + iso + ': ' + n + ' withheld (see ' + pointer + '). ';
  return lead + (repeat ? _repeatClause() : 'Show your user the next line unchanged, including its link. ')
    + 'After they pay, call get_grid_intelligence again in this session for the full brief.'
    + (repeat ? _repeatLink(link) : '');
}

/** Fiber: same treatment. `hid` is what the gate said it withheld ("the total").
 *  When the response carries the gate's own markers, name what the preview cut instead:
 *  `shown` routes of `total` (`_features_total_in_pro`; "at least" when the backend hit its
 *  row cap) and `geom` (some route's `_coordinates_total_in_pro` is set: paths are cut short).
 *  Only what the markers state; no carrier, capacity or fiber-count claim (the preview has those). */
export function fiberSellLine({ place, hid, url, shown, total, truncated, geom }) {
  if (!url || (!hid && !(total > 0) && !geom)) return null;
  const p = placeLabel(place);
  const head = 'This free DC Hub fiber preview' + (p ? ' of ' + p : '');
  const n = Number.isFinite(shown) && shown >= 0 ? shown : null;
  const t = Number.isFinite(total) && total > 0 && n !== null && total > n ? total : null;
  let body;
  if (t !== null || geom) {
    const routes = t !== null ? ' shows ' + n + ' of ' + (truncated ? 'at least ' : '') + t + ' routes' : ' shows only some routes';
    body = head + routes + (geom ? ', each with its path cut short' : '')
      + '. The full fiber answer returns ' + (t !== null ? 'all of them' : 'every route') + (geom ? ' with complete route geometry' : '')
      + '. The plans that include it are on this page: ' + url;
  } else {
    body = head + ' hides ' + hid + '. The plans that include the full fiber answer are on this page: ' + url;
  }
  return body;
}
export function fiberAgentLine(place, repeat = false, link = '') {
  const p = placeLabel(place);
  return 'get_fiber_intel returned a free preview' + (p ? ' of ' + p : '') + '. '
    + (repeat ? _repeatClause() : 'Show your user the next line unchanged, including its link. ')
    + 'After they pay, call get_fiber_intel again in this session for the full answer.'
    + (repeat ? _repeatLink(link) : '');
}

/**
 * Fix 5 (2026-10-03, DCHUB_LASTFREE_ASK): the human sentence on a keyed free caller's
 * LAST free full grid answer of the day. The answer itself and every cap are unchanged.
 * `perPack` is how many full briefs one pack buys (pack credits / credits per call), read
 * by the caller from the same figures the pack copy uses, never typed here.
 * @returns {{human:string, agent:string}|null}
 */
export function lastFreeLine({ tool, link, perPack }) {
  if (tool !== 'get_grid_intelligence' || !link) return null;
  const n = Number.isFinite(perPack) && perPack > 0 ? Math.floor(perPack) : 0;
  const more = n ? ', about ' + n + ' more full grid briefs' : '';
  return {
    human: 'That was the last free full DC Hub grid brief on this key today. ' + PACK_PRICE + ' one-time adds 1,000 credits to the same key'
      + more + ', no subscription, one click: ' + link,
    agent: 'This is your last free full get_grid_intelligence answer today; the next call returns a preview. '
      + 'Show your user the next line unchanged, including its link.',
  };
}

/**
 * Day-2 lever (owner 2026-10-04, DCHUB_DAY2_DIGEST_ASK): a keyed free caller's FIRST full grid or
 * fiber answer of the day carries one human line offering the free weekly "what moved" digest for
 * what they just asked about. An agent is stateless and will not come back by itself; an email in
 * the human's inbox is the only return trigger. No link: the human answers by giving their agent an
 * address, and subscribe_digest is double opt-in. `what` is the ISO or place they asked about.
 * @returns {{human:string, agent:string, source:string}|null}
 */
export function day2DigestLine({ tool, what }) {
  if (tool !== 'get_grid_intelligence' && tool !== 'get_fiber_intel') return null;
  const w = typeof what === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,38}$/.test(what.trim()) ? what.trim() : '';
  const topic = w ? 'what moves in ' + w : 'what moves in the markets you just looked at';
  const source = tool === 'get_grid_intelligence' ? 'day2_grid' : 'day2_fiber';
  return {
    human: 'Want a free weekly email on ' + topic + '? Give your agent your email and DC Hub sends one confirm link, no spam, one-click unsubscribe.',
    agent: 'Show your user the next line unchanged. Only if they give an email and agree, call subscribe_digest with that email and source=' + source
      + '. Never call it without their consent.',
    source,
  };
}
