// lib/licence-block.mjs — an agent-readable licence block on gated answers (owner 2026-11-21, funnel item 4).
//
// WHY. A gated answer carried `_upgrade` ({tier, locked, next_tool, ...}): internal tier names and a checkout tool,
// nothing an agent can quote when its user asks "what would a licence add?".
//
// WHAT (behind DCHUB_LICENCE_BLOCK, default OFF; on only for 1 / true / yes / on). server.mjs _licenceBlockStep, late in
// the /mcp chain (after every step that reads `_upgrade`), replaces `_upgrade` on a gated answer, in structuredContent
// and in the answer's JSON block, with:
//   "licence": {
//     "current_tier": "anonymous" | "keyed" | "licensed",      (licenceTier: the ONE mapping, tested)
//     "licence_unlocks": [<withheld field names for this call>], (lib/withheld-copy.mjs withheldFields: the same list
//                                                                as "Withheld here:" and the relay page; never empty)
//     "licence_url": licenceBaseUrl() + "?via=mcp&tool=<tool>",   (/licence under DCHUB_LICENCE_PAGE_V1, else /connect)
//     "trial_available": <bool>,                                  (server.mjs reads the existing offer eligibility)
//     "checkout_tool": "unlock_more_data",
//     "agent_instruction": AGENT_INSTRUCTION
//   }
// A gated answer that carried no `_upgrade` gets the block too, so every preview names what a licence adds.
// Never: the directory / Claude / core profiles (their copy is frozen), a clean platform, an execute_plan step.
// No plan name (Free / Developer / Pro / Enterprise), price, currency, credit or calls-per-day wording: the tier names
// are the owner's three neutral ones. Pure: no ctx, no network.
import { licenceBaseUrl } from './wall-relay-everywhere.mjs';
import { withheldFields } from './withheld-copy.mjs';

export const LICENCE_BLOCK_FLAG = 'DCHUB_LICENCE_BLOCK';
export function licenceBlockOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[LICENCE_BLOCK_FLAG]) || '').trim());
}

export const LICENCE_TIERS = Object.freeze(['anonymous', 'keyed', 'licensed']);
export const CHECKOUT_TOOL = 'unlock_more_data';
export const AGENT_INSTRUCTION = 'If your user asks what a licence adds, quote licence_unlocks and share licence_url. '
  + 'Don’t state or guess prices.';

// The internal tiers that are a paid plan. Anything else with a key (free, identified, trial, claimed) is keyed.
const PAID_TIERS = new Set(['starter', 'developer', 'pro', 'professional', 'team', 'business', 'enterprise', 'paid', 'operator']);
// keyless -> anonymous; a free or claimed key -> keyed; any paid tier -> licensed.
export function licenceTier({ apiKey = '', tier = '' } = {}) {
  const t = String(tier || '').trim().toLowerCase();
  if (PAID_TIERS.has(t)) return 'licensed';
  return apiKey ? 'keyed' : 'anonymous';
}

const TOOL_RE = /^[a-z][a-z0-9_]{1,63}$/;
export function licenceUrl(tool, env = process.env) {
  return licenceBaseUrl(env) + '?via=mcp' + (TOOL_RE.test(String(tool || '')) ? '&tool=' + tool : '');
}

export function licenceBlock({ tool = '', sc = {}, apiKey = '', tier = '', trialAvailable = false, env = process.env } = {}) {
  return {
    current_tier: licenceTier({ apiKey, tier }),
    licence_unlocks: withheldFields(sc),
    licence_url: licenceUrl(tool, env),
    trial_available: trialAvailable === true,
    checkout_tool: CHECKOUT_TOOL,
    agent_instruction: AGENT_INSTRUCTION,
  };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isJsonText = (b) => b && b.type === 'text' && typeof b.text === 'string' && /^\s*\{/.test(b.text);

// `o` with `licence` in the place `_upgrade` held (or appended), `_upgrade` gone.
function swap(o, block) {
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(o)) {
    if (k === '_upgrade') { out.licence = block; placed = true; continue; }
    if (k === 'licence') continue;
    out[k] = v;
  }
  if (!placed) out.licence = block;
  return out;
}
// The result with the block in structuredContent and in its first JSON block (compact or 2-space layout kept).
export function withLicenceBlock(result, block) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !isObj(block)) return result;
  let done = false;
  const content = result.content.map((b) => {
    if (done || !isJsonText(b)) return b;
    done = true;
    try {
      const o = JSON.parse(b.text);
      if (!isObj(o)) return b;
      for (const ind of [undefined, 2]) if (b.text === JSON.stringify(o, null, ind)) return { ...b, text: JSON.stringify(swap(o, block), null, ind) };
      return { ...b, text: JSON.stringify(swap(o, block)) };
    } catch (_) { return b; }   // a cut JSON block is left as it is
  });
  const sc = isObj(result.structuredContent) ? swap(result.structuredContent, block) : result.structuredContent;
  return { ...result, content, ...(sc !== undefined ? { structuredContent: sc } : {}) };
}

// What the block may never say (prices, currency, plan names, credits, calls-per-day). The must-fail test reads it.
export const LICENCE_BLOCK_BANNED = /[$€£¥]|\b(?:usd|eur|gbp)\b|\bper month\b|\/mo\b|\b(?:free|developer|pro|enterprise|starter)\b|\bcredits?\b|\b\d[\d,]*\s+(?:mcp\s+)?(?:calls?|answers?|full answers?)\b|\/day\b|\bper day\b|\ba day\b|\b\d+(?:\.\d+)?\s*(?:dollars?|cents?)\b/i;
