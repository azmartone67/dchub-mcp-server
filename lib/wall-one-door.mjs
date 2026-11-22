// lib/wall-one-door.mjs — the "one door" wall, a single-surface A/B test (owner 2026-11-22, "Build it").
//
// WHY. Measured 2026-11-22 (backend /api/v1/mcp/funnel, 7 days): 587 walled answers asked for an email or a visit, the
// relay /u/ link drew 2 qualified human opens, and no email was entered. A walled answer on /mcp carries five doors
// (the value-first link, a sign-in line, the in-chat email ask, a "For your human" block repeating the link, and a
// footer pointing at the connect page), and the "Give your user this answer first" line, the one an agent most often
// relays, carries no link at all. This test keeps two doors and puts the link where the relayed line is.
//
// WHAT (behind DCHUB_WALL_ONE_DOOR, default OFF; on only for 1 / true / yes / on):
//   * a gated answer on the generic /mcp surface that already carries the session-bound relay link (wall item 1,
//     ctx._relayEverywhereLink), for a keyless or trial-key caller, assigns the caller an arm from a salted sha256 of
//     its stable identity (oneDoorArm): 'one_door' (half) or 'control' (half). The identity, the surface and the
//     caller rules are the paid-line test's (lib/wall-paid-line.mjs), so the same callers are out: ChatGPT / OpenAI,
//     /mcp/claude, /mcp/core, Grok, a gateway (Pipeworx), any path but /mcp, a loopback step, a device-matched
//     caller, a non-trial key. The two tests never share a wall: the paid-line step skips every answer that carries
//     the relay link, and this one runs only on those.
//   * the one_door arm (withOneDoor): the relay link is appended to the "Give your user this answer first" line; the
//     sign-in line (lib/wall-identity-v2.mjs SIGNIN_LINE), the "→ **For your human:**" block and the identity footer
//     (lib/dchub-identity.mjs PREVIEW_FOOTER, before or after the v2 connect rewrite) are removed. The value-first
//     block 0 (headline + link), the JSON block, the in-chat email ask (get_api_key) and every other block stay.
//     structuredContent is not touched: its human_url / for_your_human / human_message already name the same link.
//   * the control arm: the answer is unchanged, byte for byte.
//   * both arms are recorded: params._wall_one_door on the call's /api/v1/mcp/track rows (the held rows and the parked
//     wall row, whose wall_link_th names the relay link, so a relay open joins to its arm) and wall_one_door on its
//     quota_wall_hit funnel event and on the email_entered event of an email entered after that wall
//     (lib/email-entered.mjs). The backend stores the event field once its owner-applied column exists.
// Placed by server.mjs _wallOneDoorStep AFTER _valueFirstStep (the last rewrite of a gated answer), so it reads the
// answer the agent receives. Keyless gating, tiers and quotas are untouched: blocks are only removed or extended.
// No network; markHeldTrackRows is the one function that writes (the held telemetry rows on ctx).
import { createHash } from 'node:crypto';
import { paidLineCallerId, paidLineSurface, paidLineCaller } from './wall-paid-line.mjs';
import { SIGNIN_LINE } from './wall-identity-v2.mjs';
import { PREVIEW_FOOTER } from './dchub-identity.mjs';
import { ANSWER_FIRST_LEAD, ANSWER_FIRST_SKIP } from './claim-handoff.mjs';
import { FOR_HUMAN_LEAD } from './wall-relay-everywhere.mjs';

export const WALL_ONE_DOOR_FLAG = 'DCHUB_WALL_ONE_DOOR';
export function wallOneDoorOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[WALL_ONE_DOOR_FLAG]) || '').trim());
}

export const ARM_ONE_DOOR = 'one_door';
export const ARM_CONTROL = 'control';
export const ONE_DOOR_ARMS = Object.freeze([ARM_ONE_DOOR, ARM_CONTROL]);
export const TRACK_FIELD = '_wall_one_door';     // mcp_call_log.params key
export const EVENT_FIELD = 'wall_one_door';      // quota_wall_hit body key
export const isOneDoorArm = (a) => ONE_DOOR_ARMS.includes(a);

// The same callers and the same surface as the paid-line test (one definition, not two).
export const oneDoorCallerId = paidLineCallerId;
export const oneDoorSurface = paidLineSurface;
export const oneDoorCaller = paidLineCaller;

