// lean-response.mjs -- one short human line per tool result, no repeated retention blocks.
//
// WHY (agent QA 2026-10-20, owner-approved). Mistral and Claude measured 30-50% of every /mcp
// response's tokens as the same retention and marketing blocks, repeated on every call:
// next_session, starter_pack, digest_offer, recipes, come-back nudges, "Next question to offer the
// user", watch offers, the execute_plan menu, and an upgrade message that carried the same link
// three ways (human_url, upgrade_url, for_your_human.url) plus raw checkout links in _upgrade.
//
// WHAT THIS STEP DOES. It runs last on a /mcp tool result (inside _sourceLineCb, before the
// plan-free field rename) and:
//   * drops the retention keys and duplicate link/upgrade keys from structuredContent and from every
//     JSON text block (top level only: data rows are never touched);
//   * shrinks `_upgrade` to its machine fields (tier, next_tool, wall, remaining_today, ...): no
//     prose, no links;
//   * drops prose paragraphs that are retention or commerce copy (key claiming, checkout links,
//     pack pitches, menus, nudges);
//   * when the result carries a human_url, adds ONE line: one sentence and that one link
//     (human_message when it has the link, else a neutral sentence). human_url and human_message stay
//     in structuredContent, which is what the server instructions tell agents to read.
// Data, provenance, citation, identity and the "Source: DC Hub" line are kept.
//
// SKIPPED: the directory, Claude and core profiles (each has its own scrub; /mcp/chatgpt is frozen),
// ChatGPT clients on /mcp (the clean-platform path), execute_plan's in-process steps (its readers
// still see the original markers; the plan's final result is leaned once), and the key/account tools.
// Kill switch: DCHUB_LEAN_RESPONSES=0.

import { EMAIL_ASK } from './claim-handoff.mjs';

export const LEAN_MARKER = 'lean_v1';

// Top-level keys removed outright. The relay contract the server instructions document (human_url,
// human_message, for_your_human, agent_instruction, user_message) and next_ask stay: they are the one
// link and the one sentence, and agents read them by name.
const DROP_KEY = new RegExp('^(?:' + [
  '_?next_session', '_?starter_pack', '_?digest_offer', '_?come_back', 'recipes?', 'next_recipe',
  '_?cookbook.*', '_?watch_offer', 'retention_tools', '_?first_call_nudge', '_?front_door.*',
  '_end_of_burst', 'return_reward', '_bind', 'bind_hint', 'continuation',
  'upgrade', 'upgrade_url', 'upgrade_options', 'full_results_available', 'signup_url', 'redeem_url',
  'developer_url', 'pro_url', 'pro_hint', 'usage_url', 'credits_url', 'credits_hint',
  'web_explore_url', '_?optin.*', '_?opt_in.*', '_?email_hint.*', '_?return_nudge.*',
  'save_offer', 'share_text', 'share_hint', 'try_next', 'suggested_next.*', 'capacity_source_hint',
  'bind_email_(?:endpoint|tool|why)', 'retry_instructions', 'unlocked_tools',
  // ★2026-10-20 (agent QA round 2, item 6): the get_fiber_intel envelope was ~75% promotion and
  // NONE of it sat under a key listed here: the self-pay offer (agent_payment / machine_pay, now
  // also off by policy, mpp-hook MPP_SELF_PAY_ADVERTISED), the map CTA and the paid-plan teasers.
  'agent_payment', 'machine_pay', 'agent_pay_hint', 'map_cta', 'map_relay', 'pay_now',
  '_full_in_developer', '_full_in_pro', 'recommended', 'recommended_subscription', 'plans'
].join('|') + ')$');

// `_upgrade` keeps only these (machine signals an agent acts on; no prose, no links).
const UPGRADE_KEEP = new Set([
  'tier', 'next_tool', 'wall', 'pack_opens', 'remaining_today', 'remaining_today_basis',
  'binding_limit', 'locked', 'unlocks_at', 'reason', 'resets_at',
]);

