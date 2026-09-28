// grok-profile.mjs — the Grok-sized endpoint served at /mcp/grok (G1, G2, G5
// of the 2026-09-27 Grok path audit).
//
// WHY THIS EXISTS. Measured 2026-09-27 on live /mcp: tools/list is 92 tools and
// 457-479 KB (outputSchema ~236 KB of it). xAI documents that without
// `allowed_tools` every tool definition is injected into Grok's context, and
// grok.com consumer connectors have no documented tool filter, so a consumer
// Grok user gets the whole catalogue on every turn. The server has to do the
// scoping. Tool RESULTS are the other half: get_grid_scoreboard, the call the
// install page recommends as the first one, returned 46,912 characters of text
// (plus ~53k of structuredContent) — measured against a hosted connector that
// keeps 20,000 text bytes.
//
// WHAT THIS PATH DOES, and nothing else:
//   · tools/list lists GROK_TOOLS only, each description <= 600 characters,
//     with no outputSchema (structuredContent is still returned; MCP allows it
//     without a declared schema). Annotations, _meta and inputSchema pass
//     through unchanged, so access/maturity markers stay what /mcp says.
//   · tools/call text is capped at GROK_TEXT_MAX_CHARS (see capToolResultText).
//     structuredContent is never touched.
//   · /mcp/grok/oauth (and /mcp/grok?auth=oauth) answers an unauthenticated
//     initialize with 401 + WWW-Authenticate so a connector's setup step can
//     run the AuthKit OAuth flow. The plain path stays keyless.
//
// ★ A LISTING SCOPE, NOT AN ENTITLEMENT SCOPE — same contract as the r-pack
// paths in server.mjs. tools/call on /mcp/grok still accepts any DC Hub tool by
// name, every gate runs on the caller's key exactly as on /mcp, and nothing
// here reads or writes a key, a trial or a paywall line.
//
// /mcp is NOT changed by anything in this file.

import { readFileSync } from 'node:fs';

export const GROK_PATH = '/mcp/grok';
export const GROK_OAUTH_PATH = '/mcp/grok/oauth';
export const GROK_PACK_NAME = 'grok';
export const GROK_DESCRIPTION_MAX = 600;
export const GROK_TEXT_MAX_CHARS = 12000;
// The cap on the whole tools/list response body this path may serve. Pinned by
// test/grok-profile.test.mjs against the real handler.
export const GROK_TOOLS_LIST_MAX_BYTES = 40000;

// Why these eleven (brief §4 and §6 G1, measured 2026-09-27):
//   · eight free or free-preview tools a keyless Grok user can actually get an
//     answer from: execute_plan (the front door), get_grid_scoreboard (the
//     install-test call), get_market_dcpi_rank, search_facilities,
//     get_power_availability_timeline, get_hosting_capacity, source_capacity
//     and get_changes;
//   · the two paid flagships with the most measured demand from free users in
//     30 days: get_grid_intelligence (90) and analyze_site (72);
//   · discover_tools, so the endpoint is not a dead end: it names the rest of
//     the catalogue, all of which stays callable by name.
// Not the "Grok starter toolkit": 4 of its 9 were paid or metered.
export const GROK_TOOLS = Object.freeze([
  'execute_plan', 'get_grid_scoreboard', 'get_market_dcpi_rank', 'search_facilities',
  'get_power_availability_timeline', 'get_hosting_capacity', 'source_capacity', 'get_changes',
  'get_grid_intelligence', 'analyze_site', 'discover_tools',
]);

