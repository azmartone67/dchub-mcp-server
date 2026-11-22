// cli-starter.mjs: the coding-CLI first call (Grok funnel spec F3, 2026-11-22). Flag DCHUB_CLI_STARTER, default OFF.
//
// WHY. /api/v1/mcp/funnel + /retention, 7d to 2026-11-22: GitHub Copilot CLI 572 connects / 4 tool-call sessions,
// Codex CLI 178 / 3, opencode 137 / 0. These clients already get the implicit light list on bare /mcp
// (lib/light-profile.mjs, owner 2026-11-12 / 2026-11-14), execute_plan first, and with A2 live
// (lib/light-list-instructions.mjs) a "Tools:" line naming only listed tools. They still connect and stop.
//
// WHAT, with the flag on, for the six named clients only (Copilot CLI, Codex CLI, opencode, Cursor, Windsurf, Cline;
// every other session, the other light-list clients and /mcp/light included, is unchanged byte for byte):
//   . tools/list: CLI_STARTER_TOOLS first, in that order, then the rest of the light list in its own order. No tool is
//     removed; get_fiber_intel, which the light list did not carry, is added. Listing scope only, as before.
//   . initialize: the canon sentence stays first, byte for byte; right after it, one example line
//     (CLI_STARTER_EXAMPLE). The "Tools:" line names CLI_STARTER_TOOLS. To stay under the 2,048 characters clients
//     keep, the "Data moves daily: re-query." sentence is dropped from this handshake only (get_changes' daily check-in
//     line right after it says the same).
// No price, plan name, "free", credit, trial wording, per-day figure or tool count. Pure: no ctx, no network.
//
// Checked against mcp#1650 (merged 2026-11-22: no root-level anyOf on served schemas): that fixed whether these clients
// can register the tools at all; this file only changes order and the handshake lead, and adds no schema.

import { CANON_SENTENCE } from './dchub-identity.mjs';

export const CLI_STARTER_FLAG = 'DCHUB_CLI_STARTER';

export const CLI_STARTER_TOOLS = Object.freeze([
  'execute_plan', 'get_market_dcpi_rank', 'get_grid_intelligence', 'source_capacity', 'get_fiber_intel',
]);

export const CLI_STARTER_EXAMPLE = 'First call: execute_plan(intent="<the user\'s question>").';
const DROPPED_SENTENCE = 'Data moves daily: re-query. ';

// OFF unless set to 1 / true / yes / on.
export function cliStarterOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[CLI_STARTER_FLAG]) || '').trim());
}

// The six clients (User-Agent and/or clientInfo.name, as lib/light-profile.mjs reads them):
//   GitHub Copilot CLI  UA copilot-cli/<v>, clientInfo github-copilot-developer / copilot-cli
//   Codex CLI           UA / clientInfo codex-mcp-client/<v>, codex-cli
//   opencode            UA opencode/<v>/cli, clientInfo opencode
//   Cursor              clientInfo cursor-vscode / cursor
//   Windsurf            clientInfo windsurf-client / windsurf / codeium
//   Cline               clientInfo cline-vscode / cline
// VS Code, Claude Code, Gemini CLI, Clono and WorkBuddy are light-list clients too, and are NOT matched here.
export const CLI_STARTER_UA = /(?:^|[\s(/])(copilot-cli\/|codex-mcp-client\/|opencode\/)/i;
export const CLI_STARTER_NAME = /^(copilot-cli|github-copilot-developer|codex-mcp-client|codex-cli|opencode|cursor-vscode|cursor|windsurf-client|windsurf|codeium|cline-vscode|cline)([\s_/.-]|$)/i;

export function isCliStarterIdentity({ userAgent, clientName } = {}) {
  return CLI_STARTER_UA.test(String(userAgent || '').trim()) || CLI_STARTER_NAME.test(String(clientName || '').trim());
}

// The starter order over a base list: CLI_STARTER_TOOLS first, then every other base name in its own order.
export function cliStarterOrder(base) {
  const rest = (Array.isArray(base) ? base : []).filter((n) => !CLI_STARTER_TOOLS.includes(n));
  return Object.freeze([...CLI_STARTER_TOOLS, ...rest]);
}

// The handshake rewrite: run AFTER the light-list rewrite (which already wrote the Tools: line). Pure; never throws.
export function cliStarterInstructions(text) {
  const s = String(text == null ? '' : text);
  try {
    if (!s.startsWith(CANON_SENTENCE)) return s;   // the canon sentence must lead; anything else is left alone
    let rest = s.slice(CANON_SENTENCE.length);
    if (rest.startsWith(' ' + CLI_STARTER_EXAMPLE)) return s;   // idempotent
    rest = rest.replace(DROPPED_SENTENCE, '');
    rest = rest.replace(/\bTools: [a-z_]+(?:, [a-z_]+)*\. /, `Tools: ${CLI_STARTER_TOOLS.join(', ')}. `);
    return CANON_SENTENCE + ' ' + CLI_STARTER_EXAMPLE + rest;
  } catch (_) { return s; }
}
