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

const RELAY_HUMAN_URL_RE = /^https:\/\/dchub\.cloud\/upgrade\/h\/([A-Za-z0-9_-]+\.[0-9a-f]{32})(\?[^\s"'\\)\]}>]*)?$/;
const MINTED_RE = /^https:\/\/dchub\.cloud\/(?:u\/[2-9a-hj-km-np-z]{6}|upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[a-z0-9_=&]{1,200})?)$/;

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
export async function shortWallLinkStep(result, { mint, env } = {}) {
  try {
    if (!wallShortAllOn(env)) return result;
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const sc = result.structuredContent;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return result;
    const hu = typeof sc.human_url === 'string' ? sc.human_url : '';
    const m = RELAY_HUMAN_URL_RE.exec(hu);
    if (!m) return result;   // no relay link, or already a /u/ link (siting walls)
    const target = dropBuyParam(hu);
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
export function withWallNextAsk(result, name) {
  try {
    if (!result || typeof result !== 'object') return result;
    const sc = result.structuredContent;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return result;
    const ask = wallNextAsk(name);
    const content = _withBlock0Json(result.content, (j) => (j.next_ask !== undefined ? { ...j, next_ask: ask } : null));
    return { ...result, content, structuredContent: { ...sc, next_ask: ask } };
  } catch (_) { return result; }
}
