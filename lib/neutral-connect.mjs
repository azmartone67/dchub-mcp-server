// neutral-connect.mjs -- live MCP tool output and the server instructions carry no price, credit, free-key or
// calls-per-day wording; where that wording stood, one neutral line points to /connect (owner decision, option A,
// 2026-11-16).
//
// WHY. A keyless head-to-head test read these off live /mcp results and the handshake: "one-time pack of 1,000
// credits", "free key" (telling the human to get one), "50 MCP calls/day with an email", "1 free Land & Power map
// search a month", and the Capacity Source "(free; fee only on close)" routing. The copy comes from dozens of
// writers (walls, relay lines, sell lines, the free-offer canon, key lines); the owner's rule is one neutral line.
//
// WHAT. connectNeutralString(s): sentence by sentence (line breaks kept), a sentence carrying OFFER wording is
// dropped and NEUTRAL_CONNECT_LINE is said once in its place. neutralConnectStep(result): the LAST rewrite of a
// tool result (server.mjs _sourceLineCb), on structuredContent and every text block (block 0's JSON parsed and
// re-serialised only when something changed).
//
// DATA IS NEVER REWRITTEN. Row data sits in arrays (data[], rows[], facilities[], items[] ...); strings inside an
// array element are passed through as they are, unless the array sits under a call-to-action key (CTA_KEYS from
// lib/neutral-cta.mjs: for_your_human, human_message, offers, walls ...). A bare "$<digit>" is a figure (energy
// prices, deal values), so it counts as offer wording only under a CTA key; elsewhere only DC Hub's own price shapes
// ("$10 one-time", "$49/mo", "$10 pack") count. A sentence that carries an API key value (dch_...) is always kept:
// dropping it would lose the key.
//
// Skipped (server.mjs): paid callers, the key and commerce tools (claim_free_key, recover_my_key, bind_email,
// unlock_more_data: the caller asked about keys or buying), execute_plan loopback steps, the directory / Claude / core
// profiles and clean platforms (each keeps its own frozen or reviewed copy). Kill switch DCHUB_NEUTRAL_CONNECT=0
// (read per call): every result as it was, byte for byte.

import { splitLeadingJson } from './facility-location.mjs';
import { CTA_KEYS } from './neutral-cta.mjs';

export const NEUTRAL_CONNECT_FLAG = 'DCHUB_NEUTRAL_CONNECT';
export const NEUTRAL_CONNECT_LINE = 'More detail is available at dchub.cloud/connect.';
// The handshake / dchub://instructions copy of the same line.
export const INSTR_CONNECT_LINE = NEUTRAL_CONNECT_LINE;

export function neutralConnectOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[NEUTRAL_CONNECT_FLAG]) || '').trim());
}

// The tools whose own job is keys or buying: their answer is what the caller asked for.
export const NEUTRAL_CONNECT_SKIP_TOOLS = Object.freeze(new Set([
  'claim_free_key', 'recover_my_key', 'bind_email', 'unlock_more_data',
]));

