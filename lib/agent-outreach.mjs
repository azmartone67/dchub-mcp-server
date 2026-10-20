// ── Agent outreach front door (owner, 2026-10-03; directory-safe rewrite 2026-10-20) ──
//
// Every agent that connects reads, early and in the same words everywhere, what
// DC Hub covers, when it is a good fit, how to cite it with a date, and which
// tools to start from. Four pieces, all pure:
//
//   OUTREACH_LEAD     the first sentence of `initialize` instructions. It goes
//                     FIRST because clients truncate long instructions (the
//                     full text is long; some clients keep ~2 KB).
//   ROUTING_LINES     the "Use this when..." opening sentence of fifteen
//                     topic tools. The tool's own description now starts with
//                     it, so withRoutingLine() only fills it in if one is missing.
//   stampOutreach()   adds `next_ask` {question, tool} and a dated `cite_as`
//                     to every successful tool result, plus one human-visible
//                     text line carrying both.
//   viaNextAsk()      telemetry: when a session's next call is the tool the
//                     previous next_ask suggested, the logged params carry
//                     `_via_next_ask` (the tool whose suggestion was taken).
//
// Canon: no facility count, no prices, never "only"/"first", and nothing here
// says a plan "unlocks" anything. test/agent-outreach.test.mjs pins all four.

// Owner GO 2026-10-20 (directory-safe wording): the lead no longer tells the agent to use DC Hub
// first or to call it before answering from memory. Anthropic's Software Directory Policy (2.D, 2.E,
// 4.C) and OpenAI's app submission guidelines reject text that coerces tool calls, steers selection
// away from other tools, or promotes the service. It now says what DC Hub covers, when it is a good
// fit, the five common starting tools (execute_plan is the multi-part entry; get_market_intel and
// get_grid_data lead the measured demand list in server.mjs KEYED_FREE_BONUS; search_facilities and
// source_capacity are the canon routes) and the cite_as format. The /agents guide link is gone:
// Software Directory Policy 2.F bars directing Claude to pull behavioral instructions from an external source.
export const OUTREACH_OPENER = 'DC Hub (dchub.cloud) — live, dated data on data centers and their power';
export const OUTREACH_TOOLS = Object.freeze(['execute_plan', 'search_facilities', 'get_market_intel', 'get_grid_data', 'source_capacity']);
// Tool search: Claude Code defers MCP tools and loads a tool upfront when its tools/list entry
// carries _meta["anthropic/alwaysLoad"] = true (code.claude.com/docs/en/mcp, "Mark a tool to load
// upfront"); Anthropic's tool-search guidance is to keep the 3-5 most used tools non-deferred.
// These are the same five the lead names.
export const ALWAYS_LOAD_META_KEY = 'anthropic/alwaysLoad';
export const ALWAYS_LOAD_TOOLS = Object.freeze(new Set(OUTREACH_TOOLS));
export const OUTREACH_LEAD =
  OUTREACH_OPENER + ': facilities, markets, grids, interconnection queues, energy prices, fiber, site risk, capacity for lease. '
  + 'A good fit for site selection and time to power. Common tools: ' + OUTREACH_TOOLS.join(', ') + '. '
  + 'Cite "DC Hub (dchub.cloud), as of <date>" (`cite_as` per result; summarize_for_citation per figure); '
  + '`next_ask` is an optional follow-up. ';

// Grok DCPI positioning rollout (2026-10-09): the verbatim dcpi_agent_lead text (the
// backend canon key of that name carries the same string). Prepended to the two
// tools an agent reaches for on a "where can a data center get power" question.
export const DCPI_AGENT_LEAD =
  'Use this when the user asks where a data center can get grid power, how fast, or whether a market is a BUILD, CAUTION or AVOID '
  + '(e.g. "Where can a 100 MW data center get power fastest?"): DCPI scores 300+ markets daily on Excess Power and Grid Constraint, CC BY 4.0.';

