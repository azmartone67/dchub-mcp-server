// invalid-param-hint.test.mjs — (2026-08-25)
//
// The 400/422 hint told agents: "Re-read this tool's inputSchema in tools/list
// and re-send with the declared types." Measured against the published
// manifest: only 7 of 82 tools declare a `required` array at all. So for 75 of
// them the schema cannot say which argument was missing, and CONDITIONAL
// requirements ("needed only alongside another") are not expressible in JSON
// Schema `required` at any rate.
//
// Worked example — rank_sites:
//   call  {candidates:[…]}            -> API 400, detail "objectives required: {field: weight}"
//   schema required                    -> absent; `objectives` is .optional()
// and that .optional() is CORRECT: objectives is genuinely optional in
// shortlist_name mode, and making it required caused a -32602 on 2026-07-16
// that rejected the documented re-rank path. The schema is right; the hint was
// pointing at it as if it were an oracle.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../mcp-server.json', import.meta.url), 'utf8'));

// The 400/422 branch of deterministic_hint.
const HINT = (() => {
  const m = SRC.match(/\? 'A parameter was rejected\.([\s\S]*?)'\n/);
  return m ? m[0] : '';
})();

describe('the invalid_parameter hint points somewhere that can actually help', () => {
  it('finds the hint at all', () => {
    // Guard the guard — a regex drift makes every assertion below vacuous.
    expect(HINT.length).toBeGreaterThan(80);
  });

  it('sends the agent to `detail` first', () => {
    // detail is the only field that names the offending argument.
    expect(HINT).toMatch(/`detail`/);
  });

  it('names the tool DESCRIPTION, not only the inputSchema', () => {
    expect(HINT).toMatch(/DESCRIPTION/);
  });

  it('does not present inputSchema as the sole authority', () => {
    const mentionsSchema = /inputSchema/.test(HINT);
    const qualifies = /as well as|no `required`|conditionally required/.test(HINT);
    expect(mentionsSchema && !qualifies).toBe(false);
  });

  it('still tells the agent not to retry identical arguments', () => {
    expect(HINT).toMatch(/[Dd]o not retry the same arguments/);
  });
});

describe('the premise behind the hint is still true', () => {
  it('most tools genuinely declare no `required` array', () => {
    // SELF-INVALIDATING: if a future pass adds `required` across the fleet,
    // this fails and whoever did it should revisit the hint's wording rather
    // than leave it claiming something that stopped being true.
    const tools = [];
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object') {
        if (typeof n.name === 'string' && 'description' in n) tools.push(n);
        Object.values(n).forEach(walk);
      }
    })(MANIFEST);
    expect(tools.length).toBeGreaterThan(50);

    const withRequired = tools.filter(
      t => Array.isArray(t.inputSchema?.required) && t.inputSchema.required.length > 0
    );
    expect(withRequired.length / tools.length).toBeLessThan(0.5);
  });
});
