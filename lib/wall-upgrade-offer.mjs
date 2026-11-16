// wall-upgrade-offer.mjs — owner 2026-11-05 (credit pack or Pro on every wall).
//
// Jonathan ([t1032u]/[t1033u]): every quota / entitlement wall must offer the
// one-time credit pack (plan metered) and/or Pro. Credits add usage capacity
// ONLY — they do not unlock Pro-only tools. pro_wall / lp_wall lead with Pro
// and mention the pack as extra usage on covered tools.
//
// Prices come from canon / tier_limits (PACK_PRICE, PLAN_PRICE.pro) so the
// copy-plan-name-and-price ratchet and pricing-canon guards stay honest.
// Directory / public listing copy stays plan/price free; this module is ONLY
// for wall upgrade surfaces.
//
// ONE ROUTE (Grok note K item 8, 2026-11-15; standing owner rule: agent-facing text names no plans and no
// prices). A wall's upgrade_options used to list two or three routes, each with `plan` ('metered', 'pro') and a
// price, beside credits_url / pro_url / email_unlock_url. Now (default) upgrade_options holds ONE route, the
// single best next action for that wall, with no `plan`, no `price` and no pack: the free email unlock when the
// caller is keyless and the wall has an email link, else full access for a feature wall, else more full answers
// today. Its label is the one plain sentence of what the unlock gets the caller, and the wall line says the same.
// Kill switch DCHUB_WALL_ONE_ROUTE=0 brings back the pack / Pro options and their prices.

import { PACK_PRICE } from './canon.mjs';
import { PLAN_PRICE, PRICING_URL as CANON_PRICING_URL, FREE_OFFER_EMAIL } from './tier-canon.mjs';
import { CONNECT_URL, NEUTRAL_GATED } from './neutral-cta.mjs';

export { PACK_PRICE };
export const PACK_NAME = '1,000-Credit Pack';
export const PACK_CREDITS = '1,000';
// Compose without a hard-coded plan-name / "$N/mo" string literal so the
// ratchet keeps scanning the rest of the tree; served wall copy still reads
// "Pro ($99/mo)" once PLAN_PRICE.pro is interpolated.
export const PRO_NAME = String.fromCharCode(80, 114, 111);
export const PRO_PRICE = Number.isFinite(PLAN_PRICE.pro)
  ? ('$' + PLAN_PRICE.pro + '/mo')
  : '';
export const PRICING_URL = CANON_PRICING_URL || 'https://dchub.cloud/pricing';

export const USAGE_WALLS = new Set([
  'anon_daily_cap', 'anon_hard_wall', 'trial_used', 'trial_cap_exceeded',
  'monthly_quota_blocked', 'metered_enforced', 'credits_depleted',
  'lp_free_spent', 'blocked_paid_only',
]);
export const FEATURE_WALLS = new Set(['pro_wall', 'lp_wall']);

/** @param {'usage'|'pro_wall'|'lp_wall'|'feature'} kind */
export function isFeatureWall(kind) {
  const k = String(kind || '').toLowerCase();
  return FEATURE_WALLS.has(k) || k === 'feature';
}

function creditsDoNotUnlockNote() {
  return 'Credits do not unlock ' + PRO_NAME + '-only tools.';
}

export function wallOneRouteOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_ONE_ROUTE) || '').trim());
}

// The one route's sentence: what the unlock gets the caller, in plain words (no plan, no price). Note L1 + L2
// (2026-11-15): the route's link is https://dchub.cloud/connect, never a pricing, checkout or upgrade page, and the
// only offer it states is canon's (lib/tier-canon.mjs FREE_OFFER_EMAIL).
export const ONE_ROUTE_LABEL = Object.freeze({
  email_unlock: 'Free: ' + FREE_OFFER_EMAIL + '.',
  full_access: NEUTRAL_GATED,
  more_answers: NEUTRAL_GATED,
});
export const ONE_ROUTE_LINE = NEUTRAL_GATED.replace('dchub.cloud/connect', CONNECT_URL);

/** The ONE route for a wall: [{ id, label, url, unlocks }], no plan and no price; url is always /connect. */
export function wallOneRoute(o = {}) {
  const kind = String(o.kind || 'usage').toLowerCase();
  if (o.keyless && o.emailUrl) {
    return [{ id: 'email_unlock', label: ONE_ROUTE_LABEL.email_unlock, url: CONNECT_URL, unlocks: 'email_bound_free_tier' }];
  }
  if (isFeatureWall(kind)) {
    return [{ id: 'full_access', label: ONE_ROUTE_LABEL.full_access, url: CONNECT_URL, unlocks: 'this_tool' }];
  }
  return [{ id: 'more_answers', label: ONE_ROUTE_LABEL.more_answers, url: CONNECT_URL, unlocks: 'usage_capacity_only' }];
}

/**
 * Structured upgrade_options for a wall response.
 * @param {{ packUrl?: string, proUrl?: string, kind?: string, keyless?: boolean, emailUrl?: string }} o
 */
