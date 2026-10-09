// execute_plan only runs read-only lookup tools, and on the ChatGPT app only
// the tools that app lists (OpenAI review of 1.0.0, 2026-10-09, item 1d).
//
// execute_plan is annotated readOnlyHint:true and /mcp/chatgpt says "every tool
// is a read-only lookup". Before _EXEC_ALLOWED_TOOLS the executor refused only
// plan_query / execute_plan and dispatched any tool the planner named, and on
// /mcp/chatgpt it ran tools the app does not list (analyze_site,
// get_composite_site_score) through the loopback to /mcp.
//
// What fails here:
//   - a write added to _EXEC_ALLOWED_TOOLS (checked against the SERVED /mcp
//     annotations, not a hand-kept list);
//   - the handler dispatching a step outside the allowlist or outside the
//     surface (checked end to end: the loopback calls the stub backend saw);
//   - the deal-desk mint (a POST that stores a brief) firing from /mcp/chatgpt;
//   - the planner naming a tool the allowlist does not carry (that step would be
//     refused everywhere, so the list and the planner must move together).
// Real server.mjs on loopback, stub backend: no network, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
import { CLAUDE_PROFILE } from '../lib/claude-directory.mjs';

const WRITE_PREFIX = /^(save_|set_|register_|subscribe_|bind_|claim_|request_|report_|accept_|delete_|recover_|unlock_)/;
// An intent the planner answers with analyze_site + get_composite_site_score,
// neither of which /mcp/chatgpt lists.
const SITE_INTENT = { intent: 'analyze site 33.45,-112.07 for 100 MW and score it' };
// Intents that between them reach every planner class used in production batteries.
const BATTERY = [
  'rank markets for a 200 MW AI campus', 'rank markets for a 200 MW AI campus in Texas',
  'compare Dallas vs Phoenix for a hyperscale campus', 'find 100 MW of buildable capacity near Ashburn',
  'where do fiber density and grid headroom overlap in Atlanta', 'how much power is available in ERCOT',
  'evaluate 100 MW power headroom for a GPU training cluster in PJM', 'analyze site 33.45,-112.07 for 100 MW',
  'tax incentives for data centers in Ohio', 'water risk and climate for a site at 39.04,-77.48',
  'interconnection queue in MISO for solar over 100 MW', 'latest data center deals and news',
  'plan fiber lead-in from 39.04,-77.48 to a carrier hotel', 'gas fired power for a data center in Texas',
  'what changed this week', 'my saved sites', 'buy 20 MW of colocation in Dallas',
  'retirements that could free capacity for 300 MW in PJM', 'permitting moratorium in Loudoun',
  'where is the market heading in Phoenix', 'hosting capacity near 33.45,-112.07',
];

let H, fence, S, lists = {}, runs = {};

async function settle(quietMs = 400, maxMs = 10000) {
  const t0 = Date.now(); let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
// Tools the run actually dispatched: every tools/call writes a tracking row.
const trackedTools = (hits) => [...new Set(hits
  .filter((h) => h.path === '/api/v1/mcp/track' && h.body && typeof h.body.tool === 'string' && h.body.event !== 'recipe_lifecycle')
  .map((h) => h.body.tool))].sort();
const META = new Set(['execute_plan', 'execute_plan_steps', 'deal_desk_automint']);

async function runPlan(path, headers = {}) {
  const before = H.hits.length;
  const r = await H.call(path, 'execute_plan', SITE_INTENT, { 'user-agent': 'test-client', ...headers });
  await settle();
  const hits = H.hits.slice(before);
  return { r, hits, tools: trackedTools(hits).filter((t) => !META.has(t)),
           dealDesk: hits.filter((h) => h.path === '/api/v1/deal-desk').length };
}

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness();
  S = H.S;
  for (const p of ['/mcp', '/mcp/chatgpt', '/mcp/claude']) {
    lists[p] = (await H.list(p)).msg.result.tools;
  }
  await settle();
  runs.mcp = await runPlan('/mcp', { 'x-api-key': PRO_KEY });
  runs.chatgpt = await runPlan('/mcp/chatgpt');
  runs.chatgptPro = await runPlan('/mcp/chatgpt', { 'x-api-key': PRO_KEY });
  runs.claudePro = await runPlan('/mcp/claude', { 'x-api-key': PRO_KEY });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); });

