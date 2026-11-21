// lib/wall-copy-v2.mjs — the rest of a keyless / trial-key wall reads the v2 copy (owner 2026-11-21, "fix above",
// after the wall_identity_v2 outside test: /workspace brain paste 2026-11-21-wall-identity-v2-outside-test).
//
// WHY. wall_identity_v2 (lib/wall-identity-v2.mjs) added the sign-in line and the get_api_key email ask, but every
// other line of the same wall still read the older copy, measured live on keyless /mcp 2026-11-21:
//   "get_grid_intelligence returned a free preview", "Your user can unlock the full brief free with their email",
//   "Free: reply with your email ... no card needed", "previews on free; an email adds 10 full answers/day each",
//   next_ask.free = true, bind_email asks, "After they pay, call ...", and human links to /upgrade/h/... and
//   dchub.cloud/connect. Grok's G3 wall kept all of it. The owner rule: agent-facing copy names no price, plan,
//   "free", credits or calls-per-day, and the person is sent to ONE page, https://dchub.cloud/mcp/connect.
//
// WHAT (behind DCHUB_WALL_IDENTITY_V2, plus its own kill switch DCHUB_WALL_COPY_V2=0). Applied LAST to a walled /
// preview answer (server.mjs _wallCopyV2Step), after the sign-in line is placed:
//   * the known older sentences are rewritten to neutral ones (REWRITES below), in prose blocks and in the
//     answer's JSON strings (block 0 and structuredContent); citation and licence text is left alone;
//   * every human link in the wall copy (/upgrade/h/<token>, /u/<code>, /upgrade, /pricing, dchub.cloud/connect)
//     becomes https://dchub.cloud/mcp/connect. The /connect page itself (and its checkout) is untouched;
//   * next_ask.free is dropped; for a keyless caller the ask tools (next_ask, next_call, _upgrade.next_tool,
//     provenance.preview.unlock_tool) and the prose name get_api_key instead of bind_email (one call: mints a key
//     with the email bound). A trial-key caller keeps bind_email (it binds the key it already holds);
//   * the headline ("Give your user this answer first: ...", with its date) moves ahead of the sign-in line, as its
//     own block, with the answer's Source line, so the number, date and source come before the wall.
// Pure: no ctx, no network.
import { CONNECT_URL, SIGNIN_LINE, KEY_TOOL } from './wall-identity-v2.mjs';

export const WALL_COPY_V2_FLAG = 'DCHUB_WALL_COPY_V2';
export function wallCopyV2On(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[WALL_COPY_V2_FLAG]) || '').trim());
}

// The Grok hosted connector's human line (its own sign-in URL stays /mcp/grok/oauth).
export const HUMAN_CONNECT_LINE = 'If your user sets it up by hand: ' + CONNECT_URL + '.';
export const PLAN_PARTIAL_LINE = 'This answer is partial. Your user can sign in at ' + CONNECT_URL
  + ', or share an email with ' + KEY_TOOL + ', for the full answer.';