// Its own salt: independent of the paid-line split and every other hash-based split in the stack.
const ARM_SALT = 'dchub:wall-one-door:v1|';
// 'one_door' or 'control', stable per identity; null with no identity (no arm, no change, nothing recorded).
export function oneDoorArm(identity) {
  const id = String(identity || '').trim();
  if (!id) return null;
  const unit = createHash('sha256').update(ARM_SALT + id).digest().readUInt32BE(0) / 0x100000000;
  return unit < 0.5 ? ARM_ONE_DOOR : ARM_CONTROL;
}

// The text put after the answer-first sentence. The URL ends the sentence (no trailing period: a period glued to a
// URL breaks it in some renderers).
export const LINK_LEAD = ' Full answer: ';

const isText = (b) => b && b.type === 'text' && typeof b.text === 'string';
// Prose only: a JSON block (the answer's data) is never edited, even where a string in it repeats a line.
const isProse = (b) => isText(b) && !/^\s*[{[]/.test(b.text);
// The footer as built, or after the v2 copy's connect rewrite ("— https://dchub.cloud/mcp/connect").
const FOOTER_HEAD = PREVIEW_FOOTER.split(' — ')[0] + ' — ';
const isFooter = (t) => t.trim() === PREVIEW_FOOTER || t.trim().startsWith(FOOTER_HEAD);

// The one_door answer. Returns the result unchanged (same object) when it is not a content result, there is no
// link, or no answer-first line takes the link (nothing to move the door to: the other doors stay, so no answer
// ever loses its last link). Never adds the link twice.
export function withOneDoor(result, link) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !result.content.length) return result;
  const url = typeof link === 'string' ? link.trim() : '';
  if (!/^https:\/\/\S+$/.test(url)) return result;
  const af = result.content.findIndex((b) => isProse(b) && b.text.includes(ANSWER_FIRST_LEAD));
  if (af < 0) return result;
  const blocks = [];
  result.content.forEach((b, i) => {
    if (!isProse(b)) { blocks.push(b); return; }
    let t = b.text;
    if (i === af && !t.includes(url)) {
      const lead = t.indexOf(ANSWER_FIRST_LEAD);
      const skip = t.indexOf(ANSWER_FIRST_SKIP, lead);
      const nl = t.indexOf('\n', lead);
      let at = skip >= 0 ? skip : (nl >= 0 ? nl : t.length);
      while (at > lead && /\s/.test(t[at - 1])) at -= 1;
      t = t.slice(0, at) + LINK_LEAD + url + t.slice(at);
    }
    if (i > 0 && t.startsWith(FOR_HUMAN_LEAD)) return;
    if (i > 0 && isFooter(t)) return;
    if (t.includes(SIGNIN_LINE)) {
      t = t.split(SIGNIN_LINE).join('').replace(/\n{3,}/g, '\n\n').trim();
      if (!t) return;
    }
    blocks.push(t === b.text ? b : { ...b, text: t });
  });
  return { ...result, content: blocks };
}

// Telemetry. Each returns its input untouched when there is no arm.
export function withArmEvent(body, arm) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !isOneDoorArm(arm)) return body;
  return { ...body, [EVENT_FIELD]: arm };
}
// The /api/v1/mcp/track rows for `tool` on ctx gain params._wall_one_door, first: the held rows
// (lib/agent-outreach.mjs holdTrackRow, `row`) and the parked wall rows (lib/wall-link-track.mjs parkWallTrack,
// `payload`; sent later by the outer wrapper with the relay link's hash). Mutates only those entries' row reference.
// Returns how many rows were marked.
export function markHeldTrackRows(c, tool, arm) {
  let n = 0;
  try {
    if (!isOneDoorArm(arm) || !c) return 0;
    for (const [list, field] of [[c._heldTrackRows, 'row'], [c._pendingWallTracks, 'payload']]) {
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        const row = e && !e.sent ? e[field] : null;
        if (!row || row.tool !== tool) continue;
        const p = (row.params && typeof row.params === 'object' && !Array.isArray(row.params)) ? row.params : {};
        if (p[TRACK_FIELD]) continue;
        e[field] = { ...row, params: { [TRACK_FIELD]: arm, ...p } };
        n += 1;
      }
    }
  } catch (_) { /* telemetry never touches a response */ }
  return n;
}
