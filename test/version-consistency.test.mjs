// =============================================================================
// Version consistency across publish surfaces — HARD gate
// -----------------------------------------------------------------------------
// Split out of test/regression.test.mjs on 2026-08-30, unchanged in substance.
//
// WHY IT MOVED. This guard's own header said "Fail the build if the five publish
// surfaces disagree", and it could not. regression.test.mjs is named in the
// "Live MCP suite — informational (non-blocking)" step of test.yml, which carries
// continue-on-error: true — so this assertion could go red while the job reported
// SUCCESS. That is not hypothetical: mcp #262 bumped package.json, server.json,
// mcp-server.json and smithery.yaml to 2.12.1 and missed server.mjs. This test
// went red on that PR, `smoke` reported SUCCESS, the drift merged, and the
// RUNNING server identified as 2.12.0 on both surfaces it controls while the
// official registry served 2.12.1 as isLatest. Four days and four PRs later it
// was still red on main.
//
// The step boundary in test.yml is drawn by FILE, but the blocking property
// belongs to the ASSERTION. A file that mixes deterministic guards with live
// network calls cannot be placed correctly, so the deterministic ones live here
// instead — no network, no file mutation, safe on the hard gate.
//
// ★Do NOT gate this with `vitest -t "<name>"` instead. Measured 2026-08-30:
// `vitest run <file> -t "<name-that-matches-nothing>"` exits 0. A name-scoped
// gate certifies nothing the moment the describe is renamed. File-scoped only.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ── Version consistency guard (r-version-sync 2026-06-19) ──────────────────
// The release flow bumps package.json + server.mjs, but server.json /
// mcp-server.json / smithery.yaml have drifted behind before — and server.json is
// what registry-refresh publishes to the official MCP registry, so a mismatch
// silently UNDER-publishes the version (caught + fixed v2.3.0->2.3.1, 2026-06-19).
// Fail the build if the five publish surfaces disagree. Pure local read, no network.
describe('version consistency across publish surfaces', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('package.json / server.json / mcp-server.json / smithery.yaml / server.mjs all agree', () => {
    const versions = {
      'package.json':    JSON.parse(read('../package.json')).version,
      'server.json':     JSON.parse(read('../server.json')).version,
      'mcp-server.json': JSON.parse(read('../mcp-server.json')).version,
    };
    const sm = read('../smithery.yaml').match(/^version:\s*["']?(\d+\.\d+\.\d+)/m);
    versions['smithery.yaml'] = sm ? sm[1] : null;
    // server.mjs carries the version in 2+ spots (McpServer init + well-known);
    // dedup — if they disagree, the joined string makes the set size > 1 and fails.
    const mjs = [...new Set([...read('../server.mjs')
      .matchAll(/version:\s*['"](\d+\.\d+\.\d+)['"]/g)].map((m) => m[1]))];
    versions['server.mjs'] = mjs.length === 1 ? mjs[0] : mjs.join(',');
    expect(
      new Set(Object.values(versions)).size,
      `version drift across publish surfaces: ${JSON.stringify(versions)}`,
    ).toBe(1);
  });
});