const C = CONNECT_URL;
// Human links a wall hands out. dchub.cloud/connect (bare or https), never /mcp/connect (the path after the host is
// /mcp there). Query strings ride along and are dropped with the link.
const HUMAN_LINK_RE = /(?:https?:\/\/)?(?:www\.)?dchub\.cloud\/(?:upgrade\/h\/[A-Za-z0-9_.-]+|u\/[A-Za-z0-9_-]+|upgrade(?![A-Za-z0-9_-])|pricing(?![A-Za-z0-9_-])|connect(?![A-Za-z0-9_-]))(?:\?[^\s"'\\)\]}>,]*)?/g;

// [pattern, replacement]. Order matters: whole sentences first, then words. No replacement contains a double quote
// or a backslash, so a JSON text that does not parse can be rewritten in place and stay valid.
export const REWRITES = [
  // the decision-tool basis clause (lib/free-decision-taste.mjs freeDecisionClause / FREE_DECISION_CLAUSE_PREVIEW_ONLY)
  [/Grid\/queue\/market-intel tools: previews on free; an email adds \d[\d,]* full answers\/day each\./g,
    'Grid/queue/market-intel tools: previews; an email shared with ' + KEY_TOOL + ' opens the full answers.'],
  [/Grid\/queue\/market-intel tools: previews on free; full needs a paid DC Hub plan\./g,
    'Grid/queue/market-intel tools: previews; sign in for the full answers.'],
  // lib/grid-sell-line.mjs GRID_AGENT_EMAIL_TAIL
  [/Your user can unlock the full brief free with their email \(the step above\)\./g,
    'Your user can get the full brief by sharing their email (the step above).'],
  // "After they pay, call X again in this session for the full brief|answer." (grid / fiber / paid agent lines)
  [/After they pay, call (`?[a-z_]+`?) again in this session for the full (brief|answer)\./g,
    (_m, tool, what) => 'After your user signs in at ' + C + ' or shares an email with ' + KEY_TOOL + ', call ' + tool
      + ' again in this session for the full ' + what + '.'],
  [/After they pay,/g, 'After your user signs in,'],
  // repeat-wall pointer at the credit pack
  [/ ?If they missed it, the one-click credit-pack link is: \S+/g, ' If they missed it, the sign-in page is: ' + C],
  // lib/human-email-reply.mjs HUMAN_EMAIL_REPLY (with and without its "Free:")
  [/(?:Free: r|R)eply with your email and your assistant can unlock the full answer here, no card needed\./g,
    'Reply with your email and your assistant can open the full answer here.'],
  // "Or open <link> to see what your agent found." / "see what your agent found: <link>"
  [/Or open \S+ to see what your agent found\./g, 'Or sign in at ' + C + '.'],
  [/see what your agent found(?: and how to unlock it)?: \S+/g, 'your user can sign in for it: ' + C],
  [/open \S+ (?:—|-) see what your agent found and how to unlock it\./g, 'sign in at ' + C + '.'],
  // execute_plan's partial line
  [/This answer is partial; the full answer is behind the link in human_url\.?/g, PLAN_PARTIAL_LINE],
  // claim hand-off leads
  [/Keep going free: /g, 'Keep going: '],
  [/This IP has used today's anonymous allowance\. Free, one call: /g, 'This answer is a preview. One call: '],
  [/Free, one call: /g, 'One call: '],
  [/ An email raises the daily allowance\./g, ''],
  [/ An identified caller is not held to the anonymous limit\./g, ''],
  [/ Free key: [^.]*\./g, ''],
  [/A (?:free )?key with a bound email gets \d[\d,]* full (`[a-z_]+`) answers a day\./g, (_m, tool) => 'A key with a bound email gets full ' + tool + ' answers.'],
  [/(?:DC Hub\u2019s|DC Hub's) paid layer has /g, 'DC Hub has '],
  [/,? ?no card needed/g, ''],
  // the anonymous pause notice (server.mjs abuse block): the pause stays, the counts and allowance go
  [/You've made more than \d[\d,]* anonymous calls from this IP today \([^)]*\)\. /g, 'This IP has made many anonymous calls today. '],
  [/ ?\(\d+x the free anonymous allowance of \d+\)/g, ''],
  // a trailing ", free." on an ask
  [/,\s*free(?=[.;:)])/g, ''],
  // what is left: "free preview" / "free DC Hub preview" / "free DC Hub fiber preview"
  [/\b[Ff]ree (DC Hub (?:fiber )?preview|preview)/g, (_m, rest) => rest],
];

// Keys whose strings are citation / licence text, never wall copy.
const SKIP_KEYS = new Set(['licences', 'licenses', 'license', 'citation', 'cite_as', 'provenance_text', 'methodology', 'sources']);

export function rewriteText(s, { keyless = false } = {}) {
  if (typeof s !== 'string' || !s) return s;
  let t = s;
  for (const [re, rep] of REWRITES) t = t.replace(re, rep);
  t = t.replace(HUMAN_LINK_RE, C);
  if (keyless) t = t.replace(/\bbind_email\b/g, KEY_TOOL);
  return t;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const TOOL_KEYS = new Set(['tool', 'next_tool', 'unlock_tool']);

function walk(v, opts, key = '') {
  if (typeof v === 'string') {
    if (TOOL_KEYS.has(key)) return (opts.keyless && v === 'bind_email') ? KEY_TOOL : v;
    return rewriteText(v, opts);
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, opts, key));
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (SKIP_KEYS.has(k)) { out[k] = x; continue; }
    if (k === 'provenance' && isObj(x)) {   // citation block: only its preview.unlock_tool is an ask
      const p = { ...x };
      if (isObj(p.preview) && opts.keyless && p.preview.unlock_tool === 'bind_email') p.preview = { ...p.preview, unlock_tool: KEY_TOOL };
      out[k] = p;
      continue;
    }
    if (k === 'next_ask' && isObj(x)) {
      const { free: _drop, ...rest } = x;   // next_ask.free: an allowance word in a structured field
      out[k] = walk(rest, opts, k);
      continue;
    }
    out[k] = walk(x, opts, k);
  }
  return out;
}

export function rewriteJson(o, opts = {}) { return walk(o, opts); }

const isText = (b) => b && b.type === 'text' && typeof b.text === 'string';
const isJsonText = (b) => isText(b) && /^\s*[{[]/.test(b.text);
const HEADLINE_LEAD = 'Give your user this answer first: ';

// The headline paragraph out of its block, ahead of the sign-in line, with the answer's Source line. Returns blocks.
function headlineFirst(blocks, signInLine) {
  const si = blocks.findIndex((b) => isText(b) && b.text.includes(signInLine));
  const hi = blocks.findIndex((b) => isText(b) && !isJsonText(b) && b.text.startsWith(HEADLINE_LEAD));
  if (si < 0 || hi < 0 || hi < si) return blocks;
  const t = blocks[hi].text;
  const cut = t.indexOf('\n\n');
  const head = cut >= 0 ? t.slice(0, cut) : t;
  const rest = cut >= 0 ? t.slice(cut + 2).replace(/^\s+/, '') : '';
  const src = blocks.find((b) => isText(b) && /^Source: DC Hub/.test(b.text));
  const srcTxt = src ? ' ' + src.text.trim().replace(/\.?$/, '.') : '';
  const out = blocks.slice();
  if (rest) out[hi] = { ...blocks[hi], text: rest }; else out.splice(hi, 1);
  out.splice(si, 0, { type: 'text', text: head.trim() + (srcTxt && !head.includes('Source:') ? srcTxt : '') });
  return out;
}

// The whole v2 copy on one result. opts: { keyless, signInLine, grok, planAsk: { line, call } }.
export function wallCopyV2(result, opts = {}) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const o = { keyless: !!opts.keyless };
  let blocks = result.content.map((b) => {
    if (!isText(b)) return b;
    if (isJsonText(b)) {
      try { return { ...b, text: JSON.stringify(rewriteJson(JSON.parse(b.text), o)) }; } catch (_) { /* cut or prose JSON: in place */ }
    }
    return { ...b, text: rewriteText(b.text, o) };
  });
  // Grok's G3 sign-in block names /mcp/grok/oauth; the person also gets the hand set-up page.
  if (opts.grok) {
    blocks = blocks.map((b) => (isText(b) && /\/mcp\/grok\/oauth/.test(b.text) && !b.text.includes(CONNECT_URL)
      ? { ...b, text: b.text.replace(/\s*$/, '') + ' ' + HUMAN_CONNECT_LINE } : b));
  }
  blocks = headlineFirst(blocks, opts.signInLine || SIGNIN_LINE);
  let sc = result.structuredContent;
  if (isObj(sc)) sc = rewriteJson(sc, o);
  // execute_plan on Grok: the one get_api_key ask (the /mcp plan gets it from the v2 step's key entry).
  if (opts.planAsk && opts.planAsk.line && !blocks.some((b) => isText(b) && b.text.includes(opts.planAsk.line))) {
    let at = blocks.length;
    while (at > 1 && isText(blocks[at - 1]) && /^(?:Source:|DC Hub:)/.test(blocks[at - 1].text)) at -= 1;
    blocks.splice(at, 0, { type: 'text', text: opts.planAsk.line });
    if (isObj(sc) && sc.email_ask === undefined && opts.planAsk.call) sc = { ...sc, email_ask: opts.planAsk.call };
  }
  return { ...result, content: blocks, ...(sc !== undefined ? { structuredContent: sc } : {}) };
}

// Is this answer a wall or a preview? (the caller's own walled read, or the result's preview markers)
export function looksPreview(result) {
  try {
    const sc = isObj(result && result.structuredContent) ? result.structuredContent : {};
    if (sc.free_preview_only === true || sc.preview_is_partial === true || /partial|preview/.test(String(sc.completeness || ''))) return true;
    return (result.content || []).some((b) => isText(b) && (/dchub\.cloud\/upgrade\/h\//.test(b.text) || b.text.includes('This answer is partial')));
  } catch (_) { return false; }
}
