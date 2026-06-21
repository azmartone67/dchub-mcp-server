/**
 * MPP gateway hook — PURE (no mppx import). Talks to the MPP sidecar over HTTP
 * so the live MCP gateway never takes on mppx's dep tree (it conflicts) and
 * stays the safe live earner.
 *
 * FULLY DARK unless BOTH MPP_ENABLED=1 and MPP_SIDECAR_URL are set —
 * mppEnabled() short-circuits every path otherwise, so importing this file is a
 * no-op for the running gateway until an operator flips it on.
 *
 * Deep tier only ($0.50 = fiat SPT minimum): analyze_site, compare_sites,
 * site reports. Constants mirror mppx's Mcp module (hardcoded so we don't import it).
 */
export const MPP_CRED_KEY         = 'org.paymentauth/credential';
export const MPP_RECEIPT_KEY      = 'org.paymentauth/receipt';
export const MPP_PAYMENT_REQUIRED = -32042;   // mppx Mcp.paymentRequiredCode
export const MPP_PAYMENT_FAILED   = -32043;   // mppx Mcp.paymentVerificationFailedCode

const MPP_PRICE = {
  analyze_site: '0.50', compare_sites: '0.50',
  get_site_capacity_report: '0.50', get_developer_brief: '0.50',
  site_selection_canvas: '0.50',
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