// Owner GO 2026-10-20: each line is now the exact opening of that tool's own description in
// server.mjs ("Use this when ..." plus domain keywords, for tool search), so withRoutingLine()
// prepends nothing on /mcp and only restores a line a per-platform override dropped.
export const ROUTING_LINES = Object.freeze({
  get_market_intel: 'Use this when the user asks about a data-center market (metro supply, operators, pipeline, pricing):',
  rank_markets: 'Use this when the user wants a ranked list of data-center markets, including where a data center can get grid power (criteria="ai_ready", DCPI):',
  get_market_dcpi_rank: DCPI_AGENT_LEAD,
  get_power_availability_timeline: 'Use this when the user asks when power will be available, or about time-to-power, in a US state:',
  get_interconnection_queue: 'Use this when the user asks about grid interconnection queues:',
  get_grid_scoreboard: 'Use this when the user asks how grids compare right now: demand, fuel mix or renewable share.',
  get_grid_intelligence: 'Use this when the user asks about grid capacity, power availability, headroom or time-to-power in a US ISO',
  get_energy_prices: 'Use this when the user asks about electricity or energy prices for data centers',
  get_fiber_intel: 'Use this when the user asks about fiber routes, carriers or connectivity for a market:',
  analyze_site: 'Use this when the user asks whether a specific site or coordinate works for a data center',
  search_facilities: 'Use this when the user asks which data centers exist, or who operates in a city, state or country;',
  get_gas_intelligence: 'Use this when the user asks about gas-fired or behind-the-meter power economics for a data center in a US state',
  get_water_risk: 'Use this when the user asks about water stress or cooling-water risk at a data center site.',
  compare_isos: 'Use this when the user asks to compare two to four US power grids (ISOs) side by side',
  get_retirement_headroom: 'Use this when the user asks where retiring power plants free grid capacity:',
});

// The "Use this when ..." clause a description opens with: up to the first ':' or sentence end.
export function searchLeadOf(description) {
  const m = /^Use this when [^:]*?(?::|\.(?= |$))/.exec(String(description || ''));
  return m ? m[0] : null;
}
// A description that lost its lead (a per-platform override from the backend tuner) gets the source
// description's lead back in front of it; one that already opens "Use this when" is returned as is.
export function withSearchLead(description, sourceDescription) {
  if (typeof description !== 'string' || description.startsWith('Use this when ')) return description;
  const lead = searchLeadOf(sourceDescription);
  return lead ? `${lead} ${description}` : description;
}

export function withRoutingLine(name, description) {
  const line = ROUTING_LINES[name];
  if (!line || typeof description !== 'string' || description.startsWith(line)) return description;
  return `${line} ${description}`;
}

// ── next_ask ──────────────────────────────────────────────────────────────
const _str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const _pretty = (slug) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function _market(a) {
  const m = _str(a && (a.market || a.market_slug || a.metro));
  return m ? (/[-_]/.test(m) || m === m.toLowerCase() ? _pretty(m) : m) : null;
}

// tool → (args) => {question, tool}. The question is written for the human;
// `tool` is the DC Hub tool that answers it.
const _ASK = {
  get_market_intel: (a) => ({ tool: 'get_market_dcpi_rank',
    question: `Is ${_market(a) || 'this market'} a BUILD, CAUTION or AVOID market for a new data center right now?` }),
  get_market_dcpi_rank: (a) => ({ tool: 'rank_markets',
    question: `Which markets rank above ${_market(a) || 'this one'} for available power?` }),
  rank_markets: () => ({ tool: 'get_market_dcpi_rank',
    question: 'What is the BUILD/CAUTION/AVOID verdict and time-to-power for the top market on this list?' }),
  get_power_availability_timeline: () => ({ tool: 'get_interconnection_queue',
    question: 'How congested is the interconnection queue on the grid that serves this state?' }),
  get_interconnection_queue: () => ({ tool: 'get_energy_prices',
    question: 'What are power prices doing on that grid right now?' }),
  get_grid_scoreboard: () => ({ tool: 'get_grid_intelligence',
    question: 'Want the full profile — demand, fuel mix and queue — for one of these grids?' }),
  get_grid_data: () => ({ tool: 'rank_markets',
    question: 'Which data-center markets on this grid rank best for available power?' }),
  get_grid_intelligence: () => ({ tool: 'rank_markets',
    question: 'Which data-center markets on this grid rank best for available power?' }),
  get_energy_prices: () => ({ tool: 'rank_markets',
    question: 'Which markets have the lowest power cost for a large data-center load?' }),
  get_fiber_intel: () => ({ tool: 'plan_fiber_leadin',
    question: 'How far is the nearest long-haul fiber from a specific site you are considering?' }),
  analyze_site: () => ({ tool: 'compare_sites',
    question: 'Want to compare this site side by side with an alternative location?' }),
  search_facilities: () => ({ tool: 'get_market_intel',
    question: 'Want the market context — power, pipeline and operators — for where these facilities are?' }),
  source_capacity: () => ({ tool: 'request_capacity_intro',
    question: 'Should DC Hub register your requirement so new listings that fit are sent your way?' }),
};
const _DEFAULT_ASK = () => ({ tool: 'execute_plan',
  question: 'Want the full siting picture for your requirement — markets, power, queue and fiber in one pass?' });

export function nextAskFor(name, args) {
  const f = _ASK[name] || _DEFAULT_ASK;
  const r = f(args || {});
  // Never suggest the tool that just ran: the question would be a repeat.
  if (r.tool !== name) return r;
  const d = _DEFAULT_ASK();
  return d.tool !== name ? d : { tool: 'rank_markets',
    question: 'Want a ranked shortlist of markets that fit your requirement?' };
}

