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
import { createHash } from 'node:crypto';

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
// r-mpp-at-wall (2026-08-10): the covered list was ALSO hardcoded a second time
// inside unlock_more_data's machine_pay block, so the two could drift and an
// agent could be told a tool was payable when it was not. One source now.
export const MPP_COVERED_TOOLS = Object.freeze(Object.keys(MPP_PRICE));

/**
 * ── AGENT-PAY FUNNEL CANON (r-mpp-abandonment, 2026-08-12) ────────────────
 *
 * WHY THIS EXISTS. `mpp_challenge` records "a signed quote was ISSUED to the
 * caller". It was read everywhere — including DC Hub's own agent brief — as
 * "the agent attempted to pay". Those are different events, and the funnel had
 * no counter between them, so a quote that was issued and never came back was
 * indistinguishable from one the caller returned and failed on. Over 120d that
 * left 13 quotes and exactly 1 verify failure with no way to say whether the
 * other 12 tried and broke, or saw a price and left. The two diagnoses point at
 * opposite fixes (settlement path vs price/framing), so the gap had to become a
 * counter rather than an inference.
 *
 * THE RULE THIS ENFORCES: one status per DISTINCT event, and the status name
 * must not imply an event it does not record. Each entry below carries a BASIS
 * string naming the exact line of code that stamps it. If you add a status,
 * add its basis in the same commit — a counter without a basis is the defect
 * this block exists to prevent.
 *
 * WIRE-COMPATIBILITY: `mpp_challenge` keeps its name. It is already published
 * on /api/v1/admin/agent-pay-events and quoted externally, and renaming it
 * would silently zero every existing reader. It is aliased to the honest name
 * `quote_issued` in the published funnel instead — same rows, clearer label.
 */
export const MPP_FUNNEL_STATUS = Object.freeze({
  /** passive pre-wall offer attached to a call that SUCCEEDED */
  OFFER_PREWALL:       'mpp_offer_prewall',
  /** a signed quote was ISSUED to the caller (NOT an attempt to pay) */
  QUOTE_ISSUED:        'mpp_challenge',
  /** the caller CAME BACK and presented a credential (the missing event) */
  CREDENTIAL_RETURNED: 'mpp_credential_returned',
  /** a presented credential failed verify/settle */
  VERIFY_FAILED:       'mpp_verify_failed',
  /** a presented credential verified and settled — real money */
  PAID:                'mpp_paid',
  // ── r-mpp-receipt-replay (2026-08-12) ──────────────────────────────────
  // Two events the retry fix makes REACHABLE, and which the five statuses
  // above cannot express without lying. Added with their BASIS lines in the
  // same change, per the rule stated at the top of this block.
  //
  // NOTE ON THE KEY NAME: deliberately REPLAY_SERVED, not PAID_REPLAY. The
  // funnel-split guard anchors the PAID counter with an unanchored
  // /status\s*=\s*MPP_FUNNEL_STATUS\.PAID/ and demands exactly one hit, so any
  // key beginning "PAID" would match twice and take that guard out.
  /** an ALREADY-paid credential was re-served its original answer — no new money */
  REPLAY_SERVED:       'mpp_paid_replay',
  /** money moved, but the paid result could not be resolved — NOT a verify failure */
  REPLAY_UNRESOLVED:   'mpp_replay_unresolved',
});

/**
 * One line per counter stating EXACTLY which event increments it. Keyed by the
 * wire status so a reader can join basis→rows without a lookup table.
 */
