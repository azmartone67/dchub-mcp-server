// instructions-constraint-coverage.test.mjs — (2026-08-25)
//
// The tail claimed "a site query returns a `constraint_coverage` block naming
// what it cannot answer and why". Measured live 2026-08-25 against
// https://dchub.cloud/mcp, on calls that did NOT error:
//
//   analyze_site              isError:false, no constraint_coverage, no coverage
//   get_composite_site_score  no constraint_coverage — `coverage` + `coverage_ratio`
//   rank_sites                constraint_coverage OBJECT {power_score:'unavailable'}
//   site_selection_canvas     constraint_coverage OBJECT {capacity_mw:{applied:false,…}}
//   get_power_availability_timeline  constraint_coverage ARRAY of caveat strings
//
// So the block is real, but it is NOT on the site queries, and it does not have
// one shape. An agent that trusted the old sentence would look for the block on
// analyze_site (absent) or iterate the array form over an object (wrong type).
//
// This is the second retraction on this one sentence — the 08-24 pass read an
// ERRORED get_power_availability_timeline call as proof the block did not exist
// anywhere and broadcast that to seven partners. The lesson both times is the
// same: the implementation was right and the prose drifted. Guard the prose.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const TAIL = (SRC.match(/const _INSTR_TAIL = '([\s\S]*?)';\n/) || [])[1] || '';
const MANIFEST = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'));

// Every tool name declared anywhere in the published manifest.
function manifestToolNames(node, out = new Set()) {
  if (Array.isArray(node)) { for (const x of node) manifestToolNames(x, out); return out; }
  if (node && typeof node === 'object') {
    if (typeof node.name === 'string' && 'description' in node) out.add(node.name);
    for (const v of Object.values(node)) manifestToolNames(v, out);
  }
  return out;
}
const TOOL_NAMES = manifestToolNames(MANIFEST);

// The sentence under guard: from the limits clause to the competitor contrast.
const CLAUSE = (() => {
  const start = TAIL.indexOf('publishes its own limits');
  const end = TAIL.indexOf('Not analyst PDFs (DataCenterHawk)');
  return start > -1 && end > start ? TAIL.slice(start, end) : '';
})();

describe('the constraint_coverage claim matches what the tools return', () => {
  it('extracts a non-empty tail and clause', () => {
    // Guard the guard: a regex drift here would make every assertion vacuous.
    expect(TAIL.length).toBeGreaterThan(1000);
    expect(CLAUSE.length).toBeGreaterThan(80);
  });

  it('does NOT claim a site query returns the block', () => {
    // analyze_site returns neither constraint_coverage nor coverage, and
    // get_composite_site_score returns `coverage`, not `constraint_coverage`.
    expect(CLAUSE).not.toMatch(/a site query returns a .?constraint_coverage/i);
  });

  it('names only tools that exist in the published manifest', () => {
    // NOTE: the char class MUST include digits. Written first as [a-z_]{4,},
    // it silently skipped any name carrying one — a mutation naming a
    // nonexistent `get_site_limits_v2` passed clean. The guard was vacuous
    // for exactly the names a typo is most likely to produce.
    const named = [...CLAUSE.matchAll(/`([a-z0-9_]{4,})`/g)]
      .map(m => m[1])
      .filter(n => n.includes('_') && !n.startsWith('_'))
      .filter(n => !['constraint_coverage', 'coverage_ratio', 'capacity_mw'].includes(n));
    // Floor, not a smoke check: the clause names four tools, so a regex that
    // stops matching fails here instead of passing on an empty set.
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const n of named) {
      expect(TOOL_NAMES.has(n), `instructions name \`${n}\`, absent from mcp-server.json`).toBe(true);
    }
  });

  it('names the three verified emitters', () => {
    for (const t of ['rank_sites', 'site_selection_canvas', 'get_power_availability_timeline']) {
      expect(CLAUSE).toContain(t);
    }
  });

  it('warns that the shape differs per tool', () => {
    // One name, three types. An agent that assumes the array form breaks on
    // the two object forms, which is a silent wrong-type read, not an error.
    expect(CLAUSE).toMatch(/shape/i);
    expect(CLAUSE).toMatch(/read the shape from the response/i);
  });

  it('says a declared argument can still be inert', () => {
    // site_selection_canvas reports capacity_mw applied:false. That is the one
    // place the platform already tells the truth about a dropped argument.
    expect(CLAUSE).toMatch(/applied:false|applied: ?false/);
  });

  it('stays inside the payload-diet budget', () => {
    // Same budget argument as instructions-selftest-pointer: this tail is
    // enormous and a paragraph here contradicts the diet change.
    expect(CLAUSE.length).toBeLessThan(1000);
  });
});