// Retention copy: always dropped, line by line.
const RETENTION_LINE = new RegExp([
  String.raw`Next question to offer`, String.raw`^\s*\u{1F9ED}`, String.raw`Watch offer`,
  String.raw`execute_plan.?\s*FIRST`, String.raw`Try any of these verbatim`,
  String.raw`Single-capability lookups go direct`, String.raw`^\s*\u2022 \*\*[a-z_]+\*\* \u2192 .execute_plan`,
  String.raw`\bcome back\b`, String.raw`\bnext session\b`, String.raw`\bget_changes\b.*\b(?:tomorrow|next time|later)\b`,
  String.raw`\bstarter pack\b`, String.raw`\brecipes?\b.*\bexecute_plan\b`,
].join('|'), 'iu');

// Ask copy (keys, emails, links, checkout, packs): a response keeps at most ONE ask paragraph.
const ASK_PARA = new RegExp([
  String.raw`\bclaim_free_key\b`, String.raw`\bbind_email\b`,
  String.raw`/upgrade/h/`, String.raw`dchub\.cloud/u/`, String.raw`buy\.stripe\.com`, String.raw`/go/[a-z]/`,
  String.raw`dchub\.cloud/(?:pricing|signup|checkout|plans|upgrade)\b`,
  String.raw`[\u{1F512}\u{1F4B3}\u{1F4A1}\u{1F4E6}\u{1F381}\u{1F511}\u{1F464}]`,
  String.raw`\bpack of [\d,]+ (?:API )?credits\b`, String.raw`\bFor your human\b`, String.raw`^\s*Tell (?:the user|your human)\b`,
  String.raw`\brelay (?:the|this) link\b`,
].join('|'), 'iu');

// The daily site lane's run-count note, keyless and keyed wording.
const DAILY_SITE_RUN_NOTE = /^Free (?:full site analysis without a key:|daily full site analysis) \d+ of \d+ today/;

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

export function leanResponsesOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_LEAN_RESPONSES) || ''));
}

function leanUpgrade(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return u;
  const o = {};
  for (const [k, v] of Object.entries(u)) if (UPGRADE_KEEP.has(k)) o[k] = v;
  return o;
}

// Pure: returns a new object, never mutates (a result can be a shared cache entry).
export function leanObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (DROP_KEY.test(k)) continue;
    out[k] = k === '_upgrade' ? leanUpgrade(v) : v;
  }
  return out;
}

// Tools whose own answer IS the key, account or commerce step: never leaned.
export const LEAN_SKIP_TOOLS = new Set([
  'claim_free_key', 'recover_my_key', 'bind_email', 'unlock_more_data', 'why_dchub', 'subscribe_digest',
  'accept_capacity_terms', 'request_capacity_intro', 'read_inbox',
]);

