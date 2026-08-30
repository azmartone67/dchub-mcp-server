// =============================================================================
// toolspec.json must carry REAL schemas — and the alias targets must be in them
// -----------------------------------------------------------------------------
// Measured on origin/main 2026-08-30, before scripts/refresh-toolspec.mjs:
// toolspec.json held 79 tools against a live 83, and `properties` was EMPTY for
// every one — each inputSchema was the bare {"type":"object"}.
//
// ★ THE FILE WAS NOT MERELY STALE, IT WAS LOAD-BEARING IN THE WRONG DIRECTION.
// server.mjs's ARG_ALIASES rewrites guessed argument names for agents
// ({location} -> market). Its targets must be REAL declared properties, and
// both server.mjs and test/arg-aliases.test.mjs stated plainly that this repo
// "CANNOT assert that" because "validating against it would pass vacuously".
// So a property renamed upstream would leave a silent no-op alias and nothing
// here would catch it — Zod strips undeclared arguments, so the caller gets a
// confident WRONG answer rather than an error. A schema file with no schemas
// did not just fail to help; it blocked the guard that needed it.
//
// ★ STALENESS IS DETECTED WITHOUT A DATE. The names in toolspec.json must equal
// the trackedTool() set in server.mjs — the ONE place tools are defined
// (scripts/sync-tools-manifest.mjs derives its canonical list the same way). An
// embedded generated_at would be a time bomb that reds main whenever the daily
// job has a bad night; a name-set comparison only fails when the file is
// genuinely behind the code, which is exactly when it should.
//
// Regenerate with: node scripts/refresh-toolspec.mjs   (fails closed — it will
// never overwrite a good snapshot with a degraded one).
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ARG_ALIASES } from '../server.mjs';

const spec = JSON.parse(readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8'));
const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// Same derivation sync-tools-manifest.mjs uses: server.mjs is the only place
// tools are defined.
const registered = new Set(
  [...src.matchAll(/trackedTool\(\s*srv\s*,\s*'([a-z_]+)'/g)].map((m) => m[1]),
);
const props = (t) => Object.keys((t.inputSchema || {}).properties || {});
const byName = Object.fromEntries(spec.map((t) => [t.name, t]));

describe('toolspec.json is a real schema snapshot', () => {
  it('parsed a non-empty array, and server.mjs really registered tools', () => {
    // A silently-empty parse on either side would make everything below pass
    // vacuously — which is the defect this file is about.
    expect(Array.isArray(spec)).toBe(true);
    expect(spec.length).toBeGreaterThan(50);
    expect(registered.size).toBeGreaterThan(50);
  });

  it('is NOT the vacuous {"type":"object"} snapshot it used to be', () => {
    const withProps = spec.filter((t) => props(t).length > 0);
    expect(
      withProps.length,
      `every one of ${spec.length} tools declares an EMPTY inputSchema — this is ` +
        'the 2026-08-30 vacuum. Run: node scripts/refresh-toolspec.mjs',
    ).toBeGreaterThan(spec.length / 2);
  });

  it('lists exactly the tools server.mjs registers', () => {
    const inSpec = new Set(spec.map((t) => t.name));
    const missing = [...registered].filter((n) => !inSpec.has(n)).sort();
    const extra = [...inSpec].filter((n) => !registered.has(n)).sort();
    expect(
      { missing, extra },
      'toolspec.json has drifted from server.mjs. Run: node scripts/refresh-toolspec.mjs',
    ).toEqual({ missing: [], extra: [] });
  });
});

describe('every ARG_ALIASES target is a REAL declared property', () => {
  // ★ This is the assertion server.mjs called impossible. It is the whole
  // reason the snapshot was worth repairing rather than deleting: a rename
  // upstream now reds CI here instead of silently no-op'ing in production.
  it('resolves every alias target against the tool it belongs to', () => {
    const broken = [];
    for (const [tool, map] of Object.entries(ARG_ALIASES)) {
      const t = byName[tool];
      if (!t) { broken.push(`${tool}: not in toolspec.json at all`); continue; }
      const declared = props(t);
      if (declared.length === 0) { broken.push(`${tool}: declares no properties to check against`); continue; }
      for (const [guess, target] of Object.entries(map)) {
        if (!declared.includes(target)) {
          broken.push(`${tool}: alias ${guess} -> '${target}' is NOT declared (real: ${declared.join(', ')})`);
        }
      }
    }
    expect(
      broken,
      'an alias points at a property the tool does not declare. Zod strips ' +
        'undeclared arguments, so this is a SILENT no-op in production, not an ' +
        'error the caller can see:\n  ' + broken.join('\n  '),
    ).toEqual([]);
  });

  it('never aliases a guess that is ITSELF a declared property', () => {
    // Rewriting a real argument would destroy a caller's explicit value.
    const shadowed = [];
    for (const [tool, map] of Object.entries(ARG_ALIASES)) {
      const declared = props(byName[tool] || {});
      for (const guess of Object.keys(map)) {
        if (declared.includes(guess)) shadowed.push(`${tool}: '${guess}' is a REAL property but is aliased away`);
      }
    }
    expect(shadowed).toEqual([]);
  });
});
