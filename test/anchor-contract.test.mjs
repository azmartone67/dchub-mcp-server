import { describe, it, expect } from 'vitest';
import { _STARTER_PACK, _planQuery } from '../server.mjs';

// The six anchor intents are published verbatim on /for/*, llms.txt,
// llms-full.txt, AGENTS.md, all six /integrations pages, and in the starter
// pack every connecting agent receives. Agents copy them literally, so they are
// not documentation — they are a public API written in English.
//
// Routing was already guarded ("classes must not steal each other"). What was
// NOT guarded is the PAIRING: this list claims each intent belongs to a recipe,
// and nothing asserted the planner agrees. An edit to either side could drift
// without failing anything.
//
// Declared recipe -> the planner class(es) that legitimately serve it. More
// than one is allowed where a recipe spans classes; an EMPTY match is not.
const RECIPE_CLASSES = {
  market_selection:     ['market_ranking'],
  grid_and_queue:       ['grid_headroom', 'interconnection_queue'],
  compare_markets:      ['market_comparison'],
  site_analysis:        ['site_analysis', 'capacity_search'],
  fiber_power_pairing:  ['fiber_power_pairing', 'fiber'],
};

describe('anchor intents are a tested contract, not just copy', () => {
  it('the published list is non-empty and well-formed', () => {
    expect(_STARTER_PACK.length).toBeGreaterThanOrEqual(5);
    for (const a of _STARTER_PACK) {
      expect(typeof a.recipe).toBe('string');
      expect(typeof a.intent).toBe('string');
      expect(a.intent.length).toBeGreaterThan(20);
    }
  });

  it.each(_STARTER_PACK.map((a) => [a.recipe, a.intent]))(
    '%s ← "%s" actually routes there',
    (recipe, intent) => {
      const allowed = RECIPE_CLASSES[recipe];
      expect(allowed, `no class mapping declared for recipe "${recipe}"`).toBeTruthy();
      const got = _planQuery(intent, {}).intent_class;
      expect(allowed).toContain(got);
    });

  it('every declared recipe has a class mapping (no silent additions)', () => {
    for (const a of _STARTER_PACK) {
      expect(Object.keys(RECIPE_CLASSES)).toContain(a.recipe);
    }
  });

  it('intents are passthrough questions — they must not name our own tools', () => {
    // An anchor is what a USER asks. If it names execute_plan or a tool, we are
    // teaching agents to paste our API instead of their user's question.
    for (const a of _STARTER_PACK) {
      expect(a.intent).not.toMatch(/execute_plan|plan_query|get_[a-z_]+|rank_markets/);
    }
  });
});
