// ── a mandatory argument must be declared mandatory ─────────────────────────
//
// THE DEFECT (measured live 2026-08-29, `POST /mcp tools/list`, paid key)
// 75 of 82 tools served `inputSchema.required` EMPTY. Every shared alias in
// createServer — S, N, I, B, ID — ends in `.optional()`, so nothing was ever
// required no matter what the description said. A model reading the schema is
// therefore free to omit an argument the prose calls mandatory, and 32 of the
// 82 tools fail when called with `{}`.
//
// The cost is not theoretical. `get_market_dcpi_rank` was called 6,605 times;
// 193 of those omitted `market_slug` and got back an API 404 that leaks
// internal routing (`/api/v1/dcpi/scores/`, plus a note about `.well-known/`
// being "shadowed by the zone-level MCP-landing worker") rather than the name
// of the missing field. One live external user hit that 12 times in a session.
//
// ★ THE RISK THIS TEST EXISTS TO FENCE. `required` is the one schema edit that
// can BREAK a working caller: marking an argument required makes the SDK reject
// the call at validation, before the handler runs. So it is only ever correct
// for an argument that is UNCONDITIONALLY mandatory. Three shapes must stay
// optional, and each is represented below:
//
//   1. alias groups   — get_grid_intelligence takes region_id | iso | region
//   2. either-or      — rank_sites takes candidates OR shortlist_name
//   3. second modes   — research_task takes question, OR task_id to poll
//
// JSON Schema `required` cannot express "one of these", and marking one arm
// breaks the others. That regression has ALREADY SHIPPED here once: see the
// r-shortlist-rerank comment on rank_sites.objectives, where a non-optional
// z.any() made the documented shortlist re-rank mode return -32602 before the
// handler ever ran. This test pins both directions so it cannot happen twice.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { readFileSync } from 'node:fs';
// server.json is what the registry publishes and what sync-tools-manifest
// heals every surface to — so it is the count this suite must agree with.
const TOOL_COUNT_OWNER = JSON.parse(readFileSync(
  new URL('../server.json', import.meta.url), 'utf8'),
)._meta['io.modelcontextprotocol.registry/publisher-provided'].toolCount;
let S, PORT, httpServer, TOOLS;

beforeAll(async () => {
  // Point the module at an unroutable base before import — server.mjs captures
  // API_BASE once at module evaluation. tools/list never makes an upstream
  // call, but a sibling test sharing this worker's process.env must not inherit
  // it, so it is restored immediately (same discipline as capacity-context).
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;

  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;

  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  TOOLS = ((JSON.parse(json).result) || {}).tools || [];
}, 60000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
});

const byName = (n) => TOOLS.find((t) => t.name === n);
const requiredOf = (n) => ((byName(n) || {}).inputSchema || {}).required || [];

// ── what MUST be required ───────────────────────────────────────────────────
// Every entry was established by calling the live tool twice: once with `{}`
// (fails) and once with only this argument (succeeds, or advances to a
// different error). None of them has an alias or an either-or partner.
const MUST_REQUIRE = {
  find_alternatives:               ['facility_id'],
  score_facility:                  ['facility_id'],
  get_shortlist:                   ['name'],
  suggest_reallocation:            ['shortlist_name'],
  get_power_availability_timeline: ['state'],
  predict_market_trajectory:       ['market_slug'],
  get_market_dcpi_rank:            ['market_slug'],
  get_market_context:              ['market'],
  get_iso_context:                 ['iso'],
  get_gas_economics:               ['market'],
  compare_isos:                    ['isos'],
  plan_fiber_leadin:               ['from', 'to'],
  recover_my_key:                  ['email'],
  subscribe_digest:                ['email'],
  bind_email:                      ['email'],
  set_market_alert:                ['market', 'channel'],
  set_site_alert:                  ['saved_site_id', 'notify_email'],
};