// Hand-written for every tool whose /mcp description is over the cap. Only
// arguments the tool actually declares are named. A tool whose /mcp
// description already fits (get_market_dcpi_rank today) is served as-is, so it
// cannot drift from /mcp.
export function grokDescriptions({ facilities = '24,600+', countries = '170+' } = {}) {
  return {
    execute_plan: 'Answer a data-center infrastructure question that spans several topics in one call: '
      + 'markets and the Data Center Power Index (DCPI), grid power and headroom, interconnection queues, fiber, '
      + 'water and climate risk, tax incentives, and deals. Pass the user\'s question unchanged as intent. '
      + 'A rule-based planner (no AI model) picks the lookups, runs them and returns each step\'s result '
      + 'with a replay of how the answer was built. Use this first when a question has more than one part.',
    get_grid_scoreboard: 'Live grid scoreboard: US grid operators (PJM, ERCOT, CAISO, MISO, SPP, NYISO, '
      + 'ISO-NE, BPA, TVA), Great Britain, European bidding zones, Taiwan, Japan, South Korea and Brazil, '
      + 'ranked side by side on each feed\'s latest published reading: renewable share (wind+solar+hydro), '
      + 'gas share, fuel mix in MW and demand, greenest first. Freshness differs by feed, so read each '
      + 'row\'s mix_age_hours before calling a reading current. No arguments. Answers "which grid is '
      + 'cleanest right now".',
    search_facilities: `Search ${facilities} data-center facilities in ${countries} countries by text query, `
      + 'country, state, city, operator, or capacity range (min_capacity_mw, max_capacity_mw); limit and '
      + 'offset page through results. Returns each facility\'s name, provider, location and capacity. Use '
      + 'it for inventory lookups (which facilities match these filters); for a question that also needs '
      + 'power, fiber or risk context, use execute_plan.',
    get_power_availability_timeline: 'When power gets easier in one US state, year by year: new generation '
      + 'coming online (EIA-860M, kept separate as under construction, testing and planned), scheduled '
      + 'retirements, and interconnection-queue depth as congestion context (the queue has no delivery '
      + 'dates). cumulative_firm_signal_mw counts only under-construction and testing MW minus retirements. '
      + 'Arguments: state (required), years, mw. Supply-side signals, not a promise that a load can connect.',
    get_hosting_capacity: 'Utility-published feeder hosting capacity: the MW a named distribution feeder '
      + 'can take, from utilities\' own hosting-capacity maps (a named set of utilities in the Northeast, '
      + 'Mid-Atlantic and Midwest, not nationwide). Call with lat and lon (radius_km, default 25), with a '
      + 'utility or market for a whole territory, or with no arguments for the list of covered markets. '
      + 'Check capacity_type before quoting a number, and count distinct_feeders, not rows.',
    source_capacity: 'Search DC Hub Capacity Source for data-center capacity to buy or lease, by size '
      + '(min_kw or min_mw) and location (region such as europe, or a country, state, market or location). '
      + 'Size is matched against what a listing can deliver: contiguous_kw, the largest contiguous block, '
      + 'and min_contract_kw, the smallest chunk the provider will contract. Also filters by delivery_type '
      + 'and available_by. Returns listing teasers; an introduction is requested with request_capacity_intro.',
    get_changes: 'What changed in DC Hub since a timestamp: DCPI 7-day market movers, newly found '
      + 'facilities, and new M&A deals and news; keyed callers with saved sites also get per-site changes. '
      + 'Pass since as ISO-8601 or "24h" / "7d" (default 24h) and pass the response\'s generated_at back '
      + 'next time. Answers "what changed this week".',
    get_grid_intelligence: 'Grid headroom and interconnection-queue brief for one grid: "can I get N MW '
      + 'in this ISO, and how long will it take?". region_id is one of PJM, ERCOT, CAISO, MISO, SPP, NYISO, '
      + 'ISO-NE, or a US balancing authority (those return the live generation mix). Supply-side signals, '
      + 'not a promise that a load can connect.',
    analyze_site: 'Score one site for data-center suitability. Pass lat and lon, a candidate_id from '
      + 'get_refined_queue, or a market name as location; capacity_mw and state refine it. Returns a 0-100 '
      + 'score with power, gas, fiber, market and risk sub-scores and the nearby infrastructure behind '
      + 'them. Example: lat=33.45 lon=-112.07 capacity_mw=100 state=AZ.',
    discover_tools: 'Browse DC Hub\'s full tool catalogue by family (facility, market, grid and power, gas, '
      + 'site geometry, fiber, deals and news, saved work, account), optionally filtered by query. This '
      + 'endpoint lists a Grok-sized subset; every other DC Hub tool can still be called by name.',
  };
}