export const MPP_FUNNEL_BASIS = Object.freeze({
  mpp_offer_prewall:
    'Increments when mppPrewallOffer() returned an offer that was attached to a SUCCESSFUL '
    + 'tool result. The caller was NOT gated and paid nothing. Passive — not pay-intent.',
  mpp_challenge:
    'Increments when the gateway MINTED and RETURNED a signed price quote (challenge) to a '
    + 'gated caller that asked for one (_meta.mpp_pay or MPP_HARD_GATE). It records ISSUANCE '
    + 'of a quote, NOT an attempt to pay. Nothing came back at this point.',
  mpp_credential_returned:
    'Increments the instant mppCredential(extra) returns non-null on a gated MPP tool call — '
    + 'i.e. the caller CAME BACK and presented a credential. Stamped BEFORE mppVerify() runs, '
    + 'so it counts the return even when the settle never reaches a terminal state.',
  mpp_verify_failed:
    'Increments when a credential WAS presented and mppVerify() returned ok:false. Strictly '
    + 'downstream of mpp_credential_returned — it cannot fire without a returned credential.',
  mpp_paid:
    'Increments when a credential WAS presented and mppVerify() returned ok:true and the '
    + 'settle was FRESH (replayed:false) — money moved now. Strictly downstream of '
    + 'mpp_credential_returned.',
  mpp_paid_replay:
    'Increments when mppVerify() returned ok:true with replayed:true — a duplicate retry of a '
    + 'call that was ALREADY paid for, re-served its original receipt. NO new money moved, so '
    + 'it is kept out of mpp_paid: counting it there would book settled revenue twice.',
  mpp_replay_unresolved:
    'Increments when mppVerify() returned ok:false with replayed:true — the payment settled '
    + '(exactly once) but the paid result could not be re-served, or the credential was spent '
    + 'on a DIFFERENT call. Kept out of mpp_verify_failed on purpose: no verification failed '
    + 'here, and a settle-failure metric must not absorb a money-moved-but-unresolved case.',
});

/**
 * Events this rail structurally CANNOT count, stated so a zero is never read as
 * a measurement. Three-valued: absent from this list means measured.
 */
export const MPP_FUNNEL_UNMEASURED = Object.freeze([
  'A credential presented on a call the gate ALLOWED (gate.allowed === true) is never counted: '
  + 'the MPP block does not execute on an ungated call, so no status is stamped. Such a caller '
  + 'gets its answer free and its return is invisible.',
  'A credential presented while the rail is dark (MPP_ENABLED unset / no sidecar) is never '
  + 'counted, for the same reason.',
  'No correlation id links a returned credential to the quote that produced it — challenge.id '
  + 'is not persisted on the call row. Every issued-vs-returned gap is therefore a POPULATION '
  + 'difference over a window, not a per-quote join.',
]);

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

/**
 * r-mpp-receipt-replay (2026-08-12): canonical, key-order-independent digest of
 * the CALL a payment is being spent on.
 *
 * $0.50 buys ONE call. The sidecar records this digest at first settle; a
 * duplicate retry must present the SAME digest to be re-served the answer it
 * paid for. Without it, fixing the retry defect would open a worse one — pay
 * once, then replay the credential with different args for unlimited free
 * answers inside the challenge's 5-minute life.
 *
 * NOT bound into the challenge on purpose: the pre-wall offer ships a challenge
 * with a call that SUCCEEDS, and the agent spends it on the NEXT call — whose
 * args are legitimately different. Binding at MINT time would break the shipped
 * product; binding at SPEND time is what "one payment, one call" actually means.
 */
export function mppCallDigest(name, args) {
  return createHash('sha256')
    .update('dchub-mpp-call\u0000' + String(name) + '\u0000' + _canonJson(args))
    .digest('hex');
}
function _canonJson(v) {
  if (v === undefined) return 'u';
  if (v === null) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v) ?? 'u';
  if (Array.isArray(v)) return '[' + v.map(_canonJson).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ':' + _canonJson(v[k])).join(',') + '}';
}

/** Older sidecars have no `replayed` flag — recognise the mppx reason text so an un-upgraded sidecar still yields the actionable error instead of a bare payment_failed. */
const _MPPX_REPLAY_TEXT = /already been processed/i;

