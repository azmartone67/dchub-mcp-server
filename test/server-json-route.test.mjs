// Guards GET /server.json — the live full registry-schema manifest that the
// dchub-backend FAILOVER publisher fetches (with GitHub raw as fallback). Two
// invariants must hold or the failover could publish a bad body to the official
// MCP registry:
//   1. server.json is a valid, complete registry-schema entry for cloud.dchub.
//   2. the route serves it with version overridden to SERVER_VERSION, so a
//      file-sync lag can't advertise a version this process isn't running.
// No HTTP harness in this repo, so (2) is asserted against the route's source —
// same static-source style as manifest-description-heals.test.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MCP_PATHS } from '../server.mjs';

const SERVER_JSON = JSON.parse(
  readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

describe('server.json (the body GET /server.json publishes)', () => {
  it('is a complete registry-schema entry for cloud.dchub/mcp-server', () => {
    expect(SERVER_JSON.name).toBe('cloud.dchub/mcp-server');
    expect(SERVER_JSON.$schema).toMatch(/server\.schema\.json$/);
    expect(SERVER_JSON.version).toMatch(/^\d+\.\d+\.\d+/);
    // ── r-cascade-path (2026-09-04) ─────────────────────────────────────
    // The remote the registry advertises must be the live MCP endpoint. That
    // was pinned to the literal '/mcp'; the endpoint is now '/mcp/registry',
    // the shared cascade arrival tag, so the LITERAL is no longer the
    // invariant — being genuinely routed is. Asserting membership in
    // MCP_PATHS is strictly stronger: it would also have caught a typo'd
    // '/mpc', which the old equality check could only catch for one value.
    const remote = SERVER_JSON.remotes?.[0]?.url;
    expect(remote).toMatch(/^https:\/\/dchub\.cloud\//);
    expect(MCP_PATHS).toContain(new URL(remote).pathname);
  });
});

describe('GET /server.json route', () => {
  it('is registered', () => {
    expect(SRC).toMatch(/app\.get\(\s*['"]\/server\.json['"]/);
  });

  it('overrides version with SERVER_VERSION (no file-sync-lag publishes)', () => {
    // isolate the route body and assert the override is present inside it
    const start = SRC.indexOf("app.get('/server.json'");
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 800);
    expect(body).toMatch(/\.version\s*=\s*SERVER_VERSION/);
    expect(body).toMatch(/readFileSync\(new URL\('\.\/server\.json'/);
  });
});
