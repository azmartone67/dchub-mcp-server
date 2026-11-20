// key-path-next.mjs -- a keyless execute_plan answer names the key tool in next_tools (Grok cold-start note 2026-11-20, fix 2).
//
// WHY. A keyless plan answer carried next_tools (report_finding, the get_changes check-in) but no key or email path,
// so the agent had nothing to relay when its human wanted to keep the shortlist or get alerts.
//
// WHAT. One entry, {tool: get_api_key, args: {}, say}, appended to next_tools. `say` is the one line the agent may
// relay. It names no price, plan, allowance or call count, and the entry carries no email: binding stays a step the
// human approves. The caller (server.mjs execute_plan) decides who gets it: keyless callers, on the surfaces that
// already carry next_tools (_findingNudgeAllowed: not /mcp/chatgpt, /mcp/core or a ChatGPT-identified client), at
// most once per session. A sessionless caller gets it on every keyless answer.
//
// Kill switch DCHUB_KEY_PATH_NEXT=0.

import { keyToolName } from './key-tool-name.mjs';

export const KEY_PATH_NEXT_FLAG = 'DCHUB_KEY_PATH_NEXT';
export const KEY_PATH_LINE = 'To keep this shortlist and get alerts, share your email with get_api_key.';

export function keyPathNextOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[KEY_PATH_NEXT_FLAG]) || '').trim());
}

export function keyPathNextTool(env = process.env) {
  const tool = keyToolName(env);
  return { tool, args: {}, say: tool === 'get_api_key' ? KEY_PATH_LINE : KEY_PATH_LINE.replace('get_api_key', tool) };
}

const _isKeyEntry = (e) => !!e && typeof e === 'object' && (e.tool === 'get_api_key' || e.tool === 'claim_free_key');

// Appends the entry to obj.next_tools in place (creating it when absent). A result that already names the key tool,
// or whose next_tools is not an array, is left alone. Returns obj.
export function attachKeyPathNext(obj, env = process.env) {
  try {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const entry = keyPathNextTool(env);
    if (obj.next_tools === undefined) obj.next_tools = [entry];
    else if (Array.isArray(obj.next_tools) && !obj.next_tools.some(_isKeyEntry)) obj.next_tools = [...obj.next_tools, entry];
  } catch (_) { /* a hint never breaks an answer */ }
  return obj;
}
