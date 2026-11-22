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
//   nextAskArgs()     (owner 2026-11-18, "lets do 1-6", item 2) every next_ask
//                     carries `args` filled from the call that just ran
//                     (state, iso, market, capacity, coordinates), named as
//                     the suggested tool's own schema names them, so the agent
//                     can make the follow-up without re-deriving them. Still
//                     structured only: no visible "next call" line (owner).
//                     Kill switch DCHUB_NEXT_ASK_ARGS=0.
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
// Item 9 (owner 2026-11-11): OUTREACH_OPENER ('DC Hub (dchub.cloud) — live, dated data on data centers and their power')
// is retired: lib/dchub-identity.mjs CANON_SENTENCE is the first sentence of every non-frozen handshake.
// Energy first (owner 2026-11-11, item 3): the same five tools, grid and capacity named before the market and facility lookups.
export const OUTREACH_TOOLS = Object.freeze(['execute_plan', 'get_grid_data', 'source_capacity', 'get_market_intel', 'search_facilities']);
// Tool search: Claude Code defers MCP tools and loads a tool upfront when its tools/list entry
// carries _meta["anthropic/alwaysLoad"] = true (code.claude.com/docs/en/mcp, "Mark a tool to load
// upfront"); Anthropic's tool-search guidance is to keep the 3-5 most used tools non-deferred.
// These are the same five the lead names.
export const ALWAYS_LOAD_META_KEY = 'anthropic/alwaysLoad';
export const ALWAYS_LOAD_TOOLS = Object.freeze(new Set(OUTREACH_TOOLS));
export const OUTREACH_LEAD =
  // Item 9 (owner 2026-11-11): the canon sentence (lib/dchub-identity.mjs CANON_SENTENCE) now opens every
  // non-frozen handshake, and it already names power, grid, queues, capacity, fiber, sites and markets and says
  // DC Hub is the neutral orchestration layer, so this lead no longer opens with OUTREACH_OPENER or repeats that
  // list: it names what the canon sentence does not (gas prices and the Data Center Gas Index, facilities, site
  // risk), keeps the energy-first good-fit line (mcp#1365), and steers a market or siting answer to the Data
  // Center Power Index (DCPI) verdict (item 3). Stays under 500 characters (test/agent-outreach) and every
  // handshake under the 2,048 / 2,000 budgets (test/initialize-instructions-length).
  'Also: gas prices (Data Center Gas Index, DCGI), facilities, site risk. '
  + 'A good fit for site selection, time to power; lead a market or siting answer with its Data Center Power Index (DCPI) verdict. '
  + 'Tools: ' + OUTREACH_TOOLS.join(', ') + '. '
  + 'Cite "DC Hub (dchub.cloud), as of <date>" (`cite_as` per result; summarize_for_citation per figure); '
  + '`next_ask`: optional follow-up. ';

// Grok DCPI positioning rollout (2026-10-09): the verbatim dcpi_agent_lead text (the
// backend canon key of that name carries the same string). Prepended to the two
// tools an agent reaches for on a "where can a data center get power" question.
export const DCPI_AGENT_LEAD =
  'Use this when the user asks where a data center can get grid power, how fast, or whether a market is a BUILD, CAUTION or AVOID '
  + '(e.g. "Where can a 100 MW data center get power fastest?"): DCPI scores markets daily on Excess Power and Grid Constraint, verdicts CC BY 4.0 after 30 days.';

