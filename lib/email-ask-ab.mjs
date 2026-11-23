// lib/email-ask-ab.mjs — F4 "Email-ask A/B" (Grok spec via the owner, 2026-11-22). DRAFT: flag DCHUB_EMAIL_ASK_AB,
// default OFF. Off, nothing here runs and every wall is byte-identical to before.
//
// WHAT IT TESTS: on an unlock-ask wall (the keyless cap wall, hard or soft, whose email link opens the answer: the walls
// marked email_ask 'link' / 'link_exit', unlock_kind 'email_cap'), does an ask that names the call's own market or ISO
// get more emails than today's generic ask?
//   arm A (holdout)   today's ask, unchanged.
//   arm B (treatment) the ask line names the call's market ("Add an email to get the full Dallas answer: <link>") or
//                     ISO ("... the full ERCOT queue: <link>"), read from the call's own arguments. With neither, or
//                     where an email does not open this tool's full answer, arm B shows arm A's text and is still
//                     recorded as arm B (intent to treat).
// Only the copy of an ask that is already there changes: no wall gains an ask, none loses one, enforcement is unchanged.
//
// ASSIGNMENT: the shared one (lib/monetization-experiments.mjs, test exp_email_ask_ab, 50/50), sticky per identity.
// RECORDING: the exposure (both arms) goes to experiment_exposure (once per identity per UTC day per replica), the arm
// rides the call's quota_wall_hit row as `email_ask_ab` ('a' | 'b'), and a later successful email entry by the same
// identity posts email_captured. Readout: GET /api/v1/mcp/funnel/experiments, exp_email_ask_ab.
//
// WALL TO KEY (mcp#1677, another session's draft): its DCHUB_W2K_EMAIL_ASK_ALL path writes its own email_ask
// ({tool: 'get_api_key', ...}) onto a wall. A result that carries any email_ask other than the cap wall's own
// (lib/daily-habit.mjs wallEmailAsk, recognisable by its `copy` sentence) is left untouched here and gets no exposure,
// so the two tests never apply to the same call.
//
// Pure apart from the exposure memo: no ctx, no network.
import { wallMarketSlug, marketDisplayName } from './keyless-wall.mjs';
import { DAILY_ASK_LEAD } from './daily-habit.mjs';
import { EMAIL_ASK_AB, TREATMENT, HOLDOUT, armFor, expOn } from './monetization-experiments.mjs';

export const FLAG = 'DCHUB_EMAIL_ASK_AB';
export const TEST = EMAIL_ASK_AB;
export const ARM_A = 'a';
export const ARM_B = 'b';
export const EVENT_FIELD = 'email_ask_ab';
export const UNLOCK_ASK_KINDS = new Set(['link', 'link_exit']);

export function emailAskAbOn(env = process.env) { return expOn(EMAIL_ASK_AB, env); }

// The shared arm, as the wall row's letter: treatment = B, holdout = A.
export function armLetter(identity) {
  if (!identity) return '';
  return armFor(identity, EMAIL_ASK_AB) === TREATMENT ? ARM_B : ARM_A;
}
export const MX_ARM = Object.freeze({ [ARM_B]: TREATMENT, [ARM_A]: HOLDOUT });

