// lib/wall-relay-everywhere.mjs — a session-bound relay link on every walled answer (owner 2026-11-21, wall item 1).
//
// WHY. On keyless /mcp (measured 2026-11-21) get_market_dcpi_rank and search_facilities handed the person a signed
// /u/<code> relay link, while every wall the v2 copy rewrites (get_energy_prices, get_interconnection_queue,
// analyze_site, ...) handed out https://dchub.cloud/mcp/connect: a sign-in page that knows nothing about the call.
// analyze_site even promised "this session's next analyze_site call returns the full report" beside that unbound link.
//
// WHAT (behind DCHUB_WALL_RELAY_EVERYWHERE, default OFF; on only for 1 / true / yes / on). server.mjs
// _relayEverywhereStep, placed AFTER the v2 copy (so its /mcp/connect rewrite never sees the link), mints ONE relay
// token per walled answer with the existing signer (_signRelayPayload, the same token buildHumanRelay mints) and three
// more fields, after the ones the backend already parses (pk- / w- / m-):
//   a-<16 hex>   sha256 of the call's arguments (canonical JSON), so the page and its telemetry know WHICH call
//   c-<client>   the client slug (grok, cursor, claude, ...), so the page knows whether a session can carry a key
//   u-<unlock>   what an email on that page really opens for this answer: 'email' (the full answer) or 'licence'
//                (the withheld fields need a DC Hub licence; an email keeps the session, it does not open them)
//   s-<0|1>      1 when a key the page binds reaches the agent's next call by itself (a key in hand, or a real
//                transport session on a client that keeps it); 0 = the page hands the key back as a connector URL
// The long URL carries ?via=mcp-wall&tool=<tool>&client=<client>, is shortened to /u/<code> (the existing mint,
// fail-open to the long URL), and becomes human_url, for_your_human.url and the link in human_message.
// The backend relay page reads the same three fields (dchub-backend routes/wall_relay_page.py): the dated headline,
// "Withheld from this answer:", the email box that binds a key to the token's session (or key), sign in, and
// "See what a licence adds" (LICENCE_URL). A client that opens a fresh session per call (ChatGPT, Grok: the backend
// retention grok_by_key rule) gets the key back as a connector URL on the page instead.
// Pure: no ctx, no network.
import { createHash } from 'node:crypto';

export const WALL_RELAY_EVERYWHERE_FLAG = 'DCHUB_WALL_RELAY_EVERYWHERE';
export function wallRelayEverywhereOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[WALL_RELAY_EVERYWHERE_FLAG]) || '').trim());
}

// "See what a licence adds". /licence does not exist yet; this is the ONE constant every surface reads (the relay
// page's secondary action, the licence block's licence_url). Change it here when /licence ships.
export const LICENCE_URL = 'https://dchub.cloud/connect';
// The sign-in page (secondary action).
export const SIGNIN_PAGE_URL = 'https://dchub.cloud/mcp/connect';

export const UNLOCK_EMAIL = 'email';
export const UNLOCK_LICENCE = 'licence';
export const UNLOCKS = Object.freeze([UNLOCK_EMAIL, UNLOCK_LICENCE]);

const CLIENT_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const TOOL_RE = /^[a-z][a-z0-9_]{1,63}$/;
// The Grok connector's platform string alone is not evidence; its user agent is (dchub-backend ai_platform_canon
// GROK_CONNECTOR_UA_PREFIX, the rule routes/grok_key_retention counts Grok by).
const GROK_UA_PREFIX = 'grok-connectors-manager/';

// The client slug the token carries: the platform the server already resolved, lower-cased to [a-z0-9-]{1,24};
// 'grok' for the Grok connector; 'unknown' when none.
export function relayClient({ platform = '', userAgent = '' } = {}) {
  const p = String(platform || '').trim().toLowerCase();
  const ua = String(userAgent || '').trim().toLowerCase();
  if (p === 'grok' || ua.startsWith(GROK_UA_PREFIX)) return 'grok';
  if (p.includes('chatgpt') || p.includes('openai')) return 'chatgpt';
  const s = p.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return CLIENT_RE.test(s) ? s : 'unknown';
}

// A client that opens a new MCP session for every call: a key bound to the token's session never reaches its next
// call, so the page hands the key back as a connector URL. ChatGPT, and Grok by the grok_by_key rule.
export const FRESH_SESSION_CLIENTS = Object.freeze(new Set(['chatgpt', 'grok']));
export function freshSessionClient(client) { return FRESH_SESSION_CLIENTS.has(String(client || '')); }

// sha256 of the arguments as canonical JSON (keys sorted at every level), first 16 hex. '' arguments hash the same
// as {}.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
export function argsHash(args) {
  const a = (args && typeof args === 'object') ? args : {};
  return createHash('sha256').update(canon(a)).digest('hex').slice(0, 16);
}

// The four token fields, in this order, after pk- / w- / m-.
export function relayBindFields({ args = {}, client = 'unknown', unlock = UNLOCK_LICENCE, sessionBound = false } = {}) {
  const c = CLIENT_RE.test(String(client || '')) ? client : 'unknown';
  const u = UNLOCKS.includes(unlock) ? unlock : UNLOCK_LICENCE;
  return ['a-' + argsHash(args), 'c-' + c, 'u-' + u, 's-' + (sessionBound === true ? '1' : '0')];
}