// ── what MUST NOT become required ───────────────────────────────────────────
// Each of these is reachable WITHOUT the named argument. The note is the
// evidence; several were caught only because the live call was actually made.
const MUST_NOT_REQUIRE = {
  // alias groups — any one member satisfies the tool
  get_grid_intelligence: { args: ['region_id', 'iso', 'region'], why: 'three names for one value' },
  semantic_search:       { args: ['q', 'query'],                 why: 'q and query are aliases' },
  search_intelligence:   { args: ['query', 'q'],                 why: 'q and query are aliases' },
  get_gas_intelligence:  { args: ['region', 'state'],            why: 'region and state are aliases' },
  compare_sites:         { args: ['locations', 'sites'],         why: 'locations and sites are aliases' },
  get_facility:          { args: ['facility_id', 'slug', 'id', 'name'], why: 'four ways to identify one facility' },
  // either-or — a genuine second input path
  rank_sites:            { args: ['candidates', 'objectives', 'shortlist_name'], why: 'shortlist_name replaces candidates; objectives are reused from the shortlist (r-shortlist-rerank)' },
  cluster_sites_by_latency: { args: ['sites', 'candidate_ids'],  why: 'sites OR candidate_ids' },
  get_water_risk:        { args: ['state', 'lat', 'lon'],        why: 'state OR a coordinate' },
  get_facility_risk_delta: { args: ['facility_id', 'market'],    why: 'verified live: {market} alone returns a full delta' },
  // second modes
  research_task:         { args: ['question', 'task_id'],        why: 'task_id polls an earlier submission with no question' },
  // ★2026-09-06 — the bundled standing_intent is SPLIT. It could not declare
  //   `kind` required, because action="list" legitimately took none — a
  //   conditional requirement JSON Schema cannot express. Splitting removes
  //   the condition: the lister takes nothing, and each writer can state
  //   plainly what it needs.
  //   Nothing replaces it here: `kind` and `webhook_url` on register, and
  //   `intent_id` on delete, are now genuinely REQUIRED and belong in the
  //   required-args contract, not in this optional-by-design table.
  // coordinate tools — lat/lon carry the aliases latitude/lng/longitude, so no
  // single name can be required without rejecting the other spelling
  analyze_site:            { args: ['lat', 'lon'], why: 'latitude/lng/longitude aliases' },
  analyze_parcel:          { args: ['lat', 'lon'], why: 'latitude/lng/longitude aliases' },
  save_site:               { args: ['lat', 'lon'], why: 'latitude/lng/longitude aliases' },
  get_composite_site_score: { args: ['lat', 'lon'], why: 'latitude/lng/longitude aliases' },
  get_disaster_risk:       { args: ['lat', 'lon'], why: 'latitude/lng/longitude aliases' },
  get_climate_intel:       { args: ['lat', 'lon'], why: 'latitude/lng/longitude aliases' },
  generate_site_analysis:  { args: ['lat', 'lon'], why: 'latitude/lng/longitude aliases' },
  get_infrastructure:      { args: ['lat', 'lon'], why: 'latitude/lng/longitude aliases' },
  get_fiber_readiness:     { args: ['lat', 'lon'], why: 'latitude/lng/longitude aliases' },
};

describe('tools/list serves a usable schema', () => {
  it('every tool is present and carries an inputSchema', () => {
    // The tool count's documented owner is server.json / server.mjs via
    // scripts/sync-tools-manifest.mjs (see canonical/mcp_facts.json's warning),
    // NOT a literal here. A hardcoded number turns every tool addition into a
    // test edit and teaches the next person that the number is negotiable.
    expect(TOOLS.length).toBe(TOOL_COUNT_OWNER);
    for (const t of TOOLS) expect(t.inputSchema, `${t.name} has no inputSchema`).toBeTruthy();
  });

  // Guards the guard: if tools/list ever came back empty or shapeless, every
  // assertion below would pass vacuously against an empty array.
  it('the fixtures name tools that actually exist', () => {
    for (const n of [...Object.keys(MUST_REQUIRE), ...Object.keys(MUST_NOT_REQUIRE)]) {
      expect(byName(n), `${n} is not served — fixture is stale`).toBeTruthy();
    }
  });

  // The draft-07 incident (mcp #215): the bundled Claude client rejects ANY
  // schema carrying an unsupported $schema, and it rejected all 82 at once.
  // Adding `required` must not reintroduce a dialect stamp.
  it('no tool stamps a $schema dialect', () => {
    const stamped = TOOLS.filter((t) => t.inputSchema && '$schema' in t.inputSchema).map((t) => t.name);
    expect(stamped).toEqual([]);
  });
});

describe('unconditionally mandatory arguments are declared required', () => {
  for (const [tool, args] of Object.entries(MUST_REQUIRE)) {
    it(`${tool} requires ${args.join(' + ')}`, () => {
      const req = requiredOf(tool);
      for (const a of args) expect(req, `${tool}.${a} not in required[]`).toContain(a);
    });

    it(`${tool} declares every required arg as a real property`, () => {
      const props = Object.keys((byName(tool).inputSchema || {}).properties || {});
      for (const a of requiredOf(tool)) {
        expect(props, `${tool} requires "${a}" but never declares it`).toContain(a);
      }
    });
  }
});

