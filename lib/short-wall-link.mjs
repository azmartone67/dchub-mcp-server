// Wall-to-paid P1 + P4 (owner 2026-10-23, ~/dchub-progress/wall-to-paid-1023.md).
//
// Measured 30d to 2026-10-23: every plausible human open of a wall link came from a siting wall,
// whose link is a 6-character /u/<code>. Every data-tool wall (get_grid_intelligence, queue, market
// intel, ...) handed out the signed /upgrade/h/<token> URL instead, 200-330 characters an agent has to
// re-type, and on keyless walls with ?buy=1, which skips the relay page (the held-back number, both
// options, "email me later") and drops the person straight into one plan's checkout while the
// human_message says "the plans ... are on this page".
//
// This step, on the finished response of a wall that hands out a relay link:
//   P4  drops buy=1 from the link, so it lands on the relay page the copy describes;
//   P1  mints the /u/ short link for it (the existing _shortRelayPageLink mint, fail-open to the
//       long link) and writes it in place of every copy of that link, in every text block and in
//       structuredContent; human_url becomes the FIRST key of structuredContent and of block 0's
//       JSON, so content[0] carries the link while block 0 stays JSON an agent can parse
//       (test/block0-is-json-everywhere, Grok 2026-10-04).
// Wording is untouched: no plan or price is added anywhere. Kill switch DCHUB_WALL_SHORT_ALL=0.
// The caller decides the skips (server.mjs: the /mcp/chatgpt, /mcp/claude and /mcp/core profiles,
// execute_plan loopback steps and paid tiers never reach it).

import { splitLeadingJson } from './facility-location.mjs';
import { tagRelayUrl } from './wall-tag.mjs';

const RELAY_HUMAN_URL_RE = /^https:\/\/dchub\.cloud\/upgrade\/h\/([A-Za-z0-9_-]+\.[0-9a-f]{32})(\?[^\s"'\\)\]}>]*)?$/;
const MINTED_RE = /^https:\/\/dchub\.cloud\/(?:u\/[2-9a-hj-km-np-z]{6}|upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[a-z0-9_=&-]{1,200})?)$/;

export function wallShortAllOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_SHORT_ALL) || '').trim());
}

// The relay URL without its buy parameter (any value); other parameters kept in order.
export function dropBuyParam(url) {
  const s = String(url || '');
  const q = s.indexOf('?');
  if (q < 0) return s;
  const kept = s.slice(q + 1).split('&').filter((p) => p && !/^buy(=|$)/i.test(p));
  return s.slice(0, q) + (kept.length ? '?' + kept.join('&') : '');
}


// Block 0 is JSON, possibly followed by prose in the same block (the lean step folds the agent and
// human lines into it). Rewrite the leading JSON object only; head and rest are kept byte for byte.
function _withBlock0Json(content, edit) {
  const b0 = Array.isArray(content) ? content[0] : null;
  if (!b0 || b0.type !== 'text' || typeof b0.text !== 'string') return content;
  const sp = splitLeadingJson(b0.text);
  if (!sp || !sp.json || typeof sp.json !== 'object' || Array.isArray(sp.json)) return content;
  const next = edit(sp.json);
  if (!next) return content;
  return [{ ...b0, text: sp.head + JSON.stringify(next) + sp.rest }, ...content.slice(1)];
}

const _esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function _deepSwap(v, swap) {
  if (typeof v === 'string') return swap(v);
  if (Array.isArray(v)) return v.map((x) => _deepSwap(x, swap));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = _deepSwap(x, swap);
    return o;
  }
  return v;
}

// mint(url) -> Promise<string>: the short link for `url`, or `url` itself on any failure.
export async function shortWallLinkStep(result, { mint, env, wall } = {}) {
  try {
    if (!wallShortAllOn(env)) return result;
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const sc = result.structuredContent;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return result;
    const hu = typeof sc.human_url === 'string' ? sc.human_url : '';
    const m = RELAY_HUMAN_URL_RE.exec(hu);
    if (!m) return result;   // no relay link, or already a /u/ link (siting walls)
    const target = wall ? tagRelayUrl(dropBuyParam(hu), wall) : dropBuyParam(hu);   // the wall tag rides in the long URL the /u link redirects to
    let link = target;
    try { link = typeof mint === 'function' ? await mint(target) : target; } catch (_) { link = target; }
    if (typeof link !== 'string' || !MINTED_RE.test(link)) link = target;
    const re = new RegExp('https://dchub\\.cloud/upgrade/h/' + _esc(m[1]) + '(?:\\?[^\\s"\'\\\\)\\]}>]*)?', 'g');
    const swap = (s) => s.replace(re, link);
    const { human_url: _h, ...rest } = _deepSwap(sc, swap);
    const structuredContent = { human_url: link, ...rest };
    const swapped = result.content.map((b) => (b && b.type === 'text' && typeof b.text === 'string')
      ? { ...b, text: swap(b.text) } : b);
    const content = _withBlock0Json(swapped, (j) => { const { human_url: _x, ...jr } = j; return { human_url: link, ...jr }; });
    return { ...result, content, structuredContent };
  } catch (_) { return result; }   // a link swap is never worth failing a response over
}