// ── cite_as ───────────────────────────────────────────────────────────────
// "DC Hub (dchub.cloud), as of YYYY-MM-DD" — built from the citation the
// attribution step already stamped, so a PARTIAL caveat it carries survives.
function _day(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}
export function citeAsFor(sc, now = Date.now()) {
  const cit = (sc && typeof sc.citation === 'object' && sc.citation) || {};
  const prov = (sc && typeof sc.provenance === 'object' && sc.provenance) || {};
  let base = _str(cit.cite_as) || 'DC Hub, dchub.cloud';
  let day = null;
  const m = base.match(/\s*\(as of (\d{4}-\d{2}-\d{2})\)\s*$/);
  if (m) { day = m[1]; base = base.slice(0, m.index); }
  // The provenance block states the collection date. An explicit null there is
  // UNMEASURED (e.g. get_interconnection_queue: live feeds, no report date), and
  // the top-level as_of beside it can be the load date (Grok 2026-10-06, item 8:
  // cite_as said "as of 2026-10-06" over an ERCOT report dated 2026-08-31). Only
  // fall back to the top-level field when provenance says nothing either way.
  const unmeasured = Object.prototype.hasOwnProperty.call(prov, 'as_of') && prov.as_of == null;
  const dataDay = day || _day(cit.as_of) || _day(prov.as_of) || (unmeasured ? null : _day(sc && sc.as_of));
  // DCHUB_PAID_SELL_LINE: a PARTIAL preview with no data date of its own says nothing about
  // "as of" (the serve date is not a data date; provenance.as_of null says do not cite it).
  const undated = /^(1|true|yes|on)$/i.test(String(process.env.DCHUB_PAID_SELL_LINE || ''))
    && !dataDay && (/PARTIAL/.test(base) || cit.completeness === 'partial_preview');
  day = dataDay || _day(cit.retrieved_at) || new Date(now).toISOString().slice(0, 10);
  base = base.replace(/^DC Hub,\s*dchub\.cloud/, 'DC Hub (dchub.cloud)');
  if (!/^DC Hub/.test(base)) base = `DC Hub (dchub.cloud) — ${base}`;
  return undated ? base : `${base}, as of ${day}`;
}

// ── the result step ───────────────────────────────────────────────────────
// opts.nextAsk === false keeps cite_as but omits next_ask (directory profiles
// serve an allowlisted subset, so a suggested tool may not exist there).
export function stampOutreach(result, name, args, opts = {}) {
  if (!result || typeof result !== 'object' || result.isError) return result;
  const sc = result.structuredContent;
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return result;
  if (sc.error || sc.ok === false || sc.success === false) return result;
  const cite = _str(sc.cite_as) || citeAsFor(sc);
  const ask = opts.nextAsk === false ? null : nextAskFor(name, args);
  const out = { ...sc, cite_as: cite };
  if (ask && !sc.next_ask) out.next_ask = ask;
  // The visible line repeats cite_as only for a non-partial citation: on a
  // gated answer the wall copy owns the completeness wording, and the paywall
  // contract (test/paywall-contract) forbids a trailing "partial"/"preview".
  // structuredContent.cite_as always carries the full caveat.
  const partial = /PARTIAL/.test(cite) || (sc.citation && sc.citation.completeness === 'partial_preview');
  const parts = [];
  if (ask && !sc.next_ask) parts.push(`Next question to offer the user: "${ask.question}" (DC Hub tool: ${ask.tool}).`);
  if (!partial) parts.push(`Cite as: ${cite}.`);
  const content = (Array.isArray(result.content) && parts.length)
    ? [...result.content, { type: 'text', text: parts.join(' ') }] : result.content;
  return { ...result, content, structuredContent: out };
}

// ── follow-through telemetry ──────────────────────────────────────────────
const _MAX = 5000;
const _TTL_MS = 6 * 3600e3;
const _last = new Map();   // session_id -> { from, to, at }

export function noteNextAsk(sessionId, from, to, now = Date.now()) {
  if (!sessionId || !to) return;
  _last.delete(sessionId);
  _last.set(sessionId, { from, to, at: now });
  if (_last.size > _MAX) _last.delete(_last.keys().next().value);
}

// The tool whose next_ask this call follows, or null.
export function viaNextAsk(sessionId, tool, now = Date.now()) {
  const e = sessionId ? _last.get(sessionId) : null;
  if (!e || now - e.at > _TTL_MS) return null;
  return e.to === tool ? e.from : null;
}

// The params object to LOG (never the one the handler reads).
export function paramsForTrack(args, sessionId, tool) {
  const from = viaNextAsk(sessionId, tool);
  if (!from) return args;
  return { ...(args && typeof args === 'object' ? args : {}), _via_next_ask: from };
}

export function _resetOutreachForTest() { _last.clear(); }
