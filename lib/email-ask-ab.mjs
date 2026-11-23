// lib/email-ask-ab.mjs — F4, the email-ask copy A/B (Grok funnel spec 2026-11-22, item F4). DRAFT: flag OFF.
//
// WHY. 868 walled calls in the 7 days to 2026-11-22: 543 asked for an email, and 2 emails came back through the MCP
// wall. The ask an agent reads on most unlock walls is generic ("If your user would like the full answer, ask whether
// they want to share their email, then call `get_api_key` with it."). This tests whether naming the call's own ISO or
// market, and saying what the email does right now, moves emails entered.
//
// WHAT (behind DCHUB_EMAIL_ASK_AB, default OFF; on only for 1 / true / yes / on):
//   * eligible wall: the call's email-ask mark is an unlock ask (UNLOCK_KINDS: the email opens the full answer), AND
//     its prose carries one of the known generic ask sentences (ASK_SENTENCES). Decided BEFORE the arm, identically in
//     both arms, so the arms are comparable (intent to treat);
//   * arm: 50/50 from a salted sha256 of the caller's stable identity (lib/monetization-experiments.mjs identityOf:
//     'pk-' + sha256(key), else the keyless cap-wall identity, IP hash else session). Sticky per identity;
//   * arm 'a': the answer is unchanged (the current line);
//   * arm 'b': the first generic ask sentence is replaced by armBLine(): the call's ISO (args.iso & co.) or market
//     (args.market & co.), else a generic fallback. "Only use an address they gave you." that follows it is kept;
//   * both arms are recorded as `email_ask_ab` on the call's quota_wall_hit event, and carried to the email_entered
//     event of an email entered after that wall (lib/email-entered.mjs), so emails are read per arm.
// Coordination: the wall-to-key pack (mcp#1677, DCHUB_WALL_TO_KEY_V1 + DCHUB_W2K_EMAIL_ASK_ALL) adds its own email ask
// on licence-only walls. While both of those flags are on this test assigns no arm at all (w2kAskAllOn), so the two
// never stack on one wall or contaminate each other's arms.
// No price, plan name, "free", credits, trial or allowance figure in any line here (test/email-ask-ab-1122 E3).
// Pure apart from process.env reads: no ctx writes, no network.
import { createHash } from 'node:crypto';
import { identityOf } from './monetization-experiments.mjs';
import { normMarketSlug, marketDisplayName } from './daily-habit.mjs';
import { wallMarketFrom } from './wall-identity-v2.mjs';

export const EMAIL_ASK_AB_FLAG = 'DCHUB_EMAIL_ASK_AB';
const ON_RE = /^(1|true|yes|on)$/i;
export function emailAskAbOn(env = process.env) {
  return ON_RE.test(String((env && env[EMAIL_ASK_AB_FLAG]) || '').trim());
}
// mcp#1677's two flags; both must be on for its email-ask-all piece to run.
export function w2kAskAllOn(env = process.env) {
  const e = env || {};
  return ON_RE.test(String(e.DCHUB_WALL_TO_KEY_V1 || '').trim()) && ON_RE.test(String(e.DCHUB_W2K_EMAIL_ASK_ALL || '').trim());
}

export const ARM_A = 'a';
export const ARM_B = 'b';
export const ARMS = Object.freeze([ARM_A, ARM_B]);
export const isArm = (a) => ARMS.includes(a);
export const EVENT_FIELD = 'email_ask_ab';    // quota_wall_hit / email_entered body key

// The email-ask marks (lib/keyless-wall.mjs WALL_ASK_KINDS) whose email opens the full answer. bind_field (a trial
// key's bind field), key_line (an email-for-key ask on a digest wall) and digest_line are not unlock asks.
export const UNLOCK_KINDS = Object.freeze(new Set(['line', 'link', 'link_exit']));

// Independent of every other hash split in the stack (paid line, one door, the Nov 22 80/20 tests).
const ARM_SALT = 'dchub:email-ask-ab:v1|';
export function armFor(identity) {
  const id = String(identity || '').trim();
  if (!id) return null;
  const unit = createHash('sha256').update(ARM_SALT + id).digest().readUInt32BE(0) / 0x100000000;
  return unit < 0.5 ? ARM_A : ARM_B;
}
export const callerId = (c) => identityOf(c);