// The ISOs an ask may name (closed set; anything else names nothing).
const ISO_NAMES = Object.freeze({
  ERCOT: 'ERCOT', PJM: 'PJM', CAISO: 'CAISO', MISO: 'MISO', SPP: 'SPP', NYISO: 'NYISO', ISONE: 'ISO-NE', 'ISO-NE': 'ISO-NE',
});
export const QUEUE_TOOLS = new Set(['get_interconnection_queue', 'get_refined_queue']);
export function isoOf(args) {
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
    const v = typeof args.iso === 'string' ? args.iso : (typeof args.iso_code === 'string' ? args.iso_code : '');
    const k = v.trim().toUpperCase().replace(/[\s_]+/g, '-');
    return ISO_NAMES[k] || ISO_NAMES[k.replace(/-/g, '')] || '';
  } catch (_) { return ''; }
}
// What the call names: a market first, else an ISO, else null.
export function askSubject(args) {
  const m = wallMarketSlug(args);
  if (m) return { kind: 'market', label: marketDisplayName(m) };
  const iso = isoOf(args);
  if (iso) return { kind: 'iso', label: iso };
  return null;
}
// Arm B's ask line, or '' (= show arm A's line). Never a price, plan, allowance or tool count.
export function armBLine({ subject, link, tool = '', emailOpens = true } = {}) {
  if (!subject || !subject.label || !link || !emailOpens) return '';
  const what = subject.kind === 'iso' && QUEUE_TOOLS.has(String(tool)) ? 'queue' : 'answer';
  return 'Add an email to get the full ' + subject.label + ' ' + what + ': ' + link;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// An email_ask this wall did not build itself (mcp#1677's, or any other step's). The cap wall's own ask is
// lib/daily-habit.mjs wallEmailAsk: an object whose `copy` is the owner-approved daily sentence.
export function foreignEmailAsk(sc) {
  const own = (a) => isObj(a) && typeof a.copy === 'string' && a.copy.startsWith(DAILY_ASK_LEAD);
  if (!isObj(sc)) return false;
  for (const a of [sc.email_ask, isObj(sc._upgrade) ? sc._upgrade.email_ask : undefined]) {
    if (a !== undefined && a !== null && !own(a)) return true;
  }
  return false;
}
// The unlock-ask wall this result is, or null: its structured content, the ask line it shows and the link in it.
export function unlockAskWall(result, askKind) {
  if (!UNLOCK_ASK_KINDS.has(askKind) || !result || typeof result !== 'object' || !Array.isArray(result.content)) return null;
  const sc = result.structuredContent;
  if (!isObj(sc)) return null;
  const up = isObj(sc._upgrade) ? sc._upgrade : {};
  if (sc.unlock_kind !== 'email_cap' && up.unlock_kind !== 'email_cap') return null;
  const line = typeof sc.user_message === 'string' ? sc.user_message : '';
  const link = (typeof sc.human_url === 'string' && sc.human_url) || (typeof up.human_url === 'string' && up.human_url) || '';
  if (!line || !link || !line.includes(link)) return null;
  return { sc, line, link };
}

function deepReplace(v, from, to, d = 0) {
  if (typeof v === 'string') return v.includes(from) ? v.split(from).join(to) : v;
  if (d > 8 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => deepReplace(x, from, to, d + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = deepReplace(x, from, to, d + 1);
  return o;
}
// Every copy of `from` in the result (text blocks, JSON text, structuredContent) becomes `to`.
export function replaceLine(result, from, to) {
  if (!from || from === to) return result;
  const content = result.content.map((b) => (b && b.type === 'text' && typeof b.text === 'string' && b.text.includes(from)
    ? { ...b, text: b.text.split(from).join(to) } : b));
  const out = { ...result, content };
  if (isObj(result.structuredContent)) out.structuredContent = deepReplace(result.structuredContent, from, to);
  return out;
}

// The A/B on one result. Pure. {result, eligible, arm, applied, reason}:
//   eligible false: not an unlock-ask wall, no identity, or another step's email ask is on it (result untouched,
//                   nothing recorded); reason says which.
//   arm 'a': result untouched. arm 'b': the line names the subject (applied) or falls back to A's text (applied false).
export function applyEmailAskAb(result, { identity = '', args = {}, tool = '', askKind = '', emailOpens = true } = {}) {
  const no = (reason) => ({ result, eligible: false, arm: '', applied: false, reason });
  try {
    const w = unlockAskWall(result, askKind);
    if (!w) return no('not_unlock_ask_wall');
    if (foreignEmailAsk(w.sc)) return no('other_email_ask');
    if (!identity) return no('no_identity');
    const arm = armLetter(identity);
    if (arm !== ARM_B) return { result, eligible: true, arm, applied: false, reason: 'arm_a' };
    const line = armBLine({ subject: askSubject(args), link: w.link, tool, emailOpens });
    if (!line) return { result, eligible: true, arm, applied: false, reason: emailOpens ? 'no_subject' : 'email_does_not_open' };
    return { result: replaceLine(result, w.line, line), eligible: true, arm, applied: true, reason: 'named' };
  } catch (_) { return no('error'); }
}

// The wall row's field. Any other value adds nothing.
export function withArmEvent(body, arm) {
  if (!body || typeof body !== 'object' || (arm !== ARM_A && arm !== ARM_B)) return body;
  return { ...body, [EVENT_FIELD]: arm };
}

// One exposure row per identity per UTC day per replica (a restart may send one more; the readout counts identities).
const _seen = new Map();
export function exposureDue(identity, now = Date.now()) {
  if (!identity) return false;
  const k = identity + '|' + new Date(now).toISOString().slice(0, 10);
  if (_seen.has(k)) return false;
  if (_seen.size >= 50000) _seen.clear();
  _seen.set(k, 1);
  return true;
}
export function _resetForTests() { _seen.clear(); }
