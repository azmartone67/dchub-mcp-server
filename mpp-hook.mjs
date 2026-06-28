/**
 * MPP gateway hook — PURE (no mppx import). Talks to the MPP sidecar over HTTP
 * so the live MCP gateway never takes on mppx's dep tree (it conflicts) and
 * stays the safe live earner.
 *
 * FULLY DARK unless BOTH MPP_ENABLED=1 and MPP_SIDECAR_URL are set —
 * mppEnabled() short-circuits every path otherwise, so importing this file is a
 * no-op for the running gateway until an operator flips it on.
 *
 * Priced at the $0.50 fiat SPT minimum. Covers the deep tier (analyze_site,
 * compare_sites, site reports) PLUS the high-traffic flagship value-moment tools
 * (get_grid_intelligence, get_fiber_intel, get_market_intel) — where the bulk of
 * paywall hits land — so the live fiat rail and real demand actually overlap.
 * Constants mirror mppx's Mcp module (hardcoded so we don't import it).
 */
export const MPP_CRED_KEY         = 'org.paymentauth/credential';
export const MPP_RECEIPT_KEY      = 'org.paymentauth/receipt';
export const MPP_PAYMENT_REQUIRED = -32042;   // mppx Mcp.paymentRequiredCode
export const MPP_PAYMENT_FAILED   = -32043;   // mppx Mcp.paymentVerificationFailedCode

const MPP_PRICE = {
  analyze_site: '0.50', compare_sites: '0.50',
  get_site_capacity_report: '0.50', get_developer_brief: '0.50',
  site_selection_canvas: '0.50',
  // r-mpp-flagships (2026-06-28): extend the LIVE fiat rail onto the high-traffic
  // value-moment tools (~4,540 paywall hits/30d landed here) — previously assigned
  // ONLY to the DARK x402 rail, so the working agent-pay rail and real demand never
  // overlapped. Priced at the $0.50 Stripe SPT fiat minimum (x402's $0.10 is USDC,
  // which has no fiat floor — a sub-$0.50 SPT would be rejected by Stripe).
  get_grid_intelligence: '0.50', get_fiber_intel: '0.50', get_market_intel: '0.50',
};
const MPP_TOOLS = new Set(Object.keys(MPP_PRICE));

export function mppEnabled() {
  return process.env.MPP_ENABLED === '1' && !!(process.env.MPP_SIDECAR_URL || '').trim();
}
export function isMppTool(name) { return MPP_TOOLS.has(name); }
export function mppPrice(name) { return MPP_PRICE[name] || '0.50'; }

/** Pull an SPT credential out of the MCP request _meta (the SDK handler's `extra` arg). */
export function mppCredential(extra) {
  const m = extra && (extra._meta || extra.meta || (extra.requestInfo && extra.requestInfo._meta));
  const v = m && m[MPP_CRED_KEY];
  return (typeof v === 'string' || (v && typeof v === 'object')) ? v : null;
}

async function _post(path, payload, ms = 8000) {
  const base = (process.env.MPP_SIDECAR_URL || '').replace(/\/+$/, '');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(base + path, {
      method: 'POST', signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        ...(process.env.MPP_SIDECAR_TOKEN ? { 'x-mpp-token': process.env.MPP_SIDECAR_TOKEN } : {}),
      },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Build the JSON-RPC -32042 payment-required error (with challenge) for an unpaid MPP tool. null on sidecar failure → caller falls back to the normal depth-tease. */
export async function mppChallengeError(name) {
  try {
    const j = await _post('/mpp/challenge', { tool: name, amount: mppPrice(name) });
    if (!j || !j.ok || !j.challenge) return null;
    return {
      code: MPP_PAYMENT_REQUIRED,
      message: `Payment required: $${j.price_usd} to call ${name} (DC Hub deep-tier).`,
      data: { httpStatus: 402, challenges: [j.challenge], price_usd: j.price_usd, tool: name },
    };
  } catch { return null; }
}

/** Verify+settle a presented SPT via the sidecar. {ok:true, receipt} | {ok:false, error}. */
export async function mppVerify(name, credential) {
  try {
    const j = await _post('/mpp/verify', { tool: name, amount: mppPrice(name), credential });
    return j && j.ok ? { ok: true, receipt: j.receipt }
                     : { ok: false, error: (j && j.error) || 'verification failed' };
  } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 160) }; }
}

/**
 * Per-call opt-in: did the agent ask for an MPP payment challenge on THIS call?
 * Lets an MPP-capable agent get a 402 challenge without the global MPP_HARD_GATE —
 * so humans (who never set this) keep their normal trial/preview funnel.
 */
export function mppWantsChallenge(extra, args) {
  const m = (extra && (extra._meta || extra.meta || (extra.requestInfo && extra.requestInfo._meta))) || {};
  return !!(m.mpp_pay || m['org.paymentauth/pay'] || (args && args.mpp_pay));
}

/**
 * SOFT-ADVERTISE hint to embed in a deep-tool tease/preview's structuredContent.
 * Purely informational + SYNC (no sidecar call) — tells an MPP-capable agent it can
 * pay per-call, and exactly how. Returns null unless MPP is live AND it's an MPP tool,
 * so it never appears for non-MPP tools or when MPP is off.
 */
export function mppAdvertiseHint(name) {
  if (!mppEnabled() || !isMppTool(name)) return null;
  const price = mppPrice(name);
  return {
    protocol: 'stripe-mpp',
    price_usd: price,
    machine_payable: true,
    note: `Machine-payable: pay $${price} for this single \`${name}\` call (no key, no subscription) via Stripe MPP — a Shared Payment Token — to unlock the full result.`,
    how: `Step 1: retry this exact call with _meta.mpp_pay=true to receive a payment challenge (in structuredContent.payment_required). Step 2: mint a Shared Payment Token from that challenge and retry once more with it in _meta[${JSON.stringify(MPP_CRED_KEY)}] — you get full data + a payment receipt.`,
    credential_meta_key: MPP_CRED_KEY,
  };
}
