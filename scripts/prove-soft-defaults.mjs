#!/usr/bin/env node
// Proof script for MS ticket 5864963 soft defaults on /mcp/core tools.
// Runs offline against lib/core-profile.mjs with mock deps. Exit 0 on pass.
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
            shortlist: [{ market_slug: 'dallas' }], matched: 3, universe: 10,
            results: [{ market_slug: 'phoenix', value: 1 }],
            iso: args?.iso || 'PJM', demand_mw: 90000, excess_power_score: 55,
            data: [{ name: 'Example DC', provider: 'OpCo', city: 'Ashburn', state: 'VA' }],
            total_matching: 1,
            intent_class: 'markets', recommended_sequence: [{ step: 1 }],
            executed: [{ step: 1, status: 'executed', derived_from: 'rank_markets' }],
          }),
        }],
      };
    },
    async siteHeadline() { return { ok: false }; },
    async resolveLocation() { return { ok: false }; },
  };
}

const tool = (n) => C.CORE_TOOLS.find((t) => t.name === n);
async function run(name, args, deps = mockDeps()) {
  const env = await tool(name).run(args || {}, deps);
  if (env && Array.isArray(env.content)) {
    return { isError: !!env.isError, env: env.structuredContent || JSON.parse(env.content[0].text) };
  }
  return { isError: false, env };
}

const cases = [];
function check(label, ok, detail) {
  cases.push({ label, ok: !!ok, detail: detail || null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
}

const r1 = await run('plan_and_answer', {});
check('plan_and_answer {}', !r1.isError && /US data center/.test(r1.env.query.intent), r1.env.query.intent);

const r1b = await run('plan_and_answer', { question: 'compare phoenix and dallas', dry_run: true });
check('plan_and_answer question= alias', !r1b.isError && /phoenix/.test(r1b.env.query.intent));

const r2 = await run('find_sites', {});
check('find_sites {} -> markets/us', !r2.isError && r2.env.query.mode === 'markets' && r2.env.query.region === 'us');

const r3 = await run('rank_markets', {});
check('rank_markets {}', !r3.isError && r3.env.query.criteria === 'ai_ready');

const r4 = await run('grid_power', {});
check('grid_power {} -> PJM', !r4.isError && r4.env.query.iso === 'PJM');

const r5 = await run('facility_lookup', {});
check('facility_lookup {} -> US list', !r5.isError && (r5.env.notes || []).join(' ').includes('country=US'));

check('plan_and_answer.intent optional in schema', tool('plan_and_answer').schema.intent.isOptional());

const failed = cases.filter((c) => !c.ok);
console.log(`\n${cases.length - failed.length}/${cases.length} passed`);
process.exit(failed.length ? 1 : 0);
