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

const SERVER_JSON = JSON.parse(
  readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

describe('server.json (the body GET /server.json publishes)', () => {
  it('is a complete registry-schema entry for cloud.dchub/mcp-server', () => {
    expect(SERVER_JSON.name).toBe('cloud.dchub/mcp-server');
    expect(SERVER_JSON.$schema).toMatch(/server\.schema\.json$/);
    expect(SERVER_JSON.version).toMatch(/^\d+\.\d+\.\d+/);
    // the remote the registry advertises must be the live MCP endpoint
    expect(SERVER_JSON.remotes?.[0]?.url).toBe('https://dchub.cloud/mcp');
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