// Quantities come from the canonical snapshot daily-manifest-sync refreshes
// (canonical/canon_phrases.json), as lib/claude-directory.mjs does, so they
// cannot drift from /mcp's. The literals are the fallback if it is unreadable.
const _CANON = (() => {
  try { return JSON.parse(readFileSync(new URL('../canonical/canon_phrases.json', import.meta.url), 'utf8')); }
  catch (_) { return {}; }
})();
export const GROK_DESCRIPTIONS = Object.freeze(grokDescriptions({
  facilities: typeof _CANON.facilities === 'string' ? _CANON.facilities : '24,600+',
  countries: typeof _CANON.countries === 'string' ? _CANON.countries : '170+',
}));

// One factual clause from the tool's own access annotation (the value /mcp
// publishes), so a keyless Grok user knows before calling which tools answer
// in full. Not sales copy: no price, no link, no instruction.
const ACCESS_NOTE = {
  free: '',
  free_preview: ' Keyless calls return a preview.',
};
function accessNote(access) {
  if (!access) return '';
  if (Object.prototype.hasOwnProperty.call(ACCESS_NOTE, access)) return ACCESS_NOTE[access];
  return ' Full results need a paid DC Hub key.';
}

// Cut a description to `max` characters at a sentence end, else at a word,
// never mid-word. Used for the /mcp description of a listed tool that has no
// hand-written entry (a tool added to GROK_TOOLS later) and as the final
// bound on every served description.
export function compactDescription(desc, max = GROK_DESCRIPTION_MAX) {
  const d = String(desc == null ? '' : desc).replace(/\s+/g, ' ').trim();
  if (d.length <= max) return d;
  const head = d.slice(0, max);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.) '));
  if (stop >= max * 0.4) return head.slice(0, stop + 1);
  const sp = head.lastIndexOf(' ', max - 1);
  return (sp > 0 ? head.slice(0, sp) : head.slice(0, max - 1)) + '…';
}

// Project a finished canonical ListToolsResult onto the Grok list. Tool
// objects are copied, never rebuilt: only description and outputSchema change.
export function grokToolsList(result, descriptions = GROK_DESCRIPTIONS) {
  const have = new Map((result?.tools || []).map((t) => [t.name, t]));
  const tools = [];
  const missing = [];
  for (const n of GROK_TOOLS) {
    const t = have.get(n);
    if (!t) { missing.push(n); continue; }
    const out = { ...t };
    delete out.outputSchema;
    const access = (t.annotations && t.annotations.access) || null;
    const own = descriptions[n];
    const base = own || t.description;
    const note = accessNote(access);
    out.description = compactDescription(base, GROK_DESCRIPTION_MAX - note.length) + note;
    tools.push(out);
  }
  if (missing.length) {
    console.error(`[grok] GROK_TOOLS names ${missing.length} tool(s) absent from the catalog — serving short: ${missing.join(', ')}`);
  }
  return result?._meta ? { tools, _meta: result._meta } : { tools };
}

// ── G5: the opt-in OAuth variant ────────────────────────────────────────────
export function isGrokOauthRequest(req) {
  const p = (req?.path || '').replace(/\/+$/, '');
  if (p === GROK_OAUTH_PATH) return true;
  if (p !== GROK_PATH) return false;
  try {
    return new URL(req.url || '', 'http://_').searchParams.get('auth') === 'oauth';
  } catch (_) { return false; }
}
export const GROK_OAUTH_CHALLENGE =
  'Bearer resource_metadata="https://dchub.cloud/.well-known/oauth-protected-resource", '
  + 'scope="openid profile email offline_access"';
export const GROK_OAUTH_MESSAGE =
  'Sign-in required: this DC Hub connector URL uses OAuth. Complete the sign-in advertised in '
  + 'WWW-Authenticate (RFC 9728 resource_metadata). For keyless access use https://dchub.cloud/mcp/grok.';