// Wall-to-paid P2 (owner 2026-10-23): on a relay wall the follow-up is the relay, then the SAME tool
// again, never a different tool. Replaces next_ask in structuredContent and in block 0's JSON.
export const WALL_NEXT_ASK_QUESTION = 'Show your human the link in human_url first; once they have opened it, ask again for the full answer.';
export function wallNextAsk(name) {
  return { tool: name, question: WALL_NEXT_ASK_QUESTION, after: 'human_url' };
}
// Guided first query (owner 2026-11-02, "Yes, free tool next"): reverses P2 above. On a relay wall
// next_ask names a DIFFERENT tool whose answer is free, never the walled one (live 2026-11-02: every
// gated answer's next_call pointed back at its own tool, a loop with no answer at its end). The relay
// stays first in the question. Free answers only: get_market_dcpi_rank (verdict + composite are free),
// rank_markets (free rows), and analyze_site for a keyless caller while the daily site lane is on.
// Kill switch DCHUB_WALL_FREE_NEXT=0 restores P2 (same tool, WALL_NEXT_ASK_QUESTION).
export const WALL_FREE_NEXT_LEAD = 'Show your human the link in human_url. Meanwhile, a free answer: ';
const _SITE_NEXT_TOOLS = new Set(['get_fiber_intel', 'get_fiber_readiness', 'plan_fiber_leadin', 'get_metro_fiber',
  'get_composite_site_score', 'compare_sites', 'get_power_availability_timeline', 'analyze_parcel', 'find_sites']);
export function wallFreeNextOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_FREE_NEXT) || '').trim());
}
// opts: { market: a slug or name for this call, siteFree: a keyless caller with the daily site lane on }.
// The ask carries free: true (the next step costs nothing), so lib/next-call.mjs lets it outrank the wall's own next_tool (Muse check
// 2026-11-02: grid's next_call was unlock_more_data, a checkout, while next_ask and the prose both named
// something else).
export function wallFreeNext(name, { market = '', siteFree = false } = {}) {
  const m = typeof market === 'string' ? market.trim() : '';
  const dcpi = () => ({ tool: 'get_market_dcpi_rank', question: WALL_FREE_NEXT_LEAD + 'call get_market_dcpi_rank'
    + (m ? ' for ' + m : ' for the market in question') + ' for its BUILD/CAUTION/AVOID verdict and composite score.', after: 'human_url', free: true });
  const rank = () => ({ tool: 'rank_markets', question: WALL_FREE_NEXT_LEAD
    + 'call rank_markets to see which data-center markets rank best for available power.', after: 'human_url', free: true });
  if (siteFree && name !== 'analyze_site' && _SITE_NEXT_TOOLS.has(name)) {
    return { tool: 'analyze_site', question: WALL_FREE_NEXT_LEAD
      + 'call analyze_site for the site\'s location (a full site analysis, free without a key).', after: 'human_url', free: true };
  }
  if (name === 'get_market_dcpi_rank') return rank();
  if (name === 'rank_markets') return dcpi();
  return m ? dcpi() : rank();
}
// The agent line on a cut-short answer (lib/paid-sell-line.mjs paidAgentLine, lib/grid-sell-line.mjs
// fiberAgentLine) ended "After they pay, call <tool> again in this session for the full answer.", the
// same-tool loop next_ask no longer names. With the free next answer on, that sentence names the free
// tool first; the walled tool stays the route once the human has unlocked it. No plan, no price, no
// "pay". Grid's own tail ("... for the full brief.") is left alone: the claim handoff step swaps it
// for the email tail later in the chain (server.mjs _claimHandoffStep).
export function freeNextAgentTail(name, freeTool) {
  return 'Meanwhile, call ' + freeTool + ' for a free answer (it is next_call). Once your user has unlocked this answer, call '
    + name + ' again in this session for the full answer.';
}
export function withFreeNextAgentLine(content, name, freeTool) {
  if (!Array.isArray(content) || !freeTool || freeTool === name) return content;
  const old = 'After they pay, call ' + name + ' again in this session for the full answer.';
  const tail = freeNextAgentTail(name, freeTool);
  return content.map((b) => (b && b.type === 'text' && typeof b.text === 'string' && b.text.includes(old)
    ? { ...b, text: b.text.split(old).join(tail) } : b));
}
// Grid / queue (owner 2026-11-02, on Muse's check): their keyless preview now gives the free figure first
// and then asks for the email (server.mjs _claimHandoffStep, answer first). Their next step is that ask,
// not another data tool: a second answer would let the email ask drop, and the wall's own next_tool
// (unlock_more_data) is a checkout. next_ask names bind_email with the brief's wording, after the answer;
// free: true lets next_call follow it. The skip clause keeps the answer whatever the user says.
export const EMAIL_NEXT_QUESTION = 'After giving the free answer, ask: "Want to save this check and pick up where you left off? '
  + 'Leave an email; you can skip this and keep the answer either way." Call bind_email only with an address they gave you.';
export function emailNextAsk() {
  return { tool: 'bind_email', question: EMAIL_NEXT_QUESTION, after: 'answer', free: true };
}
export function withEmailNextAsk(result, env = process.env) {
  try {
    if (!wallFreeNextOn(env) || !result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const ask = emailNextAsk();
    const content = _withBlock0Json(result.content, (j) => ({ ...j, next_ask: ask }));
    const sc = result.structuredContent;
    const scOk = sc && typeof sc === 'object' && !Array.isArray(sc);
    return { ...result, content, ...(scOk ? { structuredContent: { ...sc, next_ask: ask } } : {}) };
  } catch (_) { return result; }
}
export function withWallNextAsk(result, name, opts = null) {
  try {
    if (!result || typeof result !== 'object') return result;
    const sc = result.structuredContent;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return result;
    const freeNext = !!(opts && wallFreeNextOn(opts.env));
    const ask = freeNext ? wallFreeNext(name, opts) : wallNextAsk(name);
    const prose = freeNext ? withFreeNextAgentLine(result.content, name, ask.tool) : result.content;
    const content = _withBlock0Json(prose, (j) => (j.next_ask !== undefined ? { ...j, next_ask: ask } : null));
    return { ...result, content, structuredContent: { ...sc, next_ask: ask } };
  } catch (_) { return result; }
}
