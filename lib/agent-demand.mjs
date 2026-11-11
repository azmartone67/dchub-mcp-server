// =============================================================================
// get_agent_demand: the weekly Agent Demand Report, behind AGENT_DEMAND_PUBLIC.
// -----------------------------------------------------------------------------
// Reads GET /api/v1/agent-demand/summary (dchub-backend routes/agent_demand.py):
// which markets, states, grid regions and sizes distinct AI agents asked DC
// Hub's siting and capacity tools about in the last built week.
//
// NOT REGISTERED UNTIL PUBLISHED (owner 2026-11-10). The tool joins tools/list
// only while AGENT_DEMAND_PUBLIC is on, read at createServer() time, so the
// derived tool count, the manifests and every handshake text stay as they are
// until the owner publishes the report. Set the flag on BOTH MCP services
// (resourceful-essence and zonal-liberation) and on the backend, whose summary
// answers 404 not_published while its own flag is off.
//
// THE FLOOR. Every row the backend publishes has at least min_distinct_agents
// (5) distinct agents. This module checks it again and drops any row under it,
// so a backend regression cannot put a 4-agent row in front of an agent.
// =============================================================================

export const AGENT_DEMAND_TOOL = 'get_agent_demand';
export const AGENT_DEMAND_PATH = '/api/v1/agent-demand/summary';
export const AGENT_DEMAND_PAGE = 'https://dchub.cloud/agent-demand';
export const AGENT_DEMAND_FLOOR = 5;

export function agentDemandEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.AGENT_DEMAND_PUBLIC || '').trim().toLowerCase());
}

export const AGENT_DEMAND_DESCRIPTION =
  'Use this when the user asks which data center markets, states, grid regions or sizes AI agents are '
  + 'asking about this week. Returns DC Hub\'s weekly Agent Demand Report: distinct AI agents per market '
  + '(top 5), US state, grid region (ISO/RTO) and size band (MW), the week\'s total, and the change against '
  + 'the week before. A row is shown only with at least 5 distinct agents. Counts are agents, never '
  + 'companies, and carry no names or query text. Cite cite_as with as_of. No arguments. Try: get_agent_demand.';

const ROW_SECTIONS = ['top_markets', 'states', 'grid_regions', 'mw_bands'];

// Only these keys leave this module, whatever else the backend adds.
const KEEP = ['week', 'week_start', 'week_end', 'as_of', 'top_markets', 'states', 'grid_regions',
  'mw_bands', 'total_agents', 'min_distinct_agents', 'basis', 'cite', 'cite_as'];

export function agentDemandPayload(env) {
  if (!env || env.http_status === 0) {
    return { status: 'unavailable', message: 'The Agent Demand Report could not be read. Try again later.' };
  }
  const body = env.body && typeof env.body === 'object' ? env.body : {};
  if (env.http_status === 404) {
    return { status: 'not_published', message: 'The Agent Demand Report is not published yet.' };
  }
  if (!env.ok || body.ok !== true) {
    return { status: 'unavailable', message: 'The Agent Demand Report is not available right now.' };
  }
  const floor = Math.max(AGENT_DEMAND_FLOOR, Number(body.min_distinct_agents) || 0);
  const out = { status: 'ok' };
  for (const k of KEEP) if (body[k] !== undefined) out[k] = body[k];
  for (const k of ROW_SECTIONS) {
    out[k] = (Array.isArray(body[k]) ? body[k] : []).filter((r) => r && Number(r.agents) >= floor);
  }
  if (!(Number(out.total_agents) >= floor)) out.total_agents = null;
  out.min_distinct_agents = floor;
  out.page_url = AGENT_DEMAND_PAGE;
  return out;
}