// ── G2: text cap for tools/call results ─────────────────────────────────────
//
// THE RULE. What DC Hub says about the honesty and the price of an answer is
// never what gets cut to save room. The JSON blocks are slimmed STRUCTURALLY by
// server.mjs's _slimStepResult (every array keeps its first rows and reports
// the full count; tier_masked, relay, upgrade, unlock, machine_pay and the
// other never-cut keys ride byte-identical), never by a character prefix. A
// line addressed to the human (the relay line) is moved to the top instead of
// being left at the tail where a gateway's cut lands. structuredContent is not
// touched: the full data is still in it.
const HUMAN_LINE_RE = /for your human|tell your human|\/upgrade\/h\//i;
const HUMAN_FOLLOWER_RE = /^_?agent:\s*include the line above/i;

function _tryJson(line) {
  const t = String(line).trim();
  if (t[0] !== '{' && t[0] !== '[') return undefined;
  try { return JSON.parse(t); } catch (_) { return undefined; }
}

function _slimArray(arr, budget) {
  let n = arr.length;
  let s = JSON.stringify(arr);
  while (s.length > budget && n > 1) {
    n = Math.max(1, Math.floor(n / 2));
    s = JSON.stringify(arr.slice(0, n));
  }
  return { text: s, kept: n, total: arr.length };
}

// Split one text block into ordered segments: JSON documents (a whole block,
// or a line that is one) and runs of plain lines. Human lines (and the agent
// instruction line that follows one) are pulled out into `human`.
function _segments(text, human) {
  const whole = _tryJson(text);
  if (whole !== undefined) return [{ json: whole }];
  const segs = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (HUMAN_LINE_RE.test(ln)) {
      human.push(ln);
      if (i + 1 < lines.length && HUMAN_FOLLOWER_RE.test(lines[i + 1].trim())) human.push(lines[++i]);
      continue;
    }
    const j = ln.length > 200 ? _tryJson(ln) : undefined;
    if (j !== undefined) { segs.push({ json: j }); continue; }
    const last = segs[segs.length - 1];
    if (last && last.lines) last.lines.push(ln); else segs.push({ lines: [ln] });
  }
  return segs;
}

export function capToolResultText(result, { tool = 'this tool', max = GROK_TEXT_MAX_CHARS, slimJson, slimText } = {}) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const total = result.content.reduce((n, c) => n + ((c && c.type === 'text' && typeof c.text === 'string') ? c.text.length : 0), 0);
  if (total <= max) return result;

  const human = [];
  const blocks = result.content.map((c) => ((c && c.type === 'text' && typeof c.text === 'string')
    ? { c, segs: _segments(c.text, human) } : { c }));

  const note = '[DC Hub: this result was ' + total.toLocaleString('en-US') + ' characters of text, over this '
    + 'connector\'s ' + max.toLocaleString('en-US') + '-character limit, so lists are shortened here (each '
    + 'truncation block gives the full counts)'
    + (result.structuredContent ? '; the complete result is in structuredContent' : '')
    + '. Narrower arguments to ' + tool + ', where it takes them, return fewer rows.]';

  // Budget: small plain-text runs are kept whole; the rest is shared by the
  // big segments.
  const all = blocks.flatMap((b) => b.segs || []);
  const isBig = (s) => s.json !== undefined || s.lines.join('\n').length > 1000;
  const small = all.filter((s) => !isBig(s)).reduce((n, s) => n + s.lines.join('\n').length + 1, 0);
  const humanLen = human.join('\n').length;
  const budget = Math.max(2000, max - humanLen - note.length - small - 8);
  const per = Math.floor(budget / (all.filter(isBig).length || 1));

  const render = (s) => {
    if (s.json === undefined) {
      const t = s.lines.join('\n');
      if (t.length <= 1000 || typeof slimText !== 'function') return t;
      return slimText(t, per).text;
    }
    if (Array.isArray(s.json)) {
      const a = _slimArray(s.json, per);
      return a.kept < a.total
        ? JSON.stringify({ items: JSON.parse(a.text), truncated: true, items_total: a.total, items_kept: a.kept })
        : a.text;
    }
    // _slimStepResult may return up to 1.5x its limit; ask for 2/3 of ours.
    const slim = typeof slimJson === 'function' ? slimJson(s.json, tool, Math.floor(per / 1.5)) : s.json;
    return JSON.stringify(slim);
  };

  const out = [];
  if (human.length) out.push({ type: 'text', text: human.join('\n') });
  out.push({ type: 'text', text: note });
  for (const b of blocks) {
    if (!b.segs) { out.push(b.c); continue; }
    const text = b.segs.map(render).join('\n').replace(/^\n+|\n+$/g, '');
    if (text.trim()) out.push({ ...b.c, text });
  }
  return { ...result, content: out };
}