describe('the allowlist holds read-only tools only', () => {
  it('control: the allowlist and the served /mcp list are non-empty', () => {
    expect(S._EXEC_ALLOWED_TOOLS.length).toBeGreaterThan(20);
    expect(lists['/mcp'].length).toBeGreaterThan(50);
  });

  it('every allowlisted tool is served on /mcp with readOnlyHint true', () => {
    const served = new Map(lists['/mcp'].map((t) => [t.name, t.annotations || {}]));
    const bad = [];
    for (const name of S._EXEC_ALLOWED_TOOLS) {
      const a = served.get(name);
      if (!a) bad.push(`${name}: not served on /mcp`);
      else if (a.readOnlyHint !== true) bad.push(`${name}: readOnlyHint=${a.readOnlyHint}`);
      else if (a.destructiveHint !== false) bad.push(`${name}: destructiveHint=${a.destructiveHint}`);
      if (WRITE_PREFIX.test(name) || name === 'research_task') bad.push(`${name}: a write by name`);
    }
    expect(bad).toEqual([]);
  });

  it('no write served on /mcp passes the step check, on any profile', () => {
    const writes = lists['/mcp'].filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(writes, 'control: /mcp serves writes, so this check has something to refuse').toContain('research_task');
    const passed = [];
    for (const w of writes) {
      for (const prof of [undefined, DIRECTORY_PROFILE, CLAUDE_PROFILE]) {
        if (S._execStepAllowed(w, prof)) passed.push(`${w}@${prof}`);
      }
    }
    expect(passed).toEqual([]);
  });

  it('on the ChatGPT profile a step must also be a tool /mcp/chatgpt lists', () => {
    const chatgpt = new Set(lists['/mcp/chatgpt'].map((t) => t.name));
    const allowed = S._EXEC_ALLOWED_TOOLS.filter((t) => S._execStepAllowed(t, DIRECTORY_PROFILE));
    expect(allowed.length, 'control: some steps still run on ChatGPT').toBeGreaterThan(20);
    expect(allowed.filter((t) => !chatgpt.has(t))).toEqual([]);
    const claude = new Set(lists['/mcp/claude'].map((t) => t.name));
    expect(S._EXEC_ALLOWED_TOOLS.filter((t) => S._execStepAllowed(t, CLAUDE_PROFILE) && !claude.has(t))).toEqual([]);
    expect(S._execStepAllowed('analyze_site', DIRECTORY_PROFILE)).toBe(false);
    expect(S._execStepAllowed('analyze_site', undefined)).toBe(true);
  });

  it('every tool the planner names is on the allowlist (else that step is refused everywhere)', () => {
    const allow = new Set(S._EXEC_ALLOWED_TOOLS);
    const named = new Set();
    for (const intent of BATTERY) {
      for (const s of S._planQuery(intent).recommended_sequence || []) named.add(s.tool);
    }
    expect(named.size, 'control: the battery reaches several tools').toBeGreaterThan(10);
    const missing = [...named].filter((t) => !allow.has(t) && t !== 'plan_query' && t !== 'execute_plan');
    expect(missing).toEqual([]);
  });
});

describe('the handler refuses what the allowlist refuses (end to end)', () => {
  it('control: on /mcp the same plan dispatches analyze_site and mints the deal-desk brief', () => {
    expect(runs.mcp.r.status).toBe(200);
    expect(runs.mcp.tools).toContain('analyze_site');
    expect(runs.mcp.dealDesk).toBeGreaterThan(0);
  });

  for (const k of ['chatgpt', 'chatgptPro']) {
    it(`/mcp/chatgpt (${k === 'chatgpt' ? 'keyless' : 'with a Pro key'}) dispatches only tools the app lists`, () => {
      const chatgpt = new Set(lists['/mcp/chatgpt'].map((t) => t.name));
      expect(runs[k].r.status).toBe(200);
      expect(runs[k].tools.length, 'control: the plan ran some step').toBeGreaterThan(0);
      expect(runs[k].tools.filter((t) => !chatgpt.has(t))).toEqual([]);
    });
  }

  it('/mcp/chatgpt never mints the deal-desk brief, even for a Pro key', () => {
    expect(runs.chatgptPro.dealDesk).toBe(0);
  });

  // /mcp/claude also says "every tool here is a read-only lookup" and annotates
  // execute_plan readOnlyHint:true, so the mint (a POST that stores a brief)
  // must not fire there either.
  it('/mcp/claude never mints the deal-desk brief, even for a Pro key', () => {
    expect(runs.claudePro.r.status).toBe(200);
    expect(runs.claudePro.tools.length, 'control: the plan ran some step').toBeGreaterThan(0);
    expect(runs.claudePro.dealDesk).toBe(0);
  });
});
