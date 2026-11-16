// human-email-reply.mjs -- the person's line carries the email offer (Grok to Brain 2026-11-16, paywall
// email-ask read: walls offered 765, identities 149, converted 0).
//
// WHY. On a wall where an email opens the answer (grid, queue, rank_markets, the free-key walls), the email
// ask is written to the AGENT ("If your user would like the full answer, ask whether they want to share their
// email, then call `bind_email`"). The line written to the PERSON, the one every client is told to show
// verbatim (→ For your human / user_message / for_your_human / human_message), never named the email. Live
// 2026-11-16 on a keyless get_interconnection_queue first wall it said "DC Hub's paid layer has `projects` for
// this query — open <link> to see it and unlock": "paid" on rows the same response offers free for an email.
// On the session's later walls it said "free: 50 MCP calls/day with an email. Open this link to see what it
// found and how to unlock it". So a person who reads only what the agent relays sees a link to a page, never
// that they can type an email into the chat they are already in, and the agent's ask is conditional
// ("if your user would like"), so most agents answer and move on. 0 of 149 identities bound an email.
//
// WHAT. Where the response already asks the agent for an unlock email, the person's line says the same thing
// in the person's words: what is behind the wall (the existing clause, without "paid layer"), then
// "Free: reply with your email and your assistant can unlock the full answer here, no card needed. Or open
// <link> ...". The link, the marker, the agent paragraph and every machine field are unchanged. The agent
// paragraph already tells the agent what to do with the email the person types (`bind_email`, only an
// address they gave).
//
// WHO. Decided in server.mjs (_humanEmailReplyStep): only a response whose own wall marked an email UNLOCK
// ask (email_ask line / link / link_exit / bind_field; never key_line, where an email opens no field), whose
// prose names `bind_email`, for a caller with no bound email, outside the directory / Claude / core profiles,
// the clean platforms and the Grok contract (their copy is frozen or carries no ask). So the line only says
// "free" where the response itself already offers the free unlock.
//
// Numbers: none. The free allowance stays where canon prints it (lib/tier-canon.mjs, lib/unlock-line.mjs);
// this sentence names no count, plan or price, so it cannot drift from canon.
//
// Kill switch DCHUB_HUMAN_EMAIL_REPLY=0 (read per call): every line as it was, byte for byte.

export const HUMAN_EMAIL_REPLY_FLAG = 'DCHUB_HUMAN_EMAIL_REPLY';
export function humanEmailReplyOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[HUMAN_EMAIL_REPLY_FLAG]) || '').trim());
}

// The sentence the person reads. "your assistant" is the agent (the line is relayed in the agent's voice
// or quoted; both read right). "here" = the chat they are in.
export const HUMAN_EMAIL_REPLY = 'Free: reply with your email and your assistant can unlock the full answer here, '
  + 'no card needed.';