// Rewrite a buffered JSON-RPC response body (plain JSON or SSE frames): cap the
// text of every tools/call result in it. Anything that does not parse is
// passed through unchanged — the cap may shorten an answer, never break one.
export function capResponseBody(raw, opts) {
  if (typeof raw !== 'string' || !raw) return raw;
  const capMsg = (m) => (m && m.result && Array.isArray(m.result.content))
    ? { ...m, result: capToolResultText(m.result, opts) } : m;
  const t = raw.trimStart();
  if (t[0] === '{' || t[0] === '[') {
    try {
      const j = JSON.parse(t);
      return JSON.stringify(Array.isArray(j) ? j.map(capMsg) : capMsg(j));
    } catch (_) { return raw; }
  }
  if (!/(^|\n)data:/.test(raw)) return raw;
  return raw.split(/\n\n/).map((ev) => {
    const lines = ev.split('\n');
    const dataLines = lines.filter((l) => l.startsWith('data:'));
    if (!dataLines.length) return ev;
    const data = dataLines.map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    let msg;
    try { msg = JSON.parse(data); } catch (_) { return ev; }
    const capped = capMsg(msg);
    if (capped === msg) return ev;
    const kept = lines.filter((l) => !l.startsWith('data:'));
    return [...kept, `data: ${JSON.stringify(capped)}`].join('\n');
  }).join('\n\n');
}

// Buffer one tools/call response and cap it before it is sent. Installed only
// for tools/call on a Grok request, so tools/list, initialize and every other
// path stream exactly as before. Headers other than Content-Length are kept
// (the Mcp-Session-Id of a stateful call must reach the client).
export function installGrokResultCap(req, res, opts) {
  const origWriteHead = res.writeHead.bind(res);
  const origEnd = res.end.bind(res);
  const chunks = [];
  let head = null;
  let done = false;
  const push = (chunk, enc) => {
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));
  };
  res.flushHeaders = () => {};
  res.writeHead = (status, a, b) => { head = [status, a, b]; return res; };
  res.write = (chunk, enc, cb) => {
    push(chunk, enc);
    const fn = typeof enc === 'function' ? enc : cb;
    if (typeof fn === 'function') fn();
    return true;
  };
  res.end = (chunk, enc, cb) => {
    if (done) return res;
    done = true;
    push(chunk, enc);
    const fn = typeof chunk === 'function' ? chunk : (typeof enc === 'function' ? enc : cb);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = raw;
    try { body = capResponseBody(raw, opts); } catch (e) {
      console.error('[grok] result cap failed, sending uncapped:', e && e.message);
      body = raw;
    }
    const strip = (h) => {
      if (!h || typeof h !== 'object' || Array.isArray(h)) return h;
      const o = {};
      for (const [k, v] of Object.entries(h)) if (!/^content-length$/i.test(k)) o[k] = v;
      return o;
    };
    try { res.removeHeader('Content-Length'); } catch (_) {}
    res.writeHead = origWriteHead;
    if (head) {
      const [status, a, b] = head;
      if (typeof a === 'string') origWriteHead(status, a, strip(b));
      else origWriteHead(status, strip(a));
    }
    return origEnd(body, 'utf8', fn);
  };
}

// A Grok request, for the G2 result cap: the Grok path, a connector URL tagged
// ?via=grok (what /install/grok hands out today), or Grok's connector
// user-agent (grok-connectors-manager). The UA is caller-assertable; the only
// thing it can buy is a shorter text block.
export function isGrokRequest(req) {
  const p = (req?.path || '').replace(/\/+$/, '');
  if (p === GROK_PATH || p === GROK_OAUTH_PATH) return true;
  try {
    if (/^grok$/i.test(new URL(req.url || '', 'http://_').searchParams.get('via') || '')) return true;
  } catch (_) { /* fall through */ }
  return /grok/i.test(String(req?.headers?.['user-agent'] || ''));
}