describe('optional-by-design arguments stay optional', () => {
  for (const [tool, { args, why }] of Object.entries(MUST_NOT_REQUIRE)) {
    it(`${tool} keeps ${args.join('/')} optional — ${why}`, () => {
      const req = requiredOf(tool);
      for (const a of args) {
        expect(req, `${tool}.${a} was made required, but ${why}`).not.toContain(a);
      }
    });
  }
});

describe('the seven tools that were already correct are untouched', () => {
  const PRE_EXISTING = {
    search:                 ['query'],
    fetch:                  ['id'],
    execute_plan:           ['intent'],
    get_retirement_headroom: ['target_mw', 'horizon_months'],
    plan_query:             ['intent'],
    save_to_shortlist:      ['shortlist_name', 'site'],
    set_shortlist_alert:    ['notify'],
  };
  for (const [tool, args] of Object.entries(PRE_EXISTING)) {
    it(`${tool} still requires ${args.join(' + ')}`, () => {
      expect(requiredOf(tool).sort()).toEqual([...args].sort());
    });
  }
});

// ── the behaviour the schema change actually buys ───────────────────────────
// A `required` entry is enforced by the SDK BEFORE the handler runs, so the
// caller gets the name of the missing field instead of whatever the backend
// happens to say. For get_market_dcpi_rank that replaces an API 404 which
// leaked `/api/v1/dcpi/scores/` and a note about the zone-level MCP-landing
// worker — internal routing detail, shipped to customers, 193 times.
async function callTool(name, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return JSON.parse(json);
}
const textOf = (d) => JSON.stringify(d.error || d.result || d);

describe('a missing required argument is refused by name, before the handler', () => {
  it('get_market_dcpi_rank {} names market_slug instead of returning an API 404', async () => {
    const out = textOf(await callTool('get_market_dcpi_rank', {}));
    expect(out).toContain('market_slug');
    expect(out).toMatch(/invalid_type|Input validation|required/i);
    // the old failure mode, gone: no leaked upstream path
    expect(out).not.toContain('/api/v1/dcpi/scores/');
  }, 20000);

  it('get_iso_context {} names iso', async () => {
    const out = textOf(await callTool('get_iso_context', {}));
    expect(out).toContain('iso');
    expect(out).toMatch(/invalid_type|Input validation|required/i);
  }, 20000);

  // The other half of the contract, and the one that would catch an
  // over-eager `required`: supplying the argument must get PAST validation.
  // API_BASE points at an unroutable port here, so reaching a network error
  // IS the proof that the schema let the call through.
  it('get_iso_context {iso:"PJM"} passes validation and reaches the handler', async () => {
    const out = textOf(await callTool('get_iso_context', { iso: 'PJM' }));
    expect(out).not.toMatch(/Input validation error/i);
  }, 20000);

  it('an alias-only call still passes validation — get_grid_intelligence {iso}', async () => {
    const out = textOf(await callTool('get_grid_intelligence', { iso: 'PJM' }));
    expect(out).not.toMatch(/Input validation error/i);
  }, 20000);

  it('a coordinate call using the ALIAS spelling still passes validation', async () => {
    const out = textOf(await callTool('analyze_site', { latitude: 38.9, longitude: -77.4 }));
    expect(out).not.toMatch(/Input validation error/i);
  }, 20000);
});

describe('the change is bounded', () => {
  // A blanket "make everything required" would break 50 tools that legitimately
  // answer with no arguments at all (measured: 50 of 82 return data for `{}`).
  it('tools that answer with no arguments require nothing', () => {
    for (const n of ['get_grid_scoreboard', 'get_intelligence_index', 'get_agent_registry',
                     'get_backup_status', 'rank_markets', 'hyperscaler_deals', 'get_news',
                     'why_dchub', 'get_tax_incentives', 'list_saved_sites', 'discover_tools']) {
      expect(requiredOf(n), `${n} should require nothing`).toEqual([]);
    }
  });

  it('exactly 26 tools declare a required argument', () => {
    // ★2026-09-06 24 -> 26. The standing_intent split retired one tool that
    //   declared NO required args (its `kind` was conditional on action, which a
    //   schema cannot say) and added two that declare real ones —
    //   register_standing_intent (kind + webhook_url) and delete_standing_intent
    //   (intent_id) — plus a lister that correctly requires nothing. Net +2.
    const withReq = TOOLS.filter((t) => (t.inputSchema.required || []).length).map((t) => t.name);
    expect(withReq.length, `got: ${withReq.sort().join(', ')}`).toBe(26);
  });
});
