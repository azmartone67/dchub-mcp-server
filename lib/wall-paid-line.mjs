// lib/wall-paid-line.mjs — the wall "paid license" line, a single-surface A/B test (owner relay from Grok, 2026-11-21).
//
// WHY. A keyless / trial-key wall on /mcp tells the agent how to sign in or share an email, but nothing in it tells the
// person behind the agent that there is something to buy. This adds ONE plain sentence the agent can pass on, and
// measures whether it moves anything: no dollar amount, no plan name, no credits, no calls-per-day.
//
// WHAT (behind DCHUB_WALL_PAID_LINE, default OFF; on only for 1 / true / yes / on):
//   * a walled answer on the generic /mcp surface, for a keyless or trial-key caller, assigns the caller an arm from a
//     salted sha256 of its stable identity (paidLineArm): 'paid_line' (half) or 'control' (half);
//   * the paid_line arm reads PAID_LINE as its own text block right after the sign-in line (or, with no sign-in line,
//     where the sign-in line would go: right after the answer's JSON block), at most once per (session, tool) like the
//     sign-in line, and PAID_LINE_SHORT in structuredContent.next_ask.full_access when the answer carries a next_ask
//     (the tight field), mirrored in the JSON block's next_ask;
//   * both arms are recorded: params._wall_paid_line on the call's /api/v1/mcp/track row (mcp_call_log.params, jsonb,
//     no schema change) and wall_paid_line on its quota_wall_hit funnel event (ignored by today's backend until a
//     column is added; see the PR for the readout that needs).
// Placed by server.mjs _wallPaidLineStep AFTER _wallCopyV2Step, so the v2 human-link rewrite (every dchub.cloud/connect
// link, query string and all, becomes /mcp/connect) never sees the tagged URL. It does not go through
// lib/wall-offers.mjs (one route per wall, mintedOnly): it is an added line, not a route.
// Never: /mcp/chatgpt or any ChatGPT / OpenAI client, /mcp/claude, /mcp/core, Grok, any path but /mcp, a loopback
// (execute_plan step) call, the key / account tools, a non-trial key, a device-matched caller. Keyless gating, tiers
// and quotas are untouched: only copy is added. No network; markHeldTrackRows is the one function that writes (the
// held telemetry rows on ctx).
import { createHash } from 'node:crypto';
import { capWallIdentity } from './keyless-wall.mjs';
import { SIGNIN_LINE } from './wall-identity-v2.mjs';

export const WALL_PAID_LINE_FLAG = 'DCHUB_WALL_PAID_LINE';
export function wallPaidLineOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[WALL_PAID_LINE_FLAG]) || '').trim());
}

// The owner's copy, verbatim (relay 2026-11-21). The URL is tagged so a /connect visit from it can be told apart.
export const PAID_LINE_URL = 'https://dchub.cloud/connect?via=mcp-wall&v=paid-line';
export const PAID_LINE = 'Full access is a paid DC Hub license. Your user can review options and get one at ' + PAID_LINE_URL;
export const PAID_LINE_SHORT = 'Full access needs a paid license: ' + PAID_LINE_URL;
export const NEXT_ASK_FIELD = 'full_access';

export const ARM_PAID_LINE = 'paid_line';
export const ARM_CONTROL = 'control';
export const PAID_LINE_ARMS = Object.freeze([ARM_PAID_LINE, ARM_CONTROL]);
export const TRACK_FIELD = '_wall_paid_line';     // mcp_call_log.params key
export const EVENT_FIELD = 'wall_paid_line';      // quota_wall_hit body key

// The only path this test runs on. Packs, registry paths, /mcp/grok, /mcp/claude, /mcp/chatgpt and /mcp/core are out.
export const PAID_LINE_PATH = '/mcp';

// The caller's stable identity: the key it holds (a trial key keeps its arm when its IP or session changes), else
// the keyless cap wall's own per-caller identity (lib/keyless-wall.mjs capWallIdentity: the IP hash, else the
// session). '' when there is nothing stable to key on.
export function paidLineCallerId(c) {
  const x = (c && typeof c === 'object') ? c : {};
  if (x.api_key) return 'key-' + createHash('sha256').update(String(x.api_key)).digest('hex');
  try { return capWallIdentity(x) || ''; } catch (_) { return ''; }
}

// The salt keeps this split independent of every other hash-based split in the stack (the continuation arm, the
// paywall contract, the first-plan depth test): two correlated randomizations would be one confounded one.
const ARM_SALT = 'dchub:wall-paid-line:v1|';
// The arm for an identity: 'paid_line' or 'control', stable per identity; null with no identity (no arm, no line,
// nothing recorded: an effect that cannot be attributed to a caller is not evidence).
export function paidLineArm(identity) {
  const id = String(identity || '').trim();
  if (!id) return null;
  const unit = createHash('sha256').update(ARM_SALT + id).digest().readUInt32BE(0) / 0x100000000;
  return unit < 0.5 ? ARM_PAID_LINE : ARM_CONTROL;
}
export const isPaidLineArm = (a) => PAID_LINE_ARMS.includes(a);