// Offer wording, anywhere outside data rows. `claim_free_key` (the tool name) does not match: "_free" has no word
// boundary before "free".
const OFFER_PARTS = [
  String.raw`\b\d[\d,]*\s+(?:API\s+)?credits?\b`,               // "1,000 credits", "1,000 API credits"
  String.raw`\bone-time pack\b`, String.raw`\bcredit[- ]pack\b`,
  String.raw`\bcalls?\s*(?:\/|a|per)\s*day\b`,                    // "50 MCP calls/day", "more calls a day"
  String.raw`\bcalls-per-day\b`, String.raw`\b\d[\d,]*\/day\b`,           // "50/day with an email"
  String.raw`\bfree[- ](?:DC Hub\s+)?(?:API\s+)?keys?\b`,         // "a free key", "free DC Hub key"
  String.raw`\bfree Land (?:&|and) Power\b`,
  String.raw`\bfee only on close\b`,
  // 2026-11-17: allowance and free-tier offer shapes the first pass missed ("free, up to 10 full rankings a day",
  // "A key with a bound email gets 10 full answers a day",
  // "claim_free_key (no email) for the free tier")
  String.raw`\b\d[\d,]*\s+full\s+(?:\x60[^\x60]+\x60\s+)?[a-z]+(?:[- ][a-z]+)?\s+(?:a|per)\s+day\b`,   // "10 full answers a day", "10 full `x` answers a day"
  String.raw`\b(?:for|unlock) the (?:full )?free tier\b`,
  // 2026-11-17 midday (Grok colocation head-to-head, item 4c): "with an email it gets the full answer, free" on every
  // step relay, and the "FREE weekly DC Hub digest" offer in next_session.
  String.raw`\bfull answers?,\s*free\b`,
  // DC Hub's own price shapes ("$10 one-time", "$49/mo", "$10 pack", "$10 = 1,000 credits")
  String.raw`\$\d[\d,.]*\s*(?:\/\s?mo\b|\/month\b|(?:a|per) month\b|one-time\b|(?:credit )?pack\b|=)`,
];
// "a FREE weekly DC Hub digest" (next_session.digest_offer) is matched in capitals only: the wall digest asks' "a free
// weekly summary" is owner-approved copy pinned by test/wall-offers and test/depth-wall-digest-ask, and stays.
const FREE_DIGEST = String.raw`\bFREE weekly\b`;
export const OFFER_WORDING = new RegExp(`(?:${OFFER_PARTS.join('|')})|(?-i:${FREE_DIGEST})`, 'i');
// Under a call-to-action key any "$<digit>" is a price of ours.
export const OFFER_WORDING_CTA = new RegExp(`(?:${OFFER_PARTS.concat([String.raw`\$\s?\d`]).join('|')})|(?-i:${FREE_DIGEST})`, 'i');
const API_KEY_VALUE = /\bdch_[A-Za-z0-9_-]{6,}/;
// A sentence's leading decoration (emoji, bold, an opening quote or bracket) and its closers after the final stop.
const LEAD_DECOR = /^(?:[\p{Extended_Pictographic}\uFE0F\u200D]|\s|\*\*|__|["“'‘(\[])+/u;
const TAIL_DECOR = /[.!?:]?((?:\*\*|__|["”'’)\]])+)\s*$/u;

// Phrase rewrites first, so a line keeps its link, its email ask and its grammar: the pack becomes "full access",
// an allowance parenthetical goes, "free key" becomes "key". What still carries offer wording after them is dropped
// sentence by sentence (a sentence with a link first loses only its offending clauses).
export const PHRASE_REWRITES = Object.freeze([
  [/\$\d[\d,.]*\s*one-time\s*=\s*\d[\d,]*\s+(?:API\s+)?credits?/gi, 'full access'],
  [/\b(?:a|another)\s+one-time pack of\s+\d[\d,]*\s+(?:API\s+)?credits?/gi, 'full access'],
  // an allowance or price parenthetical ("(50 MCP calls/day)", "(previews plus …, 50/day with an email)", "($99/mo)")
  [/\s*\((?=[^()]*(?:\bcalls?\s*(?:\/|a|per)\s*day\b|\b\d[\d,]*\/day\b|\b\d[\d,]*\s+(?:API\s+)?credits?\b|\$\d))[^()]*\)/gi, ''],
  [/\bfree[- ]((?:DC Hub\s+)?(?:API\s+)?keys?)\b/gi, (_m, k) => k],
  [/\bone-click credit[- ]pack link\b/gi, 'one-click link'],
  // ", free, up to 10 full rankings a day" after what an email opens: the allowance goes, the ask stays
  [/,\s*free,\s*up to \d[\d,]*\s+full\s+[a-z]+(?:\s+[a-z]+)?\s+(?:a|per)\s+day\b/gi, ''],
  // "gets 10 full `x` answers a day" -> "gets full `x` answers": the count and the day go, the bind_email ask stays
  [/\b(?:up to )?\d[\d,]*\s+(full\s+(?:`[^`]+`\s+)?[a-z]+(?:[- ][a-z]+)?)\s+(?:a|per)\s+day(?:\s+each)?\b/gi, (_m, f) => f],
  // "gets the full answer, free" -> "gets the full answer"; "a FREE weekly DC Hub digest" -> "a weekly DC Hub digest"
  [/\b(full answers?),\s*free\b/gi, (_m, f) => f],
  [/\bFREE\s+(weekly)\b/g, (_m, w) => w],
  // "Free tier preview — up to 3 rows ..." is a preview
  [/\b(F|f)ree[- ]tier preview\b/g, (_m, f) => (f === 'F' ? 'Preview' : 'preview')],
]);
const URL_IN = /https?:\/\/\S+/;

// One string. `cta`: the string sits under a call-to-action key.
export function connectNeutralString(s, { cta = false } = {}) {
  if (typeof s !== 'string' || !s) return s;
  const BAN = cta ? OFFER_WORDING_CTA : OFFER_WORDING;
  if (!BAN.test(s)) return s;
  let said = s.includes(NEUTRAL_CONNECT_LINE);
  // A sentence carrying an API key value is never touched (dropping or rewording it could lose the key).
  const rewrite = (p) => {
    if (API_KEY_VALUE.test(p)) return p;
    let t = p;
    for (const [re, to] of PHRASE_REWRITES) { re.lastIndex = 0; t = t.replace(re, to); }
    if (!BAN.test(t) || !URL_IN.test(t)) return t;
    // a sentence with a link keeps the link: only its offending clauses go
    // clauses: split at a semicolon, a dash or a middle dot (never at a comma, which also sits inside parentheses)
    const clauses = t.split(/(?<=;)\s+|\s+(?=[—·]\s)/);
    const keptClauses = clauses.filter((c) => !BAN.test(c) || URL_IN.test(c));
    if (!keptClauses.length || keptClauses.length === clauses.length) return t;
    const u = keptClauses.join(' ').replace(/[;\s]+$/, '');
    const ended = /[.!?]["”')\]*_]*$/;
    return ended.test(u) || !ended.test(t) ? u : u + '.';
  };
  const out = s.split('\n').map((line) => {
    if (!BAN.test(line)) return line;
    const parts = line.split(/(?<=[.!?](?:\*\*|__|["”'’)\]])*)\s+/u);
    const kept = [];
    for (const p0 of parts) {
      const p = rewrite(p0);
      if (!BAN.test(p) || API_KEY_VALUE.test(p)) { kept.push(p); continue; }
      // The dropped sentence's own decoration stays balanced: an opening emoji / bold / quote it starts with and the
      // closing bold / quote / bracket it ends with wrap the neutral line ('Tell the user: "… <offer>."' keeps its quote).
      const lead = (p.match(LEAD_DECOR) || [''])[0];
      const tail = (p.match(TAIL_DECOR) || ['', ''])[1] || '';
      if (!said) { kept.push(lead + NEUTRAL_CONNECT_LINE + tail); said = true; continue; }
      const closers = tail.replace(/\*\*|__/g, '');
      const openers = lead.replace(/\*\*|__|[^"“'‘(\[]/gu, '');
      if (closers && !openers) {
        if (kept.length) kept[kept.length - 1] += closers; else kept.push(closers);
      }
    }
    return kept.join(' ');
  }).join('\n');
  return out;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// execute_plan's executed[] holds tool RESULTS, one per step, not data rows: each element is walked like a direct
// call's result (its own data arrays still count as rows). Measured live 2026-11-17: a step's
// quota.full_answers_unavailable_reason kept "A key with a bound email gets 10 full answers a day." after the same
// line was neutral on the direct get_market_intel call.
export const STEP_RESULT_LIST_KEYS = Object.freeze(new Set(['executed']));

// `cta`: under a CTA key. `row`: inside an array element outside a CTA key (data).
function walk(v, cta = false, row = false, depth = 0) {
  if (depth > 60 || v == null) return v;
  if (typeof v === 'string') return (row && !cta) ? v : connectNeutralString(v, { cta });
  if (Array.isArray(v)) return v.map((x) => walk(x, cta, true, depth + 1));
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    const c = cta || CTA_KEYS.has(k);
    out[k] = (STEP_RESULT_LIST_KEYS.has(k) && Array.isArray(x))
      ? x.map((e) => walk(e, c, row, depth + 2))
      : walk(x, c, row, depth + 1);
  }
  return out;
}
export function neutralConnectObject(v) { return walk(v); }

// KEY-TOOL FIELDS (item 4c). The string pass above leaves tool NAMES alone on purpose: a wall's "call
// `claim_free_key` with {email}" is how a walled caller continues, and the handshake keeps its KEYS line (owner,
// 2026-11-17 morning). A successful answer is different: it also carried the key path as structure, on every step
// (`_upgrade.next_tool: "claim_free_key"`, `email_ask.tool`, `next_tool: "unlock_more_data"`,
// `provenance.preview.unlock_tool`) plus the tier markers `trial_preview: true` and `tier_required: "free"`.
// stripWalk drops, from an execute_plan step result that is not a wall: a key `unlock_tool` or `trial_preview`, a
// `tier_required` of "free", any field whose value is a key tool's name, an object whose `tool` is a key tool (a call
// suggestion for it), and the key tools and call suggestions in a list (other list elements are rows, kept).
export const KEY_TOOLS = Object.freeze(new Set(['claim_free_key', 'unlock_more_data']));
const KEY_FIELD_DROP = Object.freeze(new Set(['unlock_tool', 'trial_preview']));

function stripWalk(v, depth = 0) {
  if (depth > 60 || v == null) return v;
  // In a list, a key tool's name or a call suggestion for one goes; every other element is a row, kept as it is.
  if (Array.isArray(v)) return v.filter((x) => !(typeof x === 'string' && KEY_TOOLS.has(x))
    && !(isObj(x) && typeof x.tool === 'string' && KEY_TOOLS.has(x.tool)));
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (KEY_FIELD_DROP.has(k)) continue;
    if (k === 'tier_required' && typeof x === 'string' && x.toLowerCase() === 'free') continue;
    if (typeof x === 'string' && KEY_TOOLS.has(x)) continue;
    if (isObj(x) && typeof x.tool === 'string' && KEY_TOOLS.has(x.tool)) continue;
    const y = (STEP_RESULT_LIST_KEYS.has(k) && Array.isArray(x)) ? x.map((e) => stripWalk(e, depth + 2)) : stripWalk(x, depth + 1);
    if (isObj(y) && !Object.keys(y).length && isObj(x) && Object.keys(x).length) continue;   // emptied by the strip
    out[k] = y;
  }
  return out;
}

// A wall (or an error) keeps its key path: there it is the way forward.
export function isWallResult(result) {
  const sc = result && result.structuredContent;
  if (result && result.isError === true) return true;
  if (!isObj(sc)) return false;
  return sc.error !== undefined || sc._wall === true || sc.binding_limit !== undefined || sc.wall !== undefined;
}

// Scope: an execute_plan answer (the head-to-head surface). Its STEP results lose every key-tool field; the plan's own
// top level keeps the caller's continue path (_upgrade, for_your_human, human_url, agent_hints: the email-first ask the
// owner kept, 2026-10-20 and 2026-11-17 morning) and loses only the tier markers and provenance.preview.unlock_tool.
// Direct tool calls are not touched here: their soft-cap and preview asks are each tool's own contract.
export function stripKeyToolFields(plan) {
  if (!isObj(plan)) return plan;
  const out = {};
  for (const [k, x] of Object.entries(plan)) {
    if (KEY_FIELD_DROP.has(k)) continue;
    if (k === 'tier_required' && typeof x === 'string' && x.toLowerCase() === 'free') continue;
    if (k === 'executed' && Array.isArray(x)) {
      out[k] = x.map((e) => (isObj(e) && isObj(e.result) ? { ...e, result: stripWalk(e.result, 2) } : e));
      continue;
    }
    if (k === 'provenance' && isObj(x) && isObj(x.preview) && x.preview.unlock_tool !== undefined) {
      const { unlock_tool: _u, ...pv } = x.preview;
      out[k] = { ...x, preview: pv };
      continue;
    }
    out[k] = x;
  }
  return out;
}

// The step. `skip`: a paid caller, a skipped tool or surface, a loopback step.
export function neutralConnectStep(result, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !neutralConnectOn(env)) return result;
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const strip = !isWallResult(result);
    const shape = (j) => (strip && isObj(j) && j._entity === 'plan_execution' ? stripKeyToolFields(walk(j)) : walk(j));
    let changed = false;
    const content = result.content.map((b) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') return b;
      const sp = splitLeadingJson(b.text);
      let text;
      if (sp && (isObj(sp.json) || Array.isArray(sp.json))) {
        const j = shape(sp.json);
        const js = JSON.stringify(j);
        const body = js === JSON.stringify(sp.json) ? b.text.slice(sp.head.length, b.text.length - sp.rest.length) : js;
        text = connectNeutralString(sp.head) + body + connectNeutralString(sp.rest);
      } else {
        text = connectNeutralString(b.text);
      }
      if (text === b.text) return b;
      changed = true;
      return { ...b, text };
    });
    let sc = result.structuredContent;
    if (isObj(sc) || Array.isArray(sc)) {
      const next = shape(sc);
      if (JSON.stringify(next) !== JSON.stringify(sc)) { sc = next; changed = true; }
    }
    if (!changed) return result;
    return { ...result, content, ...(result.structuredContent !== undefined ? { structuredContent: sc } : {}) };
  } catch (_) { return result; }   // copy only: never break a response
}