const MARKER = '→ **For your human:**';
const PAID_LAYER = 'DC Hub\u2019s paid layer has ';
const PAID_LAYER_ASCII = "DC Hub's paid layer has ";
const URL_RE = /https:\/\/dchub\.cloud\/[^\s"'\\)\]}>]+/;

// The three endings buildHumanFirstLine writes (server.mjs), longest first. Each is " — open <url> ..." or,
// with nothing specific to say, " open <url> — see what your agent found and how to unlock it."
const ENDINGS = [
  { re: /\s+—\s+open (\S+?) to see it and unlock\.\s*$/, tail: ' to see what your agent found.' },
  { re: /\s+—\s+open (\S+?) to see what your agent found\.\s*$/, tail: ' to see what your agent found.' },
];
const GENERIC = /^\s*open (\S+?) — see what your agent found and how to unlock it\.\s*$/;

// One person's line (the text after the marker, or the whole user_message / for_your_human.text). Returns
// the rewritten line, or null when the line is not one of the shapes this knows (then nothing changes).
// A line that names a plan for what it hid (lib/upgrade-missed.mjs relayMissedClause: "the lowest plan that
// returns them is …", "the plans that return them …") says those fields are NOT the email's to open: left as
// it is, so the person never reads "free" beside a paid field.
const NAMES_A_PLAN = /\b(?:lowest plan that returns them|plans that return them)\b/;
// After a lead that already says "free" (the relay message's "; free: 50 MCP calls/day with an email"), the
// sentence drops its own "Free:".
const _reply = (head) => (/\bfree\b/i.test(head || '') ? HUMAN_EMAIL_REPLY.replace(/^Free: r/, 'R') : HUMAN_EMAIL_REPLY);

const _alreadySaid = (s) => /reply with your email and your assistant can unlock/i.test(s);

export function rewriteHumanLine(line) {
  if (typeof line !== 'string' || !line || _alreadySaid(line) || NAMES_A_PLAN.test(line)) return null;
  const g = GENERIC.exec(line);
  if (g) return HUMAN_EMAIL_REPLY + ' Or open ' + g[1] + ' to see what your agent found.';
  for (const e of ENDINGS) {
    const m = e.re.exec(line);
    if (!m) continue;
    const what = line.slice(0, m.index).split(PAID_LAYER).join('DC Hub has ').split(PAID_LAYER_ASCII).join('DC Hub has ');
    return what.replace(/[\s.;:—-]+$/, '') + '. ' + _reply(what) + ' Or open ' + m[1] + e.tail;
  }
  return null;
}

// The relay message (buildHumanRelay, for_your_human.message) on a session's later walls:
// "<lead>. Open this link to see what it found and how to unlock it:" -> "<lead>. <reply>. Or open this link
// to see what it found:". Also the self-contained form with the link inside ("... unlock it. <url>").
const RELAY_TAIL = /\.\s+Open this link to see what it found and how to unlock it(:|\.\s+(https:\/\/\S+))\s*$/;
export function rewriteRelayMessage(msg) {
  if (typeof msg !== 'string' || !msg || _alreadySaid(msg) || NAMES_A_PLAN.test(msg)) return null;
  const m = RELAY_TAIL.exec(msg);
  if (!m) return null;
  const head = msg.slice(0, m.index);
  return head + '. ' + _reply(head) + (m[2] ? ' Or open this link to see what it found: ' + m[2]
    : ' Or open this link to see what it found:');
}

function _rewriteAny(v) {
  if (typeof v !== 'string') return null;
  return rewriteHumanLine(v) || rewriteRelayMessage(v);
}

// Apply to one final result: the marker line in any prose block, and the structured person fields.
// Pure; returns the same object when nothing matched.
export function applyHumanEmailReply(result) {
  try {
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    let changed = false;
    const content = result.content.map((b) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string' || !b.text.includes(MARKER)) return b;
      if (/^\s*[{[]/.test(b.text)) return b;   // a JSON block: machine text, never rewritten
      const lines = b.text.split('\n').map((l) => {
        const at = l.indexOf(MARKER);
        if (at < 0) return l;
        const nl = rewriteHumanLine(l.slice(at + MARKER.length).trim());
        return nl ? l.slice(0, at) + MARKER + ' ' + nl : l;
      });
      const t = lines.join('\n');
      if (t === b.text) return b;
      changed = true;
      return { ...b, text: t };
    });
    const sc0 = result.structuredContent;
    let sc = sc0;
    if (sc0 && typeof sc0 === 'object' && !Array.isArray(sc0)) {
      const next = { ...sc0 };
      for (const k of ['user_message', 'human_message']) {
        const r = _rewriteAny(sc0[k]);
        if (r) { next[k] = r; changed = true; }
      }
      const f = sc0.for_your_human;
      if (f && typeof f === 'object' && !Array.isArray(f)) {
        const nf = { ...f };
        let fc = false;
        for (const k of ['text', 'message']) {
          const r = _rewriteAny(f[k]);
          if (r) { nf[k] = r; fc = true; }
        }
        if (fc) { next.for_your_human = nf; changed = true; }
      }
      sc = next;
    }
    if (!changed) return result;
    return { ...result, content, structuredContent: sc };
  } catch (_) { return result; }   // copy only: never break a response
}

// The URL a rewritten line must still carry (tests read it).
export const lineUrl = (s) => { const m = typeof s === 'string' ? URL_RE.exec(s) : null; return m ? m[0] : null; };