/**
 * Verify+settle a presented SPT via the sidecar.
 *
 *   {ok:true,  receipt, replayed:false}                     → settled now
 *   {ok:true,  receipt, replayed:true, payment_reference}   → ALREADY PAID; Stripe
 *        charged nothing extra and the sidecar resolved the original receipt.
 *        The caller paid → serve the data. This is the retry fix.
 *   {ok:false, replayed:true,  reason, payment_reference}   → paid, but the paid
 *        result could not be resolved (receipt expired / sidecar restarted) or the
 *        credential was already spent on a DIFFERENT call. Actionable, never generic.
 *   {ok:false, replayed:false, reason}                      → genuinely not paid.
 */
export async function mppVerify(name, credential, callDigest) {
  try {
    const j = await _post('/mpp/verify', {
      tool: name, amount: mppPrice(name), credential,
      ...(callDigest ? { call_digest: callDigest } : {}),
    });
    if (j && j.ok) {
      return {
        ok: true, receipt: j.receipt, replayed: !!j.replayed,
        settled_at: j.settled_at || null, payment_reference: j.payment_reference || null,
      };
    }
    const error = (j && j.error) || 'verification failed';
    return {
      ok: false, error,
      reason: (j && j.reason) || 'verification_failed',
      replayed: !!(j && j.replayed) || _MPPX_REPLAY_TEXT.test(String(error)),
      payment_reference: (j && j.payment_reference) || null,
    };
  } catch (e) {
    // Sidecar unreachable: we cannot know whether money moved. Fail closed and
    // say nothing we cannot prove.
    return { ok: false, error: String(e?.message || e).slice(0, 160), reason: 'sidecar_unreachable', replayed: false, payment_reference: null };
  }
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
 *
 * NOTE: this is the TWO-STEP fallback shape (ask for a challenge, then pay it). The
 * preferred shape is mppOffer() below, which ships the challenge inline so the agent
 * pays in ONE retry. This stays as the zero-latency / sidecar-down fallback.
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

/**
 * Circuit breaker for the inline-challenge mint. mppOffer runs on the HOT paywall
 * path (every gated MPP-tool preview), so a sick sidecar must never turn into
 * per-request latency for every unpaid caller. After MPP_BREAKER_FAILS consecutive
 * failures, stop calling the sidecar for MPP_BREAKER_COOLDOWN_MS and serve the sync
 * two-step hint instead; one success closes it again.
 */
const _BRK_FAILS = 3;
const _BRK_COOLDOWN_MS = 30_000;
let _brkFails = 0, _brkUntil = 0;
function _breakerOpen() { return Date.now() < _brkUntil; }
function _breakerOk()   { _brkFails = 0; _brkUntil = 0; }
function _breakerFail() {
  if (++_brkFails >= _BRK_FAILS) { _brkUntil = Date.now() + _BRK_COOLDOWN_MS; _brkFails = 0; }
}

/**
 * r-mpp-onestep (2026-07-25): ONE-STEP offer — the advertise hint WITH a live,
 * ready-to-pay challenge already embedded.
 *
 * WHY: the two-step shape above required the agent to first discover a magic flag
 * (_meta.mpp_pay=true), retry to fetch a challenge, and only then pay — three round
 * trips gated on parsing an English `how` string. Live watcher read on 2026-07-25:
 * ZERO challenges ever requested, so nobody could reach the pay step. Shipping the
 * challenge with the preview collapses that to: read challenges[0] → mint an SPT →
 * retry once with the credential.
 *
 * Cost is one sidecar call (~local HMAC mint, no Stripe round-trip). SAFETY: short
 * timeout and any failure degrades to the sync hint above — the caller's response is
 * never blocked or broken by the sidecar.
 *
 * This does NOT write an `mpp_challenge` status: that status means "an agent asked to
 * pay" (real pay-intent) and must keep meaning exactly that. A passively-offered
 * challenge is not intent, and counting it as such would corrupt the agent-pay funnel.
 */
export async function mppOffer(name, ms = 1200) {
  const base = mppAdvertiseHint(name);
  if (!base) return null;
  if (_breakerOpen()) return base;   // sidecar sick → don't tax the hot paywall path
  let challenge = null;
  try {
    const j = await _post('/mpp/challenge', { tool: name, amount: mppPrice(name) }, ms);
    if (j && j.ok && j.challenge) { challenge = j.challenge; _breakerOk(); }
    else _breakerFail();
  } catch { _breakerFail(); /* sidecar down/slow → two-step hint (no regression) */ }
  if (!challenge) return base;
  return {
    ...base,
    // The whole point: no flag to discover, no extra round trip.
    how: `ONE STEP: mint a Shared Payment Token for \`challenges[0]\` below, then retry this exact call with the token in _meta[${JSON.stringify(MPP_CRED_KEY)}]. You get the full result plus a payment receipt in _meta[${JSON.stringify(MPP_RECEIPT_KEY)}]. No key, no account, no human.`,
    challenges: [challenge],
    pay_now: {
      credential_meta_key: MPP_CRED_KEY,
      receipt_meta_key: MPP_RECEIPT_KEY,
      retry_tool: name,
      amount_usd: mppPrice(name),
      // Explicit machine-readable recipe so no agent has to parse the prose above.
      steps: [
        'Take challenges[0] from this object.',
        'Mint a Shared Payment Token (Stripe MPP) satisfying that challenge.',
        `Retry the identical \`${name}\` call with _meta[${JSON.stringify(MPP_CRED_KEY)}] = <the token>.`,
      ],
    },
    // Fallback for an agent that lets this challenge expire: ask for a fresh one.
    refresh_challenge: 'retry this call with _meta.mpp_pay=true for a new challenge',
  };
}

/**
 * r-prewall (2026-07-27): PRE-WALL offer — the pay option attached to a call that
 * SUCCEEDS, while the agent still has intent, instead of only at the wall.
 *
 * WHY: shell #34 measured the wall itself. Only 3 of 2,529 real payable-tool calls
 * in 30d were ever gated (0.1%) — the auto-trial grants full data on essentially
 * every call, so 99.9% of agents never saw the pay offer at all. Both the payment
 * rail and the email-bind ladder sit behind a wall almost nobody reaches. Making
 * the rail nicer was never going to help; making the offer REACHABLE is the lever.
 *
 * This takes nothing away: the agent still gets its full answer. It just also
 * learns, on its last free call, that the next one costs $0.50 and can be paid
 * in one retry — while it is mid-task and the answer just proved useful.
 *
 * ★ METRIC CONTRACT (do not break): this offer is PASSIVE. It must never be
 * recorded as `mpp_challenge` — that status means "an agent ASKED to pay" and is
 * the real pay-intent signal. If a passively-shipped challenge were counted, the
 * metric would degrade into "every call near the cap" and stop meaning anything.
 * The downstream signal for this surface is a SETTLE attempt (mpp_paid /
 * mpp_verify_failed), and challenges≈0 stays the expected steady state.
 *
 * @param {string} name       tool name
 * @param {number} remaining  full answers left today AFTER this one (0 = last free)
 * @returns {object|null}     offer to merge into structuredContent.agent_payment
 */
export async function mppPrewallOffer(name, remaining) {
  if (String(process.env.MPP_PREWALL_DISABLE || '') === '1') return null;
  if (!mppEnabled() || !isMppTool(name)) return null;
  const at = Math.max(0, parseInt(process.env.MPP_PREWALL_AT || '1', 10));
  if (!Number.isFinite(remaining) || remaining > at) return null;
  const offer = await mppOffer(name);          // reuses the breaker + inline challenge
  if (!offer) return null;
  const last = remaining <= 0;
  return {
    ...offer,
    offer_type: 'pre_wall',                    // passive — NOT pay-intent
    passive: true,
    free_full_answers_remaining: remaining,
    note: last
      ? `This was your LAST free full \`${name}\` answer today. The next one is $${mppPrice(name)} — payable in one retry with the challenge below, no key and no human needed.`
      : `${remaining} free full \`${name}\` answer${remaining === 1 ? '' : 's'} left today. After that it is $${mppPrice(name)} per call — payable in one retry with the challenge below, no key and no human needed.`,
  };
}
