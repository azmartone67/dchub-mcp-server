// lib/next-call.mjs — every tool answer says what to call next (Brain block 2026-10-28, item 4).
//
// A structured `next_call` on the finished response of a data tool:
//
//   next_call: {
//     tool: 'execute_plan',                       // the follow-up tool the response already names, else execute_plan
//     arguments: { intent: "<the user's question, unchanged>" },   // only when the tool is execute_plan
//     why: 'plans and chains the right tools and returns one dated, cited answer',
//     connect: 'MCP server: dchub.cloud/mcp',                     // the connect line (see below)
//   }
//
// In block 0's JSON and in structuredContent, never as a new text block: the free answer's closing Source line
// stays the last block (test/grid-sell-line, test/spent-cap-link-line pin it). A response that already names a
// `next_tool` (a wall or a preview naming bind_email / claim_free_key / unlock_more_data) keeps that tool as
// the follow-up, so the hint never competes with the wall's own ask.
//
// The connect line is on every answer, keyed or not: a field only a keyless answer carried would make the keyed
// answer worse than the anonymous one (test/key-never-worse-than-anon pins that rule).
//
// No plan name, no price, no count, no superlative. Pure: no ctx, no network. server.mjs decides who gets it
// (never the directory / Claude / core profiles or a clean platform: /mcp/chatgpt is frozen for OpenAI's review).
// Kill switch: DCHUB_NEXT_CALL=0.
import { splitLeadingJson } from './facility-location.mjs';

export const NEXT_CALL_ENTRY = 'execute_plan';
export const NEXT_CALL_WHY = 'plans and chains the right tools and returns one dated, cited answer';
export const NEXT_CALL_INTENT = "<the user's question, unchanged>";
// No scheme on purpose: a wall carries ONE link and the one-link guards (test/spent-cap-link-line,
// test/keyless-wall-grok-audit) count every https://dchub.cloud/<path> in a response.
export const NEXT_CALL_CONNECT = 'MCP server: dchub.cloud/mcp';

// Tools whose answer IS the next step already (the entry itself, the key tools, the key relay).
export const NEXT_CALL_SKIP = Object.freeze(new Set([
  'execute_plan', 'claim_free_key', 'bind_email', 'recover_my_key', 'unlock_more_data', 'accept_capacity_terms',
]));

const TOOL_RE = /^[a-z][a-z0-9_]{2,63}$/;

export function nextCallOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_NEXT_CALL) || '').trim());
}

// The follow-up the response already names, if any.
function namedFollowUp(sc) {
  const cands = [sc && sc.next_tool, sc && sc._upgrade && sc._upgrade.next_tool, sc && sc.next_ask && sc.next_ask.tool];
  for (const v of cands) if (typeof v === 'string' && TOOL_RE.test(v)) return v;
  return null;
}

export function buildNextCall(name, sc) {
  const tool = namedFollowUp(sc) || NEXT_CALL_ENTRY;
  return tool === NEXT_CALL_ENTRY
    ? { tool, arguments: { intent: NEXT_CALL_INTENT }, why: NEXT_CALL_WHY, connect: NEXT_CALL_CONNECT }
    : { tool, why: 'the follow-up this answer names', connect: NEXT_CALL_CONNECT };
}

// Add next_call to a finished result. Returns the same object when nothing applies.
export function withNextCall(result, name, { env } = {}) {
  try {
    if (!nextCallOn(env)) return result;
    if (!name || NEXT_CALL_SKIP.has(name)) return result;
    if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !result.content.length) return result;
    const sc = result.structuredContent;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return result;
    // a failure envelope gets no hint; a wall/preview flagged isError (DCHUB_PREVIEW_ISERROR) is an answer and does
    if (result.isError && (sc.error || sc.error_code)) return result;
    if (sc.next_call) return result;                       // idempotent; never overwrites
    const nc = buildNextCall(name, sc);
    let content = result.content;
    const b0 = content[0];
    const sp = b0 && b0.type === 'text' && typeof b0.text === 'string' ? splitLeadingJson(b0.text) : null;
    if (sp && sp.json && typeof sp.json === 'object' && !Array.isArray(sp.json) && !sp.json.next_call) {
      content = [{ ...b0, text: sp.head + JSON.stringify({ ...sp.json, next_call: nc }) + sp.rest }, ...content.slice(1)];
    }
    return { ...result, content, structuredContent: { ...sc, next_call: nc } };
  } catch (_) { return result; }   // a hint is never worth failing a response over
}
