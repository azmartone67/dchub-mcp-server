// lib/wall-pack-first.mjs — lead the offer with the one-time credit pack, at the wall and on the last full answer
// (owner 2026-11-22: "agent pay first at the wall"; reachability: the pay offer used to appear only after the wall).
//
// Behind DCHUB_WALL_PACK_FIRST (default OFF; on only for 1 / true / yes / on). Off: nothing here runs.
//
// ★ Turning it on reverses a standing copy rule (Grok note K item 8, 2026-11-15: agent-facing text names no plans
// and no prices; DCHUB_WALL_ONE_ROUTE). This line names the pack's price, read from canon (lib/canon.mjs PACK_PRICE,
// the published credit_pack), never typed here. That is the owner's call when the flag goes on.
//
// WHERE (server.mjs _wallPackFirstStep decides; this module only builds and places the line):
//   * a CAPACITY wall (server.mjs _wallKindFor === WALL_KIND_CAPACITY: a credit buys more full answers there), and
//   * the LAST full answer of the day on a tool (quota.full_answers_remaining_today === 0 on an answer that is not
//     gated): the offer reaches the caller one call before the wall instead of after it.
// Only on a tool a credit opens (server.mjs _packOpensTool): credits buy capacity, not depth, so a depth / Pro /
// decision-tool wall never gets this line (it would promise a preview the caller already holds).
// Never on ChatGPT / OpenAI clients or the directory / Claude / core profiles (_newWallStepSkip), never for a paid
// tier or a key that already holds credits, at most once per (session, tool).
//
// WHAT: one text block right after content[0] (the answer, or value-first's headline), and
// structuredContent.pack_offer, a machine-readable twin. When the answer already carries an inline per-call payment
// challenge (structuredContent.agent_payment, the MPP rail), pack_offer says so; this module never creates one.
// The checkout link is server.mjs's own pack link (_packCheckoutUrl: the signed /go/c link), tagged ?via=pack_first
// so the checkout_started funnel event can be read by origin (dchub-backend accepts the via value).
import { PACK_PRICE, PACK_PRICE_USD, PACK_CREDITS } from './canon.mjs';
import { PRO_NAME } from './wall-upgrade-offer.mjs';

export const WALL_PACK_FIRST_FLAG = 'DCHUB_WALL_PACK_FIRST';
export const PACK_FIRST_VIA = 'pack_first';
export const KIND_WALL = 'wall';
export const KIND_LAST_FULL = 'last_full';

export function wallPackFirstOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[WALL_PACK_FIRST_FLAG]) || '').trim());
}

// The /go/c link with ?via=pack_first. A link that is not a dchub.cloud /go/ link (the raw Payment Link fallback when
// the internal key is unset) is returned unchanged: Stripe gets no parameter it was not built for.
export function tagPackUrl(url) {
  const u = String(url || '');
  if (!/^https:\/\/dchub\.cloud\/go\//.test(u)) return u;
  return u + (u.includes('?') ? '&' : '?') + 'via=' + PACK_FIRST_VIA;
}

const _credits = () => (PACK_CREDITS ? PACK_CREDITS.toLocaleString('en-US') : '');

// The line. kind 'wall' | 'last_full'. '' when canon has no pack price or there is no link (nothing honest to say).
export function packFirstLine({ kind = KIND_WALL, tool = '', url = '' } = {}) {
  if (!url || PACK_PRICE_USD === null || !PACK_CREDITS) return '';
  const t = tool ? '`' + tool + '`' : 'this tool';
  const pack = 'a one-time ' + PACK_PRICE + ' pack of ' + _credits() + ' API calls, no subscription';
  if (kind === KIND_LAST_FULL) {
    return 'That was the last full ' + t + ' answer today. To keep full answers coming, your user can buy ' + pack
      + ': ' + url + ' . The next call after they pay returns full data.';
  }
  return 'Quickest way to the full ' + t + ' answer: ' + pack + '. Your user can buy it here: ' + url
    + ' . The next call after they pay returns full data.';
}

export function packOffer({ kind = KIND_WALL, url = '', agentPayment = null } = {}) {
  const ap = agentPayment && typeof agentPayment === 'object' ? agentPayment : null;
  return {
    kind: 'credit_pack', shown_on: kind, one_time: true,
    price_usd: PACK_PRICE_USD, calls: PACK_CREDITS, checkout_url: url,
    // credits_url: the key lib/offers-shown.mjs reads as a credit_pack offer, so the wall row's offers_shown names it.
    credits_url: url,
    opens: 'more full answers on tools a credit covers; it does not open ' + PRO_NAME + '-only tools',
    per_call_payment_inline: !!(ap && Array.isArray(ap.challenges) && ap.challenges.length),
    ...(ap && ap.price_usd ? { per_call_price_usd: ap.price_usd } : {}),
  };
}

// result with the line after content[0] and structuredContent.pack_offer. Unchanged when there is no line.
export function withPackFirst(result, { line, offer } = {}) {
  if (!line || !result || typeof result !== 'object' || !Array.isArray(result.content) || !result.content.length) return result;
  const content = [result.content[0], { type: 'text', text: line }, ...result.content.slice(1)];
  const sc0 = result.structuredContent;
  const out = { ...result, content };
  if (sc0 && typeof sc0 === 'object' && !Array.isArray(sc0)) out.structuredContent = { ...sc0, pack_offer: offer };
  return out;
}
