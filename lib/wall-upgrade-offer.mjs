// wall-upgrade-offer.mjs — owner 2026-11-05 ($10 credits or Pro on every wall).
//
// Jonathan ([t1032u]/[t1033u]): every quota / entitlement wall must offer the
// $10 1,000-Credit Pack (plan metered) and/or Pro ($99/mo). Credits add usage
// capacity ONLY — they do not unlock Pro-only tools. pro_wall / lp_wall lead
// with Pro and mention the pack as extra usage on covered tools.
//
// Pure module: the server hands in already-signed checkout URLs (or pricing
// fallbacks). Directory / public listing copy stays plan/price free; this
// module is ONLY for wall upgrade surfaces.

export const PACK_PRICE = '$10';
export const PACK_NAME = '1,000-Credit Pack';
export const PACK_CREDITS = '1,000';
export const PRO_NAME = 'Pro';
export const PRO_PRICE = '$99/mo';
export const PRICING_URL = 'https://dchub.cloud/pricing';

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

/**
 * Structured upgrade_options for a wall response.
 * @param {{ packUrl?: string, proUrl?: string, kind?: string, keyless?: boolean, emailUrl?: string }} o
 */
export function wallUpgradeOptions(o = {}) {
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
      label: `${PRO_NAME} — opens this tool`,
      price: PRO_PRICE,
      plan: 'pro',
      url: proUrl,
      unlocks: 'pro_only_tools',
    });
    options.push({
      id: 'metered',
      label: `${PACK_PRICE} ${PACK_NAME} — extra usage on covered tools`,
      price: PACK_PRICE,
      plan: 'metered',
      url: packUrl,
      unlocks: 'usage_capacity_only',
      note: 'Credits do not unlock Pro-only tools.',
    });
  } else {
    options.push({
      id: 'metered',
      label: `${PACK_PRICE} ${PACK_NAME}`,
      price: PACK_PRICE,
      plan: 'metered',
      url: packUrl,
      unlocks: 'usage_capacity_only',
      note: 'Credits add API usage capacity; they do not unlock Pro-only tools.',
    });
    options.push({
      id: 'pro',
      label: `${PRO_NAME} (${PRO_PRICE})`,
      price: PRO_PRICE,
      plan: 'pro',
      url: proUrl,
      unlocks: 'pro_only_tools',
    });
  }
  return options;
}

/** One-line agent/human upgrade sentence. */
export function wallUpgradeLine({ kind = 'usage', packUrl = '', proUrl = '', tool = '' } = {}) {
  const pack = packUrl || PRICING_URL;
  const pro = proUrl || (PRICING_URL + '#pro');
  const toolBit = tool ? ` (\`${tool}\`)` : '';
  if (isFeatureWall(kind)) {
    return `This tool${toolBit} needs ${PRO_NAME} (${PRO_PRICE}): ${pro}. `
      + `If you only need extra usage on tools your current plan already covers, `
      + `the ${PACK_PRICE} ${PACK_NAME} adds API capacity (credits do not unlock Pro-only tools): ${pack}.`;
  }
  return `Top up with the ${PACK_PRICE} ${PACK_NAME} (1,000 API credits, usage capacity only): ${pack}. `
    + `Or choose ${PRO_NAME} (${PRO_PRICE}) for Pro-only tools and a higher daily allowance: ${pro}. `
    + `Credits do not unlock Pro-only tools.`;
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
    sc.credits_url = packUrl || sc.credits_url || PRICING_URL;
    sc.pro_url = proUrl || sc.pro_url || (PRICING_URL + '#pro');
    if (keyless && emailUrl) {
      sc.email_unlock_url = emailUrl;
      if (typeof markAsk === 'function') markAsk(keyless ? 'link' : 'line');
    }
    // Keep existing human_url (email unlock) as the primary relay when keyless;
    // otherwise prefer Pro on feature walls and the pack on usage walls.
    if (!sc.human_url) {
      sc.human_url = (isFeatureWall(kind) ? (proUrl || packUrl) : (packUrl || proUrl)) || PRICING_URL;
    }
    const out = { ...result, structuredContent: sc };
    if (Array.isArray(result.content) && result.content.length) {
      const askBlock = {
        type: 'text',
        text: '\n\n💳 **Upgrade:** ' + line,
      };
      // Avoid duplicating if a prior pass already attached the $10/Pro line.
      const joined = result.content.map((b) => (b && b.text) || '').join('\n');
      if (!/\$10\b/.test(joined) || !/\bPro\b/.test(joined)) {
        out.content = [...result.content, askBlock];
      }
    }
    return out;
  } catch (_) {
    return result;
  }
}