// ?via=mcp-wall&tool=<tool>&client=<client> (the landing URL's query; '' parts dropped).
export function relayLandingQuery({ tool = '', client = '' } = {}) {
  const q = ['via=mcp-wall'];
  if (TOOL_RE.test(String(tool || ''))) q.push('tool=' + tool);
  if (CLIENT_RE.test(String(client || ''))) q.push('client=' + client);
  return q.join('&');
}

// The person's line, saying exactly what the page behind `link` unlocks for this answer.
//   email + sessionBound   the email there opens the full answer and this session's next call returns it
//   email                  the email there opens the full answer (no session promise: a fresh-session client, or an
//                          unbound link)
//   licence                the withheld fields come with a DC Hub licence; an email does not open them
// No plan name, no price, no "free".
export function relayHumanMessage({ tool = '', link = '', unlock = UNLOCK_LICENCE, sessionBound = false } = {}) {
  const what = TOOL_RE.test(String(tool || '')) ? ' of ' + tool : '';
  const lead = 'Your AI assistant got a preview' + what + ' from DC Hub. ';
  if (unlock === UNLOCK_EMAIL) {
    return lead + 'An email on this page opens the full answer'
      + (sessionBound && tool ? ', and this session’s next ' + tool + ' call returns it' : '') + ': ' + link;
  }
  return lead + 'The withheld fields come with a DC Hub licence, not with an email. See what was withheld: ' + link;
}

// The promises a human_message makes, for the promise test (test/wall-promises-1121): what the page must honour.
export const PROMISE_RES = Object.freeze({
  email: /\b(?:an|with an|their|your) email\b[^.:]*\b(?:opens?|gets?|returns?|unlocks?)\b[^.:]*\bfull\b/i,
  licence: /\blicen[cs]e\b|\bpaid plan\b|\bfull DC Hub access\b/i,
  session: /\bthis session\b/i,
});
export function promisesIn(text) {
  const t = String(text || '');
  return Object.keys(PROMISE_RES).filter((k) => PROMISE_RES[k].test(t)).sort();
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (b) => b && b.type === 'text' && typeof b.text === 'string';
const isJsonText = (b) => isText(b) && /^\s*\{/.test(b.text);
export const FOR_HUMAN_LEAD = '→ **For your human:** ';
export const LINK_LABEL = '[See the full answer on DC Hub]';

// The result with `link` as its human link and `message` as its person's line: structuredContent.human_url (first
// key), human_message, user_message, for_your_human {message, url, text, markdown}; the first JSON block's human_url
// (first key) and human_message when it carries them; the "For your human" prose block (replaced, or added before the
// closing Source / brand lines). Every other copy of `oldLink` in prose becomes `link` when `oldLink` was a relay link
// (/u/ or /upgrade/h/); a sign-in pointer (/mcp/connect) elsewhere is left as it is (it is still the sign-in page).
export function withRelayLink(result, { link, message, oldLink = '' } = {}) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !link) return result;
  const sc0 = isObj(result.structuredContent) ? result.structuredContent : {};
  const fy0 = isObj(sc0.for_your_human) ? sc0.for_your_human : {};
  const fy = { ...fy0, message, url: link, text: message, markdown: LINK_LABEL + '(' + link + ')',
    render: fy0.render || 'verbatim_link_required' };
  const { human_url: _h, ...rest } = sc0;
  const sc = { human_url: link, ...rest, for_your_human: fy, human_message: message };
  if (sc0.user_message !== undefined) sc.user_message = message;
  const relayOld = /^https:\/\/dchub\.cloud\/(?:u\/|upgrade\/h\/)/.test(String(oldLink || ''));
  const swapOld = (s) => (relayOld && typeof s === 'string' ? s.split(oldLink).join(link) : s);
  let jsonDone = false;
  let content = result.content.map((b) => {
    if (!isText(b)) return b;
    if (!jsonDone && isJsonText(b)) {
      jsonDone = true;
      try {
        const o = JSON.parse(b.text);
        if (isObj(o) && (o.human_url !== undefined || o.human_message !== undefined)) {
          const { human_url: _x, ...jr } = o;
          const next = { human_url: link, ...jr };
          if (o.human_message !== undefined) next.human_message = message;
          if (isObj(o.for_your_human)) next.for_your_human = fy;
          return { ...b, text: JSON.stringify(next) };
        }
      } catch (_) { /* cut or prose JSON: left as it is */ }
      return b;
    }
    if (b.text.startsWith(FOR_HUMAN_LEAD)) return { ...b, text: FOR_HUMAN_LEAD + message };
    return { ...b, text: swapOld(b.text) };
  });
  if (!content.some((b) => isText(b) && b.text.startsWith(FOR_HUMAN_LEAD))) {
    let at = content.length;
    while (at > 1 && isText(content[at - 1]) && /^(?:Source:|DC Hub:)/.test(content[at - 1].text)) at -= 1;
    content = content.slice();
    content.splice(at, 0, { type: 'text', text: FOR_HUMAN_LEAD + message });
  }
  return { ...result, content, structuredContent: sc };
}