// Is this call on the generic /mcp surface? `facts` are server.mjs's own reads: profile (ctx.profile: the directory,
// Claude and core profiles set it), grok (lib/paywall-contract.mjs isGrokPlatform), clean (a ChatGPT / OpenAI or
// DCHUB_CLEAN_PLATFORMS client).
export function paidLineSurface(c, { grok = false, clean = false } = {}) {
  const x = (c && typeof c === 'object') ? c : null;
  if (!x || x.loopback_step || x.device_match === true) return false;
  if (x.profile) return false;
  if (grok || clean || /chatgpt|openai/i.test(String(x.platform || ''))) return false;
  return String(x.path || '') === PAID_LINE_PATH;
}

// Keyless, or a trial key: the two walls this test is about. A paid / claimed key never meets this line.
export function paidLineCaller(c) {
  const x = (c && typeof c === 'object') ? c : {};
  if (!x.api_key) return true;
  return x.is_trial === true || /^dch_trial_/.test(String(x.api_key));
}

const isText = (b) => b && b.type === 'text' && typeof b.text === 'string';
const isJsonText = (b) => isText(b) && /^\s*[{[]/.test(b.text);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const withShort = (o) => (isObj(o) && isObj(o.next_ask) && o.next_ask[NEXT_ASK_FIELD] === undefined
  ? { ...o, next_ask: { ...o.next_ask, [NEXT_ASK_FIELD]: PAID_LINE_SHORT } } : o);

// The paid line on one result: PAID_LINE as its own block right after the block carrying `signInLine`, else right
// after the answer's JSON block (block 1 when there is none); PAID_LINE_SHORT in next_ask.full_access (structured
// and the JSON block). Never twice. Returns the result unchanged when it is not a content result.
export function withPaidLine(result, { signInLine = SIGNIN_LINE } = {}) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !result.content.length) return result;
  if (result.content.some((b) => isText(b) && b.text.includes(PAID_LINE))) return result;
  let blocks = result.content.map((b) => {
    if (!isJsonText(b) || !/"next_ask"/.test(b.text)) return b;
    try {
      const o = JSON.parse(b.text);
      const n = withShort(o);
      if (n === o) return b;
      // Same layout as the block had (compact or 2-space); any other layout is left as it is.
      for (const ind of [undefined, 2]) if (b.text === JSON.stringify(o, null, ind)) return { ...b, text: JSON.stringify(n, null, ind) };
      return b;
    } catch (_) { return b; }   // cut or prose JSON: left as it is
  });
  const si = signInLine ? blocks.findIndex((b) => isText(b) && b.text.includes(signInLine)) : -1;
  const j = blocks.findIndex(isJsonText);
  const at = si >= 0 ? si + 1 : (j >= 0 ? j + 1 : 1);
  blocks = blocks.slice();
  blocks.splice(Math.min(at, blocks.length), 0, { type: 'text', text: PAID_LINE });
  const sc = result.structuredContent;
  return { ...result, content: blocks, ...(isObj(sc) ? { structuredContent: withShort(sc) } : {}) };
}

// Telemetry. Each returns its input untouched when there is no arm.
// The quota_wall_hit body with the arm (a new key: today's backend reads named keys only and ignores it).
export function withArmEvent(body, arm) {
  if (!isObj(body) || !isPaidLineArm(arm)) return body;
  return { ...body, [EVENT_FIELD]: arm };
}
// The /api/v1/mcp/track rows held on ctx for `tool` (lib/agent-outreach.mjs holdTrackRow) gain params._wall_paid_line,
// first (the backend clips params at 4,000 characters). Mutates only the held entries' row reference, never the
// handler's args. Returns how many rows were marked.
export function markHeldTrackRows(c, tool, arm) {
  let n = 0;
  try {
    if (!isPaidLineArm(arm) || !c || !Array.isArray(c._heldTrackRows)) return 0;
    for (const e of c._heldTrackRows) {
      if (!e || e.sent || !e.row || e.row.tool !== tool) continue;
      const p = isObj(e.row.params) ? e.row.params : {};
      if (p[TRACK_FIELD]) continue;
      e.row = { ...e.row, params: { [TRACK_FIELD]: arm, ...p } };
      n += 1;
    }
  } catch (_) { /* telemetry never touches a response */ }
  return n;
}