// The one human sentence: human_message when it carries the link, else a neutral sentence.
export function humanLine(humanUrl, humanMessage) {
  if (typeof humanUrl !== 'string' || !/^https:\/\//.test(humanUrl)) return null;
  if (typeof humanMessage === 'string') {
    const m = humanMessage.replace(/\s+/g, ' ').trim();
    const links = m.match(URL_RE) || [];
    if (m && m.length <= 320 && links.length === 1 && links[0].replace(/[.,;]+$/, '') === humanUrl) return m;
  }
  return `This answer is partial; the full answer is at ${humanUrl}`;
}

// A line that is itself JSON is data, whatever words it contains.
const isJsonLine = (line) => /^\s*[[{]/.test(line);

function dropRetention(text) {
  return text.split('\n').filter((line) => isJsonLine(line) || !RETENTION_LINE.test(line)).join('\n')
    .replace(/^\s*---\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// End index (exclusive) of the balanced JSON object starting at i, or -1.
function jsonEnd(t, i) {
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < t.length; j++) {
    const ch = t[j];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return j + 1; }
  }
  return -1;
}

// A text block is [prose head] [one JSON object] [prose tail]. Returns its parts: the JSON leaned,
// each prose part with retention lines dropped and split into paragraphs.
function splitBlock(text) {
  const at = text.startsWith('{') ? 0 : text.search(/\n\{/) + 1;
  if (at > 0 || text.startsWith('{')) {
    const end = jsonEnd(text, at);
    if (end > 0) {
      let json = null;
      try { json = JSON.parse(text.slice(at, end)); } catch (_) { json = null; }
      if (json && typeof json === 'object') {
        return { head: paras(text.slice(0, at)), json: JSON.stringify(leanObject(json)), tail: paras(text.slice(end)) };
      }
    }
  }
  return { head: paras(text), json: null, tail: [] };
}
const paras = (t) => dropRetention(t).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

const isSourceLine = (t) => /^\s*Source: DC Hub \(/.test(t);

// result: an MCP tool result. Returns it unchanged when the step does not apply.
export function leanResponseStep(result, name, { skip = false } = {}) {
  try {
    if (skip || !leanResponsesOn() || LEAN_SKIP_TOOLS.has(name)) return result;
    // A gated preview can carry isError (DCHUB_PREVIEW_ISERROR); it is leaned like any answer. No error
    // key is ever dropped, so _flagUpstreamError's verdict stands.
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const sc0 = result.structuredContent;
    const sc = (sc0 && typeof sc0 === 'object' && !Array.isArray(sc0)) ? leanObject(sc0) : sc0;
    const humanUrl = sc0 && typeof sc0 === 'object' ? sc0.human_url : null;
    const humanMsg = sc0 && typeof sc0 === 'object' ? sc0.human_message : null;
    // Pass 1: split every text block; pick the ONE ask paragraph to keep: the first that carries
    // human_url, else the first ask paragraph.
    const parts = result.content.map((b) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') return { b };
      if (isSourceLine(b.text)) return { b, source: true };
      return { b, ...splitBlock(b.text) };
    });
    const asks = [];
    parts.forEach((p, i) => [...(p.head || []), ...(p.tail || [])].forEach((q) => { if (ASK_PARA.test(q)) asks.push(q); }));
    // The anonymous daily cap is the one wall where the way on is a free key, not the link: its claim
    // handoff line is the ask kept.
    const capLine = asks.find((q) => /anonymous allowance/i.test(q) && /\bclaim_free_key\b/.test(q));
    // The daily site lane's free run (server.mjs _withKeylessSiteRun): its run count is the ask kept.
    // Live 2026-11-02 the withheld time-to-power months put a human_url line on the run, and that
    // line won, so the caller never saw "1 of 2 today" (structuredContent.daily_site_runs stayed).
    const siteRunLine = sc0 && typeof sc0 === 'object' && sc0.daily_site_runs
      ? asks.find((q) => DAILY_SITE_RUN_NOTE.test(q)) : null;
    const keepAsk = capLine || siteRunLine
      || (typeof humanUrl === 'string' && asks.find((q) => q.includes(humanUrl))) || asks[0] || null;
    // Item 3 (owner 2026-10-16): a keyless grid / queue preview carries the email ask (an email-bound key
    // gets the full answer). It is the AGENT's instruction, beside the human's one link line, so it is
    // kept as well. Before this (full-stack QA 2026-10-24) the human_url paragraph was the only ask kept
    // and every production preview lost the email ask.
    const emailAsk = asks.find((q) => q.includes(EMAIL_ASK)) || null;
    let askKept = false, emailKept = false;
    const keep = (q) => {
      if (!ASK_PARA.test(q)) return true;
      if (!askKept && q === keepAsk) { askKept = true; if (q === emailAsk) emailKept = true; return true; }
      if (!emailKept && q === emailAsk) { emailKept = true; return true; }
      return false;
    };
    // Pass 2: rebuild. The Source line goes last.
    const blocks = [];
    let source = null;
    for (const p of parts) {
      if (!p.b || p.b.type !== 'text' || typeof p.b.text !== 'string') { blocks.push(p.b); continue; }
      if (p.source) { source = p.b; continue; }
      const t = [p.head.filter(keep).join('\n\n'), p.json, p.tail.filter(keep).join('\n\n')].filter(Boolean).join('\n\n');
      if (!t.trim()) continue;
      blocks.push(t === p.b.text ? p.b : { ...p.b, text: t });
    }
    // A gated result whose prose carried no ask gets the one line from human_message.
    if (!askKept && typeof humanUrl === 'string') {
      const line = humanLine(humanUrl, humanMsg);
      if (line) blocks.push({ type: 'text', text: line });
    }
    if (source) blocks.push(source);
    if (!blocks.length) return result;                 // never return an empty answer
    const out = { ...result, content: blocks };
    if (sc !== sc0) out.structuredContent = sc;
    return out;
  } catch (_) { return result; }   // a trim is never worth failing a response over
}
