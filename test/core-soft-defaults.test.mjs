// Soft input defaults for /mcp/core tools (Microsoft ticket 5864963).
// Copilot Studio often invokes tools with {} or under-filled args; those calls
// must return useful preview content (isError false) instead of hard -32602 /
// invalid_input. Deterministic: no network, mock deps.delegate.
import { describe, it, expect } from 'vitest';
import * as C from '../lib/core-profile.mjs';

function mockDeps(handlers = {}) {
  return {
    async delegate(name, args) {
      if (handlers[name]) return handlers[name](args);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            as_of: '2026-11-04T00:00:00Z',
            provenance: { source: 'EIA-930; DC Hub', as_of: '2026-11-04T00:00:00Z', license: 'CC-BY-4.0' },
            shortlist: [{ market_slug: 'dallas', market_name: 'Dallas' }],
            markets: [{ market_slug: 'phoenix', market_name: 'Phoenix' }],
            results: [{ market_slug: 'ashburn', market_name: 'Ashburn', value: 1 }],
            matched: 3, universe: 10,
            iso: args?.iso || 'PJM', demand_mw: 90000, excess_power_score: 55, constraint_score: 40,
            data: [{ name: 'Example DC', provider: 'OpCo', city: 'Ashburn', state: 'VA', country: 'US' }],
            total_matching: 1,
            intent_class: 'markets', recommended_sequence: [{ step: 1, derived_from: 'rank_markets' }],
            executed: [{ step: 1, status: 'executed', derived_from: 'rank_markets' }],
          }),
        }],
      };
    },
    async siteHeadline() { return { ok: false }; },
    async resolveLocation() { return { ok: false }; },
  };
}

function tool(name) {
  return C.CORE_TOOLS.find((t) => t.name === name);
}

async function run(name, args, deps = mockDeps()) {
  const env = await tool(name).run(args || {}, deps);
  // inputError returns a shaped tool result; success returns envelope object
  if (env && Array.isArray(env.content)) {
    return { isError: !!env.isError, env: env.structuredContent || JSON.parse(env.content[0].text) };
  }
  return { isError: false, env };
}

describe('core soft defaults (MS 5864963)', () => {
  it('plan_and_answer accepts empty args with a default intent', async () => {
    const r = await run('plan_and_answer', {}, mockDeps());
    expect(r.isError).toBe(false);
    expect(r.env.query.intent).toMatch(/US data center markets/i);
    expect(r.env.error).toBeUndefined();
  });

  it('plan_and_answer accepts query/question aliases', async () => {
    const r = await run('plan_and_answer', { query: 'compare phoenix and dallas for 100 MW', dry_run: true });
    expect(r.isError).toBe(false);
    expect(r.env.query.intent).toMatch(/phoenix and dallas/i);
    expect((r.env.notes || []).join(' ')).toMatch(/alias/i);
  });

  it('find_sites empty args defaults to markets mode / region=us', async () => {
    const seen = [];
    const deps = mockDeps({
      site_selection_canvas: (args) => {
        seen.push(args);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true, shortlist: [{ market_slug: 'dallas' }], matched: 5, universe: 20,
            provenance: { source: 'DC Hub', as_of: '2026-11-04', license: 'CC-BY-4.0' },
          }) }],
        };
      },
    });
    const r = await run('find_sites', {}, deps);
    expect(r.isError).toBe(false);
    expect(r.env.query.mode).toBe('markets');
    expect(r.env.query.region).toBe('us');
    expect(seen[0].region).toBe('us');
    expect(r.env.headline.markets_shown).toBe(1);
  });

  it('find_sites mode=areas without geography soft-falls to markets', async () => {
    const r = await run('find_sites', { mode: 'areas' });
    expect(r.isError).toBe(false);
    expect(r.env.query.mode).toBe('markets');
    expect((r.env.notes || []).join(' ')).toMatch(/defaulted to markets/i);
  });

  it('rank_markets works with empty args (criteria defaults to ai_ready)', async () => {
    const r = await run('rank_markets', {});
    expect(r.isError).toBe(false);
    expect(r.env.query.criteria).toBe('ai_ready');
    expect(r.env.headline.markets_shown).toBeGreaterThan(0);
  });

  it('grid_power empty args defaults to PJM', async () => {
    const seen = [];
    const deps = mockDeps({
      get_grid_intelligence: (args) => {
        seen.push(args);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true, iso: 'PJM', demand_mw: 91000, excess_power_score: 52,
            provenance: { source: 'EIA-930', as_of: '2026-11-04', license: 'CC-BY-4.0' },
          }) }],
        };
      },
    });
    const r = await run('grid_power', {}, deps);
    expect(r.isError).toBe(false);
    expect(r.env.query.iso).toBe('PJM');
    expect(seen[0].iso).toBe('PJM');
    expect(r.env.headline.demand_mw).toBe(91000);
  });

  it('facility_lookup empty args defaults to country=US list', async () => {
    const seen = [];
    const deps = mockDeps({
      search_facilities: (args) => {
        seen.push(args);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true, data: [{ name: 'Example DC', provider: 'OpCo', city: 'Ashburn', state: 'VA' }],
            total_matching: 1, provenance: { source: 'DC Hub', as_of: '2026-11-04', license: 'CC-BY-4.0' },
          }) }],
        };
      },
    });
    const r = await run('facility_lookup', {}, deps);
    expect(r.isError).toBe(false);
    expect(seen[0].country).toBe('US');
    expect(seen[0].limit).toBe(10);
    expect(r.env.headline.records_shown).toBe(1);
  });

  it('plan_and_answer schema no longer requires intent (empty args pass Zod)', () => {
    const schema = tool('plan_and_answer').schema;
    // zod object-ish: each key is a ZodType; required fields lack .isOptional()
    expect(schema.intent.isOptional()).toBe(true);
    expect(schema.query.isOptional()).toBe(true);
    expect(schema.question.isOptional()).toBe(true);
  });
});
