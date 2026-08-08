// The Smithery first touch — measured 2026-08-08 over 30d, 666 sessions.
//
//   346 sessions (52%) hit anon_daily_cap; 180 recovered by minting a key and
//   166 JUST STOPPED — 25% of every Smithery session died at the anonymous wall.
//   list_saved_sites was simultaneously the #1 OPENING tool (167 sessions) and
//   the #1 GATED tool (158 events): a quarter of sessions led with a call that
//   cannot work without a key.
//
// Two causes, both fixed here:
//   1. smithery.yaml told installers that blank = "the free anonymous tier
//      (10 calls/day)". tier_registry says anonymous is mcp_daily=5 and FREE
//      (keyed) is 10 — lowered 10->5 on 2026-08-03, and this copy never
//      followed. It advertised the keyed benefit as the keyless default, which
//      deletes the reason to paste a key.
//   2. save_site / list_saved_sites buried "needs a key" in a parenthetical.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const YAML = readFileSync(new URL('../smithery.yaml', import.meta.url), 'utf8');
const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

describe('smithery.yaml install config', () => {
  it('does NOT advertise the keyed 10/day as the anonymous default', () => {
    // The exact stale claim. tier_registry: anonymous mcp_daily=5, free=10.
    expect(YAML).not.toMatch(/anonymous tier \(10 calls\/day\)/);
  });

  it('states the real anonymous limit', () => {
    expect(YAML).toMatch(/5 calls\/day/);
  });

  it('still declares the apiKey config and header injection', () => {
    // Kills: rewriting the copy while breaking the mechanism it describes.
    expect(YAML).toMatch(/configSchema:/);
    expect(YAML).toMatch(/apiKey:/);
    expect(YAML).toMatch(/X-API-Key: "\{\{apiKey\}\}"/);
  });

  it('keeps the key OPTIONAL — keyless use must not break', () => {
    // 5/day anonymous is a real, supported tier. Requiring the key would wall
    // the front door we are trying to widen.
    expect(YAML).toMatch(/required: \[\]/);
  });
});

describe('saved-work tool descriptions lead with the key requirement', () => {
  for (const tool of ['list_saved_sites', 'save_site']) {
    it(`${tool} says NEEDS A KEY before anything else`, () => {
      const i = SRC.indexOf(`trackedTool(srv, '${tool}', '`);
      expect(i).toBeGreaterThan(-1);
      const desc = SRC.slice(i + `trackedTool(srv, '${tool}', '`.length, i + 400);
      expect(desc.startsWith('NEEDS A KEY (free):')).toBe(true);
      expect(desc).toMatch(/claim_free_key/);
      // The honest reason, not a rate-limit story: these 401 because they are
      // per-account, which is a different fact from "you used up your calls".
      expect(desc).toMatch(/auth_required/);
    });
  }

  it('neither tool was moved into PRO_ONLY (they are free WITH a key)', () => {
    const i = SRC.indexOf('const PRO_ONLY_TOOLS = new Set([');
    const block = SRC.slice(i, i + 800);
    expect(block).not.toMatch(/'list_saved_sites'/);
    expect(block).not.toMatch(/'save_site'/);
  });
});
