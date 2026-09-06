// =============================================================================
// Every TOOL_ALIASES target must be a tool that actually exists
// -----------------------------------------------------------------------------
// TOOL_ALIASES has existed since agents were first observed guessing tool NAMES,
// but nothing in this repo ever checked that an alias RESOLVES. A target that is
// renamed upstream leaves an alias pointing at nothing, and the agent gets
// tool-not-found from a map whose entire job is to prevent tool-not-found.
//
// ★2026-09-06, MEASURED. Copilot and Mistral each published a DC Hub connector
// manifest, without ever calling the server, naming `get_grid_intel` and
// `site_selection` as capabilities. Live tools/list (83 tools) has neither.
// The catalog itself teaches the wrong guess: `get_fiber_intel` and
// `get_grid_intelligence` are siblings that abbreviate differently, so an agent
// that normalises the list is wrong whichever direction it normalises.
//
// This file guards EXISTENCE (does the target resolve). test/arg-aliases.test.mjs
// guards STRUCTURE. Keep both.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_ALIASES } from '../server.mjs';

// Same derivation test/toolspec-is-real.test.mjs and scripts/sync-tools-manifest.mjs
// use: server.mjs is the only place tools are defined.
const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const registered = new Set(
  [...src.matchAll(/trackedTool\(\s*srv\s*,\s*'([a-z_]+)'/g)].map((m) => m[1]),
);

// ★The guesses MEASURED in the wild. Structure assertions alone stay green if an
// entry is deleted, because deleting it removes nothing they range over.
const MEASURED_GUESSES = [
  // 2026-09-06: named as capabilities in two published connector manifests.
  ['get_grid_intel', 'get_grid_intelligence'],
  ['site_selection', 'site_selection_canvas'],
  // The same regularisation in the other direction — the sibling that makes
  // `get_grid_intel` a natural guess makes this one natural too.
  ['get_fiber_intelligence', 'get_fiber_intel'],
];

describe('TOOL_ALIASES resolves', () => {
  it('found real tools and a non-empty map (floor — nothing below passes vacuously)', () => {
    // Without this, a regex that stops matching turns every assertion below into
    // a loop over an empty set, and the file goes green having checked nothing.
    expect(registered.size, 'trackedTool() regex matched nothing').toBeGreaterThan(50);
    expect(Object.keys(TOOL_ALIASES).length).toBeGreaterThan(20);
  });

  it('every alias target is a tool server.mjs actually registers', () => {
    const dangling = Object.entries(TOOL_ALIASES)
      .filter(([, target]) => !registered.has(target))
      .map(([guess, target]) => `${guess} -> ${target}`)
      .sort();
    expect(dangling, 'alias target is not a registered tool').toEqual([]);
  });

  it('no alias KEY shadows a real tool name', () => {
    // An alias whose key is itself a tool would silently hijack that tool: the
    // rewrite runs before dispatch, so the real tool becomes unreachable.
    const shadowing = Object.keys(TOOL_ALIASES).filter((g) => registered.has(g)).sort();
    expect(shadowing, 'alias key is a real tool and would hijack it').toEqual([]);
  });

  it('no alias maps to itself', () => {
    for (const [guess, target] of Object.entries(TOOL_ALIASES)) {
      expect(guess, `${guess} maps to itself — a no-op that reads as coverage`).not.toBe(target);
    }
  });

  it.each(MEASURED_GUESSES)('routes the measured guess %s -> %s', (guess, target) => {
    expect(TOOL_ALIASES[guess], `${guess} was published as a real tool name by an AI platform`)
      .toBe(target);
  });
});