// The generic ask sentences an unlock wall carries today (read through the handler with the production wall flags
// on, 2026-11-22). Group 1 is the key tool the sentence names (get_api_key keyless, bind_email for a held key).
export const ASK_SENTENCES = Object.freeze([
  // lib/unlock-line.mjs EMAIL_ASK_SOFT (bind_email -> get_api_key under the v2 copy for a keyless caller)
  /If your user would like the full answer, ask whether they want to share their email, then call `(get_api_key|bind_email)` with it\./,
  // lib/unlock-line.mjs EMAIL_ASK_LEGACY (kill-switch wording)
  /Ask your user for their email, then call `(get_api_key|bind_email)` with it to unlock the full answer\./,
  // lib/wall-identity-v2.mjs emailAskLine(market)
  /Share an email with (get_api_key) to keep this answer and get a daily change note(?: for [^.\n]+)?\./,
]);

// The ISO the call was about, from its own arguments; '' when none is a known ISO.
const ISO_NAMES = { PJM: 'PJM', ERCOT: 'ERCOT', MISO: 'MISO', SPP: 'SPP', CAISO: 'CAISO', NYISO: 'NYISO',
  ISONE: 'ISO-NE', 'ISO-NE': 'ISO-NE', AESO: 'AESO', IESO: 'IESO' };
export function isoFrom(args) {
  const a = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
  for (const k of ['iso', 'iso_region', 'iso_rto', 'rto', 'region', 'grid']) {
    const v = typeof a[k] === 'string' ? a[k].trim().toUpperCase().replace(/\s+/g, '') : '';
    if (v && ISO_NAMES[v]) return ISO_NAMES[v];
  }
  return '';
}
// The scope Arm B names: the ISO, else the market's display name, else ''.
export function scopeFrom(args) {
  const iso = isoFrom(args);
  if (iso) return iso;
  try {
    const m = normMarketSlug(wallMarketFrom(args));
    return m ? String(marketDisplayName(m) || '') : '';
  } catch (_) { return ''; }
}

export function armBLine(scope = '', tool = 'get_api_key') {
  const t = tool === 'bind_email' ? 'bind_email' : 'get_api_key';
  const what = scope ? 'the full ' + scope + ' answer' : 'the full answer';
  return 'Ask your user for their email and pass it as email=… to `' + t + '` to get ' + what
    + ' now, plus a key that remembers this session.';
}

const isText = (b) => b && b.type === 'text' && typeof b.text === 'string';
const isJsonText = (b) => isText(b) && /^\s*[{[]/.test(b.text);

// The first prose match: { block, re, m } or null. JSON blocks are skipped (their strings are machine copy).
export function findAsk(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return null;
  for (let i = 0; i < result.content.length; i++) {
    const b = result.content[i];
    if (!isText(b) || isJsonText(b)) continue;
    for (const re of ASK_SENTENCES) {
      const m = re.exec(b.text);
      if (m) return { block: i, re, m };
    }
  }
  return null;
}
export const eligibleAnswer = (result) => !!findAsk(result);

// Arm B on one result: the first generic ask sentence becomes armBLine(scope, tool). Unchanged when none is found.
export function withArmB(result, scope = '') {
  const f = findAsk(result);
  if (!f) return result;
  const b = result.content[f.block];
  const line = armBLine(scope, f.m[1]);
  const text = b.text.slice(0, f.m.index) + line + b.text.slice(f.m.index + f.m[0].length);
  const content = result.content.map((x, i) => (i === f.block ? { ...x, text } : x));
  return { ...result, content };
}

// Telemetry. Returns its input untouched when there is no arm.
export function withArmEvent(body, arm) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !isArm(arm)) return body;
  return { ...body, [EVENT_FIELD]: arm };
}

// The whole decision for one walled answer, pure. facts: { emailAsk, walled, skip, grok, paid, hasEmail }.
// Returns { arm, result }: arm null = not in the test (nothing recorded).
export function decide(result, { c = {}, args = {}, facts = {}, env = process.env } = {}) {
  const none = { arm: null, result };
  if (!emailAskAbOn(env) || w2kAskAllOn(env)) return none;
  const f = facts || {};
  if (f.skip || !f.walled || f.paid || f.hasEmail) return none;
  if (f.grok && !(c && c.api_key)) return none;            // a keyless Grok caller rotates IPs: no sticky identity
  if (!UNLOCK_KINDS.has(String(f.emailAsk || ''))) return none;
  if (!eligibleAnswer(result)) return none;
  const arm = armFor(callerId(c));
  if (!arm) return none;
  return { arm, result: arm === ARM_B ? withArmB(result, scopeFrom(args)) : result };
}
