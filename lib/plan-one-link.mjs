// plan-one-link.mjs -- an execute_plan answer sends the human to ONE link (Grok weekly leadership check 2026-11-19,
// item 1: all five top questions failed "at most one human link").
//
// WHY. M1.2 (lib/neutral-cta.mjs relayUrlFields) puts the priced relay page in the URL fields (human_url,
// for_your_human.url, intent_answer.relay.url), but the wall sentences beside them were rewritten earlier to point
// at /connect: live keyless "when can I get power in Ohio" carried human_url https://dchub.cloud/upgrade/h/... and
// human_message "... Open https://dchub.cloud/connect for more detail.", plus the prose line "This answer is partial;
// the full answer is at https://dchub.cloud/connect". Two routes for one wall.
//
// WHAT. When the URL fields carry the relay page, the wall sentences name no URL of their own and point at that link:
//   "Open https://dchub.cloud/connect for more detail."      -> "Open the link for more detail."
//   "the full answer is at https://dchub.cloud/connect"      -> "the full answer is behind the link in human_url"
//   "More detail is available at dchub.cloud/connect."       -> "More detail is behind the link in human_url."
// The relay URL is NOT copied into prose: M1.2 keeps it in the URL fields only (Arcade renders an upgrade URL in text
// as [blocked]; test/plan-neutral-cta "relay in prose"). Only these wall sentences change; other dchub pages
// (/data-sources, /terms, /markets/...) are references, not routes. With the relay off (DCHUB_WALL_RELAY_URL=0) the
// URL fields and the prose already name the same page, /connect, and nothing changes.
// Runs LAST on execute_plan (server.mjs), after the /connect tag. Pure, no I/O. Kill switch DCHUB_PLAN_ONE_LINK=0.

import { LONG_RELAY_RE } from './wall-tag.mjs';

export function planOneLinkOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PLAN_ONE_LINK) || '').trim());
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const Q = String.raw`(?:\?[^\s"'<>)\]\\]*)?`;   // the /connect link's optional ?via= tag
const SWAPS = [
  [new RegExp(String.raw`\bOpen https:\/\/dchub\.cloud\/connect${Q}(?![\w/]) for more detail\.?`, 'g'), 'Open the link for more detail.'],
  [new RegExp(String.raw`\bthe full answer is at https:\/\/dchub\.cloud\/connect${Q}(?![\w/])`, 'g'), 'the full answer is behind the link in human_url'],
  [/\b([Mm])ore detail is available at (?:https:\/\/)?dchub\.cloud\/connect(?![\w/?])\.?/g, '$1ore detail is behind the link in human_url.'],
];

// The relay link the answer's URL fields carry, or null (no relay: nothing to reconcile).
export function theRelayLink(sc) {
  if (!isObj(sc)) return null;
  const u = (typeof sc.human_url === 'string' && sc.human_url)
    || (isObj(sc.for_your_human) && typeof sc.for_your_human.url === 'string' && sc.for_your_human.url) || '';
  return u && LONG_RELAY_RE.test(u) ? u : null;
}

export function oneLinkString(s) {
  if (typeof s !== 'string' || !s.includes('dchub.cloud/connect')) return s;
  let t = s;
  for (const [re, to] of SWAPS) t = t.replace(re, to);
  return t;
}

function walk(v, depth = 0) {
  if (depth > 60) return v;
  if (typeof v === 'string') return oneLinkString(v);
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => { const y = walk(x, depth + 1); if (y !== x) changed = true; return y; });
    return changed ? out : v;
  }
  if (!isObj(v)) return v;
  let out = null;
  for (const [k, x] of Object.entries(v)) {
    const y = walk(x, depth + 1);
    if (y !== x) { if (!out) out = { ...v }; out[k] = y; }
  }
  return out || v;
}

export function planOneLinkStep(result, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !planOneLinkOn(env) || !result || !Array.isArray(result.content)) return result;
    if (!theRelayLink(result.structuredContent)) return result;
    let changed = false;
    const content = result.content.map((b) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') return b;
      const t = oneLinkString(b.text);
      if (t === b.text) return b;
      changed = true;
      return { ...b, text: t };
    });
    const sc = walk(result.structuredContent);
    if (sc !== result.structuredContent) changed = true;
    if (!changed) return result;
    return { ...result, content, structuredContent: sc };
  } catch (_) { return result; }   // a link rewrite never breaks a response
}
