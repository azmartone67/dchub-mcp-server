// planner-eval.test.mjs — CANONICAL BEHAVIOR SUITE for plan_query.
//
// Not implementation unit tests (those live in plan-query.test.mjs). These are
// real, everyday workflows treated as a behavior CONTRACT: each must keep routing
// to the same intent_class + lead tool across planner revisions. Per ChatGPT's
// SDK review — "keep a small suite of representative workflows and run them against
// every planner revision; they're the planner's equivalent of unit tests for
// behavior. Not because they prove correctness, but because they catch regressions
// in the scenarios people actually care about."
//
// A row that starts routing to 'unknown' (the generic discover_tools fallback) is
// a ROUTING regression, not a schema problem. EXPAND this table whenever a real gap
// is found — capacity_search + market_comparison were added on 2026-07-20 precisely
// because two everyday intents ("find 50 MW in Dallas", "compare Phoenix vs Columbus")
// had been falling through to unknown.
import { describe, it, expect } from 'vitest';
import { _planQuery } from '../server.mjs';

const CANONICAL = [
  { intent: 'rank the best data-center markets in the US',   cls: 'market_ranking',        tool: 'rank_markets' },
  { intent: 'rank markets for a 200 MW AI campus',           cls: 'market_ranking',        tool: 'rank_markets' },   // 5.27: criteria=ai_ready
  { intent: 'find 50 MW in Dallas',                          cls: 'capacity_search',       tool: 'get_retirement_headroom' },
  { intent: 'where can I get 100 MW near a substation',      cls: 'capacity_search',       tool: 'get_retirement_headroom' },
  { intent: 'compare Phoenix vs Columbus for hyperscale',    cls: 'market_comparison',     tool: 'get_market_dcpi_rank' },
  { intent: 'how much power is available in ERCOT',          cls: 'grid_headroom',         tool: 'get_grid_intelligence' },
  { intent: 'interconnection queue depth in PJM',            cls: 'interconnection_queue', tool: 'get_interconnection_queue' },
  { intent: 'what changed in the last week',                 cls: 'changes_delta',         tool: 'get_changes' },
  { intent: 'water and drought risk for Phoenix',            cls: 'water_climate',         tool: 'get_water_risk' },
  { intent: 'recent hyperscaler data center deals',          cls: 'deals_ma',              tool: 'hyperscaler_deals' },
  { intent: 'dark fiber routes near Ashburn',                cls: 'fiber',                 tool: 'get_fiber_intel' },
  { intent: 'electricity prices in Texas',                   cls: 'price',                 tool: 'get_energy_prices' },
  { intent: 'search for data centers in Virginia',           cls: 'facility_search',       tool: 'search_facilities' },
  { intent: 'analyze the site at 33.45,-112.07',             cls: 'site_analysis',         tool: 'analyze_site' },
  // 2026-07-28: the DISTRIBUTION layer. get_hosting_capacity shipped registered
  // but absent from every class, so execute_plan — the advertised front door —
  // could not reach it for ANY intent.
  { intent: 'hosting capacity on the feeders near Poughkeepsie', cls: 'hosting_capacity',   tool: 'get_hosting_capacity' },
  // ...and the intent that exposed it: a textbook capacity search that scored 2
  // against facility_search's 3 (on "data cent…s in") and routed to a search of
  // EXISTING data centers, so it never reached the class the feeder read hangs
  // off. Fixed by a verb-then-MW pattern, not by widening \bsite\b.
  { intent: 'site a 50 MW data center in central Illinois',  cls: 'capacity_search',       tool: 'get_retirement_headroom' },
];

describe('plan_query canonical behavior suite (run on every planner revision)', () => {
  it.each(CANONICAL)('routes "$intent" -> $cls / $tool', ({ intent, cls, tool }) => {
    const p = _planQuery(intent, {});
    expect(p.intent_class).toBe(cls);
    expect(p.best_tool).toBe(tool);
    // every canonical everyday intent must produce a real plan, never the generic
    // discover_tools fallback — the regression class this suite exists to catch.
    expect(p.intent_class).not.toBe('unknown');
    expect(p.recommended_sequence.length).toBeGreaterThan(0);
  });

  it('routes ZERO canonical intents to the unknown fallback', () => {
    const misrouted = CANONICAL
      .map((c) => ({ intent: c.intent, cls: _planQuery(c.intent, {}).intent_class }))
      .filter((r) => r.cls === 'unknown');
    expect(misrouted).toEqual([]); // any entry here is a routing gap to fix or re-route
  });

  it('is deterministic across the whole suite (same intent -> same route)', () => {
    for (const { intent } of CANONICAL) {
      const a = _planQuery(intent, {}), b = _planQuery(intent, {});
      expect(a.best_tool).toBe(b.best_tool);
      expect(a.intent_class).toBe(b.intent_class);
    }
  });
});

// 2026-11-07: AUTHORIZATION BOUNDARY for state-changing phrasing. These intents
// ask to save, delete, submit, buy or watch. plan_query is a read-only planner,
// so whatever class it picks, nothing it recommends may be a write tool: the
// agent must ask its human and call the write tool itself, never get one handed
// to it as a plan step. The routes themselves are not pinned (several fall back
// to discover_tools on purpose); only the read-only property is.
const WRITE_TOOL = /^(save_|set_|register_|subscribe_|bind_|claim_|request_|report_|accept_|delete_|recover_|unlock_|submit_|buy_|purchase_|watch_)/;
const STATE_CHANGING_PHRASING = [
  'save this site and alert me when power changes',
  'delete my saved site',
  'submit a listing for my 20 MW facility',
  'list my data center for sale',
  'buy a pro plan',
  'watch Dallas for changes',
  'claim my facility page',
];

describe('plan_query never plans a write step for state-changing phrasing', () => {
  it.each(STATE_CHANGING_PHRASING)('"%s" -> read-only plan', (intent) => {
    const p = _planQuery(intent, {});
    const tools = [p.best_tool, ...p.recommended_sequence.map((s) => (typeof s === 'string' ? s : s.tool))];
    expect(tools.filter((t) => WRITE_TOOL.test(String(t)))).toEqual([]);
  });
});