// Owner GO 2026-10-20: each line is now the exact opening of that tool's own description in
// server.mjs ("Use this when ..." plus domain keywords, for tool search), so withRoutingLine()
// prepends nothing on /mcp and only restores a line a per-platform override dropped.
export const ROUTING_LINES = Object.freeze({
  get_market_intel: 'Use this when the user asks about a data-center market (metro supply, operators, pipeline, pricing):',
  rank_markets: 'Use this when the user wants a ranked list of data-center markets, including where a data center can get grid power (criteria="ai_ready", DCPI):',
  get_market_dcpi_rank: DCPI_AGENT_LEAD,
  get_power_availability_timeline: 'Use this when the user asks when power will be available, or about time-to-power, in a US state:',
  get_interconnection_queue: 'Use this when the user asks about grid interconnection queues:',
  get_grid_scoreboard: 'Use this when the user asks how power grids compare: demand, fuel mix or renewable share.',
  get_grid_intelligence: 'Use this when the user asks about grid capacity, power availability, headroom or time-to-power in a US ISO',
  get_energy_prices: 'Use this when the user asks what electricity or natural gas costs for a data center in a US ISO or state',
  get_fiber_intel: 'Use this when the user asks about fiber routes, carriers or connectivity for a market:',
  analyze_site: 'Use this when the user asks whether a specific site or coordinate works for a data center',
  search_facilities: 'Use this when the user asks which data centers exist, or who operates in a city, state or country;',
  get_gas_intelligence: 'Use this when the user asks about gas-fired or behind-the-meter power economics for a data center in a US state',
  get_water_risk: 'Use this when the user asks about water stress or cooling-water risk at a data center site',
  compare_isos: 'Use this when the user asks to compare two to four power grids side by side',
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

// 2026-10-22: a description that already opens with ANY "Use this when ..." lead keeps it. The exact-prefix
// check alone prepended a second lead whenever a server.mjs description was reworded and its line here was
// not (live /mcp: compare_isos, get_grid_scoreboard, get_water_risk carried two leads after mcp#1106).
// test/tools-list-one-lead.test.mjs reads every surface's tools/list for exactly one lead.
export function withRoutingLine(name, description) {
  const line = ROUTING_LINES[name];
  if (!line || typeof description !== 'string' || description.startsWith('Use this when ')) return description;
  return `${line} ${description}`;
}

// ── next_ask ──────────────────────────────────────────────────────────────
const _str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const _pretty = (slug) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function _market(a) {
  const m = _str(a && (a.market || a.market_slug || a.metro));
  return m ? (/[-_]/.test(m) || m === m.toLowerCase() ? _pretty(m) : m) : null;
}

// ── next_ask args (item 2) ────────────────────────────────────────────────
// Only values that are unambiguous in the call that just ran, and only under the argument names the suggested
// tool's zod schema in server.mjs declares (test/next-ask-args.test.mjs checks every name against tools/list).
export function nextAskArgsOn(env = process.env) {
  return !/^(0|off|false|no)$/i.test(String((env && env.DCHUB_NEXT_ASK_ARGS) || '').trim());
}
const _US_ISOS = Object.freeze(['PJM', 'ERCOT', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISONE']);
function _iso(a) {
  const v = _str(a && (a.iso || a.region_id || a.region));
  if (!v || v.includes(',')) return null;
  const u = v.toUpperCase().replace(/[^A-Z]/g, '');
  return _US_ISOS.includes(u) ? u : null;
}
function _state(a) {
  const v = _str(a && a.state);
  return v && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null;
}
function _slug(a) {
  const v = _str(a && (a.market || a.market_slug));
  if (!v) return null;
  const s = v.toLowerCase().replace(/\s+/g, '-');
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(s) ? s : null;
}
function _num(v) { const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN); return Number.isFinite(n) ? n : null; }
function _mw(a) {
  const n = _num(a && (a.capacity_mw ?? a.target_mw ?? a.mw ?? a.min_mw));
  return n !== null && n > 0 ? n : null;
}
function _coords(a) {
  const lat = _num(a && (a.lat ?? a.latitude));
  const lon = _num(a && (a.lon ?? a.lng ?? a.long ?? a.longitude));
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
// Drop empty values; null when nothing is left.
function _args(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return Object.keys(out).length ? out : null;
}

// tool → (args) => {question, tool}. The question is written for the human;
// `tool` is the DC Hub tool that answers it.
// `args` (item 2) is optional: present only when the call that just ran pins a value the suggested tool takes.
// `needs` names a required argument the call could not supply.
const _GRID_ASK = (a) => {
  const iso = _iso(a);
  const st = _state(a);
  if (iso && st) return { tool: 'get_power_availability_timeline', args: { state: st },
    question: `When is power likely to be available for a new data-center load in ${st}?` };
  if (iso) return { tool: 'get_interconnection_queue', args: { iso },
    question: `How congested is the ${iso} interconnection queue right now?` };
  return { tool: 'rank_markets', args: { criteria: 'ai_ready' },
    question: 'Which data-center markets on this grid rank best for available power?' };
};
const _ASK = {
  get_market_intel: (a) => ({ tool: 'get_market_dcpi_rank', args: _args({ market_slug: _slug(a) }),
    question: `Is ${_market(a) || 'this market'} a BUILD, CAUTION or AVOID market for a new data center right now?` }),
  get_market_dcpi_rank: (a) => ({ tool: 'rank_markets', args: { criteria: 'ai_ready' },
    question: `Which markets rank above ${_market(a) || 'this one'} for available power?` }),
  rank_markets: () => ({ tool: 'get_market_dcpi_rank',
    question: 'What is the BUILD/CAUTION/AVOID verdict and time-to-power for the top market on this list?' }),
  // get_interconnection_queue takes `iso` only, and a state does not name one ISO, so nothing is filled here.
  get_power_availability_timeline: () => ({ tool: 'get_interconnection_queue',
    question: 'How congested is the interconnection queue on the grid that serves this state?' }),
  get_interconnection_queue: (a) => ({ tool: 'get_energy_prices',
    args: _iso(a) ? { iso: _iso(a) } : _args({ state: _state(a) }),
    question: 'What are power prices doing on that grid right now?' }),
  get_grid_scoreboard: () => ({ tool: 'get_grid_intelligence',
    question: 'Want the full profile — demand, fuel mix and queue — for one of these grids?' }),
  // Owner 2026-11-18 (item 2): a grid answer for a known US ISO suggests that grid's time to power (a state is
  // known) or its queue, with the grid filled in; with no ISO it keeps the market ranking.
  get_grid_data: _GRID_ASK,
  get_grid_intelligence: _GRID_ASK,
  get_energy_prices: () => ({ tool: 'rank_markets', args: { criteria: 'cheapest_power' },
    question: 'Which markets have the lowest power cost for a large data-center load?' }),
  get_fiber_intel: () => ({ tool: 'plan_fiber_leadin',
    question: 'How far is the nearest long-haul fiber from a specific site you are considering?' }),
  analyze_site: (a) => {
    const c = _coords(a);
    return { tool: 'compare_sites', args: _args({ locations: c ? `${c.lat},${c.lon}` : null, capacity_mw: _mw(a) }),
      ...(c ? { needs: 'one to three more "lat,lon" pairs appended to locations, separated by ";"' } : {}),
      question: 'Want to compare this site side by side with an alternative location?' };
  },
  search_facilities: () => ({ tool: 'get_market_intel',
    question: 'Want the market context — power, pipeline and operators — for where these facilities are?' }),
  source_capacity: (a) => ({ tool: 'request_capacity_intro',
    args: _args({ capacity_mw: _mw({ capacity_mw: a.target_mw ?? a.min_mw }), markets: _str(a.market), states: _state(a) }),
    question: 'Should DC Hub register your requirement so new listings that fit are sent your way?' }),
};
const _DEFAULT_ASK = (a = {}) => {
  const c = _coords(a);
  const args = _args({ market: _slug(a), state: _state(a), iso: _iso(a), capacity_mw: _mw(a),
    lat: c ? c.lat : null, lon: c ? c.lon : null });
  return { tool: 'execute_plan', ...(args ? { args, needs: "intent: your human's question, in their words" } : {}),
    question: 'Want the full siting picture for your requirement — markets, power, queue and fiber in one pass?' };
};

// Watch step 2 (owner 2026-11-02, ~/Downloads/dchub-watch-alerts-scope-1102.md): an answer about one
// market offers to watch it. set_market_alert takes the email the user types and binds it in the same
// call (mcp#1250), so this one follow-up is both the email ask and the reason to come back. It rides
// next_ask because the lean step keeps next_ask and drops the older watch line and watch_offer
// (lib/lean-response.mjs DROP_KEY), and noteNextAsk / _via_next_ask already count follow-through.
// Walls keep their own next_ask (_outreachStep withWallNextAsk; stampOutreach never replaces one), and
// the directory / core profiles drop next_ask downstream (test/watch-next-ask.test.mjs pins both).
// Kill switch DCHUB_WATCH_NEXT_ASK=0.
export const WATCH_ASK_TOOLS = Object.freeze(['get_market_intel', 'get_market_dcpi_rank']);
export function watchAskOn(env = process.env) {
  return !/^(0|off|false|no)$/i.test(String((env && env.DCHUB_WATCH_NEXT_ASK) || '').trim());
}
// Watch a SITE (owner 2026-11-18, item 3): a successful analyze_site / get_composite_site_score answer at a
// coordinate offers save_site with the coordinate filled in. save_site, not set_site_alert: set_site_alert needs a
// saved_site_id (it arms an alert on an already-saved site) and an email, while save_site is the step that puts the
// site on the key, and a saved site is what get_changes' `portfolio` block (dchub-backend lp_sites
// portfolio_snapshot) reports on next session. KEYED callers only (save_site needs a key; a keyless caller keeps
// the follow-up it gets today). Kill switches DCHUB_WATCH_SITE_NEXT_ASK=0, and DCHUB_WATCH_NEXT_ASK=0 for both.
export const WATCH_SITE_ASK_TOOLS = Object.freeze(['analyze_site', 'get_composite_site_score']);
export function watchSiteAskOn(env = process.env) {
  return watchAskOn(env) && !/^(0|off|false|no)$/i.test(String((env && env.DCHUB_WATCH_SITE_NEXT_ASK) || '').trim());
}
export function watchSiteAskFor(name, args, opts = {}) {
  if (!WATCH_SITE_ASK_TOOLS.includes(name) || !opts.keyed || !watchSiteAskOn()) return null;
  const c = _coords(args);
  if (!c) return null;
  return { tool: 'save_site',
    question: 'Want this site kept on your key, so a later session can see what changed around it?',
    args: _args({ lat: c.lat, lon: c.lon, state: _state(args), target_mw: _mw(args) }) };
}
export function watchAskFor(name, args, opts = {}) {
  const site = watchSiteAskFor(name, args, opts);
  if (site) return site;
  if (!WATCH_ASK_TOOLS.includes(name) || !watchAskOn()) return null;
  const slug = _str(args && (args.market || args.market_slug));
  if (!slug) return null;
  return { tool: 'set_market_alert',
    question: `Want an email when ${_market(args)}'s power verdict or scores change? Tell me your email and I'll set it up.`,
    args: { market: slug, channel: 'email' },
    needs: 'an email your human types here, passed as email (never guess one)' };
}

// With the args kill switch off, the follow-ups are exactly the pre-2026-11-18 ones (tool + question; the
// market watch keeps its own args, which predate item 2).
function _plain(r) {
  if (!r) return r;
  if (nextAskArgsOn() && r.args) return r;
  const { args: _a, needs: _n, ...rest } = r;   // no args pinned (or the switch is off): no args key, no needs
  return rest;
}
export function nextAskFor(name, args, opts = {}) {
  const w = watchAskFor(name, args, opts);
  if (w) return w;   // the watch asks carry their own args under their own kill switches
  const f = _ASK[name] || _DEFAULT_ASK;
  const r = f(args || {});
  // Never suggest the tool that just ran: the question would be a repeat.
  if (r.tool !== name) return _plain(r);
  const d = _DEFAULT_ASK(args || {});
  return _plain(d.tool !== name ? d : { tool: 'rank_markets',
    question: 'Want a ranked shortlist of markets that fit your requirement?' });
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

// ── cite_as_url (owner 2026-11-14, F4 "build on us") ─────────────────────
// The link an agent or a builder puts behind the cite_as text. It is the page the
// citation names when that page is on dchub.cloud (a listing, a market), else the
// site, with ?via=agent-cite so a click from a cited answer is counted as one
// (dchub-backend routes/via_attribution.py counts ?via=). Nothing about the caller
// rides in it. Any other host in citation.url is never echoed.
export const CITE_VIA = 'agent-cite';
export function citeAsUrlFor(sc) {
  const cit = (sc && typeof sc.citation === 'object' && sc.citation) || {};
  let u = null;
  try {
    const c = new URL(_str(cit.url) || 'https://dchub.cloud/');
    if (c.protocol === 'https:' && c.hostname === 'dchub.cloud' && !c.username && !c.password) u = c;
  } catch (_) { u = null; }
  if (!u) u = new URL('https://dchub.cloud/');
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) {
    if (k === 'via' || /key|token|email|session|sid/i.test(k)) u.searchParams.delete(k);
  }
  u.searchParams.set('via', CITE_VIA);
  return u.toString();
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
  const ask = opts.nextAsk === false ? null : nextAskFor(name, args, { keyed: !!opts.keyed });
  const out = { ...sc, cite_as: cite };
  // F4 (2026-11-14): the link behind cite_as. Not on a walled result (it carries exactly one
  // link, human_url, for the human) and not where opts.citeUrl === false (the frozen directory
  // profiles, whose result shape is pinned by their reviews).
  if (opts.citeUrl !== false && !sc.cite_as_url && !sc.human_url && !sc.for_your_human) {
    out.cite_as_url = citeAsUrlFor(sc);
  }
  if (ask && !sc.next_ask) out.next_ask = ask;
  // The visible line repeats cite_as only for a non-partial citation: on a
  // gated answer the wall copy owns the completeness wording, and the paywall
  // contract (test/paywall-contract) forbids a trailing "partial"/"preview".
  // structuredContent.cite_as always carries the full caveat.
  const partial = /PARTIAL/.test(cite) || (sc.citation && sc.citation.completeness === 'partial_preview');
  // Agent QA 2026-10-20 (item 1): no steering line in the visible text. A
  // "Next question to offer the user" sentence read as a salesperson's script,
  // not a neutral source; the suggestion stays in structuredContent.next_ask,
  // where an agent can use it or ignore it.
  const parts = [];
  if (!partial) parts.push(`Cite as: ${cite}.`);
  const content = (Array.isArray(result.content) && parts.length)
    ? [...result.content, { type: 'text', text: parts.join(' ') }] : result.content;
  return { ...result, content, structuredContent: out };
}

// ── follow-through telemetry ──────────────────────────────────────────────
const _MAX = 5000;
const _TTL_MS = 6 * 3600e3;
const _last = new Map();   // session_id -> { from, to, at }

// `args` (item 2, 2026-11-18): the filled args the suggestion carried, so the logged row can say whether the
// follow-up used them.
export function noteNextAsk(sessionId, from, to, now = Date.now(), args = null) {
  if (!sessionId || !to) return;
  _last.delete(sessionId);
  const a = args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length ? { ...args } : null;
  _last.set(sessionId, { from, to, at: now, ...(a ? { args: a } : {}) });
  if (_last.size > _MAX) _last.delete(_last.keys().next().value);
}

function _followed(sessionId, tool, now) {
  const e = sessionId ? _last.get(sessionId) : null;
  if (!e || now - e.at > _TTL_MS) return null;
  return e.to === tool ? e : null;
}
// The tool whose next_ask this call follows, or null.
export function viaNextAsk(sessionId, tool, now = Date.now()) {
  const e = _followed(sessionId, tool, now);
  return e ? e.from : null;
}

// 'all' | 'some' | 'none': how many of the suggested args the call passed with the same value. Pure.
export function nextAskArgsMatch(suggested, called) {
  const keys = Object.keys(suggested || {});
  if (!keys.length) return null;
  const c = called && typeof called === 'object' ? called : {};
  const same = keys.filter((k) => c[k] !== undefined && c[k] !== null && String(c[k]).toLowerCase() === String(suggested[k]).toLowerCase()).length;
  return same === keys.length ? 'all' : (same ? 'some' : 'none');
}

// The params object to LOG (never the one the handler reads).
//   _via_next_ask       the tool whose next_ask this call took (per-tool follow-through = rows carrying it
//                       for tool X / successful rows of X that were served a next_ask)
//   _via_next_ask_args  'all' | 'some' | 'none' when that suggestion carried filled args (item 2)
export function paramsForTrack(args, sessionId, tool) {
  const e = _followed(sessionId, tool, Date.now());
  if (!e) return args;
  const m = e.args ? nextAskArgsMatch(e.args, args) : null;
  return { ...(args && typeof args === 'object' ? args : {}), _via_next_ask: e.from, ...(m ? { _via_next_ask_args: m } : {}) };
}

// ── shown: the row of the call that SERVED a next_ask (coordinator follow-up 2026-11-18, mcp#1564) ──
// Follow-through alone (_via_next_ask on the NEXT call's row) has no denominator: which answers carried a
// suggestion lived only in memory. The served answer's own /api/v1/mcp/track row now says so:
//   params._next_ask_to   the tool name its final structuredContent.next_ask suggested
// so per-tool follow-up = rows with _via_next_ask = X / rows of tool X with _next_ask_to set.
// The row is built in the handler's `finally`, before the outer steps stamp next_ask, so server.mjs holds it
// on the request ctx (holdTrackRow) and sends it from the outermost wrapper with the result the agent
// receives (flushTrackRows). A held row is never lost: a timer sends it unmarked if nothing flushes it.
// Only the LOGGED params copy gets the field, never the handler's args.
// Kill switch DCHUB_NEXT_ASK_SHOWN_LOG=0: every row is sent at once, exactly as before.
export const NEXT_ASK_SHOWN_FIELD = '_next_ask_to';
export const TRACK_ROW_HOLD_MS = 5000;
export function nextAskShownLogOn(env = process.env) {
  return !/^(0|off|false|no)$/i.test(String((env && env.DCHUB_NEXT_ASK_SHOWN_LOG) || '').trim());
}
// The tool the served result's next_ask names, or null. Pure.
export function servedNextAskTo(result) {
  try {
    const sc = result && result.structuredContent;
    const a = sc && typeof sc === 'object' && !Array.isArray(sc) ? sc.next_ask : null;
    const t = a && typeof a === 'object' && typeof a.tool === 'string' ? a.tool.trim() : '';
    return /^[a-z][a-z0-9_]{1,63}$/.test(t) ? t : null;
  } catch (_) { return null; }
}
// A copy of `row` whose params carry the field; `row` and its params are not touched. Pure.
export function withNextAskShown(row, tool) {
  if (!row || typeof row !== 'object' || !tool) return row;
  const p = row.params && typeof row.params === 'object' && !Array.isArray(row.params) ? row.params : {};
  return { ...row, params: { ...p, [NEXT_ASK_SHOWN_FIELD]: tool } };
}
function _sendRowOnce(e, payload) {
  if (!e || e.sent) return false;
  e.sent = true;
  if (e.timer) { try { clearTimeout(e.timer); } catch (_) { /* gone */ } }
  try { const r = e.send(payload); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (_) { /* telemetry */ }
  return true;
}
// Hold `row` on ctx until flushTrackRows; true when held.
export function holdTrackRow(c, row, send, { fallbackMs = TRACK_ROW_HOLD_MS } = {}) {
  try {
    if (!c || typeof c !== 'object' || !row || typeof send !== 'function') return false;
    const e = { row, send, sent: false, timer: null };
    e.timer = setTimeout(() => { _sendRowOnce(e, e.row); }, fallbackMs);
    if (e.timer && typeof e.timer.unref === 'function') e.timer.unref();
    if (!Array.isArray(c._heldTrackRows)) c._heldTrackRows = [];
    c._heldTrackRows.push(e);
    return true;
  } catch (_) { return false; }
}
// Send every row held for `tool`, marked with what `result` served (unmarked when `mark` is false or the
// result carried no next_ask). Returns the number sent.
export function flushTrackRows(c, tool, result, { mark = true } = {}) {
  let n = 0;
  try {
    const list = c && Array.isArray(c._heldTrackRows) ? c._heldTrackRows : null;
    if (!list || !list.length) return 0;
    const to = mark ? servedNextAskTo(result) : null;
    const keep = [];
    for (const e of list) {
      if (e && !e.sent && e.row && e.row.tool === tool) {
        if (_sendRowOnce(e, to && e.row.status !== 'error' ? withNextAskShown(e.row, to) : e.row)) n += 1;
      } else if (e && !e.sent) keep.push(e);
    }
    c._heldTrackRows = keep;
  } catch (_) { /* telemetry never touches a response */ }
  return n;
}

export function _resetOutreachForTest() { _last.clear(); }
