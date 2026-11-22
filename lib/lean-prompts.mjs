// lean-prompts.mjs: five prompts for light-list clients, ask-dc-hub first (owner course-correct 2026-11-21, item A3).
// Behind DCHUB_PROMPTS_LEAN_V1, default OFF.
//
// WHY. A light-list client (a coding CLI or a multi-server IDE host on bare /mcp, or anyone on /mcp/light; see
// lib/light-profile.mjs lightForRequest) is handed ten tools, execute_plan first, and then fifteen prompts, several of
// them near-duplicates (analyze-site / site_analysis / site-report, pick-a-market / market_selection / compare-markets,
// power-availability / grid_and_queue), whose descriptions use "DCPI" without saying what it is.
//
// WHAT, with the flag on, for a light-list session only:
//   . prompts/list returns these five, in this order: ask-dc-hub (the user's question to execute_plan, unchanged),
//     then one site, one market, one grid-and-queue and one what-changed prompt. Each description spells out
//     "Data Center Power Index (DCPI)". Their texts start from execute_plan or a tool in the ten-tool list.
//   . prompts/get still resolves every older prompt name, unchanged, for anyone who calls one by name.
//   . Every other session's prompts/list is unchanged (the five are not registered there).
// No price, plan name, call limit or connector URL in any of this text.

export const PROMPTS_LEAN_FLAG = 'DCHUB_PROMPTS_LEAN_V1';

// OFF unless set to 1 / true / yes / on (same shape as DCHUB_LAZY_AUTH_V1).
export function promptsLeanOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[PROMPTS_LEAN_FLAG]) || '').trim());
}

const UNKNOWN = 'Report any factor returned as unavailable as unknown; never estimate it.';
const CITE = 'Quote each figure with its as_of date and cite "DC Hub (dchub.cloud)".';
const q = (s) => String(s == null ? '' : s).trim();

