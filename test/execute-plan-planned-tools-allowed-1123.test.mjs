// execute-plan-planned-tools-allowed-1123.test.mjs: every tool the planner puts in a plan is one execute_plan runs.
// Planner 5.63 (POWER rotation, 2026-11-23) planned get_infra_projects for the grid_constraints class, but the tool
// was missing from _EXEC_ALLOWED_TOOLS, so live execute_plan refused it ("not_allowed") and the Loudoun transmission
// answer said "planned upgrades are not in this answer". This sweeps every question in the test suite through
// _planQuery under four contexts and fails on any planned tool outside the allowlist.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VITEST = process.env.VITEST || '1';
const S = await import('../server.mjs');
const dir = path.dirname(fileURLToPath(import.meta.url));

const QUESTIONS = new Set([
  'What transmission constraints limit new large loads in Northern Virginia (Loudoun County), and what transmission upgrades are planned?',
]);
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'))) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of t.matchAll(/(['"`])((?:(?!\1)[^\\\n]){20,300}\?)\1/g)) QUESTIONS.add(m[2]);
}
const CTXS = [{}, { state: 'TX' }, { iso: 'PJM' }, { lat: 39.09, lon: -77.64 }];
const META = new Set(['plan_query', 'execute_plan']);

describe('every planned tool is on the execute_plan read-only allowlist', () => {
  it('sweeps the suite\'s questions', () => {
    expect(QUESTIONS.size, 'control: the sweep has questions').toBeGreaterThan(100);
    const bad = new Set();
    let planned = 0;
    for (const q of QUESTIONS) for (const c of CTXS) {
      let p;
      try { p = S._planQuery(q, c); } catch { continue; }
      for (const s of (p && p.recommended_sequence) || []) {
        planned++;
        if (!META.has(s.tool) && !S._EXEC_ALLOWED_TOOLS.includes(s.tool)) bad.add(`${s.tool} (${p.intent_class})`);
      }
    }
    expect(planned, 'control: plans have steps').toBeGreaterThan(500);
    expect([...bad]).toEqual([]);
  });
  it('the grid_constraints plan runs get_infra_projects', () => {
    const p = S._planQuery([...QUESTIONS][0], {});
    expect(p.intent_class).toBe('grid_constraints');
    expect(p.recommended_sequence.map((s) => s.tool)).toContain('get_infra_projects');
    expect(S._execStepAllowed('get_infra_projects')).toBe(true);
  });
});
