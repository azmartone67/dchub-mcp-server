// lib/offers-shown.mjs — which offers a walled response carried (C3, owner go 2026-11-09).
//
// The quota_wall_hit row says which wall it was and which email ask the response carried
// (email_ask), but not which offers the caller saw, so no change to wall offers (C2) can be read
// against a baseline. This reads the FINAL result (server.mjs _wallOuterStep, after every step that
// adds an ask or a link) and names the offers in it. dchub-backend routes/mcp_funnel_events
// .OFFER_KINDS mirrors the list and stores it as offers_shown (NULL = not sent = unknown).
//
//   email_unlock  an email ask whose email opens more (the call's email_ask mark is an unlock ask,
//                 an `email_unlock` option, or a `bind_email` ask in the response)
//   digest        the weekly digest (`subscribe_digest`, or the digest_line mark)
//   free_key      `claim_free_key`
//   credit_pack   the credit pack (a `metered` option, a credits_url, or the pack named)
//   oauth_signin  the sign-in offer (lib/wall-oauth-lead.mjs): the /mcp/oauth or /mcp/grok/oauth connector URL named
//                 in the text (owner 2026-11-12: OAuth sign-in leads the wall)
//   pro           a Pro option, a pro_url, or a relay / pricing link (that page sells Pro)
//   trial         the depth-wall trial line (lib/wall-depth-trial.mjs): the 7-day free trial named as what opens the
//                 held-back fields (owner 2026-11-13, dead-end walls)
//
// "Offered" means present in what the agent received, not that it is true for this caller: making
// every offer true is C2's job, and this is the baseline C2 is read against. Pure: no ctx, no network.
// Kill switch DCHUB_OFFERS_SHOWN_EVENT=0 (server.mjs then sends no offers_shown and adds no new asks).
import { PACK_NAME } from './wall-upgrade-offer.mjs';
import { OAUTH_SIGNIN_RE } from './wall-oauth-lead.mjs';
import { DEPTH_TRIAL_RE } from './wall-depth-trial.mjs';

export const OFFER_KINDS = Object.freeze(['credit_pack', 'digest', 'email_unlock', 'free_key', 'oauth_signin', 'pro', 'trial']);
const UNLOCK_ASKS = new Set(['link_exit', 'link', 'line', 'bind_field']);

export function offersShownOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_OFFERS_SHOWN_EVENT) || '').trim());
}

// Reference blocks every result can carry, never an offer: `identity.means` explains how to pass a key
// and names claim_free_key on every keyed answer (measured on the keyless list_transactions wall), and
// provenance / evidence are citation text. Left out, or each would read as an offer on every row.
const REFERENCE_KEYS = new Set(['identity', 'provenance', 'evidence']);
function _withoutReference(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) if (!REFERENCE_KEYS.has(k)) out[k] = v;
  return out;
}
function _blob(result) {
  const parts = [];
  for (const b of (Array.isArray(result && result.content) ? result.content : [])) {
    if (!b || b.type !== 'text' || typeof b.text !== 'string') continue;
    let t = b.text;
    if (/^\s*\{/.test(t)) {   // a JSON block mirrors structuredContent: same reference keys out
      try { t = JSON.stringify(_withoutReference(JSON.parse(t))); } catch (_) { /* JSON + prose: read as is */ }
    }
    parts.push(t);
  }
  const sc = result && result.structuredContent;
  if (sc && typeof sc === 'object') {
    try { parts.push(JSON.stringify(_withoutReference(sc))); } catch (_) { /* a cyclic object adds nothing */ }
  }
  return parts.join('\n');
}

const _OPT = (id) => new RegExp('"id"\\s*:\\s*"' + id + '"');
const RELAY_OR_PRICING = /https:\/\/dchub\.cloud\/(?:u\/[A-Za-z0-9]|upgrade\/h\/|pricing\b|upgrade\b)/;

// G8: the claim hand-off lines (lib/claim-handoff.mjs claimHandoffText) ask the agent for its human's
// email in prose and never marked the call. True when the final result's text carries that ask.
const PROSE_EMAIL_ASK = /\bask your human for (?:their|an) email\b/i;
export function askedForEmailInProse(result) {
  try {
    const blocks = Array.isArray(result && result.content) ? result.content : [];
    return blocks.some((b) => b && b.type === 'text' && typeof b.text === 'string' && PROSE_EMAIL_ASK.test(b.text));
  } catch (_) { return false; }
}

// G8 (server.mjs _finishWallRow): the email_ask mark the FINAL result earns when nothing marked it.
// `gap` is the ask a step added without marking ({ kind, url? }); it counts only if it survived the
// steps after it: its link is still there, else some email ask (bind_email, the prose ask) is. Failing
// that, the claim hand-off line, which nothing marks, counts as 'line'. null = no new mark.
export function finalAskMark({ emailAsk, gap, result } = {}) {
  try {
    if (emailAsk || !result || typeof result !== 'object') return null;
    if (gap && gap.kind) {
      const t = _blob(result);
      if (gap.url ? t.includes(gap.url) : (/\bbind_email\b/.test(t) || askedForEmailInProse(result))) return gap.kind;
    }
    return askedForEmailInProse(result) ? 'line' : null;
  } catch (_) { return null; }
}

// The offers in one final result, sorted. [] = the response offered nothing; null = not a result.
export function offersShown(result, emailAsk) {
  try {
    if (!result || typeof result !== 'object') return null;
    const t = _blob(result);
    const out = [];
    if (UNLOCK_ASKS.has(emailAsk) || _OPT('email_unlock').test(t) || /\bbind_email\b/.test(t)) out.push('email_unlock');
    if (emailAsk === 'digest_line' || /\bsubscribe_digest\b/.test(t)) out.push('digest');
    if (/\bclaim_free_key\b/.test(t)) out.push('free_key');
    if (OAUTH_SIGNIN_RE.test(t)) out.push('oauth_signin');
    if (_OPT('metered').test(t) || /"credits_url"\s*:/.test(t) || t.includes(PACK_NAME)) out.push('credit_pack');
    if (_OPT('pro').test(t) || /"pro_url"\s*:/.test(t) || RELAY_OR_PRICING.test(t)) out.push('pro');
    if (DEPTH_TRIAL_RE.test(t)) out.push('trial');
    return out.sort();
  } catch (_) { return null; }
}
