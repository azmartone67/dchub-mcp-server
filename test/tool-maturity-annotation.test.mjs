// Guards for the maturity/coverage annotations on tools/list (r-maturity,
// 2026-08-12).
//
// WHAT THIS PROTECTS: an agent chooses a tool from tools/list and nothing
// else. Maturity and the published limits existed at /api/v1/canon/coverage
// and in the canonical benchmark report, i.e. two round-trips away from the
// decision, and the measurement says nobody pays that: 254 of 265 agents never
// ran a workflow in 30d. So the values now ride on each tool's annotations —
// and the ONLY thing that makes that safe is that they are DERIVED. A
// hand-authored maturity list is a second source of truth; the last time this
// repo kept one of those, Glama published "33 tools / 21,000+" for months.
//
// THREE PROPERTIES, and the third is the one that stops this file from being
// theatre:
//   1. every tool carries a maturity value, on BOTH served paths
//   2. every served value is reproducible from canonical/tool_maturity.json by
//      an implementation this test writes itself — plus no literal maturity
//      value exists anywhere in server.mjs, so a hardcode that happens to
//      agree with canon is caught too
//   3. with the canonical source EMPTY, every tool must collapse to "unknown"
//      and the suite must go red — a guard that still passes when canon
//      returns nothing is a guard that would pass on a silently emptied
//      snapshot, which is the failure mode that matters
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createServer, _buildToolsListResult, _buildMaturityIndex,
  _maturityAnnotation, _maturityBasis, _withdrawnFromDescription,
  _MATURITY_UNKNOWN,
} from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAP_PATH = path.join(ROOT, 'canonical', 'tool_maturity.json');
const SNAP = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');

// ── the test's OWN derivation ────────────────────────────────────────────────
// Deliberately written from the snapshot's shape rather than by importing the
// server's helper, so a bug in the server's rule shows up as a disagreement
// instead of being reproduced identically on both sides. (The anchor-contract
// lesson, inverted: the test reads the runtime OUTPUT and re-derives the
// expectation from canon — never from a copy of the runtime's own logic.)
const RANK = { partial: 0, expanding: 1, mature: 2 };
function expectedFor(toolName, snap) {
  const cov = Array.isArray(snap?.coverage) ? snap.coverage : [];
  const statuses = snap?.statuses && typeof snap.statuses === 'object' ? snap.statuses : {};
  const deferred = new Set(snap?.capture_evidence?.deferred_tools || []);
  const mine = cov.filter((e) =>
    e && (e.status in statuses) && (e.status in RANK) &&
    (e.entry_tool === toolName || (Array.isArray(e.workflow) && e.workflow.includes(toolName))));
  if (!mine.length) return { maturity: _MATURITY_UNKNOWN };

  let maturity = mine.map((e) => e.status).reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
  if (deferred.has(toolName) && RANK[maturity] > RANK.expanding) maturity = 'expanding';

  const problems = [];
  const limits = [];
  const entries = new Set();
  for (const e of mine) {
    if (!problems.includes(e.problem)) problems.push(e.problem);
    for (const l of (e.limits || [])) if (!limits.includes(l)) limits.push(l);
    entries.add(e.entry_tool);
  }
  const others = [...entries].filter((x) => x !== toolName);
  const front = entries.has('execute_plan') && toolName !== 'execute_plan' ? 'execute_plan'
    : (others.length === 1 ? others[0] : null);

  const out = { maturity };
  if (problems.length) out.problem = problems.join('; ');
  if (limits.length) out.limits = limits.join(' · ');
  if (front) out.front_door = front;
  return out;
}

let listed;      // the STATELESS served result — what dchub.cloud/mcp returns
let registered;  // the registration map — what the sessioned path serializes
beforeAll(async () => {
  listed = await _buildToolsListResult(null);
  registered = createServer()._registeredTools;
});

