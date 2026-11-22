// light-list-instructions.mjs: the handshake a light-list client reads names only tools it was handed
// (owner course-correct 2026-11-21, item A2). Behind DCHUB_LIGHT_LIST_INSTRUCTIONS_V2, default OFF.
//
// THE DEFECT. A light-list client (a coding CLI or a multi-server IDE host on bare /mcp, or anyone on /mcp/light; see
// lib/light-profile.mjs lightForRequest) gets the ten-tool list, execute_plan first. Its initialize instructions are the
// shared lean text, which says "DC Hub: 98 tools." and "Tools: execute_plan, get_grid_data, source_capacity,
// get_market_intel, search_facilities." (lib/agent-outreach.mjs OUTREACH_LEAD), and then the ENDPOINT SCOPE tail says
// "this client's /mcp list shows 10 DC Hub tools". Two counts in one handshake, and two of the five named starting tools
// (get_grid_data, get_market_intel) are not in that client's tools/list.
//
// WHAT THIS DOES, with the flag on, for a light-list session only (every other session is unchanged byte for byte):
//   . the "Tools:" line names only tools in the list this client is served, execute_plan first. A lead tool the light
//     list does not carry is replaced by the listed specialist that answers the same question (LIGHT_LEAD_SUBSTITUTES);
//     anything still unlisted is dropped.
//   . the count is stated once, from the served list's length: "This list shows N tools; discover_tools lists the rest."
//     replaces "DC Hub: 98 tools.", and the ENDPOINT SCOPE tail no longer restates a count.
//   . It is a per-session rewrite (the same mechanism as /mcp/grok's grokInstructions), never a change to the shared
//     _INSTRUCTIONS / _INSTRUCTIONS_LEAN strings, so the canon fences that scan them read what they read before.
// No connector URL is added: the only URL in the tail stays https://dchub.cloud/mcp?catalog=full, which was already there.

import { OUTREACH_TOOLS } from './agent-outreach.mjs';

export const LIGHT_LIST_INSTRUCTIONS_FLAG = 'DCHUB_LIGHT_LIST_INSTRUCTIONS_V2';

// OFF unless set to 1 / true / yes / on (same shape as DCHUB_LAZY_AUTH_V1).
export function lightListInstructionsV2On(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[LIGHT_LIST_INSTRUCTIONS_FLAG]) || '').trim());
}

// A shared lead tool the light list does not carry -> the listed specialist for the same question.
export const LIGHT_LEAD_SUBSTITUTES = Object.freeze({
  get_grid_data: 'get_grid_intelligence',
  get_market_intel: 'get_market_dcpi_rank',
});

// The tools the "Tools:" line names for a client served `listed`: execute_plan first, then the shared lead order with
// substitutes, every name in `listed`, no repeats.
export function lightLeadTools(listed, lead = OUTREACH_TOOLS) {
  const have = new Set(Array.isArray(listed) ? listed : []);
  const out = [];
  const add = (n) => { if (n && have.has(n) && !out.includes(n)) out.push(n); };
  add('execute_plan');
  for (const n of lead || []) add(have.has(n) ? n : LIGHT_LEAD_SUBSTITUTES[n]);
  return out;
}

export function lightCountSentence(listed) {
  const names = Array.isArray(listed) ? listed : [];
  return names.includes('discover_tools')
    ? `This list shows ${names.length} tools; discover_tools lists the rest.`
    : `This list shows ${names.length} tools.`;
}

const TOOLS_LINE_RE = /\bTools: [a-z_]+(?:, [a-z_]+)*\. /;
const COUNT_RE = /\bDC Hub: \d+ tools\. /;
const BARE_COUNT_RE = /\bDC Hub\. /;   // _INSTRUCTIONS_LEAN when the full text carries no count

// Rewrite the shared handshake text for a session served `listed`. Pure; never throws.
export function lightListInstructions(text, { listed } = {}) {
  const s = String(text == null ? '' : text);
  try {
    if (!Array.isArray(listed) || !listed.length) return s;
    const tools = lightLeadTools(listed);
    let out = s.replace(TOOLS_LINE_RE, tools.length ? `Tools: ${tools.join(', ')}. ` : '');
    const sentence = lightCountSentence(listed) + ' ';
    if (COUNT_RE.test(out)) out = out.replace(COUNT_RE, sentence);
    else if (BARE_COUNT_RE.test(out)) out = out.replace(BARE_COUNT_RE, sentence);
    else {
      const m = /\bTools: [a-z_]+(?:, [a-z_]+)*\. /.exec(out);
      out = m ? out.slice(0, m.index + m[0].length) + sentence + out.slice(m.index + m[0].length) : out + ' ' + sentence.trim();
    }
    return out;
  } catch (_) { return s; }
}

// The ENDPOINT SCOPE tail for a light-list session with the flag on: the same rules as the flag-off tail (listing scope,
// not permission scope; tools/call takes any tool, the unlisted key tool included; where the full list is), no second
// count. "start with execute_plan" is not repeated: the canon sentence that opens the text says it, and the Tools: line
// leads with it. Shorter than the flag-off tail, so this handshake is under the 2,048 characters clients keep (the
// flag-off light handshake measured 2,130 on 2026-11-21).
export function lightListTail({ implicit = true, pack = 'light', listed = [], fullCatalogUrl } = {}) {
  const names = Array.isArray(listed) ? listed : [];
  const head = implicit ? 'ENDPOINT SCOPE:' : `ENDPOINT SCOPE: /mcp/${pack} is`;
  const unlisted = ['get_api_key', 'get_changes'].filter((n) => !names.includes(n));
  const incl = unlisted.length ? `, ${unlisted.join(' and ')} included` : '';
  return `\n\n${head} a listing scope, not a permission scope: tools/call accepts any DC Hub tool by name${incl}; `
    + `the full list is at ${fullCatalogUrl}.`;
}
