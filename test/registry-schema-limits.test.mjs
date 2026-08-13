import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// server.json is what the OFFICIAL MCP registry ingests, and most directories
// mirror the official registry. Its schema caps `description` at 100 chars.
//
// On 2026-08-13 a liveness rewrite pushed it to 354. Nothing in the repo would
// have caught that: the stale-number guard checks VALUES, the manifest sync
// heals QUANTITIES, and neither reads the schema. The publish would have been
// rejected at the registry — after the version bump, after the workflow went
// green — and the failure would have surfaced as "listing looks stale" days
// later, in a different system, with no obvious cause.
//
// That is the whole reason this file exists: the batch sync writes 30 registry
// surfaces in one run, so a constraint nothing checks is a constraint that
// breaks 30 things quietly.
//
// Limits are asserted against the SCHEMA URL the file itself declares, so a
// schema bump cannot leave this guard measuring a retired rule. The live fetch
// is opt-in (LIVE_PROBE=1); the offline default pins the known cap so CI still
// fails on a violation without needing the network.

const SERVER_JSON = JSON.parse(
  fs.readFileSync(new URL('../server.json', import.meta.url), 'utf8'),
);

// Known cap for schema 2025-12-11 → definitions.ServerDetail.properties.description.
const KNOWN_DESCRIPTION_MAX = 100;

describe('server.json respects the official registry schema', () => {
  it('declares the schema it is validated against', () => {
    expect(SERVER_JSON.$schema).toMatch(/modelcontextprotocol\.io\/schemas\//);
  });

  it('description is within the registry cap', () => {
    const n = SERVER_JSON.description.length;
    expect(
      n,
      `server.json description is ${n} chars; the registry rejects >${KNOWN_DESCRIPTION_MAX}. ` +
        `Long-form copy belongs in mcp-server.json, which has no such cap.`,
    ).toBeLessThanOrEqual(KNOWN_DESCRIPTION_MAX);
  });

  it('still carries a real description, not an empty stub', () => {
    expect(SERVER_JSON.description.trim().length).toBeGreaterThan(20);
  });

  it('keeps the fields the registry requires', () => {
    for (const k of ['name', 'version', 'description', 'repository']) {
      expect(SERVER_JSON[k], `server.json lost required field '${k}'`).toBeTruthy();
    }
  });
});

describe.runIf(process.env.LIVE_PROBE === '1')('the cap we pin matches the live schema', () => {
  it('re-reads maxLength from the declared schema URL', async () => {
    const r = await fetch(SERVER_JSON.$schema);
    expect(r.status).toBe(200);
    const schema = await r.json();
    const live = schema?.definitions?.ServerDetail?.properties?.description?.maxLength;
    expect(
      live,
      'could not locate description.maxLength in the live schema — the shape moved, ' +
        're-derive KNOWN_DESCRIPTION_MAX before trusting this guard',
    ).toBeTypeOf('number');
    expect(
      live,
      `schema now caps description at ${live}; this test pins ${KNOWN_DESCRIPTION_MAX}`,
    ).toBe(KNOWN_DESCRIPTION_MAX);
    expect(SERVER_JSON.description.length).toBeLessThanOrEqual(live);
  }, 30000);
});