export const LEAN_PROMPTS = Object.freeze([
  Object.freeze({
    name: 'ask-dc-hub',
    title: 'Ask DC Hub',
    description: 'Ask any data center power, grid, interconnection queue, site, fiber or market question. It goes to '
      + 'execute_plan unchanged, which returns one dated, cited answer, with the Data Center Power Index (DCPI) verdict '
      + 'when the question names a market or a site.',
    args: [{ name: 'question', description: 'The question, in your own words, e.g. Can I put a 200 MW AI campus in Dallas?', required: true }],
    text: (a) => `Call the DC Hub execute_plan tool with intent set to this question, unchanged: "${q(a.question)}". `
      + 'Answer from its result. When it carries a Data Center Power Index (DCPI) verdict, lead with it. '
      + `${CITE} ${UNKNOWN}`,
  }),
  Object.freeze({
    name: 'site',
    title: 'Check a data center site',
    description: 'Whether one address or coordinate works for a data center: grid power, gas, fiber, water and hazard '
      + 'risk, with a BUILD / CAUTION / AVOID verdict and the Data Center Power Index (DCPI) read for its market.',
    args: [
      { name: 'location', description: 'Street address or "lat,lon"', required: true },
      { name: 'capacity_mw', description: 'Target load in MW, e.g. 100', required: false },
    ],
    text: (a) => {
      const mw = q(a.capacity_mw);
      const loc = q(a.location);
      return `Use DC Hub to check ${loc} for a ${mw ? mw + ' MW ' : ''}data center.\n`
        + `1. execute_plan intent="analyze the site at ${loc}${mw ? ` for a ${mw} MW data center` : ''}": one dated, cited answer.\n`
        + `2. For per-factor detail, analyze_site at the site's lat,lon${mw ? ` with capacity_mw=${mw}` : ''}.\n`
        + 'Report grid headroom, fiber, gas, water and hazard risk, the Data Center Power Index (DCPI) verdict for the market, '
        + `and a BUILD / CAUTION / AVOID bottom line. ${CITE} ${UNKNOWN}`;
    },
  }),
  Object.freeze({
    name: 'market',
    title: 'Pick a data center market',
    description: 'Rank data center markets for a target load, or compare named markets, on each one\'s Data Center Power '
      + 'Index (DCPI) verdict, time to power and grid headroom.',
    args: [
      { name: 'capacity_mw', description: 'Target load in MW, e.g. 200', required: false },
      { name: 'region', description: 'Optional region or state, e.g. TX or Midwest', required: false },
      { name: 'markets', description: 'Optional 2-4 markets to compare instead, e.g. dallas,phoenix,columbus', required: false },
    ],
    text: (a) => {
      const mw = q(a.capacity_mw); const region = q(a.region); const markets = q(a.markets);
      const intent = markets
        ? `compare ${markets} for a ${mw || '100'} MW data center`
        : `rank markets for a ${mw || '100'} MW data center${region ? ' in ' + region : ''}`;
      return `Use DC Hub to ${markets ? 'compare these markets' : 'pick a market'}.\n`
        + `1. execute_plan intent="${intent}": the shortlist with each market's Data Center Power Index (DCPI) verdict.\n`
        + '2. get_market_dcpi_rank for each finalist, in parallel: verdict, composite score, time to power.\n'
        + `Return a ranked table: market, DCPI verdict, time to power, one-line reason. ${CITE} ${UNKNOWN}`;
    },
  }),
  Object.freeze({
    name: 'grid-and-queue',
    title: 'Grid headroom and interconnection queue',
    description: 'How much power a grid has for a new load and where its interconnection queue stands, with the Data '
      + 'Center Power Index (DCPI) verdicts of the markets it serves.',
    args: [
      { name: 'iso', description: 'ERCOT, PJM, MISO, CAISO, SPP, NYISO or ISONE; omit to let execute_plan choose', required: false },
      { name: 'capacity_mw', description: 'Target load in MW, e.g. 100', required: false },
    ],
    text: (a) => {
      const iso = q(a.iso); const mw = q(a.capacity_mw);
      const head = iso
        ? `Use DC Hub for ${iso}; the two calls are independent, run them in parallel:\n`
          + `1. get_grid_intelligence iso=${iso}: headroom, constraints, time to power.\n`
          + `2. get_interconnection_queue iso=${iso}: queued GW by fuel and status.\n`
        : `Use DC Hub: execute_plan intent="how much grid headroom and interconnection queue is there for a ${mw || '100'} MW data center"`
          + ' (add the region if the user named one).\n';
      return head
        + `Answer plainly: the headroom DC Hub's data shows${mw ? ` for a ${mw} MW load` : ''} (a modeled estimate, not a utility `
        + 'or ISO confirmation), how long power takes, the queue behind it, and the Data Center Power Index (DCPI) verdicts '
        + `of the markets it serves. ${CITE} ${UNKNOWN}`;
    },
  }),
  Object.freeze({
    name: 'what-changed',
    title: 'What changed',
    description: 'What moved since your last check: Data Center Power Index (DCPI) market movers, new facilities, '
      + 'pipeline projects and deals.',
    args: [{ name: 'since', description: 'Window or a previous generated_at, e.g. 1d, 7d, last_session', required: false }],
    text: (a) => `Call DC Hub get_changes since=${q(a.since) || '1d'}: the delta only (Data Center Power Index (DCPI) movers, `
      + 'new facilities, pipeline projects, deals). Keep the returned generated_at and pass it back as since= next time. '
      + `Report the notable movers with direction and why each matters. ${CITE}`,
  }),
]);

export const LEAN_PROMPT_NAMES = Object.freeze(LEAN_PROMPTS.map((p) => p.name));

// The prompts/list result a light-list session gets with the flag on.
export function leanPromptsListing() {
  return {
    prompts: LEAN_PROMPTS.map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      arguments: p.args.map((x) => ({ name: x.name, description: x.description, required: !!x.required })),
    })),
  };
}
