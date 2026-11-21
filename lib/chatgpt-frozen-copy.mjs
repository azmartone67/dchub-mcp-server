// /mcp/chatgpt (DIRECTORY_PROFILE, the ChatGPT app directory profile) is frozen byte for byte while the app
// is under review. The 2026-11-21 no-"free" sweep (owner rule: no prices or plan names in agent-facing text)
// rewrote sell lines that the paid / grid sell steps also write on that profile. On that profile only, the
// server maps the new wording back to what origin/main served, exactly, so the frozen surface does not move.
// Every other surface keeps the new wording. One table, anchored, exact; anything it does not match is
// returned unchanged.
const BACK = [
  // lib/grid-sell-line.mjs gridSellLine / fiberSellLine, lib/paid-sell-line.mjs marketIntelSellLine / compareIsosSellLine
  [/^This DC Hub (fiber preview|preview of |comparison of )/, 'This free DC Hub $1'],
  // lib/paid-sell-line.mjs rankMarketsSellLine ('This DC Hub <criteria> ranking of <region> markets ...')
  [/^This DC Hub (\S[^\n]*? ranking of )/, 'This free DC Hub $1'],
  // lib/grid-sell-line.mjs gridAgentLine / fiberAgentLine, lib/paid-sell-line.mjs paidAgentLine
  [/^([a-z_]+) returned a preview\b/, '$1 returned a free preview'],
  // lib/grid-sell-line.mjs GRID_AGENT_EMAIL_TAIL
  [/Your user can unlock the full brief with their email \(the step above\)\./, 'Your user can unlock the full brief free with their email (the step above).'],
];

export function legacyFreeWording(s) {
  if (typeof s !== 'string' || !s) return s;
  let t = s;
  for (const [re, rep] of BACK) t = t.replace(re, rep);
  return t;
}