describe('the committed canonical snapshot', () => {
  it('names its owners and carries both evidence sources', () => {
    expect(SNAP._sources.coverage).toContain('/api/v1/canon/coverage');
    expect(SNAP._sources.capture_evidence).toContain('canonical-benchmarks');
    expect(SNAP.source).toContain('problem_taxonomy.py');       // one file to edit
    expect(SNAP.contract_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(SNAP.coverage.length).toBeGreaterThanOrEqual(8);
    // The status vocabulary is canon's, not ours: every status used by a
    // coverage entry must be one the owner published a DEFINITION for.
    for (const e of SNAP.coverage) expect(Object.keys(SNAP.statuses)).toContain(e.status);
  });

  it('carries measured capture evidence, which can only ever demote', () => {
    const ev = SNAP.capture_evidence;
    expect(ev.captures_measured).toBeGreaterThan(0);
    expect(Array.isArray(ev.deferred_tools)).toBe(true);
    expect(ev.means).toMatch(/never to raise/i);
  });
});

describe('property 1 — every tool carries a maturity value, on both paths', () => {
  it('stateless tools/list: 100% coverage, values inside the published enum', () => {
    const allowed = new Set([...Object.keys(SNAP.statuses), _MATURITY_UNKNOWN]);
    const missing = listed.tools.filter((t) => !t.annotations || !t.annotations.maturity);
    expect(missing.map((t) => t.name)).toEqual([]);
    for (const t of listed.tools) {
      expect(allowed, `${t.name} has an off-enum maturity`).toContain(t.annotations.maturity);
    }
    expect(listed.tools.length).toBeGreaterThan(50);   // a 1-tool list must not pass
  });

  it('registration map (the sessioned path) carries it too', () => {
    // The access tags shipped 80/80 stateless and 0/80 sessioned for weeks
    // because only the post-parse injection existed. Same trap, both paths.
    const names = Object.keys(registered);
    expect(names.length).toBeGreaterThan(50);
    for (const n of names) {
      expect(registered[n].annotations?.maturity, `${n} sessioned annotation`).toBeTruthy();
    }
  });

  it('unknown is a real value, not an omission — and it is used', () => {
    const unknown = listed.tools.filter((t) => t.annotations.maturity === _MATURITY_UNKNOWN);
    // If this ever hits zero, someone has started defaulting. The coverage map
    // names 13 problems; it does not name all 80-odd tools, and pretending
    // otherwise is the flattering-default defect.
    expect(unknown.length).toBeGreaterThan(0);
    for (const t of unknown) {
      expect(t.annotations.problem, `${t.name} claims a problem with no maturity`).toBeUndefined();
    }
  });
});

describe('property 2 — derived from canon, not written down', () => {
  it('every served annotation is reproducible from the snapshot', () => {
    const mismatches = [];
    for (const t of listed.tools) {
      const exp = expectedFor(t.name, SNAP);
      const w = _withdrawnFromDescription(t.description);
      if (w) {
        exp.withdrawn = w;
        if (exp.maturity in RANK && RANK[exp.maturity] > RANK.partial) exp.maturity = 'partial';
      }
      const got = {
        maturity: t.annotations.maturity,
        ...(t.annotations.problem ? { problem: t.annotations.problem } : {}),
        ...(t.annotations.limits ? { limits: t.annotations.limits } : {}),
        ...(t.annotations.front_door ? { front_door: t.annotations.front_door } : {}),
        ...(t.annotations.withdrawn ? { withdrawn: t.annotations.withdrawn } : {}),
      };
      if (JSON.stringify(got) !== JSON.stringify(exp)) {
        mismatches.push(`${t.name}: served ${JSON.stringify(got)} ≠ derived ${JSON.stringify(exp)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('no maturity value is a literal anywhere in server.mjs', () => {
    // The re-derivation above catches a hardcode that DISAGREES with canon.
    // This catches one that happens to agree — which is the dangerous kind,
    // because it passes today and rots silently the day canon moves.
    // Strings inside comments are stripped first so prose may discuss the
    // words freely; only code is judged.
    const code = SERVER_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
    const hits = [...code.matchAll(/\bmaturity\s*:\s*['"`](mature|expanding|partial)['"`]/g)];
    expect(hits.map((h) => h[0]), 'a maturity value is hardcoded in server.mjs').toEqual([]);
    // ...and no per-tool maturity table keyed by tool name.
    const tableHits = [...code.matchAll(/\b(get_|rank_|execute_|ai_)[a-z_]+\s*:\s*['"`](mature|expanding|partial)['"`]/g)];
    expect(tableHits.map((h) => h[0]), 'a per-tool maturity table exists').toEqual([]);
  });

  it('every published limit is VERBATIM from canon — never paraphrased', () => {
    const canonLimits = new Set(SNAP.coverage.flatMap((e) => e.limits || []));
    expect(canonLimits.size).toBeGreaterThan(0);
    let checked = 0;
    for (const t of listed.tools) {
      if (!t.annotations.limits) continue;
      for (const part of t.annotations.limits.split(' · ')) {
        expect(canonLimits, `${t.name} publishes a limit canon does not`).toContain(part);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);   // not vacuous
  });
});

describe('property 3 — it cannot pass when the canonical source is empty', () => {
  it('an empty coverage map collapses EVERY tool to unknown', () => {
    for (const snap of [null, {}, { coverage: [], statuses: {} }, { coverage: [], statuses: SNAP.statuses }]) {
      const idx = _buildMaturityIndex(snap);
      expect(idx.size).toBe(0);
      for (const t of listed.tools) {
        // description passed empty so the withdrawn path cannot supply a value
        expect(_maturityAnnotation(t.name, '', idx)).toEqual({ maturity: _MATURITY_UNKNOWN });
      }
    }
  });

  it('and the live derivation is NOT that state — real statuses are present', () => {
    // This is the assertion that fails if the snapshot silently empties. Without
    // it, "every tool has a maturity" stays green on 82 unknowns and the guard
    // proves nothing.
    const kinds = new Set(listed.tools.map((t) => t.annotations.maturity));
    for (const s of Object.keys(SNAP.statuses)) {
      expect(kinds, `no tool renders ${s} — canon may have emptied`).toContain(s);
    }
    const covered = listed.tools.filter((t) => t.annotations.maturity !== _MATURITY_UNKNOWN);
    expect(covered.length).toBeGreaterThanOrEqual(SNAP.coverage.length);
  });

  it('an off-enum status from canon is refused, not passed through', () => {
    const idx = _buildMaturityIndex({
      statuses: SNAP.statuses,
      coverage: [{ problem: 'p', entry_tool: 'x_tool', workflow: ['x_tool'], status: 'battle_tested', limits: [] }],
    });
    expect(idx.get('x_tool')).toBeUndefined();
    expect(_maturityAnnotation('x_tool', '', idx).maturity).toBe(_MATURITY_UNKNOWN);
  });
});

describe('withdrawn capabilities say so at selection time', () => {
  it('the gas capabilities withdrawn 2026-08-08 are flagged', () => {
    const marked = listed.tools.filter((t) => t.annotations.withdrawn);
    expect(marked.map((t) => t.name).sort())
      .toEqual(['get_gas_economics', 'get_gas_index', 'get_gas_intelligence']);
    const byName = Object.fromEntries(marked.map((t) => [t.name, t.annotations]));
    // The whole tool is gone vs. named fields retracted — different advice.
    expect(byName.get_gas_index.withdrawn).toBe('withdrawn');
    expect(byName.get_gas_economics.withdrawn).toBe('partially_withdrawn');
    expect(byName.get_gas_intelligence.withdrawn).toBe('partially_withdrawn');
    // A withdrawn capability can never read as mature.
    for (const t of marked) expect(t.annotations.maturity).not.toBe('mature');
  });

  it('the verdict is read from the tool description, not a list', () => {
    expect(_withdrawnFromDescription('★ WITHDRAWN 2026-08-08: this tool no longer returns a score.'))
      .toBe('withdrawn');
    expect(_withdrawnFromDescription('★ WITHDRAWN 2026-08-08: the $/MWh is NO LONGER RETURNED.'))
      .toBe('partially_withdrawn');
    expect(_withdrawnFromDescription('a perfectly ordinary description')).toBe(null);
  });
});

describe('the basis is stated once, and states what it is NOT', () => {
  it('rides at result level, not on every tool', () => {
    const basis = listed._meta?.['cloud.dchub/maturity_basis'];
    expect(basis, 'tools/list carries no maturity basis').toBeTruthy();
    expect(basis.derived_from.coverage).toBe(SNAP._sources.coverage);
    expect(basis.contract_hash).toBe(SNAP.contract_hash);
    // Definitions come from canon, so a reader can recompute our verdicts.
    for (const [k, v] of Object.entries(SNAP.statuses)) expect(basis.values[k]).toBe(v);
    expect(basis.values.unknown).toBeTruthy();
    // Not duplicated per tool — that would be 80 copies of a paragraph.
    for (const t of listed.tools) expect(t.annotations.maturity_basis).toBeUndefined();
  });

  it('refuses to let "mature" imply battle-tested by external callers', () => {
    const basis = _maturityBasis(SNAP);
    expect(basis.what_this_label_is_not).toMatch(/external callers/i);
    expect(basis.what_this_label_is_not).toMatch(/tests/i);
    expect(basis.how).toMatch(/demote/i);
  });
});

describe('size budget', () => {
  it('the annotation stays small — an agent parses this every session', () => {
    const withAnnot = Buffer.byteLength(JSON.stringify(listed));
    const stripped = JSON.parse(JSON.stringify(listed));
    delete stripped._meta;
    for (const t of stripped.tools) {
      for (const k of ['maturity', 'problem', 'limits', 'front_door', 'withdrawn']) delete t.annotations[k];
    }
    const added = withAnnot - Buffer.byteLength(JSON.stringify(stripped));
    // Measured at +9.6 KB on a 379 KB list (~2.5%). The ceiling is generous
    // enough not to be brittle and tight enough that adding a paragraph per
    // tool trips it.
    expect(added / withAnnot).toBeLessThan(0.06);
  });
});
