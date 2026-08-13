// r-front-door-routing (2026-08-12): the adoption shell measured one rolling
// 30d window — 15,906 lookups against 39 workflows, and 254 of 265 agents
// never running a workflow at all. The shape was ROUTING, not demand:
// connectors-manager ran 27 workflows on 33 lookups (45%) while every
// high-volume platform ran zero. rank_markets was the sharpest case — 191
// distinct agents hand-called a market-ranking tool that execute_plan exists
// to answer end-to-end, with the per-finalist verdict and the grid
// reality-check attached.
//
// Tool descriptions are the one channel every MCP client reads, so the
// routing guidance has to live there. These tests pin BOTH halves of the
// contract, and the second half is the one that matters:
//
//   1. the lookup-heavy tools name execute_plan and say when it is better
//   2. they ALSO say when the direct call is right, and keep it legitimate
//
// (2) is not decoration. Copy that pushes every call through the planner
// would lift the workflow ratio while making agents slower — measured on
// 2026-08-12, execute_plan spent ~3 steps and ~2.3s on a market-ranking
// intent that rank_markets answered alone in ~0.6s. That is metric gaming,
// and a guard that only checked (1) would reward it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _TOOL_FAMILIES_TABLE } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// The six tools the adoption shell named, most-called first. Read the
// description out of the registration call itself — transcribing the text
// here would drift from the live surface, which is the whole failure class
// this repo keeps hitting (manifests are not the source of truth).
const ROUTED = [
  'search_facilities', 'get_water_risk', 'get_renewable_energy',
  'get_news', 'get_energy_prices', 'rank_markets',
];

// Pull the description literal: trackedTool(srv, '<name>',\n? '<desc>',
function descOf(tool) {
  const at = SRC.indexOf(`trackedTool(srv, '${tool}',`);
  if (at < 0) return null;
  const rest = SRC.slice(at);
  const m = rest.match(/trackedTool\(srv, '[a-z_0-9]+',\s*\n?\s*'((?:[^'\\]|\\.)*)'/);
  return m ? m[1] : null;
}

describe('front-door routing lives in the tool-description channel', () => {
  it('reads a real description for every routed tool (guard against a broken parse)', () => {
    // A regex that returns null/empty would make every assertion below pass
    // vacuously — the empty-parse-passes-all trap this repo has been bitten by.
    for (const t of ROUTED) {
      const d = descOf(t);
      expect(d, `${t} description did not parse`).toBeTruthy();
      expect(d.length, `${t} description implausibly short — parse is wrong`).toBeGreaterThan(300);
    }
  });

  it('each routed tool names execute_plan and says when it is the better call', () => {
    for (const t of ROUTED) {
      const d = descOf(t);
      expect(d, `${t} never mentions the front door`).toContain('execute_plan');
      expect(d, `${t} mentions execute_plan but not as a routing decision`)
        .toMatch(/FRONT DOOR CHECK/);
    }
  });

  // ── the anti-gaming half ────────────────────────────────────────────
  it('each routed tool ALSO keeps the direct single lookup legitimate', () => {
    // Without this, the honest fix and the metric-gaming fix look identical
    // to CI. A lookup is a legitimate use and free by design.
    for (const t of ROUTED) {
      const d = descOf(t);
      expect(d, `${t} routes to the planner without saying when to stay direct`)
        .toMatch(/IS the right call|call .* directly|stay here/i);
    }
  });

  it('is honest that the planner costs more — at least one tool states the trade', () => {
    // Naming the cost somewhere in the channel keeps the copy from reading as
    // pure promotion. rank_markets carries it: it is the 191-agent case.
    const d = descOf('rank_markets');
    expect(d).toMatch(/latency/i);
    expect(d).toMatch(/should NOT be routed through the planner/);
  });

  it('rank_markets states what the one call actually returns', () => {
    // The specific claim the shell asked for: ranking AND per-finalist verdict
    // AND grid reality-check, plus the replay of what was rejected.
    const d = descOf('rank_markets');
    expect(d).toMatch(/BUILD\/CAUTION\/AVOID/);
    expect(d).toMatch(/grid reality-check/);
    expect(d).toMatch(/replay/);
  });

  it('the front-door pointer leads the description an agent reads first', () => {
    // Buried at the end it is not a routing surface, it is trivia.
    for (const t of ROUTED) {
      expect(descOf(t).indexOf('FRONT DOOR CHECK'),
        `${t} buries the routing note instead of leading with it`).toBe(0);
    }
  });
});

describe('discover_tools families point at the front door', () => {
  // A family that lists rank_markets with no mention of execute_plan is the
  // navigation-surface twin of the description gap above.
  const FAMILIES_WITH_ROUTED = ['facility', 'market', 'grid_power', 'site_geometry', 'deals_news'];

  it('the families holding the routed tools carry a front_door_when note', () => {
    for (const name of FAMILIES_WITH_ROUTED) {
      const fam = _TOOL_FAMILIES_TABLE.find(f => f.family === name);
      expect(fam, `family ${name} missing`).toBeTruthy();
      expect(typeof fam.front_door_when, `${name} has no front_door_when`).toBe('string');
      expect(fam.front_door_when).toContain('execute_plan');
      expect(fam.front_door_when.length,
        `${name} front_door_when too thin to route on`).toBeGreaterThan(60);
    }
  });

  it('every family listing a routed tool is one of them (no silent new gap)', () => {
    // If a routed tool is later moved into a family without a front_door_when,
    // this fails rather than quietly reopening the hole.
    for (const fam of _TOOL_FAMILIES_TABLE) {
      if (fam.tools.some(t => ROUTED.includes(t))) {
        expect(typeof fam.front_door_when,
          `family ${fam.family} lists a routed tool but has no front_door_when`).toBe('string');
      }
    }
  });

  it('family front-door notes keep the direct call legitimate too', () => {
    for (const name of FAMILIES_WITH_ROUTED) {
      const fam = _TOOL_FAMILIES_TABLE.find(f => f.family === name);
      expect(fam.front_door_when, `${name} pushes everything through the planner`)
        .toMatch(/directly|single lookup|single-capability/i);
    }
  });
});

describe('routing changes did not touch behaviour', () => {
  it('all six tools are still registered under their original names', () => {
    for (const t of ROUTED) {
      expect(SRC).toContain(`trackedTool(srv, '${t}',`);
    }
  });
});
