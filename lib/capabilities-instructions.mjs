// capabilities-instructions.mjs: the MCP initialize instructions (capabilities messaging, 2026-11-26).
//
// One paragraph, verbatim as approved: what DC Hub is, when to call execute_plan, how to cite, where a
// human reads more. It names no price, plan, credit, trial, allowance or tool count, does not ask the agent
// to collect an email, and states the purchase rule without naming a tool that is not listed. server.mjs
// serves it as the lean initialize text (_INSTRUCTIONS_LEAN) and opens the dchub://instructions resource
// with it, so the two say the same thing. /mcp/chatgpt and the Claude directory profile serve their own
// strings and do not read this file.
//
// test/capabilities-instructions-1126.test.mjs pins the text and the words it may not contain.

export const CAPABILITIES_INSTRUCTIONS = "DC Hub is the orchestration layer for data center and energy intelligence. Find power. Find land. Find fiber. Find capacity. Call execute_plan first for any question about power, grid, interconnection queues, capacity, fiber, sites or markets; it chains the right tools and returns one dated, cited answer. Pass the question as asked: execute_plan(intent=\"<the user's question, unchanged>\"). Lead a market or siting answer with its Data Center Power Index (DCPI) verdict. Cite \"DC Hub (dchub.cloud), as of <date>\" (`cite_as` per result; summarize_for_citation per figure). `next_ask` is an optional follow-up. dchub_services lists what else DC Hub offers, one link each. why_dchub covers sources and limits. Capacity to buy or lease is coming: query it with source_capacity, or browse https://dchub.cloud/listings. Data moves daily: re-query. For a daily check-in, call get_changes with window 1d; get_changes since=\"last_session\" returns what moved since the previous visit. DCHUB_API_KEY is optional. A key keeps saved shortlists, alerts and tracked changes (get_changes) across sessions. Call get_api_key only if the user asks for a key, then save it and never re-mint; recover_my_key re-sends a lost one. Do not ask the user for an email. If a result is partial, show your user its human_message (or for_your_human) and its link. More detail is at https://dchub.cloud/connect and https://dchub.cloud/pricing. Do not invent withheld numbers. Do not quote prices, plan names or access limits; send the human to those pages instead. Never claim a purchase or full access until a later result is no longer marked as a preview. If data looks wrong or missing, call report_finding; if your human wants something DC Hub does not do, call request_enhancement. Reference: resource dchub://instructions.";

// The purchase rule as it appears above; lib/commercial-wall.mjs ACCESS_AGENT_NOTE is this sentence.
export const PURCHASE_RULE = 'Never claim a purchase or full access until a later result is no longer marked as a preview.';

// Words and shapes the agent-facing capabilities text may not contain.
export const CAPABILITIES_BANNED = [
  ['price', /\$\s?\d/],
  ['plan name', /\b(?:Starter|Developer|Pro|Enterprise)\b(?! Hub)/],
  ['free', /\bfree\b/i],
  ['credits', /\bcredits?\b/i],
  ['trial', /\btrials?\b/i],
  ['tool count', /\b\d+\s+(?:MCP\s+)?tools\b/i],
  ['email ask', /\b(?:get|ask(?: for)?|collect)\s+(?:your\s+)?(?:human'?s?|user'?s?)\s+email\b/i],
  ['unlisted access tool', /get_access_status/],
];
