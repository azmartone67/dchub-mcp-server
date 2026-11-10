// lib/research-request.mjs — unlock_more_data as a research request the human can act on (owner 2026-11-10,
// "we have got to do a better job getting people and AI agents to request upgrades for research to save them
// time and money").
//
// Read live 2026-11-10: an agent that called unlock_more_data on purpose, with a reason, got a relay whose
// message said "Your AI assistant hit DC Hub's free-tier limit on unlock_more_data" (false: it hit nothing,
// it asked) and a plans ladder. Nothing told the human WHAT the agent had been held back on in this session,
// or what the full answer saves them doing by hand.
//
// So:
//   * every quota_wall_hit this server records also notes the tool here, per caller (session, else key,
//     else IP; same keys as lib/email-entered.mjs), newest first, at most 6 tools, 24 h, in memory only;
//   * unlock_more_data reads that list back into `research_request` and one sentence of its human message:
//     the tools that returned previews this session, and the public sources the full answer joins for the
//     tools whose sources are fixed and documented (SOURCES below, each copied from what the tool itself
//     cites). No hours, no prices, no plan names: a saving we cannot measure is not stated.
//   * the relay message for unlock_more_data says the agent ASKED (RELAY_ASK_MESSAGE).
//
// Kill switch DCHUB_RESEARCH_REQUEST=0 (read per call) removes the sentence and the block; the relay wording
// fix is not behind it (the old wording was false).
//
// Pure apart from the memo's own Map: no ctx, no network.
import { callerKeys } from './email-entered.mjs';

export const RELAY_ASK_MESSAGE = 'Your AI assistant asked how to get you the full DC Hub data for your research. '
  + 'Open this link to see what it found and the options:';

export function researchRequestOn(env = process.env) {
  return !/^(0|false|no|off|disabled)$/i.test(String((env && env.DCHUB_RESEARCH_REQUEST) || '').trim());
}

// The public sources a FULL answer of these tools joins. Only tools whose sources are fixed: each list is
// what the tool's own answer cites (analyze_site: site_context.blocks[].sources, read live 2026-11-10;
// get_interconnection_queue: the seven ISO queue exports it collects). A tool absent here is still listed
// as walled; its sources are just not claimed.
export const SOURCES = Object.freeze({
  analyze_site: ['FEMA flood maps (NFHL)', 'EIA-930 hourly grid data', 'EIA-860M planned retirements',
    'substation data (HIFLD + OpenStreetMap)', 'PeeringDB', 'USGS/EPA hydrography (NHDPlus)',
    'EPA Green Book air-permitting areas', 'NOAA daily climate records (GHCN-Daily)', 'FEMA National Risk Index',
    'FRA rail network', 'EIA retail electricity prices', 'state tax-incentive sources'],
  get_interconnection_queue: ['ISO interconnection-queue exports (ERCOT, CAISO, NYISO, SPP, PJM, MISO, ISO-NE)'],
});

const MAX_TOOLS = 6;

export function createSessionWallLog({ cap = 20000, ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const seen = new Map();   // memo key -> [{ tool, at }], newest first
  return {
    note(c, tool) {
      try {
        const t = typeof tool === 'string' ? tool.trim() : '';
        if (!t || t === 'unlock_more_data') return false;
        const keys = callerKeys(c);
        if (!keys.length) return false;
        if (seen.size >= cap) seen.clear();
        const at = now();
        for (const [, k] of keys) {
          const prev = (seen.get(k) || []).filter((w) => w.tool !== t && at - w.at <= ttlMs);
          seen.set(k, [{ tool: t, at }, ...prev].slice(0, MAX_TOOLS));
        }
        return true;
      } catch (_) { return false; }
    },
    // The walled tools for the most specific key that has any, newest first.
    get(c) {
      try {
        const t = now();
        for (const [, k] of callerKeys(c)) {
          const l = (seen.get(k) || []).filter((w) => t - w.at <= ttlMs);
          if (l.length) return l.map((w) => w.tool);
        }
        return [];
      } catch (_) { return []; }
    },
    size() { return seen.size; },
    clear() { seen.clear(); },
  };
}

// The block unlock_more_data carries, or null when there is nothing honest to say (no reason, no walls).
export function buildResearchRequest(reason, walledTools) {
  const r = typeof reason === 'string' ? reason.trim().slice(0, 240) : '';
  const tools = Array.isArray(walledTools) ? walledTools.filter((t) => typeof t === 'string' && t).slice(0, MAX_TOOLS) : [];
  if (!r && !tools.length) return null;
  const sources = [];
  for (const t of tools) for (const s of (SOURCES[t] || [])) if (!sources.includes(s)) sources.push(s);
  return {
    asked_for: r || null,
    previews_this_session: tools,
    full_answer_joins: sources,
    basis: 'previews_this_session = tools that answered this caller with a preview or wall in the last 24 h on this DC Hub server; '
      + 'full_answer_joins = the public sources those tools cite, for the tools whose sources are fixed.',
  };
}

// One sentence for the human, or '' when the block says nothing beyond the reason line already printed.
export function researchRequestSentence(block) {
  if (!block || !block.previews_this_session.length) return '';
  const tools = block.previews_this_session.map((t) => '`' + t + '`').join(', ');
  const n = block.full_answer_joins.length;
  const joins = n
    ? ' The full answer joins ' + (n === 1 ? 'a public source' : n + ' public sources') + ' you would otherwise pull and match by hand: '
      + block.full_answer_joins.slice(0, 6).join(', ') + (n > 6 ? ' and ' + (n - 6) + ' more' : '') + '.'
    : '';
  return '\n**What DC Hub held back this session:** previews only on ' + tools + '.' + joins;
}
