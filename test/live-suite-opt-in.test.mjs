// =============================================================================
// A suite that talks to PRODUCTION must be opted INTO — the guard
// -----------------------------------------------------------------------------
// Measured 2026-09-04: test/mcp.test.mjs and test/regression.test.mjs both read
//
//     const MCP_URL = process.env.MCP_URL || 'https://dchub.cloud/mcp';
//
// and then ran unconditionally. So `npx vitest run` — the command this repo's
// own gates line recommends, and the one a contributor reaches for first — sent
// 49 live tool calls at production from any laptop, with no opt-in, no key, and
// nothing in the output that said it had happened. CI was never the problem:
// test.yml's live step sets MCP_URL explicitly. Only the DEFAULT was.
//
// ★ WHY A GUARD AND NOT A COMMENT. The repo has measured this class four times
// (see every-test-file-runs.test.mjs, which exists for the same reason). The
// fix here is two characters of gate in two files; nothing stops a third file
// from copying the original pattern, and nothing would say so.
//
// ★ WHY "GATED" IS NOT ENOUGH — the trap this guard is actually shaped around.
// mcp.test.mjs ALREADY had a gated top-level describe before this change:
//
//     describe.runIf(!!process.env.MCP_API_KEY)('late key header ...')
//
// That is a real gate and it is the WRONG one: MCP_API_KEY says which tier to
// authenticate as, not whether to touch production at all, so that block still
// fired live traffic whenever a key happened to be exported. A guard that only
// asked "is this describe gated?" would have called that file clean. So the
// assertion below is that the gate MENTIONS the live switch — the condition has
// to be about WHETHER to go to the network, not about what to send when it does.
//
// ★ NOT an exclude. Measured the same day:
//     npx vitest run test/mcp.test.mjs --exclude '**/mcp.test.mjs'
//   prints "No test files found" and exits 1. The live step carries
//   continue-on-error: true, so a config-level exclude would have retired the
//   live suite outright while CI kept reporting green. runIf skips VISIBLY:
//   the run output says "2 skipped", which is the whole difference.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const testDir = new URL('./', import.meta.url);

// ★ A file "targets production" only if it BOTH defaults to the prod endpoint
// AND actually calls the network. The env-default pattern alone is not enough:
// this guard's own must-fail fixtures below contain that literal, and the first
// version of this file duly flagged ITSELF at its own top-level describe. A
// scanner that cannot tell a suite from a description of one is not measuring
// the thing it claims to. The fetch requirement is what makes it a suite.
const PROD_DEFAULT = /process\.env\.MCP_URL\s*\|\|/;
const CALLS_NETWORK = /\bfetch\s*\(/;
const targetsProd = (src) => PROD_DEFAULT.test(src) && CALLS_NETWORK.test(src);

/** A top-level describe: column 0, so nested ones are out of scope. */
const TOP_LEVEL_DESCRIBE = /^describe(\.\w+)?\s*\(/;

/**
 * The check, as a pure function over {name -> source} so the must-fail
 * controls below can drive it with synthetic sources instead of writing to
 * the repo. Returns a list of human-readable offences.
 */
function offences(sources) {
  const out = [];
  for (const [name, src] of Object.entries(sources)) {
    if (!targetsProd(src)) continue;                // not a live-targeting suite
    src.split('\n').forEach((line, i) => {
      if (!TOP_LEVEL_DESCRIBE.test(line)) return;
      const gated = /^describe\.(runIf|skipIf)\s*\(/.test(line);
      // The gate must be about the live switch itself, not about credentials.
      const aboutLiveness = /\bLIVE\b|process\.env\.MCP_URL/.test(line);
      if (!gated) {
        out.push(`${name}:${i + 1} top-level describe is UNGATED — it will run against production`);
      } else if (!aboutLiveness) {
        out.push(`${name}:${i + 1} describe is gated, but not on the live switch (MCP_URL/LIVE)`);
      }
    });
  }
  return out;
}

const sources = Object.fromEntries(
  readdirSync(testDir)
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => [f, readFileSync(new URL(f, testDir), 'utf8')]),
);

describe('a production-targeting suite runs only when opted into', () => {
  it('found the live-targeting files at all (never pass by scanning nothing)', () => {
    // Vacuity control. If the scan or the PROD_DEFAULT pattern ever stops
    // matching, every assertion below succeeds while checking nothing — the
    // exact silent-green this file exists to prevent, in this file.
    const live = Object.keys(sources).filter((f) => targetsProd(sources[f]));
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    // Named on purpose: these are the two suites test.yml runs against live
    // prod. If either stops being DETECTED — renamed, or refactored past the
    // pattern — this fails loudly rather than quietly guarding nothing. It is a
    // positive control, not an allowlist: it can only ever demand MORE coverage.
    expect(live).toContain('mcp.test.mjs');
    expect(live).toContain('regression.test.mjs');
  });

  it('gates every top-level describe in those files on the live switch', () => {
    expect(offences(sources).join('\n')).toBe('');
  });

  // ── must-fail controls ──
  // Each reproduces a shape that HAS shipped, and asserts the checker rejects it.

  it('FAILS an ungated describe in a production-defaulting file', () => {
    const bad = { 'x.test.mjs': "const MCP_URL = process.env.MCP_URL || 'https://dchub.cloud/mcp';\nfetch(MCP_URL);\ndescribe('smoke', () => {})" };
    expect(offences(bad)).toHaveLength(1);
    expect(offences(bad)[0]).toMatch(/UNGATED/);
  });

  it('FAILS a describe gated on CREDENTIALS rather than on liveness (the 2026-09-04 shape)', () => {
    const bad = { 'x.test.mjs': "const MCP_URL = process.env.MCP_URL || 'https://dchub.cloud/mcp';\nfetch(MCP_URL);\ndescribe.runIf(!!process.env.MCP_API_KEY)('late key', () => {})" };
    expect(offences(bad)).toHaveLength(1);
    expect(offences(bad)[0]).toMatch(/not on the live switch/);
  });

  it('PASSES a correctly gated file, so the guard is not merely always-red', () => {
    const good = { 'x.test.mjs': "const LIVE = !!process.env.MCP_URL;\nconst MCP_URL = process.env.MCP_URL || 'https://dchub.cloud/mcp';\nfetch(MCP_URL);\ndescribe.runIf(LIVE)('smoke', () => {})\ndescribe.runIf(LIVE && !!process.env.MCP_API_KEY)('late key', () => {})" };
    expect(offences(good)).toEqual([]);
  });

  it('IGNORES files that never target production (no false positives)', () => {
    const offline = { 'x.test.mjs': "describe('pure unit test', () => {})" };
    expect(offences(offline)).toEqual([]);
  });
});
