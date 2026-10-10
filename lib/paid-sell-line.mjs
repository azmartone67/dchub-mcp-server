// paid-sell-line.mjs: the one human sentence for a keyless preview of get_market_intel,
// compare_isos and rank_markets (the line points at the plans page, never names the pack as the unlock), and the honest Pro line for the
// two Pro-only walls, analyze_site and compare_sites.
// Owner-approved 2026-10-04 (batch 1 item 3), DCHUB_PAID_SELL_LINE, default OFF. Pure.
//
// Every field a sentence names comes from the gate's own evidence: a `_x_in_pro === true`
// marker, a `_x_total_in_pro` count, or the "this answer hid ..." list the gate wrote. A
// field in none of those is never named. A builder returns null when it has nothing honest
// to say, and the caller keeps the line it had.
// Copy rules: no em dashes, no monthly prices, the pack is never named as what returns fields (canon 2026-10-04).
import { GRID_SELL_MAX, placeLabel } from './grid-sell-line.mjs';
import { PACK_PRICE } from './canon.mjs';

export const PAID_SELL_TOOLS = new Set(['get_market_intel', 'compare_isos', 'rank_markets']);
export const PRO_WALL_TOOLS = new Set(['analyze_site', 'compare_sites']);

const TAIL = '. The plans that include the full %s are on this page: ';

function list(xs) {
  if (xs.length <= 1) return xs.join('');
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}
// Shorten the hidden-field list, never the price or the link.
function fit(lead, items, tail) {
  let n = items.slice();
  while (n.length > 1 && (lead + list(n) + tail).length > GRID_SELL_MAX) n = n.slice(0, -1);
  return list(n);
}
const has = (hid, re) => Array.isArray(hid) && hid.some((h) => re.test(h));

/** @param hid the gate's own "hid ..." phrases, split on commas and "and". */
export function parseHidList(s) {
  if (typeof s !== 'string') return [];
  return s.replace(/\([^)]*\)/g, (m) => m.replace(/,/g, '')).split(/,\s*|\s+and\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

export function marketIntelSellLine({ market, hid, providersTotal, providersShown, timeToPower, url }) {
  const m = placeLabel(market);
  if (!m || !url) return null;
  const items = [];
  if (has(hid, /^total mw$/)) items.push('its total MW');
  if (timeToPower === true) items.push('time to power');
  const t = Number.isFinite(providersTotal) ? providersTotal : null;
  const s = Number.isFinite(providersShown) ? providersShown : 3;
  if (t !== null && t > s) items.push((t - s) + ' of the top ' + t + ' providers');
  if (!items.length) return null;
  const lead = 'This free DC Hub preview of the ' + m + ' market hides ';
  const tail = TAIL.replace('%s', m + ' market brief');
  return lead + fit(lead, items, tail) + tail + url;
}

export function compareIsosSellLine({ isos, perIso, url }) {
  if (!Array.isArray(isos) || !isos.length || !Array.isArray(perIso) || !perIso.length || !url) return null;
  const every = (k) => perIso.every((o) => o && o['_' + k + '_in_pro'] === true);
  const items = [];
  if (every('avg_time_to_power_months')) items.push("each grid's time to power");
  if (every('queue_depth_gw')) items.push('queue depth');
  if (every('headroom')) items.push('headroom');
  const c = every('constraint_score'), e = every('excess_power_score');
  if (c && e) items.push('the constraint and excess power scores');
  else if (c) items.push('the constraint score');
  else if (e) items.push('the excess power score');
  if (every('grid_emergencies_30d')) items.push('30-day grid emergencies');
  if (!items.length) return null;
  const names = isos.map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z][A-Z-]{1,11}$/.test(x));
  if (!names.length) return null;
  const lead = 'This free DC Hub comparison of ' + list(names) + ' hides ';
  const tail = TAIL.replace('%s', 'comparison');
  return lead + fit(lead, items, tail) + tail + url;
}

const CRITERIA = { best_overall: 'best overall', cheapest_power: 'cheapest power', ai_ready: 'AI-ready' };
const REGION = { us: 'US', global: 'global', eu: 'EU' };
export function rankMarketsSellLine({ criteria, region, total, shown, scoreHidden, mwHidden, url }) {
  const c = CRITERIA[criteria], r = REGION[region];
  if (!c || !r || !url || !(total > shown) || !(scoreHidden || mwHidden)) return null;
  const hides = scoreHidden && mwHidden ? "each market's score and total MW"
    : scoreHidden ? "each market's score" : "each market's total MW";
  return 'This free DC Hub ' + c + ' ranking of ' + r + ' markets shows ' + shown + ' of ' + total
    + ' and hides ' + hides + TAIL.replace('%s', 'ranking') + url;
}

/** 3b: no price, no free offer beside it. `url` is the relay link as the wall sent it. */
export function proWallLine(tool, url) {
  if (!url) return null;
  if (tool === 'analyze_site') {
    return 'DC Hub returns no site data without a key. This site\'s verdict, 0-100 score, power, gas, fiber, market and risk scores, nearby substations and power cost are in DC Hub\'s paid plan: ' + url;
  }
  if (tool === 'compare_sites') {
    return 'DC Hub returns no comparison data without a key. Each site\'s verdict, 0-100 score, sub-scores, nearby substations, power cost and the recommended winner are in DC Hub\'s paid plan: ' + url;
  }
  return null;
}

function _repeatLink(link) {
  return link ? ' If they missed it, the one-click ' + PACK_PRICE + ' link is: ' + link : '';
}
/** The agent line that replaces the 🔒 header. Repeat: the human line went earlier this session. */
export function paidAgentLine(tool, withheldCount, repeat = false, link = '', pointer = 'continuation.gated.fields_unlocked') {
  const n = Number.isFinite(withheldCount) && withheldCount > 0 ? withheldCount + ' fields are' : 'some fields are';
  if (repeat) {
    return tool + ' returned a free preview. Your user was sent the full ask earlier in this session. After they pay, call '
      + tool + ' again in this session for the full answer.' + _repeatLink(link);
  }
  return tool + ' returned a free preview: ' + n + ' withheld (see ' + pointer + '). Show your user the next line unchanged, including its link. After they pay, call '
    + tool + ' again in this session for the full answer.';
}