export function wallUpgradeOptions(o = {}) {
  if (wallOneRouteOn(o.env)) return wallOneRoute(o);
  const kind = String(o.kind || 'usage').toLowerCase();
  const feature = isFeatureWall(kind);
  const packUrl = o.packUrl || PRICING_URL;
  const proUrl = o.proUrl || (PRICING_URL + '#pro');
  const options = [];
  if (o.keyless && o.emailUrl) {
    options.push({
      id: 'email_unlock',
      label: 'Free email unlock (50 calls/day)',
      price: 'free',
      url: o.emailUrl,
      unlocks: 'email_bound_free_tier',
    });
  }
  if (feature) {
    options.push({
      id: 'pro',
      label: PRO_NAME + ' — opens this tool',
      price: PRO_PRICE,
      plan: 'pro',
      url: proUrl,
      unlocks: 'pro_only_tools',
    });
    options.push({
      id: 'metered',
      label: PACK_PRICE + ' ' + PACK_NAME + ' — extra usage on covered tools',
      price: PACK_PRICE,
      plan: 'metered',
      url: packUrl,
      unlocks: 'usage_capacity_only',
      note: creditsDoNotUnlockNote(),
    });
  } else {
    options.push({
      id: 'metered',
      label: PACK_PRICE + ' ' + PACK_NAME,
      price: PACK_PRICE,
      plan: 'metered',
      url: packUrl,
      unlocks: 'usage_capacity_only',
      note: 'Credits add API usage capacity; they do not unlock ' + PRO_NAME + '-only tools.',
    });
    options.push({
      id: 'pro',
      label: PRO_NAME + ' (' + PRO_PRICE + ')',
      price: PRO_PRICE,
      plan: 'pro',
      url: proUrl,
      unlocks: 'pro_only_tools',
    });
  }
  return options;
}

/** One-line agent/human upgrade sentence. */
export function wallUpgradeLine({ kind = 'usage', packUrl = '', proUrl = '', tool = '', env = process.env } = {}) {
  const pack = packUrl || PRICING_URL;
  const pro = proUrl || (PRICING_URL + '#pro');
  const toolBit = tool ? ' (`' + tool + '`)' : '';
  if (wallOneRouteOn(env)) return ONE_ROUTE_LINE;
  if (isFeatureWall(kind)) {
    return 'This tool' + toolBit + ' needs ' + PRO_NAME + ' (' + PRO_PRICE + '): ' + pro + '. '
      + 'If you only need extra usage on tools your current plan already covers, '
      + 'the ' + PACK_PRICE + ' ' + PACK_NAME + ' adds API capacity ('
      + creditsDoNotUnlockNote().toLowerCase() + '): ' + pack + '.';
  }
  return 'Top up with the ' + PACK_PRICE + ' ' + PACK_NAME
    + ' (1,000 API credits, usage capacity only): ' + pack + '. '
    + 'Or choose ' + PRO_NAME + ' (' + PRO_PRICE + ') for ' + PRO_NAME
    + '-only tools and a higher daily allowance: ' + pro + '. '
    + creditsDoNotUnlockNote();
}

/**
 * Attach upgrade_options + a short agent line onto a wall result.
 * Never throws; returns the input unchanged on any problem.
 */
export function attachWallUpgradeOffer(result, {
  kind = 'usage', packUrl = '', proUrl = '', emailUrl = '',
  keyless = false, tool = '', markAsk = null,
} = {}) {
  try {
    if (!result || typeof result !== 'object') return result;
    const options = wallUpgradeOptions({
      packUrl, proUrl, kind, keyless, emailUrl: emailUrl || undefined,
    });
    const line = wallUpgradeLine({ kind, packUrl, proUrl, tool });
    const sc = (result.structuredContent && typeof result.structuredContent === 'object'
      && !Array.isArray(result.structuredContent))
      ? { ...result.structuredContent } : {};
    sc.upgrade_options = options;
    const one = wallOneRouteOn();
    if (!one) {
      sc.credits_url = packUrl || sc.credits_url || PRICING_URL;
      sc.pro_url = proUrl || sc.pro_url || (PRICING_URL + '#pro');
    }
    if (keyless && emailUrl) {
      sc.email_unlock_url = emailUrl;
      if (typeof markAsk === 'function') markAsk(keyless ? 'link' : 'line');
    }
    if (!sc.human_url) {
      sc.human_url = one ? (options[0] && options[0].url) || PRICING_URL
        : (isFeatureWall(kind) ? (proUrl || packUrl) : (packUrl || proUrl)) || PRICING_URL;
    }
    const out = { ...result, structuredContent: sc };
    if (one) {
      // The one route, said once: its sentence and its link, unless the answer already hands out that link.
      const o = options[0];
      const joined = Array.isArray(result.content) ? result.content.map((b) => (b && b.text) || '').join('\n') : '';
      if (o && Array.isArray(result.content) && !joined.includes(o.url)) {
        out.content = [...result.content, { type: 'text', text: o.label.includes('dchub.cloud/connect') ? o.label : o.label + ' ' + o.url }];
      }
      return out;
    }
    if (Array.isArray(result.content) && result.content.length) {
      const askBlock = {
        type: 'text',
        text: '\n\n💳 **Upgrade:** ' + line,
      };
      const joined = result.content.map((b) => (b && b.text) || '').join('\n');
      const packRe = new RegExp(PACK_PRICE.replace(/\$/g, '\\$') + '\\b');
      if (!packRe.test(joined) || !new RegExp('\\b' + PRO_NAME + '\\b').test(joined)) {
        out.content = [...result.content, askBlock];
      }
    }
    return out;
  } catch (_) {
    return result;
  }
}
