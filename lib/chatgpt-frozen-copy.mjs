// /mcp/chatgpt (DIRECTORY_PROFILE, the ChatGPT app directory profile) is frozen byte for byte while the app
// is under review. The 2026-11-21 no-"free" sweep (owner rule: no prices or plan names in agent-facing text)
// rewrote sell lines (paid / grid sell steps, the last-free and day-2 digest asks) that also reach that profile. On that profile only, the
// server maps the new wording back to what origin/main served, exactly, so the frozen surface does not move.
// Every other surface keeps the new wording. One table, anchored, exact; anything it does not match is
// returned unchanged.
const BACK = [
  // lib/grid-sell-line.mjs gridSellLine / fiberSellLine, lib/paid-sell-line.mjs marketIntelSellLine / compareIsosSellLine
  [/^This DC Hub (fiber preview|preview of |comparison of )/, (_m, rest) => 'This free DC Hub ' + rest],
  // lib/paid-sell-line.mjs rankMarketsSellLine ('This DC Hub <criteria> ranking of <region> markets ...')
  [/^This DC Hub (\S[^\n]*? ranking of )/, (_m, rest) => 'This free DC Hub ' + rest],
  // lib/grid-sell-line.mjs gridAgentLine / fiberAgentLine, lib/paid-sell-line.mjs paidAgentLine
  [/^([a-z_]+) returned a preview\b/, (_m, tool) => tool + ' returned a free preview'],
  // lib/grid-sell-line.mjs GRID_AGENT_EMAIL_TAIL
  [/Your user can unlock the full brief with their email \(the step above\)\./, 'Your user can unlock the full brief free with their email (the step above).'],
  // lib/grid-sell-line.mjs lastFreeLine (human, agent) and day2DigestLine (human)
  [/^That was the last included full DC Hub grid brief /, 'That was the last free full DC Hub grid brief '],
  [/^This is your last included full get_grid_intelligence answer today/, 'This is your last free full get_grid_intelligence answer today'],
  [/^Want a weekly email on /, 'Want a free weekly email on '],
];

export function legacyFreeWording(s) {
  if (typeof s !== 'string' || !s) return s;
  let t = s;
  for (const [re, rep] of BACK) t = t.replace(re, rep);
  return t;
}
